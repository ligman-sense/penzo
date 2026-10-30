'use strict';

const { HttpError } = require('../utils/httpError');

const REQUEST_TRANSITIONS = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PENDING_REVIEW', 'AWAITING_VOLUNTEER', 'REJECTED', 'CANCELLED'],
  PENDING_REVIEW: ['AWAITING_VOLUNTEER', 'REJECTED', 'CANCELLED'],
  AWAITING_VOLUNTEER: ['MATCH_PROPOSED', 'REJECTED', 'CANCELLED'],
  MATCH_PROPOSED: ['VOLUNTEER_ACCEPTED', 'AWAITING_VOLUNTEER', 'CANCELLED'],
  VOLUNTEER_ACCEPTED: ['AWAITING_CANDIDATE_CONFIRMATION', 'AWAITING_VOLUNTEER', 'CANCELLED'],
  AWAITING_CANDIDATE_CONFIRMATION: ['CONFIRMED', 'AWAITING_VOLUNTEER', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'REPLACEMENT_REQUIRED', 'CANCELLED'],
  REPLACEMENT_REQUIRED: ['AWAITING_VOLUNTEER', 'MATCH_PROPOSED', 'CANCELLED'],
  REJECTED: [],
  CANCELLED: [],
  COMPLETED: [],
};

const TERMINAL_STATUSES = ['REJECTED', 'CANCELLED', 'COMPLETED'];
const EDITABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'PENDING_REVIEW', 'AWAITING_VOLUNTEER'];

const REQUEST_STATUS_LABEL = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PENDING_REVIEW: 'Under review',
  AWAITING_VOLUNTEER: 'Finding a volunteer',
  MATCH_PROPOSED: 'Match proposed',
  VOLUNTEER_ACCEPTED: 'Volunteer accepted',
  AWAITING_CANDIDATE_CONFIRMATION: 'Waiting for your confirmation',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Not approved',
  CANCELLED: 'Cancelled',
  REPLACEMENT_REQUIRED: 'Replacement needed',
  COMPLETED: 'Completed',
};

const canTransition = (from, to) => Boolean(REQUEST_TRANSITIONS[from] && REQUEST_TRANSITIONS[from].includes(to));
const isTerminal = (status) => TERMINAL_STATUSES.includes(status);
const canEdit = (status) => EDITABLE_STATUSES.includes(status);
const canCancel = (status) => canTransition(status, 'CANCELLED');

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw HttpError.invalidTransition(
      `A request that is "${REQUEST_STATUS_LABEL[from] || from}" cannot be moved to "${REQUEST_STATUS_LABEL[to] || to}".`
    );
  }
}

module.exports = {
  REQUEST_TRANSITIONS,
  TERMINAL_STATUSES,
  EDITABLE_STATUSES,
  REQUEST_STATUS_LABEL,
  canTransition,
  isTerminal,
  canEdit,
  canCancel,
  assertTransition,
};
