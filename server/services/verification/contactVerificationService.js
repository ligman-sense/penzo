'use strict';

const crypto = require('crypto');
const User = require('../../models/User');
const ContactVerificationChallenge = require('../../models/ContactVerificationChallenge');
const { getSmsAdapter } = require('./smsVerificationAdapter');
const { getEmailAdapter } = require('./emailVerificationAdapter');
const { normalizeAndValidateIndianMobile } = require('../../utils/phoneValidator');
const { HttpError } = require('../../utils/httpError');

const RESEND_COOLDOWN_SECONDS = 60;
const CHALLENGE_TTL_SECONDS = 600; // 10 minutes
const MAX_VERIFY_ATTEMPTS = 5;

function hashChallengeCode(userId, destination, code) {
  return crypto
    .createHash('sha256')
    .update(`${String(userId)}:${destination.trim().toLowerCase()}:${code.trim()}`)
    .digest('hex');
}

function generateSecureCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Initiate Mobile OTP Verification.
 * Strictly supports Indian mobile numbers (+91).
 */
async function initiateMobileVerification(userId, mobileInput, { ipAddress } = {}) {
  const user = await User.findById(userId);
  if (!user) throw HttpError.notFound('User not found.');

  // Check if mobile login identity is being changed
  if (user.authProvider === 'OTP' && user.mobileE164) {
    throw HttpError.badRequest('Mobile login identity cannot be changed.');
  }

  const canonicalMobile = normalizeAndValidateIndianMobile(mobileInput);

  // Prevent conflict if already verified on another account
  const existingUser = await User.findOne({
    _id: { $ne: user._id },
    mobileE164: canonicalMobile,
    isMobileVerified: true,
  });
  if (existingUser) {
    throw HttpError.badRequest(
      'This mobile number is already registered and verified with another PENZO account.'
    );
  }

  // Cooldown check against active challenges
  const cooldownCutoff = new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000);
  const recentChallenge = await ContactVerificationChallenge.findOne({
    userId: user._id,
    contactType: 'MOBILE',
    sentAt: { $gt: cooldownCutoff },
    consumedAt: null,
  }).sort({ sentAt: -1 });

  if (recentChallenge) {
    const elapsed = Math.floor((Date.now() - recentChallenge.sentAt.getTime()) / 1000);
    const waitSeconds = Math.max(1, RESEND_COOLDOWN_SECONDS - elapsed);
    throw HttpError.tooMany(
      `Please wait ${waitSeconds} second(s) before requesting a new verification code.`,
      { waitSeconds }
    );
  }

  // Invalidate any active prior challenges for this user's mobile verification
  await ContactVerificationChallenge.updateMany(
    { userId: user._id, contactType: 'MOBILE', consumedAt: null },
    { expiresAt: new Date() }
  );

  const code = generateSecureCode();
  const codeHash = hashChallengeCode(user._id, canonicalMobile, code);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);

  const smsAdapter = getSmsAdapter();

  const challenge = await ContactVerificationChallenge.create({
    userId: user._id,
    contactType: 'MOBILE',
    destination: canonicalMobile,
    codeHash,
    purpose: 'PROFILE_MOBILE_VERIFICATION',
    attempts: 0,
    maxAttempts: MAX_VERIFY_ATTEMPTS,
    expiresAt,
    sentAt: new Date(),
    provider: smsAdapter.name,
    ipAddress: ipAddress || null,
  });

  // Persist pending mobile number
  user.pendingMobileE164 = canonicalMobile;
  await user.save();

  await smsAdapter.sendOtp({
    destination: canonicalMobile,
    code,
    expiresInSeconds: CHALLENGE_TTL_SECONDS,
  });

  return {
    success: true,
    message: 'Verification code sent to your mobile number.',
    expiresInSeconds: CHALLENGE_TTL_SECONDS,
    resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
    destination: canonicalMobile,
  };
}

/**
 * Confirm Mobile OTP Verification.
 */
async function confirmMobileVerification(userId, code) {
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw HttpError.badRequest('Verification code is required.');
  }

  const user = await User.findById(userId);
  if (!user) throw HttpError.notFound('User not found.');

  const challenge = await ContactVerificationChallenge.findOne({
    userId: user._id,
    contactType: 'MOBILE',
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!challenge) {
    throw HttpError.invalidOtp(
      'No active verification code found or the code has expired. Please request a new code.'
    );
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    throw HttpError.invalidOtp('Too many incorrect attempts. Please request a new verification code.');
  }

  const expectedHash = hashChallengeCode(user._id, challenge.destination, code);
  if (challenge.codeHash !== expectedHash) {
    challenge.attempts += 1;
    await challenge.save();
    const remaining = challenge.maxAttempts - challenge.attempts;
    if (remaining <= 0) {
      throw HttpError.invalidOtp('Too many incorrect attempts. Please request a new verification code.');
    }
    throw HttpError.invalidOtp(`Incorrect code. ${remaining} attempt(s) remaining.`);
  }

  // Mark challenge consumed
  challenge.consumedAt = new Date();
  await challenge.save();

  // Atomically update user contact status
  user.mobileE164 = challenge.destination;
  user.isMobileVerified = true;
  user.mobileVerifiedAt = new Date();
  user.mobileVerificationSource = 'PROFILE_OTP';
  user.pendingMobileE164 = null;
  await user.save();

  return {
    success: true,
    message: 'Mobile number verified successfully.',
    mobile: user.mobileE164,
    isMobileVerified: true,
    mobileVerifiedAt: user.mobileVerifiedAt,
  };
}

/**
 * Initiate Email Verification.
 * For mobile-login users adding/updating an email address.
 */
async function initiateEmailVerification(userId, emailInput, { ipAddress } = {}) {
  const user = await User.findById(userId);
  if (!user) throw HttpError.notFound('User not found.');

  if (user.authProvider === 'GOOGLE') {
    throw HttpError.badRequest('OAuth account email is managed by Google and cannot be modified.');
  }

  if (!emailInput || typeof emailInput !== 'string') {
    throw HttpError.badRequest('Email address is required.');
  }

  const cleanEmail = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw HttpError.badRequest('Please enter a valid email address.');
  }

  // Prevent linking if already verified on another account
  const existingUser = await User.findOne({
    _id: { $ne: user._id },
    email: cleanEmail,
    isEmailVerified: true,
  });
  if (existingUser) {
    throw HttpError.badRequest(
      'This email address is already registered and verified with another PENZO account.'
    );
  }

  // Cooldown check
  const cooldownCutoff = new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000);
  const recentChallenge = await ContactVerificationChallenge.findOne({
    userId: user._id,
    contactType: 'EMAIL',
    sentAt: { $gt: cooldownCutoff },
    consumedAt: null,
  }).sort({ sentAt: -1 });

  if (recentChallenge) {
    const elapsed = Math.floor((Date.now() - recentChallenge.sentAt.getTime()) / 1000);
    const waitSeconds = Math.max(1, RESEND_COOLDOWN_SECONDS - elapsed);
    throw HttpError.tooMany(
      `Please wait ${waitSeconds} second(s) before requesting a new verification code.`,
      { waitSeconds }
    );
  }

  // Invalidate any active prior challenges for this user's email verification
  await ContactVerificationChallenge.updateMany(
    { userId: user._id, contactType: 'EMAIL', consumedAt: null },
    { expiresAt: new Date() }
  );

  const code = generateSecureCode();
  const codeHash = hashChallengeCode(user._id, cleanEmail, code);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);

  const emailAdapter = getEmailAdapter();

  await ContactVerificationChallenge.create({
    userId: user._id,
    contactType: 'EMAIL',
    destination: cleanEmail,
    codeHash,
    purpose: 'PROFILE_EMAIL_VERIFICATION',
    attempts: 0,
    maxAttempts: MAX_VERIFY_ATTEMPTS,
    expiresAt,
    sentAt: new Date(),
    provider: emailAdapter.name,
    ipAddress: ipAddress || null,
  });

  // Set pending email on user, keeping existing verified email intact
  user.pendingEmail = cleanEmail;
  await user.save();

  await emailAdapter.sendVerificationCode({
    destination: cleanEmail,
    code,
    expiresInSeconds: CHALLENGE_TTL_SECONDS,
  });

  return {
    success: true,
    message: 'Verification code sent to your email address.',
    expiresInSeconds: CHALLENGE_TTL_SECONDS,
    resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
    destination: cleanEmail,
  };
}

/**
 * Confirm Email Verification.
 */
async function confirmEmailVerification(userId, code) {
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw HttpError.badRequest('Verification code is required.');
  }

  const user = await User.findById(userId);
  if (!user) throw HttpError.notFound('User not found.');

  if (user.authProvider === 'GOOGLE') {
    throw HttpError.badRequest('OAuth account email cannot be modified.');
  }

  const challenge = await ContactVerificationChallenge.findOne({
    userId: user._id,
    contactType: 'EMAIL',
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!challenge) {
    throw HttpError.invalidOtp(
      'No active email verification code found or the code has expired. Please request a new code.'
    );
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    throw HttpError.invalidOtp('Too many incorrect attempts. Please request a new verification code.');
  }

  const expectedHash = hashChallengeCode(user._id, challenge.destination, code);
  if (challenge.codeHash !== expectedHash) {
    challenge.attempts += 1;
    await challenge.save();
    const remaining = challenge.maxAttempts - challenge.attempts;
    if (remaining <= 0) {
      throw HttpError.invalidOtp('Too many incorrect attempts. Please request a new verification code.');
    }
    throw HttpError.invalidOtp(`Incorrect code. ${remaining} attempt(s) remaining.`);
  }

  challenge.consumedAt = new Date();
  await challenge.save();

  // Atomically update user email
  user.email = challenge.destination;
  user.isEmailVerified = true;
  user.emailVerifiedAt = new Date();
  user.emailVerificationSource = 'EMAIL_OTP';
  user.pendingEmail = null;
  await user.save();

  return {
    success: true,
    message: 'Email address verified successfully.',
    email: user.email,
    isEmailVerified: true,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}

module.exports = {
  initiateMobileVerification,
  confirmMobileVerification,
  initiateEmailVerification,
  confirmEmailVerification,
};
