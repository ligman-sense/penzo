'use strict';

const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const MatchProposal = require('../models/MatchProposal');

const TRAVEL_BUFFER_MS = 45 * 60 * 1000; // 45 minutes travel/prep buffer

/**
 * Checks whether two time intervals overlap: [startA, endA) and [startB, endB).
 */
function hasScheduleOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  const sA = new Date(startA).getTime();
  const eA = new Date(endA).getTime();
  const sB = new Date(startB).getTime();
  const eB = new Date(endB).getTime();
  return sA < eB && eA > sB;
}

/**
 * Extract startsAt and endsAt from an examination and optional session.
 * Defaults to a 4-hour window if endsAt/endsOn is not explicitly specified.
 */
function getExamTimeRange(exam, session = null) {
  if (!exam) return { startsAt: null, endsAt: null };

  let startsAt = null;
  let endsAt = null;

  if (session && session.startsAt) {
    startsAt = new Date(session.startsAt);
    endsAt = session.endsAt ? new Date(session.endsAt) : new Date(startsAt.getTime() + 4 * 60 * 60 * 1000);
  } else if (session && session.date) {
    startsAt = new Date(session.date);
    endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000);
  } else if (exam.startsOn) {
    startsAt = new Date(exam.startsOn);
    endsAt = exam.endsOn ? new Date(exam.endsOn) : new Date(startsAt.getTime() + 4 * 60 * 60 * 1000);
  }

  return { startsAt, endsAt };
}

/**
 * Extract start and end Date objects for an exam or session with 3.5 hour default.
 */
function getScheduleWindow(exam, session) {
  let start = null;
  let end = null;

  if (session) {
    if (session.startsAt) start = new Date(session.startsAt);
    else if (session.date) start = new Date(session.date);

    if (session.endsAt) end = new Date(session.endsAt);
  }

  if (!start && exam) {
    if (exam.startsOn) start = new Date(exam.startsOn);
  }

  if (!end && exam) {
    if (exam.endsOn) end = new Date(exam.endsOn);
  }

  if (start && !end) {
    end = new Date(start.getTime() + 3.5 * 60 * 60 * 1000);
  }

  return { start, end };
}

/**
 * Check if a volunteer has any confirmed assignment that overlaps with the given exam/session window.
 */
async function checkVolunteerConflict(volunteerId, exam, session, excludeAssignmentId = null) {
  const { start, end } = getScheduleWindow(exam, session);
  if (!start || !end) {
    return { hasConflict: false };
  }

  const query = {
    volunteerId,
    status: 'CONFIRMED',
  };
  if (excludeAssignmentId) {
    query._id = { $ne: excludeAssignmentId };
  }

  const assignments = await ConfirmedAssignment.find(query);
  if (!assignments.length) {
    return { hasConflict: false };
  }

  for (const a of assignments) {
    const aStart = a.startsAt ? new Date(a.startsAt) : (a.confirmedAt ? new Date(a.confirmedAt) : null);
    const aEnd = a.endsAt ? new Date(a.endsAt) : (aStart ? new Date(aStart.getTime() + 3.5 * 60 * 60 * 1000) : null);

    if (!aStart || !aEnd) continue;

    const bufferedAStart = new Date(aStart.getTime() - TRAVEL_BUFFER_MS);
    const bufferedAEnd = new Date(aEnd.getTime() + TRAVEL_BUFFER_MS);

    if (start < bufferedAEnd && end > bufferedAStart) {
      return {
        hasConflict: true,
        conflictingAssignment: a,
        conflictStart: aStart,
        conflictEnd: aEnd,
        message: 'You already have a confirmed examination assignment during this time. You cannot accept another overlapping commitment.',
      };
    }
  }

  return { hasConflict: false };
}

/**
 * Enforces volunteer schedule conflict prevention across assignments and accepted proposals.
 */
async function findVolunteerScheduleConflict(volunteerId, options = {}) {
  const {
    startsAt,
    endsAt,
    excludeAssignmentId = null,
    excludeProposalId = null,
  } = options;

  if (!volunteerId || !startsAt || !endsAt) {
    return { hasConflict: false };
  }

  const sTime = new Date(startsAt);
  const eTime = new Date(endsAt);

  // 1. Check against ConfirmedAssignments
  const assignments = await ConfirmedAssignment.find({
    volunteerId,
    status: 'CONFIRMED',
  });

  for (const a of assignments) {
    if (excludeAssignmentId && a._id.toString() === excludeAssignmentId.toString()) {
      continue;
    }
    const aStart = a.startsAt ? new Date(a.startsAt) : (a.confirmedAt ? new Date(a.confirmedAt) : null);
    const aEnd = a.endsAt ? new Date(a.endsAt) : (aStart ? new Date(aStart.getTime() + 4 * 60 * 60 * 1000) : null);

    if (hasScheduleOverlap(sTime, eTime, aStart, aEnd)) {
      return {
        hasConflict: true,
        conflictType: 'CONFIRMED_ASSIGNMENT',
        conflict: a,
        reason: 'Volunteer already has a confirmed examination assignment during this schedule window.',
      };
    }
  }

  // 2. Check against active accepted MatchProposals
  const proposals = await MatchProposal.find({
    volunteerId,
    status: { $in: ['ACCEPTED', 'CANDIDATE_CONFIRMED'] },
  }).populate({
    path: 'requestId',
    populate: { path: 'examinationId' },
  });

  for (const p of proposals) {
    if (excludeProposalId && p._id.toString() === excludeProposalId.toString()) {
      continue;
    }
    const req = p.requestId;
    if (!req) continue;
    const exam = req.examinationId;
    if (!exam) continue;

    let pSession = null;
    if (exam.sessions && req.sessionId) {
      pSession = exam.sessions.id(req.sessionId) || exam.sessions.find((s) => s._id.toString() === req.sessionId.toString());
    }

    const { startsAt: pStart, endsAt: pEnd } = getExamTimeRange(exam, pSession);
    if (hasScheduleOverlap(sTime, eTime, pStart, pEnd)) {
      return {
        hasConflict: true,
        conflictType: 'ACCEPTED_PROPOSAL',
        conflict: p,
        reason: 'Volunteer already has an accepted scribe invitation during this schedule window.',
      };
    }
  }

  return { hasConflict: false };
}

module.exports = {
  TRAVEL_BUFFER_MS,
  getScheduleWindow,
  checkVolunteerConflict,
  hasScheduleOverlap,
  getExamTimeRange,
  findVolunteerScheduleConflict,
};
