'use strict';

const CANDIDATE_FIELD_LABELS = {
  fullName: 'Full Name',
  languages: 'Languages Known',
  city: 'City',
  education: 'Education',
  assistanceNeeds: 'Assistance Needs',
};

const VOLUNTEER_FIELD_LABELS = {
  fullName: 'Full Name',
  languages: 'Languages Known',
  subjects: 'Subjects',
  city: 'City',
};

function normalizeArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function candidateCompletion(profile, user) {
  const missing = [];
  const total = 5;

  if (!profile) {
    const all = ['fullName', 'languages', 'city', 'education', 'assistanceNeeds'];
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

  const education = (profile.education || '').trim();
  if (!education) missing.push('education');

  const assistance = (profile.assistanceNeeds || profile.disabilityType || '').trim();
  if (!assistance) missing.push('assistanceNeeds');

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
  const total = 4;

  if (!profile) {
    const all = ['fullName', 'languages', 'subjects', 'city'];
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
