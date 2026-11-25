'use strict';

const { Router } = require('express');
const { noStore, requireUser, requireRole } = require('../middleware/auth');
const { getProfile, saveProfile } = require('../services/profileService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const { HttpError } = require('../utils/httpError');

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

// ─── Deprecated Contact Verification Endpoints (410 Gone) ─────────────────────

const deprecatedVerificationHandler = asyncHandler(async () => {
  throw new HttpError(410, 'OTP_DEPRECATED', 'Contact OTP verification has been discontinued. Password authentication is in effect.');
});

profileRouter.post('/contact/mobile/send-otp', deprecatedVerificationHandler);
profileRouter.post('/contact/mobile/verify-otp', deprecatedVerificationHandler);
profileRouter.post('/contact/email/send-code', deprecatedVerificationHandler);
profileRouter.post('/contact/email/verify-code', deprecatedVerificationHandler);

module.exports = { profileRouter };
