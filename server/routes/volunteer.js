'use strict';

const { Router } = require('express');
const { noStore, requireUser, requireRole } = require('../middleware/auth');
const { listInterests, setInterest, withdrawInterest } = require('../services/interestService');
const { listAvailability, addAvailability, removeAvailability } = require('../services/availabilityService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');

const volunteerGuard = [noStore, requireUser, requireRole('VOLUNTEER')];

const interestsRouter = Router();
interestsRouter.use(...volunteerGuard);

interestsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, await listInterests(req.auth.user._id));
  })
);

interestsRouter.put(
  '/:examinationId',
  asyncHandler(async (req, res) => {
    ok(res, await setInterest(req.auth.user._id, req.params.examinationId, req.body));
  })
);

interestsRouter.delete(
  '/:examinationId',
  asyncHandler(async (req, res) => {
    ok(res, await withdrawInterest(req.auth.user._id, req.params.examinationId));
  })
);

const availabilityRouter = Router();
availabilityRouter.use(...volunteerGuard);

availabilityRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, await listAvailability(req.auth.user._id));
  })
);

availabilityRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    created(res, await addAvailability(req.auth.user._id, req.body));
  })
);

availabilityRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, await removeAvailability(req.auth.user._id, req.params.id));
  })
);

module.exports = { interestsRouter, availabilityRouter };
