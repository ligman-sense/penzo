'use strict';

const ScribeRequest = require('../models/ScribeRequest');
const RequestStatusHistory = require('../models/RequestStatusHistory');
const CandidateProfile = require('../models/CandidateProfile');
const MatchProposal = require('../models/MatchProposal');
const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const { writeAudit } = require('./auditService');
const { notify } = require('./notificationService');
const { assertTransition, REQUEST_STATUS_LABEL } = require('./requestStateMachine');
const { HttpError } = require('../utils/httpError');
const { escapeRegex } = require('../utils/regex');

async function listRequests({ page = 1, pageSize = 20, status, search, examinationId } = {}) {
  const query = {};
  if (status) query.status = status;
  if (examinationId) query.examinationId = examinationId;
  if (search && typeof search === 'string' && search.trim()) {
    query.reference = new RegExp(escapeRegex(search.trim()), 'i');
  }

  const [items, total] = await Promise.all([
    ScribeRequest.find(query)
      .populate('examinationId', 'name title')
      .populate('candidateId', 'mobileE164')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    ScribeRequest.countDocuments(query),
  ]);

  const mapped = await Promise.all(
    items.map(async (r) => {
      let candidateName = null;
      if (r.candidateId) {
        const cp = await CandidateProfile.findOne({ userId: r.candidateId._id }).select('fullName');
        candidateName = cp?.fullName;
      }
      return {
        id: r._id.toString(),
        reference: r.reference,
        status: r.status,
        statusLabel: REQUEST_STATUS_LABEL[r.status] || r.status,
        language: r.language,
        city: r.city,
        createdAt: r.createdAt,
        examination: r.examinationId ? {
          id: r.examinationId._id.toString(),
          name: r.examinationId.name || r.examinationId.title,
        } : null,
        candidate: {
          id: r.candidateId ? r.candidateId._id.toString() : null,
          name: candidateName || '(Unknown)',
        },
      };
    })
  );

  return { items: mapped, total };
}

async function getRequest(id) {
  const r = await ScribeRequest.findById(id)
    .populate('examinationId')
    .populate('candidateId');

  if (!r) throw HttpError.notFound('Request not found.');

  const [history, proposals, assignments, candidateProfile] = await Promise.all([
    RequestStatusHistory.find({ requestId: id })
      .sort({ createdAt: 1 })
      .populate('actorAdminId', 'name'),
    MatchProposal.find({ requestId: id })
      .populate({
        path: 'volunteerId',
        select: 'mobileE164 email',
      })
      .sort({ createdAt: -1 }),
    ConfirmedAssignment.find({ requestId: id })
      .populate('volunteerId', 'mobileE164')
      .sort({ startsAt: 1 }),
    CandidateProfile.findOne({ userId: r.candidateId?._id }),
  ]);

  const exam = r.examinationId;
  let session = null;
  if (exam && exam.sessions && r.sessionId) {
    session = exam.sessions.id(r.sessionId) || exam.sessions.find(s => s._id.toString() === r.sessionId.toString());
  }

  return {
    id: r._id.toString(),
    reference: r.reference,
    status: r.status,
    statusLabel: REQUEST_STATUS_LABEL[r.status] || r.status,
    language: r.language,
    city: r.city,
    venue: r.venue || null,
    requirements: r.requirements,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt,
    submittedAt: r.submittedAt,
    examination: exam ? {
      id: exam._id.toString(),
      name: exam.name || exam.title,
      authority: exam.authority,
      slug: exam.slug,
    } : null,
    session: session ? {
      id: session._id.toString(),
      label: session.label || session.name,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
    } : null,
    candidate: r.candidateId ? {
      id: r.candidateId._id.toString(),
      name: candidateProfile?.fullName || 'Candidate',
      mobile: r.candidateId.mobileE164,
      email: r.candidateId.email,
      languages: candidateProfile?.languages || [],
      city: candidateProfile?.city || null,
      qualification: candidateProfile?.qualification || candidateProfile?.education || null,
      currentlyPursuing: candidateProfile?.currentlyPursuing || null,
      education: candidateProfile?.qualification || candidateProfile?.education || null,
      assistanceNeeds: candidateProfile?.assistanceNeeds || null,
    } : null,
    history: history.map((h) => ({
      id: h._id.toString(),
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      fromLabel: h.fromStatus ? REQUEST_STATUS_LABEL[h.fromStatus] : null,
      toLabel: REQUEST_STATUS_LABEL[h.toStatus],
      actor: h.actorType === 'ADMIN' ? (h.actorAdminId?.name || 'Administrator') : h.actorType,
      reason: h.reason,
      createdAt: h.createdAt,
    })),
    proposals: proposals.map((p) => ({
      id: p._id.toString(),
      status: p.status,
      score: p.score,
      scoreBreakdown: p.scoreBreakdown,
      compatibility: p.compatibility,
      hasBlockingFailure: p.hasBlockingFailure,
      volunteerId: p.volunteerId?._id.toString(),
    })),
    assignments: assignments.map((a) => ({
      id: a._id.toString(),
      status: a.status,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      volunteerId: a.volunteerId?._id.toString(),
    })),
  };
}

async function updateRequestStatus(id, toStatus, reason, { adminId, ip } = {}) {
  const request = await ScribeRequest.findById(id);
  if (!request) throw HttpError.notFound('Request not found.');

  assertTransition(request.status, toStatus);
  const prevStatus = request.status;
  request.status = toStatus;
  if (toStatus === 'CANCELLED') request.cancelReason = reason || null;
  await request.save();

  await RequestStatusHistory.create({
    requestId: id,
    fromStatus: prevStatus,
    toStatus,
    actorType: 'ADMIN',
    actorAdminId: adminId,
    reason: reason || null,
  });

  await notify({
    userId: request.candidateId,
    type: 'EXAMINATION_UPDATE',
    title: `Request Status Updated: ${REQUEST_STATUS_LABEL[toStatus] || toStatus}`,
    body: reason ? `Your request has been moved to ${toStatus}. Reason: ${reason}` : `Your request is now ${toStatus}.`,
    linkPath: `/candidate/request-details.html?id=${id}`,
  });

  await writeAudit({
    adminId,
    action: 'request.status_change',
    entityType: 'ScribeRequest',
    entityId: id,
    details: { from: prevStatus, to: toStatus, reason },
    ip,
  });

  return getRequest(id);
}

async function updateRequestVenue(id, venueData, { adminId, ip } = {}) {
  const request = await ScribeRequest.findById(id).populate('examinationId');
  if (!request) throw HttpError.notFound('Request not found.');

  const prevVenue = request.venue ? JSON.parse(JSON.stringify(request.venue)) : {};
  const currentVenue = request.venue || {};

  request.venue = {
    centreName: venueData.centreName !== undefined ? venueData.centreName : currentVenue.centreName,
    address: venueData.address !== undefined ? venueData.address : currentVenue.address,
    area: venueData.area !== undefined ? venueData.area : currentVenue.area,
    city: venueData.city !== undefined ? venueData.city : (currentVenue.city || request.city),
    state: venueData.state !== undefined ? venueData.state : currentVenue.state,
    pincode: venueData.pincode !== undefined ? venueData.pincode : currentVenue.pincode,
    landmark: venueData.landmark !== undefined ? venueData.landmark : currentVenue.landmark,
    mapLink: venueData.mapLink !== undefined ? venueData.mapLink : currentVenue.mapLink,
    confirmed: venueData.confirmed !== undefined ? Boolean(venueData.confirmed) : currentVenue.confirmed,
    confirmedAt: venueData.confirmed ? (currentVenue.confirmedAt || new Date()) : currentVenue.confirmedAt,
    confirmedBy: venueData.confirmed ? (currentVenue.confirmedBy || adminId) : currentVenue.confirmedBy,
  };

  if (venueData.city) {
    request.city = venueData.city;
  }

  await request.save();

  const isChanged = prevVenue.centreName !== request.venue.centreName || prevVenue.address !== request.venue.address;
  await RequestStatusHistory.create({
    requestId: id,
    fromStatus: request.status,
    toStatus: request.status,
    actorType: 'ADMIN',
    actorAdminId: adminId,
    reason: `Examination venue ${request.venue.confirmed ? 'confirmed' : 'updated'}: ${request.venue.centreName || 'Centre'} (${request.venue.city || ''})`,
  });

  // If match was already proposed or confirmed, notify candidate and volunteer
  if (isChanged && ['MATCH_PROPOSED', 'VOLUNTEER_ACCEPTED', 'CONFIRMED'].includes(request.status)) {
    const examName = request.examinationId?.name || 'Examination';
    await notify({
      userId: request.candidateId,
      type: 'VENUE_UPDATED',
      title: 'Examination Venue Updated',
      body: `The examination venue for ${examName} has been updated to: ${request.venue.centreName}, ${request.venue.city}.`,
      linkPath: `/candidate/request-details.html?id=${id}`,
    });

    const activeProposal = await MatchProposal.findOne({
      requestId: id,
      status: { $in: ['PROPOSED', 'INVITED', 'ACCEPTED', 'CANDIDATE_CONFIRMED'] },
    });
    if (activeProposal && activeProposal.volunteerId) {
      await notify({
        userId: activeProposal.volunteerId,
        type: 'VENUE_UPDATED',
        title: 'Examination Venue Updated',
        body: `Important: The examination venue for ${examName} has been updated to: ${request.venue.centreName}, ${request.venue.city}. Please review your commitment.`,
        linkPath: '/volunteer/commitments.html',
      });
    }
  }

  await writeAudit({
    adminId,
    action: 'request.venue_update',
    entityType: 'ScribeRequest',
    entityId: id,
    details: { venue: request.venue },
    ip,
  });

  return getRequest(id);
}

async function confirmRequestVenue(id, { adminId, ip } = {}) {
  const request = await ScribeRequest.findById(id);
  if (!request) throw HttpError.notFound('Request not found.');
  if (!request.venue || !request.venue.centreName) {
    throw HttpError.badRequest('Cannot confirm empty venue details. Please enter the examination centre name and address.');
  }

  return updateRequestVenue(id, { confirmed: true }, { adminId, ip });
}

module.exports = {
  listRequests,
  getRequest,
  updateRequestStatus,
  updateRequestVenue,
  confirmRequestVenue,
};
