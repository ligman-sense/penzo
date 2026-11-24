'use strict';

const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const { verifyOtp } = require('./otpService');
const { createUserSession } = require('./sessionService');
const { HttpError } = require('../utils/httpError');

function maskMobile(e164) {
  if (!e164 || e164.length < 6) return e164 || '';
  return `${e164.slice(0, 3)}${'*'.repeat(Math.max(0, e164.length - 6))}${e164.slice(-3)}`;
}

async function resolveUserName(user) {
  if (!user || !user._id) return null;
  const ProfileModel = user.role === 'VOLUNTEER' ? VolunteerProfile : CandidateProfile;
  const profile = await ProfileModel.findOne({ userId: user._id })
    .select('fullName firstName lastName')
    .lean();
  if (!profile) return null;
  const fullName = typeof profile.fullName === 'string' ? profile.fullName.trim() : '';
  if (fullName) return fullName;
  const combined = [profile.firstName, profile.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return combined || null;
}

function toSessionUser(user, name = null) {
  return {
    id: user._id.toString(),
    role: user.role,
    name: name || user.name || null,
    mobile: user.mobileE164 || null,
    mobileMasked: maskMobile(user.mobileE164),
    isMobileVerified: Boolean(user.isMobileVerified),
    mobileVerifiedAt: user.mobileVerifiedAt || null,
    pendingMobile: user.pendingMobileE164 || null,
    email: user.email || null,
    isEmailVerified: Boolean(user.isEmailVerified),
    emailVerifiedAt: user.emailVerifiedAt || null,
    pendingEmail: user.pendingEmail || null,
    avatarUrl: user.avatarUrl || null,
    authProvider: user.authProvider || 'OTP',
    profileComplete: user.profileComplete,
    verificationStatus: user.verificationStatus || 'UNVERIFIED',
    status: user.status,
  };
}

/**
 * Verifies the OTP, creates/finds the User and sets up the session.
 */
async function loginWithOtp({ mobile, code, role, ip, userAgent }) {
  await verifyOtp(mobile, code);

  let user = await User.findOne({ mobileE164: mobile });
  let isNewUser = false;
  const now = new Date();

  if (!user) {
    if (!role || !['CANDIDATE', 'VOLUNTEER'].includes(role)) {
      throw HttpError.badRequest('A valid role (CANDIDATE or VOLUNTEER) is required for new accounts.');
    }
    user = await User.create({
      role,
      mobileE164: mobile,
      isMobileVerified: true,
      mobileVerifiedAt: now,
      mobileVerificationSource: 'LOGIN_OTP',
      authProvider: 'OTP',
      status: 'ACTIVE',
      profileComplete: false,
      lastLoginAt: now,
    });
    if (role === 'CANDIDATE') {
      await CandidateProfile.create({ userId: user._id });
    } else {
      await VolunteerProfile.create({ userId: user._id });
    }
    isNewUser = true;
  } else {
    if (user.status !== 'ACTIVE') {
      throw HttpError.forbidden('This account has been suspended. Please contact support.');
    }
    user.lastLoginAt = now;
    user.isMobileVerified = true;
    if (!user.mobileVerifiedAt) user.mobileVerifiedAt = now;
    if (!user.mobileVerificationSource || user.mobileVerificationSource === 'NONE') {
      user.mobileVerificationSource = 'LOGIN_OTP';
    }
    await user.save();
  }

  const { token, session } = await createUserSession(user._id, { ipAddress: ip, userAgent });

  return { user, session, token, isNewUser };
}

module.exports = {
  maskMobile,
  resolveUserName,
  toSessionUser,
  loginWithOtp,
};
