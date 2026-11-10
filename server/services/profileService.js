'use strict';

const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const VerificationRecord = require('../models/VerificationRecord');
const { candidateCompletion, volunteerCompletion } = require('./profileCompletion');
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
      education: cp.education || '',
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

  return {
    role: user.role,
    mobile: user.mobileE164,
    email: user.email,
    profileComplete: user.profileComplete,
    verificationStatus: user.verificationStatus || 'UNVERIFIED',
    completion,
    profile: profileData,
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

  if (data.email !== undefined) {
    user.email = data.email || null;
  }

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

    // Handle languages & education
    if (data.languages !== undefined) cpOrVp.languages = Array.isArray(data.languages) ? data.languages : [data.languages].filter(Boolean);
    if (data.preferredLanguages !== undefined) cpOrVp.preferredLanguages = Array.isArray(data.preferredLanguages) ? data.preferredLanguages : [data.preferredLanguages].filter(Boolean);
    if (data.education !== undefined) cpOrVp.education = data.education;

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
