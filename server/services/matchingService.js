'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const VolunteerInterest = require('../models/VolunteerInterest');
const VolunteerAvailability = require('../models/VolunteerAvailability');
const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const MatchProposal = require('../models/MatchProposal');
const ScribeRequest = require('../models/ScribeRequest');
const Examination = require('../models/Examination');
const RequestStatusHistory = require('../models/RequestStatusHistory');
const VerificationRecord = require('../models/VerificationRecord');
const { writeAudit } = require('./auditService');
const { notify } = require('./notificationService');
const { assertTransition, REQUEST_STATUS_LABEL } = require('./requestStateMachine');
const {
  checkVolunteerConflict,
  getExamTimeRange,
  findVolunteerScheduleConflict,
} = require('../utils/conflictChecker');
const { HttpError } = require('../utils/httpError');
const { escapeRegex } = require('../utils/regex');
const { generateAllocationId } = require('../utils/allocationId');

async function generateMatchReference() {
  const year = new Date().getFullYear();
  let candidateRef;
  let exists = true;
  let attempts = 0;
  const count = await MatchProposal.countDocuments();
  let seqNum = count + 1;

  while (exists && attempts < 25) {
    const seq = String(seqNum).padStart(5, '0');
    candidateRef = `MAT-${year}-${seq}`;
    exists = await MatchProposal.exists({ matchReference: candidateRef });
    if (exists) {
      seqNum++;
      attempts++;
    }
  }

  if (exists) {
    const crypto = require('crypto');
    candidateRef = `MAT-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }

  return candidateRef;
}

/**
 * Score a volunteer against a candidate request.
 * Scoring weights (sum to 100):
 * - Date/Time Availability: 30%
 * - Location Compatibility: 25%
 * - Language Compatibility: 20%
 * - Qualification / Subjects: 15%
 * - Relevant Experience: 10%
 */
function scoreVolunteer(request, exam, session, volunteer, profile, availability, assignments, isVerified) {
  let score = 0;
  const breakdown = {};
  const reasons = [];
  const matrix = {};
  let hasBlockingFailure = false;
  let blockingReason = null;
  let needsReview = false;

  // 1. Mandatory check: Overlapping confirmed assignments
  const reqStart = (session && session.startsAt) ? new Date(session.startsAt) : (exam && exam.startsOn ? new Date(exam.startsOn) : null);
  const reqEnd = (session && session.endsAt) ? new Date(session.endsAt) : (exam && exam.endsOn ? new Date(exam.endsOn) : (reqStart ? new Date(reqStart.getTime() + 4 * 60 * 60 * 1000) : null));

  if (reqStart && reqEnd) {
    const hasOverlap = assignments.some((a) => {
      if (a.status !== 'CONFIRMED') return false;
      const aStart = a.startsAt ? new Date(a.startsAt) : (a.confirmedAt ? new Date(a.confirmedAt) : null);
      const aEnd = a.endsAt ? new Date(a.endsAt) : (aStart ? new Date(aStart.getTime() + 4 * 60 * 60 * 1000) : null);
      if (!aStart || !aEnd) return false;
      return aStart < reqEnd && aEnd > reqStart;
    });

    if (hasOverlap) {
      hasBlockingFailure = true;
      blockingReason = 'Volunteer has an overlapping confirmed examination assignment.';
      reasons.push(blockingReason);
    }
  }

  // 2. Mandatory check: Verification status
  if (!isVerified) {
    needsReview = true;
    reasons.push('Volunteer identity verification is pending review.');
  }

  // 3. Date/Time Availability (30%)
  let dateTimeScore = 0;
  let timeMatch = false;
  if (session && session.startsAt && session.endsAt) {
    const sStart = new Date(session.startsAt);
    const sEnd = new Date(session.endsAt);
    const isAvail = availability.some((av) => {
      if (av.status !== 'OPEN') return false;
      const avStart = new Date(av.startsAt);
      const avEnd = new Date(av.endsAt);
      return avStart <= sStart && avEnd >= sEnd;
    });

    if (isAvail) {
      dateTimeScore = 30;
      timeMatch = true;
      reasons.push('Available during the exact examination session schedule.');
    } else {
      dateTimeScore = 15;
      reasons.push('Expressed interest for exam date; session-specific hours unconfirmed.');
    }
  } else {
    // Single day exam without granular session
    dateTimeScore = 25;
    timeMatch = true;
    reasons.push('Available on the examination date.');
  }
  breakdown.dateTime = dateTimeScore;
  score += dateTimeScore;

  // 4. Location compatibility (25%)
  let locationScore = 0;
  let locationMatch = false;
  const reqCity = (request.city || '').toLowerCase().trim();
  const volCity = (profile.city || '').toLowerCase().trim();
  const servLocations = (profile.serviceLocations || profile.availableRegions || []).map((l) => l.toLowerCase().trim());

  if (reqCity && (volCity === reqCity || servLocations.includes(reqCity))) {
    locationScore = 25;
    locationMatch = true;
    reasons.push(`Located in or serves examination city: ${request.city}.`);
  } else if (volCity) {
    locationScore = 10;
    reasons.push(`Based in ${profile.city}; inter-city travel may be required.`);
  } else {
    locationScore = 5;
  }
  breakdown.location = locationScore;
  score += locationScore;

  // 5. Language compatibility (20%)
  let langScore = 0;
  let langMatch = false;
  const reqLang = (request.language || '').toLowerCase().trim();
  const volLangs = (profile.languages || profile.preferredLanguages || []).map((l) => l.toLowerCase().trim());

  if (reqLang && volLangs.some((l) => l.includes(reqLang) || reqLang.includes(l))) {
    langScore = 20;
    langMatch = true;
    reasons.push(`Fluent in candidate's requested language: ${request.language}.`);
  } else if (volLangs.length > 0) {
    langScore = 8;
    reasons.push(`Speaks: ${(profile.languages || []).join(', ')}.`);
  }
  breakdown.language = langScore;
  score += langScore;

  // 6. Qualification / Subject alignment (15%)
  let qualScore = 0;
  const volSubjects = (profile.subjects || []).map((s) => s.toLowerCase().trim());
  if (volSubjects.length > 0) {
    qualScore = 15;
    reasons.push(`Comfortable scribing: ${(profile.subjects || []).join(', ')}.`);
  } else {
    qualScore = 10;
    reasons.push('General scribe assistance.');
  }
  breakdown.qualification = qualScore;
  score += qualScore;

  // 7. Relevant Experience (10%)
  let expScore = 0;
  const hasExp = Boolean(profile.hasPriorExperience || profile.hasScribeExperience);
  if (hasExp) {
    expScore = 10;
    reasons.push('Has prior examination scribe experience.');
  } else {
    expScore = 5;
    reasons.push('New volunteer scribe.');
  }
  breakdown.experience = expScore;
  score += expScore;

  // Matrix comparison for UI
  matrix.examinationMatch = true; // Guaranteed by query filter
  matrix.dateMatch = true;
  matrix.timeMatch = timeMatch;
  matrix.locationMatch = locationMatch;
  matrix.languageMatch = langMatch;
  matrix.isVerified = isVerified;
  matrix.hasExperience = hasExp;

  return {
    score: Math.min(100, Math.max(0, score)),
    scoreBreakdown: breakdown,
    compatibility: { reasons, matrix },
    hasBlockingFailure,
    blockingReason,
    needsReview,
  };
}

/**
 * Retrieve suitable volunteers who expressed interest in the SAME examination.
 * Enforces examination ID match, active status, and profile completion.
 */
async function findPotentialMatches(requestId) {
  const request = await ScribeRequest.findById(requestId).populate('examinationId');
  if (!request) throw HttpError.notFound('Request not found.');

  const exam = request.examinationId;
  if (!exam) throw HttpError.notFound('Associated examination not found.');

  let session = null;
  if (exam.sessions && request.sessionId) {
    session = exam.sessions.id(request.sessionId) || exam.sessions.find((s) => s._id.toString() === request.sessionId.toString());
  }
  if (!session && exam.sessions?.length === 1) {
    session = exam.sessions[0];
  }

  // Backend exclusion: Find volunteers who previously had a cancelled/withdrawn assignment for THIS particular request
  const withdrawnAssignments = await ConfirmedAssignment.find({
    requestId,
    status: 'CANCELLED',
  }).select('volunteerId');
  const withdrawnVolunteerIds = new Set(withdrawnAssignments.map((a) => a.volunteerId.toString()));

  // 1. CRITICAL: Query volunteer interests for the SAME examination
  const interests = await VolunteerInterest.find({
    examinationId: exam._id,
    status: 'ACTIVE',
  }).populate('volunteerId');

  const eligible = [];
  const requiresReview = [];

  for (const interest of interests) {
    const vol = interest.volunteerId;
    if (!vol || vol.role !== 'VOLUNTEER' || vol.status !== 'ACTIVE' || !vol.profileComplete) {
      continue;
    }

    // Backend exclusion: Exclude volunteer who previously withdrew from this specific request
    if (withdrawnVolunteerIds.has(vol._id.toString())) {
      continue;
    }

    const profile = await VolunteerProfile.findOne({ userId: vol._id });
    if (!profile) continue;

    // Check verification status
    const isVerified = vol.verificationStatus === 'VERIFIED';

    const [availability, assignments] = await Promise.all([
      VolunteerAvailability.find({ volunteerId: vol._id }),
      ConfirmedAssignment.find({ volunteerId: vol._id }),
    ]);

    const scored = scoreVolunteer(request, exam, session, vol, profile, availability, assignments, isVerified);

    const matchItem = {
      volunteerId: vol._id.toString(),
      volunteerName: profile.fullName || (profile.firstName ? `${profile.firstName} ${profile.lastName || ''}`.trim() : 'Volunteer'),
      volunteerMobile: vol.mobileE164,
      volunteerEmail: vol.email,
      volunteerCity: profile.city || '(City not set)',
      languages: profile.languages || profile.preferredLanguages || [],
      subjects: profile.subjects || [],
      hasExperience: Boolean(profile.hasPriorExperience || profile.hasScribeExperience),
      isVerified,
      verificationStatus: vol.verificationStatus || (isVerified ? 'VERIFIED' : 'PENDING'),
      interestId: interest._id.toString(),
      interestNotes: interest.notes,
      score: scored.score,
      scoreBreakdown: scored.scoreBreakdown,
      compatibility: scored.compatibility,
      hasBlockingFailure: scored.hasBlockingFailure,
      blockingReason: scored.blockingReason,
      needsReview: scored.needsReview,
    };

    if (!scored.hasBlockingFailure && isVerified) {
      eligible.push(matchItem);
    } else {
      requiresReview.push(matchItem);
    }
  }

  // Sort eligible volunteers by compatibility score descending
  eligible.sort((a, b) => b.score - a.score);
  requiresReview.sort((a, b) => b.score - a.score);

  return {
    request: {
      id: request._id.toString(),
      reference: request.reference,
      status: request.status,
      language: request.language,
      city: request.city,
      venue: request.venue || null,
      requirements: request.requirements,
      examination: {
        id: exam._id.toString(),
        name: exam.name || exam.title,
        authority: exam.authority || exam.conductingBody || '',
        startsOn: exam.startsOn || session?.startsAt || null,
        endsOn: exam.endsOn || session?.endsAt || null,
      },
      session: session ? {
        id: session._id.toString(),
        name: session.name || session.label || 'Main Session',
        label: session.label || session.name || 'Main Session',
        startsAt: session.startsAt,
        endsAt: session.endsAt,
      } : (exam.startsOn ? {
        id: 'default',
        name: 'General Session',
        label: 'General Session',
        startsAt: exam.startsOn,
        endsAt: exam.endsOn || exam.startsOn,
      } : null),
    },
    eligible,
    requiresReview,
    totalInterested: interests.length,
  };
}

/**
 * Administrator proposes a match between candidate request and interested volunteer.
 */
async function proposeMatch(requestId, volunteerId, adminNote, { adminId, ip, isOverride, overrideJustification, reportingTime, meetingPoint, reportingInstructions } = {}) {
  const request = await ScribeRequest.findById(requestId).populate('examinationId');
  if (!request) throw HttpError.notFound('Scribe request not found.');

  // Validate mandatory reporting details
  if (!reportingTime || typeof reportingTime !== 'string' || !reportingTime.trim()) {
    throw HttpError.badRequest('Reporting time is required before finalizing or proposing an allocation.');
  }
  if (!meetingPoint || typeof meetingPoint !== 'string' || !meetingPoint.trim()) {
    throw HttpError.badRequest('Meeting point is required before finalizing or proposing an allocation.');
  }

  const volunteer = await User.findById(volunteerId);
  if (!volunteer || volunteer.role !== 'VOLUNTEER' || volunteer.status !== 'ACTIVE') {
    throw HttpError.badRequest('Selected volunteer is not active.');
  }

  const volProfile = await VolunteerProfile.findOne({ userId: volunteerId });
  if (!volProfile) throw HttpError.notFound('Volunteer profile not found.');

  // Verify volunteer expressed interest in the SAME examination
  const interest = await VolunteerInterest.findOne({
    volunteerId,
    examinationId: request.examinationId._id,
    status: 'ACTIVE',
  });
  if (!interest) {
    throw HttpError.badRequest('Volunteer has not expressed interest in this examination.');
  }

  // Backend exclusion: Verify volunteer did not withdraw from this specific request
  const previouslyWithdrawn = await ConfirmedAssignment.findOne({
    requestId,
    volunteerId,
    status: 'CANCELLED',
  });
  if (previouslyWithdrawn) {
    throw HttpError.badRequest('This volunteer previously withdrew from this request and cannot be allocated as a replacement.');
  }

  // Ensure request can transition to MATCH_PROPOSED
  const allowedFrom = ['SUBMITTED', 'PENDING_REVIEW', 'AWAITING_VOLUNTEER', 'REPLACEMENT_REQUIRED', 'MATCH_PROPOSED'];
  if (!allowedFrom.includes(request.status)) {
    throw HttpError.badRequest(`Cannot propose match for a request with status ${request.status}.`);
  }

  // Requirement: Examination venue must be confirmed before sending a volunteer invitation
  if (!request.venue || !request.venue.confirmed) {
    throw HttpError.badRequest('Cannot propose match: Examination venue must be confirmed before inviting a volunteer.');
  }

  // Check if active match proposal already exists
  const existingActive = await MatchProposal.findOne({
    requestId,
    status: { $in: ['PROPOSED', 'INVITED', 'ACCEPTED'] },
  });
  if (existingActive) {
    if (existingActive.volunteerId.toString() === volunteerId.toString()) {
      throw HttpError.conflict('This volunteer has already been invited for this request.');
    }
    // Expire/withdraw prior pending proposal
    existingActive.status = 'WITHDRAWN';
    await existingActive.save();
  }

  // Calculate score & compatibility
  const exam = request.examinationId;
  let session = null;
  if (exam.sessions && request.sessionId) {
    session = exam.sessions.id(request.sessionId) || exam.sessions.find((s) => s._id.toString() === request.sessionId.toString());
  }

  const [availability, assignments] = await Promise.all([
    VolunteerAvailability.find({ volunteerId }),
    ConfirmedAssignment.find({ volunteerId }),
  ]);

  const isVerified = volunteer.verificationStatus === 'VERIFIED';
  const scored = scoreVolunteer(
    request,
    exam,
    session,
    volunteer,
    volProfile,
    availability,
    assignments,
    isVerified
  );

  // Check conflict: double-booking must never be bypassed
  const conflict = await checkVolunteerConflict(volunteerId, exam, session);
  if (conflict.hasConflict) {
    throw HttpError.conflict('Cannot propose match: Overlapping confirmed examination assignments cannot be overridden. You already have a confirmed examination assignment during this time. You cannot accept another overlapping commitment.');
  }

  // Validate eligibility & override requirements
  if (!isOverride) {
    if (scored.hasBlockingFailure) {
      if (scored.blockingReason && scored.blockingReason.toLowerCase().includes('overlap')) {
        throw HttpError.conflict('Cannot propose match: Overlapping confirmed examination assignments cannot be overridden. You already have a confirmed examination assignment during this time. You cannot accept another overlapping commitment.');
      }
      throw HttpError.badRequest(`Cannot propose match: ${scored.blockingReason || 'Volunteer does not meet match criteria.'}`);
    }
    if (!isVerified) {
      throw HttpError.badRequest('Selected volunteer is pending verification. Administrative justification is required.');
    }
  } else {
    // Override validations
    if (scored.hasBlockingFailure && scored.blockingReason && scored.blockingReason.toLowerCase().includes('overlap')) {
      throw HttpError.conflict('Cannot propose match: Overlapping confirmed examination assignments cannot be overridden. You already have a confirmed examination assignment during this time. You cannot accept another overlapping commitment.');
    }
    if (!overrideJustification || !overrideJustification.trim()) {
      throw HttpError.badRequest('An override justification is required when proposing a volunteer requiring review.');
    }
  }

  const matchRef = await generateMatchReference();

  const proposal = await MatchProposal.create({
    requestId,
    volunteerId,
    candidateId: request.candidateId,
    examinationId: exam._id,
    interestId: interest._id,
    matchReference: matchRef,
    score: scored.score,
    scoreBreakdown: scored.scoreBreakdown,
    compatibility: scored.compatibility,
    hasBlockingFailure: scored.hasBlockingFailure,
    blockingReason: scored.blockingReason,
    needsReview: scored.needsReview,
    isOverride: Boolean(isOverride),
    overrideJustification: overrideJustification?.trim() || null,
    adminNote: adminNote || null,
    reportingTime: reportingTime.trim(),
    meetingPoint: meetingPoint.trim(),
    reportingInstructions: reportingInstructions ? reportingInstructions.trim() : null,
    status: 'PROPOSED',
    reviewedById: adminId,
    invitedAt: new Date(),
  });

  const prevStatus = request.status;
  request.status = 'MATCH_PROPOSED';
  await request.save();

  await RequestStatusHistory.create({
    requestId,
    fromStatus: prevStatus,
    toStatus: 'MATCH_PROPOSED',
    actorType: 'ADMIN',
    actorAdminId: adminId,
    reason: `Match proposed with volunteer ${volProfile.fullName || 'Volunteer'} (${matchRef})${isOverride ? ' [OVERRIDE]' : ''}. Reporting Time: ${reportingTime.trim()}, Meeting Point: ${meetingPoint.trim()}. ${adminNote || ''}`.trim(),
  });

  // Notify Volunteer
  const examName = exam.name || exam.title;
  await notify({
    userId: volunteerId,
    type: 'INVITATION_RECEIVED',
    title: 'New Scribe Invitation!',
    body: `You have been selected and invited to scribe for ${examName}. Please review the invitation to accept or decline.`,
    linkPath: '/volunteer/commitments.html',
  });

  // Notify Candidate
  await notify({
    userId: request.candidateId,
    type: 'MATCH_PROPOSED',
    title: 'Scribe Match Proposed',
    body: `A volunteer scribe has been invited for your request (${request.reference}). We will notify you once they accept.`,
    linkPath: `/candidate/request-details.html?id=${requestId}`,
  });

  await writeAudit({
    adminId,
    action: 'match.propose',
    entityType: 'MatchProposal',
    entityId: proposal._id,
    details: { requestId, volunteerId, examId: exam._id, score: scored.score },
    ip,
  });

  return proposal;
}

/**
 * Volunteer accepts match invitation.
 */
async function acceptInvitation(proposalId, volunteerId, termsData = {}) {
  const proposal = await MatchProposal.findOne({
    _id: proposalId,
    volunteerId,
  }).populate('requestId');

  if (!proposal) throw HttpError.notFound('Invitation not found.');
  if (proposal.status !== 'PROPOSED' && proposal.status !== 'INVITED') {
    throw HttpError.badRequest(`Invitation cannot be accepted in status: ${proposal.status}.`);
  }

  const request = proposal.requestId;
  if (!request) throw HttpError.notFound('Linked scribe request not found.');

  // Validate Volunteer Commitment Agreement acceptance
  if (!termsData || !termsData.termsAccepted) {
    throw HttpError.badRequest('You must review and accept the Volunteer Commitment Agreement before accepting this assignment.');
  }

  // Populate examinationId on request if needed
  if (!request.populated('examinationId')) {
    await request.populate('examinationId');
  }
  const exam = request.examinationId || (await Examination.findById(request.examinationId));
  let session = null;
  if (exam && exam.sessions && request.sessionId) {
    session = exam.sessions.id(request.sessionId) || exam.sessions.find((s) => s._id.toString() === request.sessionId.toString());
  }

  const { startsAt: rangeStartsAt, endsAt: rangeEndsAt } = getExamTimeRange(exam, session);
  if (rangeStartsAt && rangeEndsAt) {
    const scheduleConflict = await findVolunteerScheduleConflict(volunteerId, {
      startsAt: rangeStartsAt,
      endsAt: rangeEndsAt,
      excludeProposalId: proposal._id,
    });
    if (scheduleConflict.hasConflict) {
      throw HttpError.conflict('Cannot accept invitation: You have a scheduling conflict with an existing confirmed assignment or accepted invitation.');
    }
  }

  // Double booking prevention check with travel buffer
  const conflict = await checkVolunteerConflict(volunteerId, exam, session);
  if (conflict.hasConflict) {
    throw HttpError.conflict(conflict.message);
  }

  proposal.status = 'ACCEPTED';
  proposal.termsAccepted = true;
  proposal.termsVersion = termsData.termsVersion || '1.0';
  proposal.termsAcceptedAt = new Date();
  proposal.respondedAt = new Date();
  await proposal.save();

  // Calculate examination timing & 5-day lock deadline
  let startsAt = exam?.startsOn || null;
  let endsAt = exam?.endsOn || null;
  if (session) {
    startsAt = session.startsAt || session.date || startsAt;
    endsAt = session.endsAt || session.date || endsAt;
  }

  let lockDeadline = null;
  if (startsAt) {
    lockDeadline = new Date(new Date(startsAt).getTime() - 5 * 24 * 60 * 60 * 1000);
  }
  const isLocked = lockDeadline ? (new Date() >= lockDeadline) : false;

  // Create ConfirmedAssignment in MongoDB with duplicate active protection
  let assignment;
  const allocationId = await generateAllocationId();
  try {
    assignment = await ConfirmedAssignment.create({
      requestId: request._id,
      matchProposalId: proposal._id,
      candidateId: request.candidateId,
      volunteerId,
      allocationId,
      reportingTime: proposal.reportingTime || null,
      meetingPoint: proposal.meetingPoint || null,
      reportingInstructions: proposal.reportingInstructions || null,
      startsAt,
      endsAt,
      lockDeadline,
      isLocked,
      termsAccepted: proposal.termsAccepted || true,
      termsVersion: proposal.termsVersion || '1.0',
      termsAcceptedAt: proposal.termsAcceptedAt || new Date(),
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000 || err.message?.includes('E11000')) {
      throw HttpError.conflict('An active confirmed scribe assignment already exists for this request.');
    }
    throw err;
  }

  const prevStatus = request.status;
  const isReplacement = prevStatus === 'REPLACEMENT_REQUIRED';
  request.status = 'CONFIRMED';
  await request.save();

  await RequestStatusHistory.create({
    requestId: request._id,
    fromStatus: prevStatus,
    toStatus: 'CONFIRMED',
    actorType: 'VOLUNTEER',
    actorUserId: volunteerId,
    reason: `Volunteer accepted the scribe invitation. Assignment confirmed with Allocation ID: ${allocationId}.`,
  });

  const examName = exam ? (exam.name || exam.title) : 'Examination';

  // Notify Volunteer
  await notify({
    userId: volunteerId,
    type: 'ASSIGNMENT_CONFIRMED',
    title: 'Assignment Confirmed! ✅',
    body: `Your scribe commitment has been confirmed. Please report to the designated meeting point at the specified reporting time. Use your Allocation ID (${allocationId}) to identify your assigned candidate or seek assistance from an authorized examination coordinator, where available.`,
    linkPath: '/volunteer/commitments.html',
    requestId: request._id,
  });

  // Notify Candidate (Privacy-safe: no volunteer personal details)
  await notify({
    userId: request.candidateId,
    type: isReplacement ? 'REPLACEMENT_ALLOCATED' : 'SCRIBE_ALLOCATED',
    title: isReplacement ? 'Replacement Scribe Confirmed! ✅' : 'Scribe Assistance Confirmed! ✅',
    body: isReplacement
      ? `A replacement scribe allocation has been confirmed for your examination: ${examName}. Allocation ID: ${allocationId}. Please report to the designated meeting point at the specified reporting time. Use your Allocation ID to identify your assigned scribe.`
      : `Your scribe allocation has been confirmed. Please report to the designated meeting point at the specified reporting time. Use your Allocation ID (${allocationId}) to identify your assigned scribe or seek assistance from an authorized examination coordinator, where available.`,
    linkPath: `/candidate/request-details.html?id=${request._id}`,
    requestId: request._id,
  });

  return { proposal, request, assignment };
}

/**
 * Volunteer declines match invitation.
 */
async function declineInvitation(proposalId, volunteerId, reason) {
  const proposal = await MatchProposal.findOne({
    _id: proposalId,
    volunteerId,
  }).populate('requestId');

  if (!proposal) throw HttpError.notFound('Invitation not found.');
  if (proposal.status !== 'PROPOSED' && proposal.status !== 'INVITED') {
    throw HttpError.badRequest(`Invitation cannot be declined in status: ${proposal.status}.`);
  }

  const request = proposal.requestId;
  proposal.status = 'DECLINED';
  proposal.declineReason = reason || null;
  proposal.respondedAt = new Date();
  await proposal.save();

  if (request) {
    const prevStatus = request.status;
    request.status = 'AWAITING_VOLUNTEER';
    await request.save();

    await RequestStatusHistory.create({
      requestId: request._id,
      fromStatus: prevStatus,
      toStatus: 'AWAITING_VOLUNTEER',
      actorType: 'VOLUNTEER',
      actorUserId: volunteerId,
      reason: `Volunteer declined invitation. Reason: ${reason || 'Not specified'}.`,
    });
  }

  return { proposal, request };
}

/**
 * Candidate confirms the proposed volunteer (Deprecated - auto-confirmed on volunteer acceptance).
 */
async function confirmMatch(requestId, candidateId) {
  const request = await ScribeRequest.findOne({ _id: requestId, candidateId }).populate('examinationId');
  if (!request) throw HttpError.notFound('Scribe request not found.');

  if (request.status === 'CONFIRMED') {
    throw HttpError.badRequest('Candidate confirmation of scribe allocation is no longer required. The assignment is already confirmed.');
  }

  // Handle any existing/legacy request in VOLUNTEER_ACCEPTED or AWAITING_CANDIDATE_CONFIRMATION safely
  if (request.status !== 'VOLUNTEER_ACCEPTED' && request.status !== 'AWAITING_CANDIDATE_CONFIRMATION') {
    throw HttpError.badRequest('Candidate confirmation of scribe allocation is no longer required or supported.');
  }

  const proposal = await MatchProposal.findOne({
    requestId,
    status: 'ACCEPTED',
  });
  if (!proposal) throw HttpError.notFound('No accepted volunteer match proposal found for this request.');

  const volunteerId = proposal.volunteerId;
  const exam = request.examinationId;

  let startsAt = exam?.startsOn || null;
  let endsAt = exam?.endsOn || null;

  let session = null;
  if (exam && exam.sessions && request.sessionId) {
    session = exam.sessions.id(request.sessionId) || exam.sessions.find((s) => s._id.toString() === request.sessionId.toString());
    if (session) {
      startsAt = session.startsAt || session.date || startsAt;
      endsAt = session.endsAt || session.date || endsAt;
    }
  }

  // Prevent volunteer schedule conflict at final assignment confirmation
  if (startsAt && endsAt) {
    const scheduleConflict = await findVolunteerScheduleConflict(volunteerId, {
      startsAt,
      endsAt,
      excludeProposalId: proposal._id,
    });
    if (scheduleConflict.hasConflict && scheduleConflict.conflictType === 'CONFIRMED_ASSIGNMENT') {
      throw HttpError.conflict('Cannot confirm assignment: The volunteer has a scheduling conflict with another confirmed assignment.');
    }
  }

  // Final double-booking conflict check
  const conflict = await checkVolunteerConflict(volunteerId, exam, session);
  if (conflict.hasConflict) {
    throw HttpError.conflict(conflict.message);
  }

  proposal.status = 'CANDIDATE_CONFIRMED';
  await proposal.save();

  // Calculate 5-day lock deadline relative to examination start
  let lockDeadline = null;
  if (startsAt) {
    lockDeadline = new Date(new Date(startsAt).getTime() - 5 * 24 * 60 * 60 * 1000);
  }
  const isLocked = lockDeadline ? (new Date() >= lockDeadline) : false;

  // Create ConfirmedAssignment in MongoDB with duplicate active protection
  let assignment;
  const allocationId = await generateAllocationId();
  try {
    assignment = await ConfirmedAssignment.create({
      requestId,
      matchProposalId: proposal._id,
      candidateId,
      volunteerId,
      allocationId,
      reportingTime: proposal.reportingTime || null,
      meetingPoint: proposal.meetingPoint || null,
      reportingInstructions: proposal.reportingInstructions || null,
      startsAt,
      endsAt,
      lockDeadline,
      isLocked,
      termsAccepted: proposal.termsAccepted || true,
      termsVersion: proposal.termsVersion || '1.0',
      termsAcceptedAt: proposal.termsAcceptedAt || new Date(),
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000 || err.message?.includes('E11000')) {
      throw HttpError.conflict('An active confirmed scribe assignment already exists for this request.');
    }
    throw err;
  }

  const prevStatus = request.status;
  request.status = 'CONFIRMED';
  await request.save();

  await RequestStatusHistory.create({
    requestId,
    fromStatus: prevStatus,
    toStatus: 'CONFIRMED',
    actorType: 'CANDIDATE',
    actorUserId: candidateId,
    reason: 'Candidate confirmed the scribe arrangement. Assignment is now confirmed.',
  });

  const examName = exam ? (exam.name || exam.title) : 'Examination';

  // Notify Volunteer
  await notify({
    userId: volunteerId,
    type: 'ASSIGNMENT_CONFIRMED',
    title: 'Assignment Confirmed! ✅',
    body: `Your scribe assignment for ${examName} is officially confirmed! Thank you for supporting the candidate.`,
    linkPath: '/volunteer/commitments.html',
  });

  // Notify Candidate (Privacy-safe: no volunteer personal details)
  await notify({
    userId: candidateId,
    type: 'SCRIBE_ALLOCATED',
    title: 'Scribe Assistance Confirmed! ✅',
    body: `Your scribe arrangement for ${examName} is confirmed. View details in your dashboard.`,
    linkPath: `/candidate/request-details.html?id=${requestId}`,
  });

  return { request, assignment, proposal };
}

/**
 * Candidate declines match (Disabled - candidates cannot reject allocated scribes).
 */
async function declineMatch(requestId, candidateId, reason) {
  throw HttpError.badRequest('Candidate rejection of scribe allocation is no longer required or supported.');
}

/**
 * Candidate declines proposed match.
 */
async function declineMatch(requestId, candidateId, reason) {
  const request = await ScribeRequest.findOne({ _id: requestId, candidateId });
  if (!request) throw HttpError.notFound('Scribe request not found.');

  const proposal = await MatchProposal.findOne({
    requestId,
    status: 'ACCEPTED',
  });

  if (proposal) {
    proposal.status = 'CANDIDATE_REJECTED';
    proposal.candidateDeclineReason = reason || null;
    await proposal.save();
  }

  const prevStatus = request.status;
  request.status = 'AWAITING_VOLUNTEER';
  await request.save();

  await RequestStatusHistory.create({
    requestId,
    fromStatus: prevStatus,
    toStatus: 'AWAITING_VOLUNTEER',
    actorType: 'CANDIDATE',
    actorUserId: candidateId,
    reason: `Candidate declined proposed volunteer. Reason: ${reason || 'Not specified'}. Replacement needed.`,
  });

  return { request, proposal };
}

/**
 * List all volunteer examination interests for Admin dashboard.
 */
async function listAllVolunteerInterests({ page = 1, pageSize = 20, examinationId, search } = {}) {
  const query = {};
  if (examinationId) query.examinationId = examinationId;

  if (search && typeof search === 'string' && search.trim()) {
    const reg = new RegExp(escapeRegex(search.trim()), 'i');
    const matchingExams = await Examination.find({ $or: [{ name: reg }, { title: reg }, { authority: reg }] }).select('_id');
    const examIds = matchingExams.map((e) => e._id);

    const matchingUsers = await User.find({ $or: [{ mobileE164: reg }, { email: reg }] }).select('_id');
    const userIds = matchingUsers.map((u) => u._id);

    query.$or = [{ examinationId: { $in: examIds } }, { volunteerId: { $in: userIds } }];
  }

  const [items, total] = await Promise.all([
    VolunteerInterest.find(query)
      .populate('examinationId', 'name title authority slug startsOn locations')
      .populate('volunteerId', 'mobileE164 email status verificationStatus profileComplete')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    VolunteerInterest.countDocuments(query),
  ]);

  const mapped = await Promise.all(
    items.map(async (item) => {
      let profile = null;
      if (item.volunteerId) {
        profile = await VolunteerProfile.findOne({ userId: item.volunteerId._id });
      }

      return {
        id: item._id.toString(),
        status: item.status,
        notes: item.notes,
        createdAt: item.createdAt,
        examination: item.examinationId ? {
          id: item.examinationId._id.toString(),
          name: item.examinationId.name || item.examinationId.title,
          authority: item.examinationId.authority,
          startsOn: item.examinationId.startsOn,
          locations: item.examinationId.locations,
        } : null,
        volunteer: item.volunteerId ? {
          id: item.volunteerId._id.toString(),
          name: profile?.fullName || (profile?.firstName ? `${profile.firstName} ${profile.lastName || ''}`.trim() : 'Volunteer'),
          mobile: item.volunteerId.mobileE164,
          email: item.volunteerId.email,
          city: profile?.city || '—',
          languages: profile?.languages || profile?.preferredLanguages || [],
          subjects: profile?.subjects || [],
          hasExperience: Boolean(profile?.hasPriorExperience || profile?.hasScribeExperience),
          verificationStatus: item.volunteerId.verificationStatus || 'UNVERIFIED',
        } : null,
      };
    })
  );

  return { items: mapped, total };
}

/**
 * List all matches and assignments for Admin.
 */
async function listAllMatches({ page = 1, pageSize = 20, status } = {}) {
  const query = {};
  if (status) query.status = status;

  const [items, total] = await Promise.all([
    MatchProposal.find(query)
      .populate({
        path: 'requestId',
        populate: { path: 'examinationId', select: 'name title authority startsOn' },
      })
      .populate('volunteerId', 'mobileE164 email verificationStatus')
      .populate('candidateId', 'mobileE164 email')
      .populate('reviewedById', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    MatchProposal.countDocuments(query),
  ]);

  const mapped = await Promise.all(
    items.map(async (m) => {
      let candProfile = null;
      let volProfile = null;

      if (m.candidateId) {
        candProfile = await CandidateProfile.findOne({ userId: m.candidateId._id });
      }
      if (m.volunteerId) {
        volProfile = await VolunteerProfile.findOne({ userId: m.volunteerId._id });
      }

      let activeAssignment = null;
      if (['ACCEPTED', 'CONFIRMED', 'CANDIDATE_CONFIRMED'].includes(m.status) && m.requestId?._id) {
        activeAssignment = await ConfirmedAssignment.findOne({
          requestId: m.requestId._id,
          status: 'CONFIRMED',
        }).select('allocationId reportingTime meetingPoint reportingInstructions');
      }

      return {
        id: m._id.toString(),
        reference: m.matchReference,
        allocationId: activeAssignment?.allocationId || null,
        reportingTime: activeAssignment?.reportingTime || m.reportingTime || null,
        meetingPoint: activeAssignment?.meetingPoint || m.meetingPoint || null,
        reportingInstructions: activeAssignment?.reportingInstructions || m.reportingInstructions || null,
        status: m.status,
        score: m.score,
        scoreBreakdown: m.scoreBreakdown,
        adminNote: m.adminNote,
        declineReason: m.declineReason || m.candidateDeclineReason,
        createdAt: m.createdAt,
        reviewedBy: m.reviewedById?.name || 'Administrator',
        examination: m.requestId?.examinationId ? {
          id: m.requestId.examinationId._id.toString(),
          name: m.requestId.examinationId.name || m.requestId.examinationId.title,
          authority: m.requestId.examinationId.authority,
          startsOn: m.requestId.examinationId.startsOn,
        } : null,
        candidate: m.candidateId ? {
          id: m.candidateId._id.toString(),
          name: candProfile?.fullName || 'Candidate',
          mobile: m.candidateId.mobileE164,
        } : null,
        volunteer: m.volunteerId ? {
          id: m.volunteerId._id.toString(),
          name: volProfile?.fullName || 'Volunteer',
          mobile: m.volunteerId.mobileE164,
          city: volProfile?.city,
          verificationStatus: m.volunteerId.verificationStatus || 'UNVERIFIED',
        } : null,
      };
    })
  );

  return { items: mapped, total };
}

/**
 * Super-Admin directly finalizes and confirms scribe allocation with mandatory reporting details
 */
async function allocateScribe(requestId, volunteerId, { reportingTime, meetingPoint, reportingInstructions, adminNote, isOverride, overrideJustification } = {}, { adminId, ip } = {}) {
  const request = await ScribeRequest.findById(requestId).populate('examinationId');
  if (!request) throw HttpError.notFound('Scribe request not found.');

  const volunteer = await User.findById(volunteerId);
  if (!volunteer || volunteer.role !== 'VOLUNTEER' || volunteer.status !== 'ACTIVE') {
    throw HttpError.badRequest('Selected volunteer is not active.');
  }

  const volProfile = await VolunteerProfile.findOne({ userId: volunteerId });
  if (!volProfile) throw HttpError.notFound('Volunteer profile not found.');

  // Validate mandatory reporting details
  if (!reportingTime || typeof reportingTime !== 'string' || !reportingTime.trim()) {
    throw HttpError.badRequest('Reporting time is required before finalizing allocation.');
  }
  if (!meetingPoint || typeof meetingPoint !== 'string' || !meetingPoint.trim()) {
    throw HttpError.badRequest('Meeting point is required before finalizing allocation.');
  }

  if (!request.venue || !request.venue.confirmed) {
    throw HttpError.badRequest('Cannot finalize allocation: Examination venue must be confirmed before allocating a volunteer.');
  }

  // Backend exclusion: Verify volunteer did not withdraw from this specific request
  const previouslyWithdrawn = await ConfirmedAssignment.findOne({
    requestId,
    volunteerId,
    status: 'CANCELLED',
  });
  if (previouslyWithdrawn) {
    throw HttpError.badRequest('This volunteer previously withdrew from this request and cannot be allocated as a replacement.');
  }

  const exam = request.examinationId;
  let session = null;
  if (exam.sessions && request.sessionId) {
    session = exam.sessions.id(request.sessionId) || exam.sessions.find((s) => s._id.toString() === request.sessionId.toString());
  }

  const conflict = await checkVolunteerConflict(volunteerId, exam, session);
  if (conflict.hasConflict) {
    throw HttpError.conflict('Cannot allocate volunteer: Volunteer has an overlapping confirmed examination assignment.');
  }

  const matchRef = await generateMatchReference();
  let proposal = await MatchProposal.findOne({ requestId, volunteerId });
  if (!proposal) {
    proposal = await MatchProposal.create({
      requestId,
      volunteerId,
      candidateId: request.candidateId,
      examinationId: exam._id,
      matchReference: matchRef,
      adminNote: adminNote || null,
      reportingTime: reportingTime.trim(),
      meetingPoint: meetingPoint.trim(),
      reportingInstructions: reportingInstructions ? reportingInstructions.trim() : null,
      status: 'ACCEPTED',
      reviewedById: adminId,
      invitedAt: new Date(),
      respondedAt: new Date(),
      isOverride: Boolean(isOverride),
      overrideJustification: overrideJustification?.trim() || null,
    });
  } else {
    proposal.status = 'ACCEPTED';
    proposal.reportingTime = reportingTime.trim();
    proposal.meetingPoint = meetingPoint.trim();
    proposal.reportingInstructions = reportingInstructions ? reportingInstructions.trim() : null;
    await proposal.save();
  }

  let startsAt = exam?.startsOn || null;
  let endsAt = exam?.endsOn || null;
  if (session) {
    startsAt = session.startsAt || session.date || startsAt;
    endsAt = session.endsAt || session.date || endsAt;
  }
  let lockDeadline = null;
  if (startsAt) {
    lockDeadline = new Date(new Date(startsAt).getTime() - 5 * 24 * 60 * 60 * 1000);
  }
  const isLocked = lockDeadline ? (new Date() >= lockDeadline) : false;

  const allocationId = await generateAllocationId();
  let assignment;
  try {
    assignment = await ConfirmedAssignment.create({
      requestId: request._id,
      matchProposalId: proposal._id,
      candidateId: request.candidateId,
      volunteerId,
      allocationId,
      reportingTime: reportingTime.trim(),
      meetingPoint: meetingPoint.trim(),
      reportingInstructions: reportingInstructions ? reportingInstructions.trim() : null,
      startsAt,
      endsAt,
      lockDeadline,
      isLocked,
      termsAccepted: true,
      termsVersion: '1.0',
      termsAcceptedAt: new Date(),
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000 || err.message?.includes('E11000')) {
      throw HttpError.conflict('An active confirmed scribe assignment already exists for this request.');
    }
    throw err;
  }

  const prevStatus = request.status;
  const isReplacement = prevStatus === 'REPLACEMENT_REQUIRED';
  request.status = 'CONFIRMED';
  await request.save();

  await RequestStatusHistory.create({
    requestId: request._id,
    fromStatus: prevStatus,
    toStatus: 'CONFIRMED',
    actorType: 'ADMIN',
    actorAdminId: adminId,
    reason: `Scribe allocated & confirmed by Administrator. Allocation ID: ${allocationId}. Reporting Time: ${reportingTime.trim()}, Meeting Point: ${meetingPoint.trim()}`,
  });

  const examName = exam ? (exam.name || exam.title) : 'Examination';

  // Notify Volunteer
  await notify({
    userId: volunteerId,
    type: 'ASSIGNMENT_CONFIRMED',
    title: 'Assignment Confirmed! ✅',
    body: `Your scribe commitment has been confirmed. Please report to the designated meeting point at the specified reporting time. Use your Allocation ID (${allocationId}) to identify your assigned candidate or seek assistance from an authorized examination coordinator, where available.`,
    linkPath: '/volunteer/commitments.html',
    requestId: request._id,
  });

  // Notify Candidate
  await notify({
    userId: request.candidateId,
    type: isReplacement ? 'REPLACEMENT_ALLOCATED' : 'SCRIBE_ALLOCATED',
    title: isReplacement ? 'Replacement Scribe Confirmed! ✅' : 'Scribe Assistance Confirmed! ✅',
    body: isReplacement
      ? `A replacement scribe allocation has been confirmed for your examination: ${examName}. Allocation ID: ${allocationId}. Please report to the designated meeting point at the specified reporting time. Use your Allocation ID to identify your assigned scribe.`
      : `Your scribe allocation has been confirmed. Please report to the designated meeting point at the specified reporting time. Use your Allocation ID (${allocationId}) to identify your assigned scribe or seek assistance from an authorized examination coordinator, where available.`,
    linkPath: `/candidate/request-details.html?id=${request._id}`,
    requestId: request._id,
  });

  await writeAudit({
    adminId,
    action: 'allocation.confirm',
    entityType: 'ConfirmedAssignment',
    entityId: assignment._id,
    details: { requestId, volunteerId, allocationId, reportingTime: reportingTime.trim(), meetingPoint: meetingPoint.trim() },
    ip,
  });

  return { request, proposal, assignment };
}

module.exports = {
  scoreVolunteer,
  findPotentialMatches,
  proposeMatch,
  allocateScribe,
  acceptInvitation,
  declineInvitation,
  confirmMatch,
  declineMatch,
  listAllVolunteerInterests,
  listAllMatches,
};
