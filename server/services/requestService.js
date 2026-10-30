'use strict';

const ScribeRequest = require('../models/ScribeRequest');
const RequestStatusHistory = require('../models/RequestStatusHistory');
const Examination = require('../models/Examination');
const User = require('../models/User');
const { HttpError } = require('../utils/httpError');
const { canEdit, canCancel, assertTransition, REQUEST_STATUS_LABEL } = require('./requestStateMachine');
const { notify } = require('./notificationService');

async function generateReference() {
  const year = new Date().getFullYear();
  const count = await ScribeRequest.countDocuments();
  const seq = String(count + 1).padStart(5, '0');
  return `REQ-${year}-${seq}`;
}

async function listRequests(candidateId, scope = 'all') {
  const filter = { candidateId };

  if (scope === 'active') {
    filter.status = { $nin: ['COMPLETED', 'CANCELLED', 'REJECTED'] };
  } else if (scope === 'past') {
    filter.status = { $in: ['COMPLETED', 'CANCELLED', 'REJECTED'] };
  }

  const items = await ScribeRequest.find(filter)
    .populate('examinationId', 'name title slug authority locations sessions startsOn endsOn')
    .sort({ createdAt: -1 });

  return items.map((r) => {
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
      requirements: r.requirements,
      createdAt: r.createdAt,
      submittedAt: r.submittedAt,
      cancelReason: r.cancelReason,
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
    };
  });
}

async function createRequest(candidateId, data) {
  const user = await User.findById(candidateId);
  if (!user || !user.profileComplete) {
    throw HttpError.profileIncomplete('Please complete your candidate profile before submitting a request.');
  }

  const exam = await Examination.findById(data.examinationId);
  if (!exam) throw HttpError.notFound('Examination not found.');

  // Prevent duplicate active request for this candidate and examination
  const existing = await ScribeRequest.findOne({
    candidateId,
    examinationId: data.examinationId,
    status: { $nin: ['CANCELLED', 'REJECTED'] },
  });
  if (existing) {
    throw HttpError.conflict('You already have an active request for this examination.');
  }

  const reference = await generateReference();
  const request = await ScribeRequest.create({
    candidateId,
    examinationId: data.examinationId,
    sessionId: data.sessionId || null,
    reference,
    status: 'SUBMITTED',
    language: data.language,
    city: data.city,
    requirements: data.requirements || null,
    submittedAt: new Date(),
  });

  await RequestStatusHistory.create({
    requestId: request._id,
    fromStatus: null,
    toStatus: 'SUBMITTED',
    actorType: 'CANDIDATE',
    actorUserId: candidateId,
    reason: 'Initial request submission',
  });

  await notify({
    userId: candidateId,
    type: 'REQUEST_SUBMITTED',
    title: 'Scribe Request Submitted',
    body: `Your request ${reference} for ${exam.name || exam.title} has been submitted.`,
    linkPath: `/candidate/request-details.html?id=${request._id}`,
  });

  return getRequest(candidateId, request._id.toString());
}

async function getRequest(candidateId, requestId) {
  const request = await ScribeRequest.findOne({ _id: requestId, candidateId })
    .populate('examinationId')
    .populate('candidateId', 'mobileE164 email status');

  if (!request) throw HttpError.notFound('Request not found.');

  const history = await RequestStatusHistory.find({ requestId })
    .sort({ createdAt: 1 })
    .populate('actorAdminId', 'name');

  const exam = request.examinationId;
  let session = null;
  if (exam && exam.sessions && request.sessionId) {
    session = exam.sessions.id(request.sessionId) || exam.sessions.find(s => s._id.toString() === request.sessionId.toString());
  }

  return {
    id: request._id.toString(),
    reference: request.reference,
    status: request.status,
    statusLabel: REQUEST_STATUS_LABEL[request.status] || request.status,
    language: request.language,
    city: request.city,
    requirements: request.requirements,
    cancelReason: request.cancelReason,
    createdAt: request.createdAt,
    submittedAt: request.submittedAt,
    examination: exam ? {
      id: exam._id.toString(),
      name: exam.name || exam.title,
      authority: exam.authority,
      slug: exam.slug,
      scribeEligibilityInfo: exam.scribeEligibilityInfo,
      scribeRequestInstructions: exam.scribeRequestInstructions,
      requiredDocuments: exam.requiredDocuments,
    } : null,
    session: session ? {
      id: session._id.toString(),
      label: session.label || session.name,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
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
  };
}

async function updateRequest(candidateId, requestId, data) {
  const request = await ScribeRequest.findOne({ _id: requestId, candidateId });
  if (!request) throw HttpError.notFound('Request not found.');

  if (!canEdit(request.status)) {
    throw HttpError.badRequest('This request cannot be modified in its current status.');
  }

  if (data.language !== undefined) request.language = data.language;
  if (data.city !== undefined) request.city = data.city;
  if (data.requirements !== undefined) request.requirements = data.requirements;
  if (data.sessionId !== undefined) request.sessionId = data.sessionId;

  await request.save();
  return getRequest(candidateId, requestId);
}

async function cancelRequest(candidateId, requestId, reason) {
  const request = await ScribeRequest.findOne({ _id: requestId, candidateId });
  if (!request) throw HttpError.notFound('Request not found.');

  if (!canCancel(request.status)) {
    throw HttpError.badRequest('This request cannot be cancelled in its current status.');
  }

  assertTransition(request.status, 'CANCELLED');
  const prevStatus = request.status;
  request.status = 'CANCELLED';
  request.cancelReason = reason || null;
  await request.save();

  await RequestStatusHistory.create({
    requestId: request._id,
    fromStatus: prevStatus,
    toStatus: 'CANCELLED',
    actorType: 'CANDIDATE',
    actorUserId: candidateId,
    reason: reason || 'Cancelled by candidate',
  });

  return getRequest(candidateId, requestId);
}

module.exports = {
  listRequests,
  createRequest,
  getRequest,
  updateRequest,
  cancelRequest,
};
