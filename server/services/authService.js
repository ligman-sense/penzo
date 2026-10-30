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

function toSessionUser(user) {
  return {
    id: user._id.toString(),
    role: user.role,
    mobileMasked: maskMobile(user.mobileE164),
    email: user.email,
    profileComplete: user.profileComplete,
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
      mobileVerifiedAt: now,
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
    if (!user.mobileVerifiedAt) user.mobileVerifiedAt = now;
    await user.save();
  }

  const { token, session } = await createUserSession(user._id, { ipAddress: ip, userAgent });

  return { user, session, token, isNewUser };
}

module.exports = {
  maskMobile,
  toSessionUser,
  loginWithOtp,
};
