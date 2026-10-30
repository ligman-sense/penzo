const OtpChallenge = require('../models/OtpChallenge');
const { generateOtp, hashOtp } = require('../utils/crypto');
const { HttpError } = require('../utils/httpError');
const env = require('../config/env');

/**
 * Send OTP to mobileE164.
 * Enforces resend cooldown. Invalidates old challenges.
 * Returns the challenge document.
 */
async function sendOtp(mobileE164, { ipAddress } = {}) {
  // Check resend cooldown: look for recent challenge
  const cooldownCutoff = new Date(Date.now() - env.OTP_RESEND_COOLDOWN_SECONDS * 1000);
  const recent = await OtpChallenge.findOne({
    mobileE164,
    sentAt: { $gt: cooldownCutoff },
    consumedAt: null,
  }).sort({ sentAt: -1 });

  if (recent) {
    const waitSeconds = Math.ceil(
      (recent.sentAt.getTime() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000
    );
    throw HttpError.tooMany(
      `Please wait ${waitSeconds} second(s) before requesting a new code.`,
      { waitSeconds }
    );
  }

  const code = generateOtp();
  const codeHash = hashOtp(mobileE164, code);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

  // Expire old active challenges for this number
  await OtpChallenge.updateMany(
    { mobileE164, consumedAt: null, expiresAt: { $gt: new Date() } },
    { expiresAt: new Date() }
  );

  const challenge = await OtpChallenge.create({
    mobileE164,
    codeHash,
    expiresAt,
    maxAttempts: env.OTP_MAX_VERIFY_ATTEMPTS,
    provider: env.OTP_PROVIDER,
    ipAddress: ipAddress || null,
    sentAt: new Date(),
  });

  await deliverOtp(mobileE164, code);

  return { challenge, code };
}

/**
 * Verify OTP code. Returns the challenge on success, throws on failure.
 */
async function verifyOtp(mobileE164, code) {
  const challenge = await OtpChallenge.findOne({
    mobileE164,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!challenge) {
    throw HttpError.invalidOtp('No active verification code found. Please request a new one.');
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    throw HttpError.invalidOtp('Too many incorrect attempts. Please request a new code.');
  }

  const expectedHash = hashOtp(mobileE164, code);
  const match = challenge.codeHash === expectedHash;

  if (!match) {
    challenge.attempts += 1;
    await challenge.save();
    const remaining = challenge.maxAttempts - challenge.attempts;
    if (remaining <= 0) {
      throw HttpError.invalidOtp('Too many incorrect attempts. Please request a new code.');
    }
    throw HttpError.invalidOtp(`Incorrect code. ${remaining} attempt(s) remaining.`);
  }

  challenge.consumedAt = new Date();
  await challenge.save();

  return challenge;
}

/**
 * Deliver OTP via configured provider.
 */
async function deliverOtp(mobileE164, code) {
  if (env.OTP_PROVIDER === 'development') {
    console.log(`\n[OTP] ============================`);
    console.log(`[OTP] Mobile : ${mobileE164}`);
    console.log(`[OTP] Code   : ${code}`);
    console.log(`[OTP] ============================\n`);
    return;
  }

  if (env.OTP_PROVIDER === 'sms') {
    // Placeholder: integrate real SMS gateway here
    throw { status: 503, code: 'SMS_UNAVAILABLE', message: 'SMS provider not configured. Contact support.' };
  }

  throw new Error(`Unknown OTP_PROVIDER: ${env.OTP_PROVIDER}`);
}

module.exports = { sendOtp, verifyOtp };
