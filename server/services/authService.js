'use strict';

const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const { verifyOtp } = require('./otpService');
const { createUserSession } = require('./sessionService');
const { HttpError } = require('../utils/httpError');
const { hashPassword, verifyPassword, dummyHash, validatePasswordPolicy } = require('../utils/password');
const { normalizeAndValidateIndianMobile } = require('../utils/phoneValidator');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const defaultRoleName = user.role === 'VOLUNTEER' ? 'Volunteer' : 'Candidate';
  const primary = user.primaryIdentifier || (user.googleId ? 'GOOGLE' : (user.email ? 'EMAIL' : 'MOBILE'));
  return {
    id: user._id.toString(),
    role: user.role,
    name: name || user.name || defaultRoleName,
    primaryIdentifier: primary,
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
    authProvider: user.authProvider || 'PASSWORD',
    profileComplete: user.profileComplete,
    verificationStatus: user.verificationStatus || 'UNVERIFIED',
    status: user.status,
  };
}

/**
 * Register a Candidate or Volunteer user with Email or Mobile (+91) plus Password.
 */
async function registerWithPassword({ role, identifierType, identifier, password, name, ip, userAgent }) {
  if (!role || !['CANDIDATE', 'VOLUNTEER'].includes(role)) {
    throw HttpError.badRequest('A valid role (CANDIDATE or VOLUNTEER) is required.');
  }

  if (!identifierType || !['EMAIL', 'MOBILE'].includes(identifierType)) {
    throw HttpError.badRequest('Please select either EMAIL or MOBILE as your login identifier.');
  }

  if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
    throw HttpError.badRequest('Registration identifier is required.');
  }

  const passValidation = validatePasswordPolicy(password);
  if (!passValidation.isValid) {
    throw HttpError.badRequest(passValidation.errors.join(' '));
  }

  let normalizedEmail = null;
  let canonicalMobile = null;

  if (identifierType === 'EMAIL') {
    const rawEmail = identifier.trim();
    if (!EMAIL_REGEX.test(rawEmail)) {
      throw HttpError.badRequest('Please enter a valid email address.');
    }
    normalizedEmail = rawEmail.toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw HttpError.badRequest('An account with this email address already exists.');
    }
  } else if (identifierType === 'MOBILE') {
    canonicalMobile = normalizeAndValidateIndianMobile(identifier);

    const existingUser = await User.findOne({ mobileE164: canonicalMobile });
    if (existingUser) {
      throw HttpError.badRequest('An account with this mobile number already exists.');
    }
  }

  const passwordHash = await hashPassword(password);
  const now = new Date();

  const user = await User.create({
    role,
    name: name ? String(name).trim() : null,
    email: normalizedEmail,
    mobileE164: canonicalMobile,
    primaryIdentifier: identifierType,
    passwordHash,
    authProvider: 'PASSWORD',
    status: 'ACTIVE',
    profileComplete: false,
    lastLoginAt: now,
  });

  const parsedName = name ? String(name).trim() : '';
  const firstName = parsedName ? parsedName.split(' ')[0] : '';
  const lastName = parsedName ? parsedName.split(' ').slice(1).join(' ') : '';

  if (role === 'CANDIDATE') {
    await CandidateProfile.create({
      userId: user._id,
      fullName: parsedName || null,
      firstName: firstName || null,
      lastName: lastName || null,
    });
  } else {
    await VolunteerProfile.create({
      userId: user._id,
      fullName: parsedName || null,
      firstName: firstName || null,
      lastName: lastName || null,
    });
  }

  const { token, session } = await createUserSession(user._id, { ipAddress: ip, userAgent });

  return { user, session, token, isNewUser: true };
}

/**
 * Sign in Candidate or Volunteer user with Email or Mobile (+91) plus Password.
 * Uses generic invalid-credentials responses to avoid account enumeration.
 */
async function loginWithPassword({ identifier, password, ip, userAgent }) {
  if (!identifier || typeof identifier !== 'string' || !identifier.trim() || !password || typeof password !== 'string') {
    throw HttpError.badRequest('Identifier and password are required.');
  }

  const raw = identifier.trim();
  let user = null;

  if (raw.includes('@')) {
    const normalizedEmail = raw.toLowerCase();
    user = await User.findOne({ email: normalizedEmail });
  } else {
    let cleanMobile = null;
    try {
      cleanMobile = normalizeAndValidateIndianMobile(raw);
    } catch {
      // Invalid mobile format — fall through to dummy verification
    }
    if (cleanMobile) {
      user = await User.findOne({ mobileE164: cleanMobile });
    }
  }

  // Account enumeration mitigation: constant-time dummy verification
  if (!user || !user.passwordHash) {
    await verifyPassword(password, await dummyHash());
    throw HttpError.invalidCredentials('Invalid identifier or password.');
  }

  const matches = await verifyPassword(password, user.passwordHash);
  if (!matches) {
    throw HttpError.invalidCredentials('Invalid identifier or password.');
  }

  if (user.status !== 'ACTIVE') {
    throw HttpError.forbidden('This account has been suspended. Please contact support.');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const { token, session } = await createUserSession(user._id, { ipAddress: ip, userAgent });

  return { user, session, token, isNewUser: false };
}

/**
 * Set or change password for an authenticated user.
 */
async function setPassword({ userId, currentPassword, newPassword }) {
  const user = await User.findById(userId);
  if (!user) {
    throw HttpError.notFound('User not found.');
  }

  const passValidation = validatePasswordPolicy(newPassword);
  if (!passValidation.isValid) {
    throw HttpError.badRequest(passValidation.errors.join(' '));
  }

  if (user.passwordHash) {
    if (!currentPassword) {
      throw HttpError.badRequest('Current password is required to set a new password.');
    }
    const matches = await verifyPassword(currentPassword, user.passwordHash);
    if (!matches) {
      throw HttpError.invalidCredentials('Current password is incorrect.');
    }
  }

  user.passwordHash = await hashPassword(newPassword);
  if (user.authProvider === 'OTP') {
    user.authProvider = 'PASSWORD';
  }
  await user.save();

  return { success: true };
}

/**
 * Legacy OTP login helper (deprecated).
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
      primaryIdentifier: 'MOBILE',
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
  registerWithPassword,
  loginWithPassword,
  setPassword,
  loginWithOtp,
};
