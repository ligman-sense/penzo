'use strict';

const { Router } = require('express');
const { noStore, requireUser, requireRole } = require('../middleware/auth');
const { listRequests, createRequest, getRequest, updateRequest, cancelRequest } = require('../services/requestService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { HttpError } = require('../utils/httpError');

const requestsRouter = Router();
requestsRouter.use(noStore, requireUser, requireRole('CANDIDATE'));

requestsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.query.scope || 'all';
    ok(res, await listRequests(req.auth.user._id, scope));
  })
);

requestsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    created(res, await createRequest(req.auth.user._id, req.body));
  })
);

requestsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, await getRequest(req.auth.user._id, req.params.id));
  })
);

requestsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, await updateRequest(req.auth.user._id, req.params.id, req.body));
  })
);

requestsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const reason = req.body?.reason;
    ok(res, await cancelRequest(req.auth.user._id, req.params.id, reason));
  })
);

requestsRouter.get(
  '/:id/proposed-match',
  asyncHandler(async (req, res) => {
    const MatchProposal = require('../models/MatchProposal');
    const proposal = await MatchProposal.findOne({
      requestId: req.params.id,
      status: { $in: ['ACCEPTED', 'PROPOSED', 'CANDIDATE_CONFIRMED'] },
    });

    if (!proposal) {
      return ok(res, null);
    }

    // Privacy safeguard: Scribe allocation status only, NO volunteer PII
    ok(res, {
      proposalId: proposal._id.toString(),
      matchReference: proposal.matchReference,
      status: proposal.status,
      isAllocated: true,
      adminNote: proposal.adminNote || null,
    });
  })
);

// Candidate confirmation and rejection endpoints are disabled
requestsRouter.post(
  '/:id/confirm-match',
  asyncHandler(async () => {
    throw HttpError.badRequest('Candidate confirmation of scribe allocation is no longer required or supported.');
  })
);

requestsRouter.post(
  '/:id/decline-match',
  asyncHandler(async () => {
    throw HttpError.badRequest('Candidate rejection of scribe allocation is no longer required or supported.');
  })
);

requestsRouter.post(
  '/:id/accept-scribe',
  asyncHandler(async () => {
    throw HttpError.badRequest('Candidate confirmation of scribe allocation is no longer required or supported.');
  })
);

requestsRouter.post(
  '/:id/decline-scribe',
  asyncHandler(async () => {
    throw HttpError.badRequest('Candidate rejection of scribe allocation is no longer required or supported.');
  })
);

module.exports = { requestsRouter };
