'use strict';

const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const { createUserSession } = require('./sessionService');
const { resolveUserName } = require('./authService');
const { HttpError } = require('../utils/httpError');
const env = require('../config/env');

/**
 * Check if Google OAuth credentials are fully provided in environment.
 */
function isGoogleOAuthConfigured() {
  return Boolean(
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_ID.trim() &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_CLIENT_SECRET.trim()
  );
}

/**
 * Generate Google OAuth 2.0 authorization URL.
 */
function getGoogleAuthUrl(state) {
  if (!isGoogleOAuthConfigured()) {
    throw HttpError.badRequest(
      'Google OAuth is not configured on this server. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.'
    );
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID.trim(),
    redirect_uri: env.GOOGLE_CALLBACK_URL.trim(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for Google access token.
 */
async function exchangeCodeForTokens(code) {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID.trim(),
    client_secret: env.GOOGLE_CLIENT_SECRET.trim(),
    redirect_uri: env.GOOGLE_CALLBACK_URL.trim(),
    grant_type: 'authorization_code',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    console.error('[Google OAuth Token Error]', data);
    throw HttpError.badRequest(data.error_description || 'Failed to exchange authorization code with Google.');
  }

  return data;
}

/**
 * Fetch user profile from Google UserInfo endpoint using access token.
 */
async function fetchGoogleUserInfo(accessToken) {
  const userInfoUrl = 'https://www.googleapis.com/oauth2/v3/userinfo';
  const response = await fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const profile = await response.json();
  if (!response.ok || !profile.sub) {
    console.error('[Google OAuth UserInfo Error]', profile);
    throw HttpError.badRequest('Failed to fetch user profile information from Google.');
  }

  return profile;
}

/**
 * Authenticate or register user using verified Google profile information.
 */
async function authenticateWithGoogle({ profile, ip, userAgent }) {
  const { sub: googleId, email, name, picture, given_name, family_name, email_verified } = profile;
  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  const isGoogleEmailVerified = Boolean(
    email_verified === true || email_verified === 'true'
  );

  if (!googleId) {
    throw HttpError.badRequest('Invalid Google profile: missing unique user identifier.');
  }

  let user = await User.findOne({ googleId });
  let isNewUser = false;
  const now = new Date();

  // If user not found by googleId, attempt to link via verified email address
  if (!user && cleanEmail) {
    user = await User.findOne({ email: cleanEmail });
    if (user) {
      user.googleId = googleId;
      if (picture && !user.avatarUrl) user.avatarUrl = picture;
      if (name && !user.name) user.name = name;
      user.authProvider = 'GOOGLE';
      if (isGoogleEmailVerified) {
        user.isEmailVerified = true;
        user.emailVerifiedAt = user.emailVerifiedAt || now;
        user.emailVerificationSource = 'GOOGLE';
      }
      await user.save();
    }
  }

  // If still not found, create a new user account
  if (!user) {
    user = await User.create({
      role: 'CANDIDATE', // Default initial role, user can select/switch in onboarding
      googleId,
      email: cleanEmail,
      isEmailVerified: isGoogleEmailVerified,
      emailVerifiedAt: isGoogleEmailVerified ? now : null,
      emailVerificationSource: isGoogleEmailVerified ? 'GOOGLE' : 'NONE',
      isMobileVerified: false,
      mobileVerifiedAt: null,
      mobileVerificationSource: 'NONE',
      name: name || (cleanEmail ? cleanEmail.split('@')[0] : 'User'),
      avatarUrl: picture || null,
      authProvider: 'GOOGLE',
      status: 'ACTIVE',
      profileComplete: false,
      lastLoginAt: now,
    });

    await CandidateProfile.create({
      userId: user._id,
      fullName: name || '',
      firstName: given_name || (name ? name.split(' ')[0] : ''),
      lastName: family_name || (name ? name.split(' ').slice(1).join(' ') : ''),
    });

    isNewUser = true;
  } else {
    if (user.status !== 'ACTIVE') {
      throw HttpError.forbidden('This account has been suspended. Please contact support.');
    }
    user.lastLoginAt = now;
    if (isGoogleEmailVerified && !user.isEmailVerified) {
      user.isEmailVerified = true;
      user.emailVerifiedAt = user.emailVerifiedAt || now;
      user.emailVerificationSource = 'GOOGLE';
    }
    if (picture && user.avatarUrl !== picture) {
      user.avatarUrl = picture;
    }
    await user.save();
  }

  const resolvedName = (await resolveUserName(user)) || user.name;
  const { token, session } = await createUserSession(user._id, { ipAddress: ip, userAgent });

  return { user, resolvedName, session, token, isNewUser };
}

module.exports = {
  isGoogleOAuthConfigured,
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  authenticateWithGoogle,
};
