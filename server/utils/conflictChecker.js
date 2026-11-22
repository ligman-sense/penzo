'use strict';

const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const MatchProposal = require('../models/MatchProposal');

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
 * Enforces volunteer schedule conflict prevention across assignments and accepted proposals.
 *
 * Checks:
 * 1. ConfirmedAssignment collection for volunteerId with status 'CONFIRMED'
 * 2. MatchProposal collection for volunteerId with status 'ACCEPTED' or 'CANDIDATE_CONFIRMED'
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
  hasScheduleOverlap,
  getExamTimeRange,
  findVolunteerScheduleConflict,
};
