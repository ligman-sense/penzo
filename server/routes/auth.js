'use strict';

const { Router } = require('express');
const { USER_COOKIE, clearSessionCookie, setSessionCookie } = require('../utils/cookies');
const { noStore, requireCsrf, optionalUser, requireUser } = require('../middleware/auth');
const { otpSendLimiter, otpVerifyLimiter } = require('../middleware/rateLimits');
const { sendOtp } = require('../services/otpService');
const { loginWithOtp, toSessionUser } = require('../services/authService');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const { revokeSession } = require('../services/sessionService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const { HttpError } = require('../utils/httpError');
const env = require('../config/env');

const authRouter = Router();
authRouter.use(noStore);

authRouter.post(
  '/otp/send',
  otpSendLimiter,
  asyncHandler(async (req, res) => {
    const { mobile } = req.body || {};
    if (!mobile || typeof mobile !== 'string') {
      throw HttpError.badRequest('Valid mobile number in E.164 format is required.');
    }
    const cleanMobile = mobile.replace(/\s+/g, '');
    const { challenge, code } = await sendOtp(cleanMobile, { ipAddress: req.ip });
    const payload = {
      expiresInSeconds: 300,
      resendAfterSeconds: 30,
      provider: challenge?.provider || 'development',
    };
    if (env.OTP_PROVIDER === 'development' || env.NODE_ENV !== 'production') {
      payload.devCode = code;
    }
    ok(res, payload);
  })
);

authRouter.post(
  '/otp/verify',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { mobile, role } = req.body || {};
    const code = req.body?.code || req.body?.otp;
    if (!mobile || !code) {
      throw HttpError.badRequest('Mobile number and verification code are required.');
    }
    const cleanMobile = mobile.replace(/\s+/g, '');

    const previous = req.cookies?.[USER_COOKIE];
    if (typeof previous === 'string') await revokeSession(previous);

    const { user, session, token, isNewUser } = await loginWithOtp({
      mobile: cleanMobile,
      code,
      role: role || 'CANDIDATE',
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    setSessionCookie(res, USER_COOKIE, token, session.expiresAt);
    ok(res, {
      user: toSessionUser(user),
      csrfToken: session.csrfToken,
      isNewUser,
    });
  })
);

authRouter.post(
  '/register',
  requireUser,
  asyncHandler(async (req, res) => {
    const { mobile, role } = req.body || {};
    if (!role || !['CANDIDATE', 'VOLUNTEER'].includes(role)) {
      throw HttpError.badRequest('A valid role (CANDIDATE or VOLUNTEER) is required.');
    }

    const cleanMobile = mobile ? String(mobile).replace(/\s+/g, '') : null;
    if (cleanMobile && cleanMobile !== req.auth.user.mobileE164) {
      throw HttpError.forbidden('You can only update your own user account.');
    }

    const user = await User.findById(req.auth.user._id);
    if (!user) {
      throw HttpError.notFound('User account not found.');
    }

    user.role = role;
    await user.save();

    if (role === 'CANDIDATE') {
      const exists = await CandidateProfile.findOne({ userId: user._id });
      if (!exists) await CandidateProfile.create({ userId: user._id });
    } else if (role === 'VOLUNTEER') {
      const exists = await VolunteerProfile.findOne({ userId: user._id });
      if (!exists) await VolunteerProfile.create({ userId: user._id });
    }

    ok(res, { success: true, role, csrfToken: req.auth.csrfToken });
  })
);

authRouter.get(
  '/session',
  asyncHandler(async (req, res) => {
    if (req.auth?.kind === 'user') {
      ok(res, {
        authenticated: true,
        user: toSessionUser(req.auth.user),
        csrfToken: req.auth.csrfToken,
      });
    } else {
      ok(res, { authenticated: false });
    }
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[USER_COOKIE];
    if (typeof token === 'string') await revokeSession(token);
    clearSessionCookie(res, USER_COOKIE);
    ok(res, { loggedOut: true });
  })
);

module.exports = { authRouter };
