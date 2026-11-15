'use strict';

const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const ScribeRequest = require('../models/ScribeRequest');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const RequestStatusHistory = require('../models/RequestStatusHistory');
const { notify } = require('./notificationService');
const { HttpError } = require('../utils/httpError');

const EMERGENCY_REASONS = [
  'Medical Emergency',
  'Family Emergency',
  'Urgent Official / Examination Conflict',
  'Travel / Severe Transit Disruption',
  'Other Critical Emergency',
];

async function listAssignments(userId, role) {
  const filter = role === 'CANDIDATE' ? { candidateId: userId } : { volunteerId: userId };

  const items = await ConfirmedAssignment.find(filter)
    .populate({
      path: 'requestId',
      populate: [
        { path: 'examinationId', select: 'name title slug authority startsOn locations' },
        { path: 'candidateId', select: 'mobileE164' },
      ],
    })
    .populate('volunteerId', 'mobileE164 verificationStatus')
    .populate('candidateId', 'mobileE164')
    .sort({ startsAt: 1 });

  return Promise.all(
    items.map(async (a) => {
      const req = a.requestId;
      const exam = req?.examinationId;

      let candidateName = 'Candidate';
      let volunteerName = 'Volunteer';

      if (a.candidateId) {
        const cp = await CandidateProfile.findOne({ userId: a.candidateId._id });
        if (cp) candidateName = cp.fullName || `${cp.firstName || ''} ${cp.lastName || ''}`.trim() || 'Candidate';
      }

      if (a.volunteerId) {
        const vp = await VolunteerProfile.findOne({ userId: a.volunteerId._id });
        if (vp) volunteerName = vp.fullName || `${vp.firstName || ''} ${vp.lastName || ''}`.trim() || 'Volunteer';
      }

      // 5-day lock calculation
      const startsAtTime = a.startsAt ? new Date(a.startsAt).getTime() : (exam?.startsOn ? new Date(exam.startsOn).getTime() : null);
      const lockDeadlineTime = a.lockDeadline ? new Date(a.lockDeadline).getTime() : (startsAtTime ? startsAtTime - 5 * 24 * 60 * 60 * 1000 : null);
      const isLocked = lockDeadlineTime ? (Date.now() >= lockDeadlineTime) : false;

      return {
        id: a._id.toString(),
        requestId: req ? req._id.toString() : null,
        status: a.status,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
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
        candidateName,
        volunteerName,
        candidateMobile: a.candidateId?.mobileE164,
        volunteerMobile: a.volunteerId?.mobileE164,
        examination: exam ? {
          id: exam._id.toString(),
          name: exam.name || exam.title,
          authority: exam.authority,
          slug: exam.slug,
          startsOn: exam.startsOn,
          locations: exam.locations,
        } : null,
      };
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
          title: 'URGENT: Scribe Replacement Required',
          body: `Your assigned volunteer has reported an emergency (${data.reason}) and cannot attend. Our administrative team has been urgently alerted to coordinate an emergency replacement for ${examName}.`,
          linkPath: `/candidate/request-details.html?id=${req._id}`,
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
        req.status = 'AWAITING_VOLUNTEER';
        await req.save();

        await RequestStatusHistory.create({
          requestId: req._id,
          fromStatus: prevStatus,
          toStatus: 'AWAITING_VOLUNTEER',
          actorType: 'VOLUNTEER',
          actorUserId: userId,
          reason: `Volunteer cancelled commitment before 5-day lock: ${data.reason || 'Standard cancellation'}`,
        });

        // Notify Candidate
        await notify({
          userId: req.candidateId,
          type: 'VOLUNTEER_CANCELLED',
          title: 'Volunteer Cancellation - Re-matching in Progress',
          body: `Your assigned volunteer has withdrawn from ${examName}. Your request has returned to the matching queue for another volunteer.`,
          linkPath: `/candidate/request-details.html?id=${req._id}`,
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
    assignment.cancelReason = data.reason || 'Cancelled by candidate/admin';
    assignment.cancelledAt = new Date();
    assignment.cancelledBy = userId;
    await assignment.save();
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
