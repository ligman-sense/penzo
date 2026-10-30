'use strict';

function candidateCompletion(profile, user) {
  if (!profile) return { percentage: 0, isComplete: false, missingFields: ['all'] };

  const missing = [];
  if (!profile.fullName && !(profile.firstName && profile.lastName)) missing.push('fullName');
  if (!profile.languages || profile.languages.length === 0) missing.push('languages');
  if (!profile.city) missing.push('city');
  if (!profile.education) missing.push('education');
  if (!profile.assistanceNeeds || (Array.isArray(profile.assistanceNeeds) && profile.assistanceNeeds.length === 0)) missing.push('assistanceNeeds');

  const total = 5;
  const completed = total - missing.length;
  const percentage = Math.round((completed / total) * 100);

  return {
    percentage,
    isComplete: missing.length === 0,
    missingFields: missing,
  };
}

function volunteerCompletion(profile, user) {
  if (!profile) return { percentage: 0, isComplete: false, missingFields: ['all'] };

  const missing = [];
  if (!profile.fullName && !(profile.firstName && profile.lastName)) missing.push('fullName');
  if (!profile.educationLevel && !profile.highestEducation) missing.push('educationLevel');
  if (!profile.languages || profile.languages.length === 0) missing.push('languages');
  if (!profile.subjects || profile.subjects.length === 0) missing.push('subjects');
  if (!profile.city) missing.push('city');

  const total = 5;
  const completed = total - missing.length;
  const percentage = Math.round((completed / total) * 100);

  return {
    percentage,
    isComplete: missing.length === 0,
    missingFields: missing,
  };
}

module.exports = {
  candidateCompletion,
  volunteerCompletion,
};
