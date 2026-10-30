'use strict';

const { Router } = require('express');
const { noStore, requireUser, requireRole } = require('../middleware/auth');
const { listRequests, createRequest, getRequest, updateRequest, cancelRequest } = require('../services/requestService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');

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

module.exports = { requestsRouter };
