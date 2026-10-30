'use strict';

const { Router } = require('express');
const { USER_COOKIE, clearSessionCookie, setSessionCookie } = require('../utils/cookies');
const { noStore, requireCsrf, optionalUser } = require('../middleware/auth');
const { otpSendLimiter, otpVerifyLimiter } = require('../middleware/rateLimits');
const { sendOtp } = require('../services/otpService');
const { loginWithOtp, toSessionUser } = require('../services/authService');
const User = require('../models/User');
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
  asyncHandler(async (req, res) => {
    const { mobile, role } = req.body || {};
    const cleanMobile = mobile ? mobile.replace(/\s+/g, '') : null;
    let user = await User.findOne({ mobileE164: cleanMobile });
    if (user && role) {
      user.role = role;
      await user.save();
    }
    ok(res, { success: true, role });
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
