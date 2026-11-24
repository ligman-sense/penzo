'use strict';

const { Router } = require('express');
const { USER_COOKIE, clearSessionCookie, setSessionCookie } = require('../utils/cookies');
const { noStore, requireCsrf, optionalUser, requireUser } = require('../middleware/auth');
const { otpSendLimiter, otpVerifyLimiter } = require('../middleware/rateLimits');
const { sendOtp } = require('../services/otpService');
const { loginWithOtp, resolveUserName, toSessionUser } = require('../services/authService');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const {
  isGoogleOAuthConfigured,
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  authenticateWithGoogle,
} = require('../services/googleAuthService');
const { revokeSession } = require('../services/sessionService');
const { normalizeAndValidateIndianMobile } = require('../utils/phoneValidator');
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
    const cleanMobile = normalizeAndValidateIndianMobile(mobile);
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
    const cleanMobile = normalizeAndValidateIndianMobile(mobile);

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
    const name = await resolveUserName(user);
    ok(res, {
      user: toSessionUser(user, name),
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
    if (cleanMobile && req.auth.user.mobileE164 && cleanMobile !== req.auth.user.mobileE164) {
      throw HttpError.forbidden('You can only update your own user account.');
    }

    const user = await User.findById(req.auth.user._id);
    if (!user) {
      throw HttpError.notFound('User account not found.');
    }

    user.role = role;
    if (cleanMobile && !user.mobileE164) {
      user.mobileE164 = cleanMobile;
    }
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

// ─── Google OAuth 2.0 ────────────────────────────────────────────────────────

const OAUTH_STATE_COOKIE = 'penzo_oauth_state';

authRouter.get(
  '/google',
  asyncHandler(async (req, res) => {
    const crypto = require('crypto');
    const state = crypto.randomBytes(32).toString('hex');

    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
      path: '/',
    });

    const googleUrl = getGoogleAuthUrl(state);
    res.redirect(googleUrl);
  })
);

authRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      console.warn('[Google OAuth Callback Error]', error);
      return res.redirect(`/login.html?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect('/login.html?error=MISSING_AUTH_CODE');
    }

    const storedState = req.cookies?.[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    if (!storedState || storedState !== state) {
      return res.redirect('/login.html?error=INVALID_OAUTH_STATE');
    }

    try {
      const tokens = await exchangeCodeForTokens(code);
      const profile = await fetchGoogleUserInfo(tokens.access_token);

      const previous = req.cookies?.[USER_COOKIE];
      if (typeof previous === 'string') await revokeSession(previous);

      const { user, session, token, isNewUser } = await authenticateWithGoogle({
        profile,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });

      setSessionCookie(res, USER_COOKIE, token, session.expiresAt);

      if (isNewUser) {
        return res.redirect('/login.html?oauth=new_user');
      }

      if (user.role === 'VOLUNTEER') {
        return res.redirect('/volunteer/dashboard.html');
      } else {
        return res.redirect('/candidate/dashboard.html');
      }
    } catch (err) {
      console.error('[Google OAuth Failure]', err);
      const message = err.message || 'Authentication failed. Please try again.';
      return res.redirect(`/login.html?error=${encodeURIComponent(message)}`);
    }
  })
);

authRouter.get(
  '/session',
  asyncHandler(async (req, res) => {
    if (req.auth?.kind === 'user') {
      const name = await resolveUserName(req.auth.user);
      ok(res, {
        authenticated: true,
        user: toSessionUser(req.auth.user, name),
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
