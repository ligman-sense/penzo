'use strict';

const ConfirmedAssignment = require('../models/ConfirmedAssignment');

const TRAVEL_BUFFER_MS = 45 * 60 * 1000; // 45 minutes travel/prep buffer

/**
 * Extract start and end Date objects for an exam or session.
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

  // Default duration to 3.5 hours if end is not explicitly given
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

  // Check each confirmed assignment
  for (const a of assignments) {
    const aStart = a.startsAt ? new Date(a.startsAt) : (a.confirmedAt ? new Date(a.confirmedAt) : null);
    const aEnd = a.endsAt ? new Date(a.endsAt) : (aStart ? new Date(aStart.getTime() + 3.5 * 60 * 60 * 1000) : null);

    if (!aStart || !aEnd) continue;

    // Apply travel buffer: [aStart - buffer, aEnd + buffer]
    const bufferedAStart = new Date(aStart.getTime() - TRAVEL_BUFFER_MS);
    const bufferedAEnd = new Date(aEnd.getTime() + TRAVEL_BUFFER_MS);

    // Overlap condition:
    // (start < bufferedAEnd) && (end > bufferedAStart)
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

module.exports = {
  TRAVEL_BUFFER_MS,
  getScheduleWindow,
  checkVolunteerConflict,
};
