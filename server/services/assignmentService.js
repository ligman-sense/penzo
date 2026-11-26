'use strict';

const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const ScribeRequest = require('../models/ScribeRequest');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const RequestStatusHistory = require('../models/RequestStatusHistory');
const { notify } = require('./notificationService');
const { HttpError } = require('../utils/httpError');
const { generateAllocationId } = require('../utils/allocationId');

const EMERGENCY_REASONS = [
  'Medical Emergency',
  'Family Emergency',
  'Urgent Official / Examination Conflict',
  'Travel / Severe Transit Disruption',
  'Other Critical Emergency',
];

async function listAssignments(userId, role, { status } = {}) {
  const filter = role === 'CANDIDATE' ? { candidateId: userId } : { volunteerId: userId };
  if (status) {
    filter.status = status;
  }

  const items = await ConfirmedAssignment.find(filter)
    .populate({
      path: 'requestId',
      populate: [
        { path: 'examinationId', select: 'name title slug authority startsOn endsOn sessions locations' },
      ],
    })
    .sort({ startsAt: 1 });

  return Promise.all(
    items.map(async (a) => {
      const req = a.requestId;
      const exam = req?.examinationId;

      // Lazy-generate Allocation ID for older records if confirmed
      if (a.status === 'CONFIRMED' && !a.allocationId) {
        a.allocationId = await generateAllocationId();
        await a.save();
      }

      // 5-day lock calculation
      const startsAtTime = a.startsAt ? new Date(a.startsAt).getTime() : (exam?.startsOn ? new Date(exam.startsOn).getTime() : null);
      const lockDeadlineTime = a.lockDeadline ? new Date(a.lockDeadline).getTime() : (startsAtTime ? startsAtTime - 5 * 24 * 60 * 60 * 1000 : null);
      const isLocked = lockDeadlineTime ? (Date.now() >= lockDeadlineTime) : false;

      // Extract session if applicable
      let session = null;
      if (exam && exam.sessions && req?.sessionId) {
        session = exam.sessions.id(req.sessionId) || exam.sessions.find(s => s._id.toString() === req.sessionId.toString());
      }

      const resObj = {
        id: a._id.toString(),
        allocationId: a.allocationId || null,
        reportingTime: a.reportingTime || null,
        meetingPoint: a.meetingPoint || null,
        reportingInstructions: a.reportingInstructions || null,
        reportingDetailsUpdatedAt: a.reportingDetailsUpdatedAt || null,
        requestId: req ? req._id.toString() : null,
        status: a.status,
        startsAt: session?.startsAt || a.startsAt || exam?.startsOn,
        endsAt: session?.endsAt || a.endsAt || exam?.endsOn,
        lockDeadline: lockDeadlineTime ? new Date(lockDeadlineTime) : null,
        isLocked,
        venue: req?.venue || null,
        confirmedAt: a.confirmedAt,
        completedAt: a.completedAt,
        cancelledAt: a.cancelledAt,
        cancelReason: a.cancelReason || a.cancellationReason,
        isEmergencyCancelled: a.isEmergencyCancelled || false,
        cancellationReason: a.cancellationReason,
        cancellationExplanation: a.cancellationExplanation,
        termsAccepted: a.termsAccepted,
        termsVersion: a.termsVersion,
        termsAcceptedAt: a.termsAcceptedAt,
        examination: exam ? {
          id: exam._id.toString(),
          name: exam.name || exam.title,
          authority: exam.authority,
          slug: exam.slug,
          startsOn: exam.startsOn,
          endsOn: exam.endsOn,
          locations: exam.locations,
          session: session ? {
            id: session._id.toString(),
            label: session.label || session.name,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
          } : null,
        } : null,
      };

      // Strict privacy enforcement:
      // Candidates and volunteers must NOT have access to each other's personal information (name, contact, email, etc.)
      if (role === 'ADMIN') {
        let candidateName = 'Candidate';
        let volunteerName = 'Volunteer';
        if (a.candidateId) {
          const cp = await CandidateProfile.findOne({ userId: a.candidateId });
          if (cp) candidateName = cp.fullName || `${cp.firstName || ''} ${cp.lastName || ''}`.trim() || 'Candidate';
        }
        if (a.volunteerId) {
          const vp = await VolunteerProfile.findOne({ userId: a.volunteerId });
          if (vp) volunteerName = vp.fullName || `${vp.firstName || ''} ${vp.lastName || ''}`.trim() || 'Volunteer';
        }
        resObj.candidateName = candidateName;
        resObj.volunteerName = volunteerName;
      }

      return resObj;
    })
  );
}

async function cancelAssignment(assignmentId, userId, role, data = {}) {
  const assignment = await ConfirmedAssignment.findById(assignmentId).populate('requestId');
  if (!assignment) throw HttpError.notFound('Assignment not found.');

  if (assignment.status === 'CANCELLED') {
    throw HttpError.badRequest('Assignment is already cancelled.');
  }

  // Authorization check
  const isVolunteer = assignment.volunteerId.toString() === userId.toString();
  const isCandidate = assignment.candidateId.toString() === userId.toString();
  const isAdmin = role === 'ADMIN';

  if (!isVolunteer && !isCandidate && !isAdmin) {
    throw HttpError.forbidden('You are not authorized to cancel this assignment.');
  }

  const req = await ScribeRequest.findById(assignment.requestId).populate('examinationId');
  const exam = req?.examinationId;
  const examName = exam?.name || exam?.title || 'Examination';

  // Lock calculation: 5 days before startsAt
  const startsAtTime = assignment.startsAt ? new Date(assignment.startsAt).getTime() : (exam?.startsOn ? new Date(exam.startsOn).getTime() : null);
  const lockDeadlineTime = assignment.lockDeadline ? new Date(assignment.lockDeadline).getTime() : (startsAtTime ? startsAtTime - 5 * 24 * 60 * 60 * 1000 : null);
  const isLocked = lockDeadlineTime ? (Date.now() >= lockDeadlineTime) : false;

  if (isVolunteer) {
    if (isLocked) {
      // Must use Emergency Cancellation
      if (!data.isEmergency) {
        throw HttpError.badRequest('Commitment is locked within 5 days of the examination. You must submit an Emergency Cancellation with a valid reason and explanation.');
      }

      if (!data.reason || !EMERGENCY_REASONS.includes(data.reason)) {
        throw HttpError.badRequest(`A valid emergency cancellation reason is required (${EMERGENCY_REASONS.join(', ')}).`);
      }

      if (!data.explanation || !data.explanation.trim()) {
        throw HttpError.badRequest('A detailed explanation is required for emergency cancellation.');
      }

      assignment.status = 'CANCELLED';
      assignment.isEmergencyCancelled = true;
      assignment.cancellationReason = data.reason;
      assignment.cancellationExplanation = data.explanation.trim();
      assignment.cancelledAt = new Date();
      assignment.cancelledBy = userId;
      await assignment.save();

      // Return candidate request to REPLACEMENT_REQUIRED
      if (req) {
        const prevStatus = req.status;
        req.status = 'REPLACEMENT_REQUIRED';
        await req.save();

        await RequestStatusHistory.create({
          requestId: req._id,
          fromStatus: prevStatus,
          toStatus: 'REPLACEMENT_REQUIRED',
          actorType: 'VOLUNTEER',
          actorUserId: userId,
          reason: `Emergency cancellation under 5-day lock: ${data.reason}. ${data.explanation.trim()}`,
        });

        // Notify Candidate
        await notify({
          userId: req.candidateId,
          type: 'VOLUNTEER_CANCELLED_EMERGENCY',
          title: 'Scribe Allocation Update - Replacement in Progress',
          body: 'Your allocated scribe has withdrawn from the examination commitment. The administrator will arrange a replacement scribe, and you will be notified once a new allocation is confirmed. We are sorry for the inconvenience.',
          linkPath: `/candidate/request-details.html?id=${req._id}`,
          requestId: req._id,
        });

        // Notify Admin (Urgent priority)
        await notify({
          adminAlert: true,
          type: 'EMERGENCY_CANCELLATION',
          title: 'URGENT: Volunteer Emergency Cancellation Under 5-Day Lock',
          body: `Volunteer cancelled confirmed commitment for ${examName} (Request ${req.reference}). Reason: ${data.reason}. Details: ${data.explanation.trim()}. Immediate replacement required.`,
          linkPath: `/admin/requests.html?id=${req._id}`,
          requestId: req._id,
        });
      }
    } else {
      // Before 5-day lock deadline: standard cancellation
      assignment.status = 'CANCELLED';
      assignment.isEmergencyCancelled = false;
      assignment.cancelReason = data.reason || 'Volunteer requested cancellation';
      assignment.cancellationReason = data.reason || 'Volunteer requested cancellation';
      assignment.cancellationExplanation = data.explanation?.trim() || null;
      assignment.cancelledAt = new Date();
      assignment.cancelledBy = userId;
      await assignment.save();

      if (req) {
        const prevStatus = req.status;
        req.status = 'REPLACEMENT_REQUIRED';
        await req.save();

        await RequestStatusHistory.create({
          requestId: req._id,
          fromStatus: prevStatus,
          toStatus: 'REPLACEMENT_REQUIRED',
          actorType: 'VOLUNTEER',
          actorUserId: userId,
          reason: `Volunteer cancelled commitment: ${data.reason || 'Standard cancellation'}`,
        });

        // Notify Candidate
        await notify({
          userId: req.candidateId,
          type: 'VOLUNTEER_CANCELLED',
          title: 'Scribe Allocation Update - Replacement in Progress',
          body: 'Your allocated scribe has withdrawn from the examination commitment. The administrator will arrange a replacement scribe, and you will be notified once a new allocation is confirmed. We are sorry for the inconvenience.',
          linkPath: `/candidate/request-details.html?id=${req._id}`,
          requestId: req._id,
        });

        // Notify Admin
        await notify({
          adminAlert: true,
          type: 'VOLUNTEER_WITHDRAWN',
          title: 'Volunteer Cancelled Assignment',
          body: `Volunteer withdrew from assignment for ${examName} (Request ${req.reference}) before 5-day lock. Request is awaiting a new volunteer.`,
          linkPath: `/admin/requests.html?id=${req._id}`,
          requestId: req._id,
        });
      }
    }
  } else {
    // Candidate or Admin cancellation
    assignment.status = 'CANCELLED';
    assignment.cancelReason = data.reason || 'Cancelled';
    assignment.cancelledAt = new Date();
    assignment.cancelledBy = userId;
    await assignment.save();

    if (isCandidate) {
      // Notify volunteer
      await notify({
        userId: assignment.volunteerId,
        type: 'ASSIGNMENT_CANCELLED',
        title: 'Scribe Assignment Cancelled',
        body: `The scribe allocation for ${examName} has been cancelled by the candidate. Your commitment is released.`,
        linkPath: '/volunteer/commitments.html',
        requestId: req?._id,
      });
    } else if (isAdmin) {
      // Notify both candidate and volunteer
      await notify({
        userId: assignment.candidateId,
        type: 'ASSIGNMENT_CANCELLED',
        title: 'Scribe Assignment Cancelled',
        body: `Your scribe allocation for ${examName} has been cancelled by an administrator.`,
        linkPath: `/candidate/request-details.html?id=${req?._id}`,
        requestId: req?._id,
      });
      await notify({
        userId: assignment.volunteerId,
        type: 'ASSIGNMENT_CANCELLED',
        title: 'Scribe Assignment Cancelled',
        body: `The scribe allocation for ${examName} has been cancelled by an administrator.`,
        linkPath: '/volunteer/commitments.html',
        requestId: req?._id,
      });
    }
  }

  return {
    assignment,
    isLocked,
    status: 'CANCELLED',
  };
}

module.exports = {
  listAssignments,
  cancelAssignment,
  EMERGENCY_REASONS,
};
