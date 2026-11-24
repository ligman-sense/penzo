'use strict';

const { Router } = require('express');
const { listFaqs } = require('../services/adminMiscService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

const publicFaqsRouter = Router();

publicFaqsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, await listFaqs(true));
  })
);

module.exports = { publicFaqsRouter };
