'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const PasswordResetChallenge = require('../models/PasswordResetChallenge');
const { sendPasswordResetOtp } = require('./emailService');
const { hashPassword, validatePasswordPolicy } = require('../utils/password');
const { HttpError } = require('../utils/httpError');
const env = require('../config/env');

function hashOtp(otp) {
  const secret = env.SESSION_SECRET || 'penzo-otp-secret';
  return crypto.createHmac('sha256', secret).update(String(otp).trim()).digest('hex');
}

function hashResetToken(token) {
  const secret = env.SESSION_SECRET || 'penzo-token-secret';
  return crypto.createHmac('sha256', secret).update(String(token).trim()).digest('hex');
}

/**
 * Request a 6-digit password reset OTP.
 * Returns generic message to prevent account enumeration.
 */
async function requestPasswordReset(rawEmail) {
  if (!rawEmail || typeof rawEmail !== 'string') {
    throw HttpError.badRequest('Please enter a valid email address.');
  }

  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw HttpError.badRequest('Please enter a valid email address.');
  }

  // Check resend cooldown on existing active challenge
  const existing = await PasswordResetChallenge.findOne({
    email,
    used: false,
    resendAvailableAt: { $gt: new Date() },
  });

  if (existing) {
    const remainingSecs = Math.ceil((new Date(existing.resendAvailableAt).getTime() - Date.now()) / 1000);
    throw new HttpError(429, 'RATE_LIMITED', `Please wait ${remainingSecs} seconds before requesting another code.`);
  }

  // Invalidate any older unused challenges for this email
  await PasswordResetChallenge.updateMany(
    { email, used: false },
    { $set: { used: true } }
  );

  const user = await User.findOne({ email });

  if (user) {
    // Generate secure 6-digit random code
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashOtp(otpCode);

    const expirySecs = env.PASSWORD_RESET_OTP_EXPIRY || 300;
    const cooldownSecs = env.PASSWORD_RESET_RESEND_COOLDOWN || 60;

    const expiresAt = new Date(Date.now() + expirySecs * 1000);
    const resendAvailableAt = new Date(Date.now() + cooldownSecs * 1000);
    const maxAttempts = env.PASSWORD_RESET_MAX_ATTEMPTS || 5;

    await PasswordResetChallenge.create({
      userId: user._id,
      email,
      otpHash,
      attempts: 0,
      maxAttempts,
      expiresAt,
      resendAvailableAt,
      used: false,
    });

    try {
      await sendPasswordResetOtp({
        toEmail: user.email,
        otpCode,
        expiryMinutes: Math.round(expirySecs / 60),
      });
    } catch (err) {
      console.error('[Password Reset Service] Email send failure:', err.message);
    }
  }

  // Generic message: never reveal whether the account exists
  return {
    success: true,
    message: 'If an account exists with this email address, a password reset code has been sent.',
  };
}

/**
 * Verify 6-digit password reset OTP and return a single-use resetToken.
 */
async function verifyPasswordResetOtp(rawEmail, otp) {
  if (!rawEmail || !otp) {
    throw HttpError.badRequest('Email and 6-digit verification code are required.');
  }

  const email = rawEmail.trim().toLowerCase();
  const cleanOtp = String(otp).trim();

  const challenge = await PasswordResetChallenge.findOne({
    email,
    used: false,
  }).sort({ createdAt: -1 });

  if (!challenge) {
    throw HttpError.badRequest('No active password reset request found. Please request a new code.');
  }

  if (new Date() > new Date(challenge.expiresAt)) {
    challenge.used = true;
    await challenge.save();
    throw HttpError.badRequest('Verification code has expired. Please request a new code.');
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    challenge.used = true;
    await challenge.save();
    throw HttpError.badRequest('Maximum verification attempts exceeded. Please request a new code.');
  }

  challenge.attempts += 1;

  const candidateHash = hashOtp(cleanOtp);
  const isValid = crypto.timingSafeEqual(
    Buffer.from(candidateHash, 'hex'),
    Buffer.from(challenge.otpHash, 'hex')
  );

  if (!isValid) {
    await challenge.save();
    const remaining = challenge.maxAttempts - challenge.attempts;
    if (remaining <= 0) {
      challenge.used = true;
      await challenge.save();
      throw HttpError.badRequest('Maximum attempts exceeded. Please request a new code.');
    }
    throw HttpError.badRequest(`Incorrect verification code. ${remaining} attempt(s) remaining.`);
  }

  // Generate single-use cryptographically random reset token valid for 10 minutes
  const resetToken = crypto.randomBytes(32).toString('hex');
  challenge.resetTokenHash = hashResetToken(resetToken);
  challenge.resetTokenExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await challenge.save();

  return {
    success: true,
    resetToken,
    message: 'Verification code confirmed. Please set your new password.',
  };
}

/**
 * Complete password reset using verified resetToken.
 */
async function completePasswordReset({ rawEmail, resetToken, newPassword }) {
  if (!rawEmail || !resetToken || !newPassword) {
    throw HttpError.badRequest('Email, reset token, and new password are required.');
  }

  const email = rawEmail.trim().toLowerCase();

  const passValidation = validatePasswordPolicy(newPassword);
  if (!passValidation.isValid) {
    throw HttpError.badRequest(passValidation.errors.join(' '));
  }

  const tokenHash = hashResetToken(resetToken);

  const challenge = await PasswordResetChallenge.findOne({
    email,
    resetTokenHash: tokenHash,
    used: false,
    resetTokenExpiresAt: { $gt: new Date() },
  });

  if (!challenge) {
    throw HttpError.badRequest('Invalid or expired reset session. Please request a new code.');
  }

  const user = await User.findById(challenge.userId);
  if (!user) {
    throw HttpError.notFound('Account not found.');
  }

  // Hash new password using existing scrypt algorithm
  user.passwordHash = await hashPassword(newPassword);
  if (user.authProvider === 'OTP') {
    user.authProvider = 'PASSWORD';
  }
  await user.save();

  // Invalidate challenge and any remaining challenges
  challenge.used = true;
  await challenge.save();

  await PasswordResetChallenge.updateMany(
    { email, used: false },
    { $set: { used: true } }
  );

  // Invalidate existing sessions in MongoDB if session collection exists
  try {
    const sessionCollection = mongoose.connection.collection('sessions');
    if (sessionCollection) {
      await sessionCollection.deleteMany({
        $or: [
          { 'session.userId': user._id.toString() },
          { 'session.passport.user': user._id.toString() },
        ],
      });
    }
  } catch (err) {
    // Session collection cleanup non-critical
  }

  return {
    success: true,
    message: 'Password has been reset successfully. Please sign in with your new password.',
  };
}

module.exports = {
  requestPasswordReset,
  verifyPasswordResetOtp,
  completePasswordReset,
};
