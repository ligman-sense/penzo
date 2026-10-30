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
      languages: cp.languages || [],
      education: cp.education || '',
      city: cp.city || '',
      preferredExamCity: cp.preferredExamCity || '',
      assistanceNeeds: cp.assistanceNeeds || '',
    };
  } else {
    let vp = await VolunteerProfile.findOne({ userId });
    if (!vp) vp = await VolunteerProfile.create({ userId });
    completion = volunteerCompletion(vp, user);
    profileData = {
      fullName: vp.fullName || (vp.firstName ? `${vp.firstName} ${vp.lastName || ''}`.trim() : ''),
      educationLevel: vp.educationLevel || vp.highestEducation || '',
      institution: vp.institution || '',
      languages: vp.languages || [],
      subjects: vp.subjects || [],
      city: vp.city || '',
      serviceRadiusKm: vp.serviceRadiusKm || 25,
      serviceLocations: vp.serviceLocations || [],
      hasPriorExperience: vp.hasPriorExperience || vp.hasScribeExperience || false,
    };
  }

  return {
    role: user.role,
    mobile: user.mobileE164,
    email: user.email,
    profileComplete: user.profileComplete,
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

    if (data.fullName !== undefined) cpOrVp.fullName = data.fullName;
    if (data.languages !== undefined) cpOrVp.languages = data.languages;
    if (data.education !== undefined) cpOrVp.education = data.education;
    if (data.city !== undefined) cpOrVp.city = data.city;
    if (data.preferredExamCity !== undefined) cpOrVp.preferredExamCity = data.preferredExamCity;
    if (data.assistanceNeeds !== undefined) cpOrVp.assistanceNeeds = data.assistanceNeeds;

    completion = candidateCompletion(cpOrVp, user);
    cpOrVp.completionPercentage = completion.percentage;
    await cpOrVp.save();
  } else {
    cpOrVp = await VolunteerProfile.findOne({ userId });
    if (!cpOrVp) cpOrVp = new VolunteerProfile({ userId });

    if (data.fullName !== undefined) cpOrVp.fullName = data.fullName;
    if (data.educationLevel !== undefined) {
      cpOrVp.educationLevel = data.educationLevel;
      cpOrVp.highestEducation = data.educationLevel;
    }
    if (data.institution !== undefined) cpOrVp.institution = data.institution;
    if (data.languages !== undefined) cpOrVp.languages = data.languages;
    if (data.subjects !== undefined) cpOrVp.subjects = data.subjects;
    if (data.city !== undefined) cpOrVp.city = data.city;
    if (data.serviceRadiusKm !== undefined) cpOrVp.serviceRadiusKm = Number(data.serviceRadiusKm);
    if (data.serviceLocations !== undefined) cpOrVp.serviceLocations = data.serviceLocations;
    if (data.hasPriorExperience !== undefined) {
      cpOrVp.hasPriorExperience = Boolean(data.hasPriorExperience);
      cpOrVp.hasScribeExperience = Boolean(data.hasPriorExperience);
    }

    completion = volunteerCompletion(cpOrVp, user);
    cpOrVp.completionPercentage = completion.percentage;
    await cpOrVp.save();
  }

  user.profileComplete = completion.isComplete;
  await user.save();

  return getProfile(userId);
}

module.exports = {
  getProfile,
  saveProfile,
};
