'use strict';

const CANDIDATE_FIELD_LABELS = {
  fullName: 'Full Name',
  languages: 'Languages Known',
  city: 'City',
  education: 'Qualification',
  assistanceNeeds: 'Assistance Needs',
  mobile: 'Mobile Number',
};

const VOLUNTEER_FIELD_LABELS = {
  fullName: 'Full Name',
  languages: 'Languages Known',
  subjects: 'Subjects',
  city: 'City',
  mobile: 'Mobile Number',
};

function normalizeArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function candidateCompletion(profile, user) {
  const missing = [];
  const total = 6;

  if (!profile) {
    const all = ['fullName', 'languages', 'city', 'education', 'assistanceNeeds', 'mobile'];
    return {
      percentage: 0,
      isComplete: false,
      completedCount: 0,
      totalCount: total,
      missingFields: all,
      missingLabels: all.map((f) => CANDIDATE_FIELD_LABELS[f] || f),
    };
  }

  const fullName = (profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`).trim();
  if (!fullName) missing.push('fullName');

  const langs = normalizeArray(profile.languages);
  if (langs.length === 0) missing.push('languages');

  const city = (profile.city || profile.address?.city || '').trim();
  if (!city) missing.push('city');

  const hasPursuing = (profile.currentlyPursuing || '').trim() && profile.currentlyPursuing !== 'Not Currently Pursuing Any Course';
  const education = (profile.qualification || profile.education || (hasPursuing ? profile.currentlyPursuing : '') || '').trim();
  if (!education) missing.push('education');

  const assistance = (profile.assistanceNeeds || profile.disabilityType || '').trim();
  if (!assistance) missing.push('assistanceNeeds');

  const mobile = (user?.mobileE164 || profile.mobile || profile.mobileE164 || '').trim();
  if (!mobile) missing.push('mobile');

  const completed = total - missing.length;
  let percentage = Math.round((completed / total) * 100);
  percentage = Math.max(0, Math.min(100, percentage));
  if (missing.length > 0 && percentage === 100) percentage = 99;

  return {
    percentage,
    isComplete: missing.length === 0,
    completedCount: completed,
    totalCount: total,
    missingFields: missing,
    missingLabels: missing.map((f) => CANDIDATE_FIELD_LABELS[f] || f),
  };
}

function volunteerCompletion(profile, user) {
  const missing = [];
  const total = 5;

  if (!profile) {
    const all = ['fullName', 'languages', 'subjects', 'city', 'mobile'];
    return {
      percentage: 0,
      isComplete: false,
      completedCount: 0,
      totalCount: total,
      missingFields: all,
      missingLabels: all.map((f) => VOLUNTEER_FIELD_LABELS[f] || f),
    };
  }

  const fullName = (profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`).trim();
  if (!fullName) missing.push('fullName');

  const langs = normalizeArray(profile.languages || profile.preferredLanguages);
  if (langs.length === 0) missing.push('languages');

  const subjects = normalizeArray(profile.subjects);
  if (subjects.length === 0) missing.push('subjects');

  const city = (profile.city || profile.address?.city || '').trim();
  if (!city) missing.push('city');

  const mobile = (user?.mobileE164 || profile.mobile || profile.mobileE164 || '').trim();
  if (!mobile) missing.push('mobile');

  const completed = total - missing.length;
  let percentage = Math.round((completed / total) * 100);
  percentage = Math.max(0, Math.min(100, percentage));
  if (missing.length > 0 && percentage === 100) percentage = 99;

  return {
    percentage,
    isComplete: missing.length === 0,
    completedCount: completed,
    totalCount: total,
    missingFields: missing,
    missingLabels: missing.map((f) => VOLUNTEER_FIELD_LABELS[f] || f),
  };
}

module.exports = {
  candidateCompletion,
  volunteerCompletion,
  CANDIDATE_FIELD_LABELS,
  VOLUNTEER_FIELD_LABELS,
};
