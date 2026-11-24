'use strict';

const { Router } = require('express');
const { noStore, requireUser, requireRole } = require('../middleware/auth');
const { otpSendLimiter, otpVerifyLimiter } = require('../middleware/rateLimits');
const { getProfile, saveProfile } = require('../services/profileService');
const {
  initiateMobileVerification,
  confirmMobileVerification,
  initiateEmailVerification,
  confirmEmailVerification,
} = require('../services/verification/contactVerificationService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

const profileRouter = Router();
profileRouter.use(noStore, requireUser, requireRole('CANDIDATE', 'VOLUNTEER'));

profileRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, await getProfile(req.auth.user._id));
  })
);

profileRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const { _id, role } = req.auth.user;
    const result = await saveProfile(_id, { role, data: req.body });
    ok(res, result);
  })
);

// ─── Contact Verification Routes ──────────────────────────────────────────────

profileRouter.post(
  '/contact/mobile/send-otp',
  otpSendLimiter,
  asyncHandler(async (req, res) => {
    const { mobile } = req.body || {};
    const result = await initiateMobileVerification(req.auth.user._id, mobile, {
      ipAddress: req.ip,
    });
    ok(res, result);
  })
);

profileRouter.post(
  '/contact/mobile/verify-otp',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const code = req.body?.code || req.body?.otp;
    const result = await confirmMobileVerification(req.auth.user._id, code);
    ok(res, result);
  })
);

profileRouter.post(
  '/contact/email/send-code',
  otpSendLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    const result = await initiateEmailVerification(req.auth.user._id, email, {
      ipAddress: req.ip,
    });
    ok(res, result);
  })
);

profileRouter.post(
  '/contact/email/verify-code',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const code = req.body?.code || req.body?.otp;
    const result = await confirmEmailVerification(req.auth.user._id, code);
    ok(res, result);
  })
);

module.exports = { profileRouter };
