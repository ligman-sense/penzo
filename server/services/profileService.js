'use strict';

const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const VerificationRecord = require('../models/VerificationRecord');
const { candidateCompletion, volunteerCompletion } = require('./profileCompletion');
const { normalizeAndValidateIndianMobile } = require('../utils/phoneValidator');
const { HttpError } = require('../utils/httpError');

async function getProfile(userId) {
  const user = await User.findById(userId);
  if (!user) throw HttpError.notFound('User not found.');

  const verifications = await VerificationRecord.find({ userId }).sort({ createdAt: 1 });

  let profileData = null;
  let completion = { percentage: 0, isComplete: false, missingFields: [] };

  if (user.role === 'CANDIDATE') {
    let cp = await CandidateProfile.findOne({ userId });
    if (!cp) cp = await CandidateProfile.create({ userId });
    completion = candidateCompletion(cp, user);
    profileData = {
      fullName: cp.fullName || (cp.firstName ? `${cp.firstName} ${cp.lastName || ''}`.trim() : ''),
      firstName: cp.firstName || (cp.fullName ? cp.fullName.split(' ')[0] : ''),
      lastName: cp.lastName || (cp.fullName ? cp.fullName.split(' ').slice(1).join(' ') : ''),
      languages: cp.languages || [],
      qualification: cp.qualification || cp.education || '',
      currentlyPursuing: cp.currentlyPursuing || '',
      education: cp.qualification || cp.education || '',
      city: cp.city || '',
      preferredExamCity: cp.preferredExamCity || '',
      state: cp.state || '',
      pincode: cp.pincode || '',
      dateOfBirth: cp.dateOfBirth || null,
      gender: cp.gender || '',
      disabilityType: cp.disabilityType || '',
      assistanceNeeds: cp.assistanceNeeds || '',
      address: {
        city: cp.city || '',
        state: cp.state || '',
        pincode: cp.pincode || '',
      },
    };
  } else {
    let vp = await VolunteerProfile.findOne({ userId });
    if (!vp) vp = await VolunteerProfile.create({ userId });
    completion = volunteerCompletion(vp, user);
    profileData = {
      fullName: vp.fullName || (vp.firstName ? `${vp.firstName} ${vp.lastName || ''}`.trim() : ''),
      firstName: vp.firstName || (vp.fullName ? vp.fullName.split(' ')[0] : ''),
      lastName: vp.lastName || (vp.fullName ? vp.fullName.split(' ').slice(1).join(' ') : ''),
      languages: vp.languages || [],
      preferredLanguages: vp.languages || [],
      subjects: vp.subjects || [],
      city: vp.city || '',
      state: vp.state || '',
      pincode: vp.pincode || '',
      serviceRadiusKm: vp.serviceRadiusKm || 25,
      availableRegions: vp.serviceLocations || [],
      serviceLocations: vp.serviceLocations || [],
      hasPriorExperience: vp.hasPriorExperience || vp.hasScribeExperience || false,
      hasPreviousExperience: vp.hasPriorExperience || vp.hasScribeExperience || false,
      address: {
        city: vp.city || '',
        state: vp.state || '',
        pincode: vp.pincode || '',
      },
    };
  }

  if (profileData) {
    profileData.completionPct = completion.percentage;
    profileData.completionPercentage = completion.percentage;
    profileData.verificationStatus = user.verificationStatus || 'UNVERIFIED';
  }

  const primaryIdentifier = user.primaryIdentifier || (user.authProvider === 'GOOGLE' ? 'GOOGLE' : (user.email ? 'EMAIL' : 'MOBILE'));
  const isEmailLogin = primaryIdentifier === 'EMAIL' || user.authProvider === 'GOOGLE';
  const isMobileLogin = primaryIdentifier === 'MOBILE';

  const contactInfo = {
    authProvider: user.authProvider || 'PASSWORD',
    primaryIdentifier,
    email: user.email || null,
    isEmailVerified: Boolean(user.isEmailVerified),
    emailVerifiedAt: user.emailVerifiedAt || null,
    emailVerificationSource: user.emailVerificationSource || 'NONE',
    isEmailReadOnly: isEmailLogin,
    isEmailRequired: isEmailLogin,
    mobile: user.mobileE164 || null,
    isMobileVerified: Boolean(user.isMobileVerified),
    mobileVerifiedAt: user.mobileVerifiedAt || null,
    mobileVerificationSource: user.mobileVerificationSource || 'NONE',
    isMobileReadOnly: isMobileLogin,
    isMobileRequired: true,
  };

  return {
    role: user.role,
    mobile: user.mobileE164,
    email: user.email,
    primaryIdentifier,
    profileComplete: user.profileComplete,
    verificationStatus: user.verificationStatus || 'UNVERIFIED',
    completion,
    profile: profileData,
    contactInfo,
    verifications: verifications.map((v) => ({
      id: v._id.toString(),
      kind: v.kind,
      status: v.status,
      reason: v.reason,
      reviewedAt: v.reviewedAt,
    })),
  };
}

async function saveProfile(userId, { role, data }) {
  const user = await User.findById(userId);
  if (!user) throw HttpError.notFound('User not found.');

  const primaryIdentifier = user.primaryIdentifier || (user.authProvider === 'GOOGLE' ? 'GOOGLE' : (user.email ? 'EMAIL' : 'MOBILE'));

  // 1. Email handling
  if (data.email !== undefined) {
    const rawEmail = typeof data.email === 'string' ? data.email.trim() : '';
    const cleanEmail = rawEmail.toLowerCase();
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

    if (!cleanEmail) {
      if (primaryIdentifier === 'EMAIL' || user.authProvider === 'GOOGLE') {
        throw HttpError.badRequest('Registered email is your required login identifier and cannot be removed.');
      }
      user.email = null;
    } else {
      if (!emailRegex.test(cleanEmail)) {
        throw HttpError.badRequest('Invalid email address format.');
      }

      if (primaryIdentifier === 'EMAIL' || user.authProvider === 'GOOGLE') {
        if (cleanEmail !== (user.email || '').toLowerCase()) {
          const msg = user.authProvider === 'GOOGLE'
            ? 'OAuth account email is managed by Google and cannot be modified.'
            : 'Registered email login identifier cannot be modified via profile update.';
          throw HttpError.badRequest(msg);
        }
      } else {
        // Mobile-first user updating optional email
        if (cleanEmail !== (user.email || '').toLowerCase()) {
          const duplicate = await User.findOne({ email: cleanEmail, _id: { $ne: user._id } });
          if (duplicate) {
            throw HttpError.badRequest('This email address is already in use by another account.');
          }
          user.email = cleanEmail;
        }
      }
    }
  }

  // 2. Mobile handling
  if (data.mobile !== undefined || data.phoneNumber !== undefined) {
    const rawMobile = data.mobile !== undefined ? data.mobile : data.phoneNumber;
    const cleanMobileStr = typeof rawMobile === 'string' ? rawMobile.trim() : '';

    if (primaryIdentifier === 'MOBILE') {
      if (!cleanMobileStr) {
        throw HttpError.badRequest('Registered mobile number is your required login identifier and cannot be removed.');
      }
      const canonical = normalizeAndValidateIndianMobile(cleanMobileStr);
      if (canonical !== user.mobileE164) {
        throw HttpError.badRequest('Registered mobile login identifier cannot be modified via profile update.');
      }
    } else {
      // Email/Google user updating mandatory mobile
      if (!cleanMobileStr) {
        throw HttpError.badRequest('Mobile number is mandatory and cannot be removed.');
      }
      const canonical = normalizeAndValidateIndianMobile(cleanMobileStr);
      if (canonical !== user.mobileE164) {
        const duplicate = await User.findOne({ mobileE164: canonical, _id: { $ne: user._id } });
        if (duplicate) {
          throw HttpError.badRequest('This mobile number is already in use by another account.');
        }
        user.mobileE164 = canonical;
      }
    }
  }

  await user.save();

  let cpOrVp;
  let completion;

  if (user.role === 'CANDIDATE') {
    cpOrVp = await CandidateProfile.findOne({ userId });
    if (!cpOrVp) cpOrVp = new CandidateProfile({ userId });

    // Handle names
    if (data.firstName !== undefined) cpOrVp.firstName = data.firstName;
    if (data.lastName !== undefined) cpOrVp.lastName = data.lastName;
    if (data.fullName !== undefined) {
      cpOrVp.fullName = data.fullName;
    } else if (data.firstName || data.lastName) {
      cpOrVp.fullName = [data.firstName, data.lastName].filter(Boolean).join(' ');
    }

    // Handle dates and bio
    if (data.dateOfBirth !== undefined) cpOrVp.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
    if (data.gender !== undefined) cpOrVp.gender = data.gender || null;

    // Handle languages & education / qualification
    if (data.languages !== undefined) cpOrVp.languages = Array.isArray(data.languages) ? data.languages : [data.languages].filter(Boolean);
    if (data.preferredLanguages !== undefined) cpOrVp.preferredLanguages = Array.isArray(data.preferredLanguages) ? data.preferredLanguages : [data.preferredLanguages].filter(Boolean);

    // Qualification and Currently Pursuing conditional validation
    const rawQual = data.qualification !== undefined ? data.qualification : (data.education !== undefined ? data.education : undefined);
    const rawPursuing = data.currentlyPursuing !== undefined ? data.currentlyPursuing : undefined;

    if (rawQual !== undefined || rawPursuing !== undefined) {
      const isPursuingFilled = Boolean(rawPursuing && rawPursuing.trim() && rawPursuing.trim() !== 'Not Currently Pursuing Any Course');
      const isQualFilled = Boolean(rawQual && rawQual.trim());

      // If Currently Pursuing is empty / not pursuing, Qualification becomes mandatory
      if (!isPursuingFilled && !isQualFilled) {
        throw HttpError.badRequest('Qualification is required when not currently pursuing any course.');
      }

      if (rawQual !== undefined) {
        cpOrVp.qualification = rawQual ? rawQual.trim() : null;
        cpOrVp.education = rawQual ? rawQual.trim() : (isPursuingFilled ? rawPursuing.trim() : null);
      }
      if (rawPursuing !== undefined) {
        cpOrVp.currentlyPursuing = rawPursuing ? rawPursuing.trim() : null;
      }
    } else if (data.education !== undefined) {
      cpOrVp.education = data.education;
      if (!cpOrVp.qualification) cpOrVp.qualification = data.education;
    }

    // Handle address and cities (support both flat fields and nested address object)
    if (data.city !== undefined) cpOrVp.city = data.city;
    if (data.state !== undefined) cpOrVp.state = data.state;
    if (data.pincode !== undefined) cpOrVp.pincode = data.pincode;
    if (data.address && typeof data.address === 'object') {
      if (data.address.city !== undefined) cpOrVp.city = data.address.city;
      if (data.address.state !== undefined) cpOrVp.state = data.address.state;
      if (data.address.pincode !== undefined) cpOrVp.pincode = data.address.pincode;
    }
    if (data.preferredExamCity !== undefined) cpOrVp.preferredExamCity = data.preferredExamCity;

    // Handle disability & assistance needs
    if (data.disabilityType !== undefined) cpOrVp.disabilityType = data.disabilityType;
    if (data.disabilityDescription !== undefined) cpOrVp.disabilityDescription = data.disabilityDescription;
    if (data.assistanceNeeds !== undefined) {
      cpOrVp.assistanceNeeds = data.assistanceNeeds;
    } else if (data.disabilityType) {
      cpOrVp.assistanceNeeds = data.disabilityType;
    }

    completion = candidateCompletion(cpOrVp, user);
    cpOrVp.completionPercentage = completion.percentage;
    await cpOrVp.save();
  } else {
    cpOrVp = await VolunteerProfile.findOne({ userId });
    if (!cpOrVp) cpOrVp = new VolunteerProfile({ userId });

    // Handle names
    if (data.firstName !== undefined) cpOrVp.firstName = data.firstName;
    if (data.lastName !== undefined) cpOrVp.lastName = data.lastName;
    if (data.fullName !== undefined) {
      cpOrVp.fullName = data.fullName;
    } else if (data.firstName || data.lastName) {
      cpOrVp.fullName = [data.firstName, data.lastName].filter(Boolean).join(' ');
    }

    const langs = data.languages || data.preferredLanguages;
    if (langs !== undefined) {
      cpOrVp.languages = Array.isArray(langs) ? langs : [langs].filter(Boolean);
    }
    if (data.subjects !== undefined) cpOrVp.subjects = Array.isArray(data.subjects) ? data.subjects : [data.subjects].filter(Boolean);

    // Handle address (support flat and nested)
    if (data.city !== undefined) cpOrVp.city = data.city;
    if (data.state !== undefined) cpOrVp.state = data.state;
    if (data.pincode !== undefined) cpOrVp.pincode = data.pincode;
    if (data.address && typeof data.address === 'object') {
      if (data.address.city !== undefined) cpOrVp.city = data.address.city;
      if (data.address.state !== undefined) cpOrVp.state = data.address.state;
      if (data.address.pincode !== undefined) cpOrVp.pincode = data.address.pincode;
    }

    if (data.serviceRadiusKm !== undefined) cpOrVp.serviceRadiusKm = Number(data.serviceRadiusKm);
    const locations = data.serviceLocations || data.availableRegions;
    if (locations !== undefined) {
      cpOrVp.serviceLocations = Array.isArray(locations) ? locations : [locations].filter(Boolean);
    }
    if (data.hasPriorExperience !== undefined || data.hasPreviousExperience !== undefined) {
      const exp = Boolean(data.hasPriorExperience || data.hasPreviousExperience);
      cpOrVp.hasPriorExperience = exp;
      cpOrVp.hasScribeExperience = exp;
    }

    completion = volunteerCompletion(cpOrVp, user);
    cpOrVp.completionPercentage = completion.percentage;
    await cpOrVp.save();
  }

  user.profileComplete = completion.isComplete;
  await user.save();

  // If profile is complete, ensure verification queue records exist
  if (completion.isComplete) {
    const requiredKinds = user.role === 'CANDIDATE' ? ['IDENTITY', 'ASSISTANCE_NEED'] : ['IDENTITY'];
    for (const kind of requiredKinds) {
      let rec = await VerificationRecord.findOne({ userId, kind });
      if (!rec) {
        rec = await VerificationRecord.create({
          userId,
          kind,
          status: 'PENDING',
        });
      } else if (rec.status === 'REQUIRES_CORRECTION' || rec.status === 'REJECTED') {
        rec.history = rec.history || [];
        rec.history.push({
          fromStatus: rec.status,
          toStatus: 'PENDING',
          reason: 'Profile details updated by user and resubmitted for verification.',
          timestamp: new Date(),
        });
        rec.status = 'PENDING';
        rec.reason = null;
        await rec.save();
      }
    }
  }

  await syncUserVerification(userId);

  return getProfile(userId);
}

async function syncUserVerification(userId) {
  const user = await User.findById(userId);
  if (!user) return 'UNVERIFIED';

  const records = await VerificationRecord.find({ userId });
  if (!records || records.length === 0) {
    user.verificationStatus = 'UNVERIFIED';
    await user.save();
    return 'UNVERIFIED';
  }

  let status = 'PENDING';
  if (records.every((r) => r.status === 'VERIFIED')) {
    status = 'VERIFIED';
  } else if (records.some((r) => r.status === 'REJECTED')) {
    status = 'REJECTED';
  } else if (records.some((r) => r.status === 'REQUIRES_CORRECTION')) {
    status = 'REQUIRES_CORRECTION';
  } else if (records.some((r) => r.status === 'UNDER_REVIEW')) {
    status = 'UNDER_REVIEW';
  } else {
    status = 'PENDING';
  }

  user.verificationStatus = status;
  await user.save();

  if (user.role === 'CANDIDATE') {
    await CandidateProfile.updateOne({ userId }, { verificationStatus: status });
  } else {
    await VolunteerProfile.updateOne({ userId }, { verificationStatus: status });
  }

  return status;
}

module.exports = {
  getProfile,
  saveProfile,
  syncUserVerification,
};
