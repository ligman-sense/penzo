'use strict';

const OtpChallenge = require('../models/OtpChallenge');
const { generateOtp, hashOtp } = require('../utils/crypto');
const { HttpError } = require('../utils/httpError');
const env = require('../config/env');

const RESEND_WINDOW_MS = 15 * 60 * 1000; // 15-minute rolling window for resends
const MAX_RESENDS_PER_WINDOW = 4; // Initial send + 4 resends = 5 total attempts

/**
 * Send OTP to mobileE164.
 * Enforces durable resend cooldown and attempt limits across process restarts.
 * Invalidates old challenges.
 * Returns the challenge document and code.
 */
async function sendOtp(mobileE164, options = {}) {
  const { ipAddress = null, skipCooldown = false } = options;

  // Look for the most recent challenge for this mobile within the resend window
  const windowCutoff = new Date(Date.now() - RESEND_WINDOW_MS);
  const recent = await OtpChallenge.findOne({
    mobileE164,
    createdAt: { $gte: windowCutoff },
  }).sort({ createdAt: -1 });

  let nextResendCount = 0;

  if (recent) {
    const cooldownSeconds = env.OTP_RESEND_COOLDOWN_SECONDS || 30;
    const elapsedSeconds = (Date.now() - new Date(recent.sentAt).getTime()) / 1000;

    // Enforce cooldown if not explicitly skipped
    if (!skipCooldown && cooldownSeconds > 0 && elapsedSeconds < cooldownSeconds) {
      const waitSeconds = Math.ceil(cooldownSeconds - elapsedSeconds);
      throw HttpError.tooMany(
        `Please wait ${waitSeconds} second(s) before requesting a new code.`,
        { waitSeconds }
      );
    }

    // Enforce durable maximum resend limit across restarts
    if (recent.resendCount >= MAX_RESENDS_PER_WINDOW) {
      throw HttpError.tooMany(
        'Maximum OTP resend attempts exceeded for this mobile number. Please try again after 15 minutes.'
      );
    }

    nextResendCount = (recent.resendCount || 0) + 1;
  }

  const code = generateOtp();
  const codeHash = hashOtp(mobileE164, code);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

  // Invalidate any prior unconsumed active challenges for this number
  await OtpChallenge.updateMany(
    { mobileE164, consumedAt: null, expiresAt: { $gt: new Date() } },
    { consumedAt: new Date() }
  );

  const challenge = await OtpChallenge.create({
    mobileE164,
    codeHash,
    expiresAt,
    maxAttempts: env.OTP_MAX_VERIFY_ATTEMPTS,
    provider: env.OTP_PROVIDER,
    ipAddress,
    sentAt: new Date(),
    resendCount: nextResendCount,
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
    if (env.NODE_ENV !== 'production') {
      console.log(`\n[OTP] ============================`);
      console.log(`[OTP] Mobile : ${mobileE164}`);
      console.log(`[OTP] Code   : ${code}`);
      console.log(`[OTP] ============================\n`);
    }
    return;
  }

  if (env.OTP_PROVIDER === 'sms') {
    const gateway = (
      process.env.SMS_PROVIDER ||
      process.env.SMS_GATEWAY ||
      (process.env.FAST2SMS_API_KEY ? 'fast2sms' : 'twilio')
    ).toLowerCase();

    if (gateway === 'fast2sms') {
      const { sendFast2Sms } = require('./verification/fast2smsService');
      await sendFast2Sms({ destination: mobileE164, code });
      return;
    }

    const { sendTwilioSms } = require('./verification/twilioService');
    await sendTwilioSms({ destination: mobileE164, code });
    return;
  }

  throw new Error(`Unknown OTP_PROVIDER: ${env.OTP_PROVIDER}`);
}

module.exports = {
  sendOtp,
  verifyOtp,
  RESEND_WINDOW_MS,
  MAX_RESENDS_PER_WINDOW,
};
