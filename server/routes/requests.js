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

requestsRouter.get(
  '/:id/proposed-match',
  asyncHandler(async (req, res) => {
    const MatchProposal = require('../models/MatchProposal');
    const VolunteerProfile = require('../models/VolunteerProfile');
    const proposal = await MatchProposal.findOne({
      requestId: req.params.id,
      status: { $in: ['ACCEPTED', 'PROPOSED', 'CANDIDATE_CONFIRMED'] },
    }).populate('volunteerId', 'mobileE164 email verificationStatus');

    if (!proposal) {
      return ok(res, null);
    }

    const vp = await VolunteerProfile.findOne({ userId: proposal.volunteerId._id });
    ok(res, {
      proposalId: proposal._id.toString(),
      matchReference: proposal.matchReference,
      status: proposal.status,
      score: proposal.score,
      adminNote: proposal.adminNote,
      volunteer: {
        id: proposal.volunteerId._id.toString(),
        name: vp?.fullName || (vp?.firstName ? `${vp.firstName} ${vp.lastName || ''}`.trim() : 'Volunteer'),
        city: vp?.city,
        languages: vp?.languages || vp?.preferredLanguages || [],
        subjects: vp?.subjects || [],
        hasExperience: Boolean(vp?.hasPriorExperience || vp?.hasScribeExperience),
        isVerified: proposal.volunteerId.verificationStatus === 'VERIFIED',
        verificationStatus: proposal.volunteerId.verificationStatus || 'UNVERIFIED',
      },
    });
  })
);

requestsRouter.post(
  '/:id/confirm-match',
  asyncHandler(async (req, res) => {
    const { confirmMatch } = require('../services/matchingService');
    ok(res, await confirmMatch(req.params.id, req.auth.user._id));
  })
);

requestsRouter.post(
  '/:id/decline-match',
  asyncHandler(async (req, res) => {
    const { declineMatch } = require('../services/matchingService');
    const { reason } = req.body || {};
    ok(res, await declineMatch(req.params.id, req.auth.user._id, reason));
  })
);

module.exports = { requestsRouter };
