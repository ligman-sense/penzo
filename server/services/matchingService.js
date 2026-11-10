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
const { HttpError } = require('../utils/httpError');

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
  if (session && session.startsAt && session.endsAt) {
    const sStart = new Date(session.startsAt);
    const sEnd = new Date(session.endsAt);
    const hasOverlap = assignments.some((a) => {
      if (a.status !== 'CONFIRMED') return false;
      const aStart = new Date(a.startsAt);
      const aEnd = new Date(a.endsAt);
      return aStart < sEnd && aEnd > sStart;
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
      requirements: request.requirements,
      examination: {
        id: exam._id.toString(),
        name: exam.name || exam.title,
        authority: exam.authority,
        startsOn: exam.startsOn,
      },
      session: session ? {
        id: session._id.toString(),
        name: session.name || session.label || 'Main Session',
        startsAt: session.startsAt,
        endsAt: session.endsAt,
      } : null,
    },
    eligible,
    requiresReview,
    totalInterested: interests.length,
  };
}

/**
 * Administrator proposes a match between candidate request and interested volunteer.
 */
async function proposeMatch(requestId, volunteerId, adminNote, { adminId, ip } = {}) {
  const request = await ScribeRequest.findById(requestId).populate('examinationId');
  if (!request) throw HttpError.notFound('Scribe request not found.');

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

  // Ensure request can transition to MATCH_PROPOSED
  const allowedFrom = ['SUBMITTED', 'PENDING_REVIEW', 'AWAITING_VOLUNTEER', 'REPLACEMENT_REQUIRED', 'MATCH_PROPOSED'];
  if (!allowedFrom.includes(request.status)) {
    throw HttpError.badRequest(`Cannot propose match for a request with status ${request.status}.`);
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

  const scored = scoreVolunteer(
    request,
    exam,
    session,
    volunteer,
    volProfile,
    availability,
    assignments,
    volunteer.verificationStatus === 'VERIFIED'
  );

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
    adminNote: adminNote || null,
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
    reason: `Match proposed with volunteer ${volProfile.fullName || 'Volunteer'} (${matchRef}). ${adminNote || ''}`.trim(),
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
async function acceptInvitation(proposalId, volunteerId) {
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

  proposal.status = 'ACCEPTED';
  proposal.respondedAt = new Date();
  await proposal.save();

  const prevStatus = request.status;
  request.status = 'VOLUNTEER_ACCEPTED';
  await request.save();

  await RequestStatusHistory.create({
    requestId: request._id,
    fromStatus: prevStatus,
    toStatus: 'VOLUNTEER_ACCEPTED',
    actorType: 'VOLUNTEER',
    actorUserId: volunteerId,
    reason: 'Volunteer accepted the scribe invitation.',
  });

  // Notify Candidate to confirm
  await notify({
    userId: request.candidateId,
    type: 'VOLUNTEER_ACCEPTED',
    title: 'Volunteer Accepted! Confirmation Required',
    body: 'A volunteer has accepted your scribe request. Please confirm the arrangement to finalize the scribe assistance.',
    linkPath: `/candidate/request-details.html?id=${request._id}`,
  });

  return { proposal, request };
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
 * Candidate confirms the proposed volunteer.
 */
async function confirmMatch(requestId, candidateId) {
  const request = await ScribeRequest.findOne({ _id: requestId, candidateId }).populate('examinationId');
  if (!request) throw HttpError.notFound('Scribe request not found.');

  if (request.status !== 'VOLUNTEER_ACCEPTED' && request.status !== 'AWAITING_CANDIDATE_CONFIRMATION') {
    throw HttpError.badRequest(`Cannot confirm match for request in status: ${request.status}.`);
  }

  const proposal = await MatchProposal.findOne({
    requestId,
    status: 'ACCEPTED',
  });
  if (!proposal) throw HttpError.notFound('No accepted volunteer match proposal found for this request.');

  const volunteerId = proposal.volunteerId;
  const exam = request.examinationId;

  let startsAt = exam.startsOn || null;
  let endsAt = exam.endsOn || null;

  if (exam.sessions && request.sessionId) {
    const session = exam.sessions.id(request.sessionId) || exam.sessions.find((s) => s._id.toString() === request.sessionId.toString());
    if (session) {
      startsAt = session.startsAt || session.date || startsAt;
      endsAt = session.endsAt || session.date || endsAt;
    }
  }

  proposal.status = 'CANDIDATE_CONFIRMED';
  await proposal.save();

  // Create ConfirmedAssignment in MongoDB
  const assignment = await ConfirmedAssignment.create({
    requestId,
    matchProposalId: proposal._id,
    candidateId,
    volunteerId,
    startsAt,
    endsAt,
    status: 'CONFIRMED',
    confirmedAt: new Date(),
  });

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

  const examName = exam.name || exam.title;

  // Notify Volunteer
  await notify({
    userId: volunteerId,
    type: 'ASSIGNMENT_CONFIRMED',
    title: 'Assignment Confirmed! ✅',
    body: `Your scribe assignment for ${examName} is officially confirmed! Thank you for supporting the candidate.`,
    linkPath: '/volunteer/commitments.html',
  });

  // Notify Candidate
  await notify({
    userId: candidateId,
    type: 'ASSIGNMENT_CONFIRMED',
    title: 'Scribe Assistance Confirmed! ✅',
    body: `Your scribe arrangement for ${examName} is confirmed. View details in your dashboard.`,
    linkPath: `/candidate/request-details.html?id=${requestId}`,
  });

  return { request, assignment, proposal };
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

  if (search) {
    const reg = new RegExp(search, 'i');
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

      return {
        id: m._id.toString(),
        reference: m.matchReference,
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

module.exports = {
  scoreVolunteer,
  findPotentialMatches,
  proposeMatch,
  acceptInvitation,
  declineInvitation,
  confirmMatch,
  declineMatch,
  listAllVolunteerInterests,
  listAllMatches,
};
