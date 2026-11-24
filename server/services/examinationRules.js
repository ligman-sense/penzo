'use strict';

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 80);
}

const EXAM_TRANSITIONS = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['UNPUBLISHED', 'ARCHIVED'],
  UNPUBLISHED: ['PUBLISHED', 'ARCHIVED'],
  ARCHIVED: [],
};

function canMoveExam(from, to) {
  return Boolean(EXAM_TRANSITIONS[from] && EXAM_TRANSITIONS[from].includes(to));
}

function publishBlockers(exam) {
  const blockers = [];
  if (!exam.name && !exam.title) blockers.push('Examination name is required');
  if (!exam.authority && !exam.conductingBody) blockers.push('Conducting authority is required');
  return blockers;
}

function verificationSummary(records) {
  if (!records || records.length === 0) return 'PENDING';
  const hasPending = records.some((r) => r.status === 'PENDING');
  if (hasPending) return 'PENDING';
  const hasRejected = records.some((r) => r.status === 'REJECTED');
  if (hasRejected) return 'REJECTED';
  const allVerified = records.every((r) => r.status === 'VERIFIED');
  return allVerified ? 'VERIFIED' : 'PENDING';
}

module.exports = {
  slugify,
  canMoveExam,
  publishBlockers,
  verificationSummary,
};
