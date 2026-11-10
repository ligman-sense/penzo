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

interestsRouter.get(
  '/invitations',
  asyncHandler(async (req, res) => {
    const MatchProposal = require('../models/MatchProposal');
    const items = await MatchProposal.find({
      volunteerId: req.auth.user._id,
      status: 'PROPOSED',
    })
      .populate({
        path: 'requestId',
        populate: [
          { path: 'examinationId', select: 'name title authority startsOn endsOn locations' },
          { path: 'candidateId', select: 'mobileE164' },
        ],
      })
      .sort({ createdAt: -1 });

    const mapped = items.map((p) => {
      const r = p.requestId;
      const e = r?.examinationId;
      return {
        id: p._id.toString(),
        matchReference: p.matchReference,
        status: p.status,
        score: p.score,
        adminNote: p.adminNote,
        invitedAt: p.invitedAt,
        request: r ? {
          id: r._id.toString(),
          reference: r.reference,
          language: r.language,
          city: r.city,
          requirements: r.requirements,
        } : null,
        examination: e ? {
          id: e._id.toString(),
          name: e.name || e.title,
          authority: e.authority,
          startsOn: e.startsOn,
          locations: e.locations,
        } : null,
      };
    });

    ok(res, mapped);
  })
);

interestsRouter.post(
  '/invitations/:id/accept',
  asyncHandler(async (req, res) => {
    const { acceptInvitation } = require('../services/matchingService');
    ok(res, await acceptInvitation(req.params.id, req.auth.user._id));
  })
);

interestsRouter.post(
  '/invitations/:id/decline',
  asyncHandler(async (req, res) => {
    const { declineInvitation } = require('../services/matchingService');
    const { reason } = req.body || {};
    ok(res, await declineInvitation(req.params.id, req.auth.user._id, reason));
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
