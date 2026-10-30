'use strict';

const { Router } = require('express');
const { noStore, requireUser, requireRole } = require('../middleware/auth');
const { getProfile, saveProfile } = require('../services/profileService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

const profileRouter = Router();
profileRouter.use(noStore, requireUser, requireRole('CANDIDATE', 'VOLUNTEER'));

profileRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, await getProfile(req.auth.user._id));
  })
);

profileRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const { _id, role } = req.auth.user;
    const result = await saveProfile(_id, { role, data: req.body });
    ok(res, result);
  })
);

module.exports = { profileRouter };
