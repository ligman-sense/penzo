'use strict';

const { Router } = require('express');
const {
  listPublicExaminations,
  getPublicFilterOptions,
  getPublicExamination,
  getExaminationPreview,
} = require('../services/examinationService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, pageMeta } = require('../utils/response');

const publicExaminationsRouter = Router();

publicExaminationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '12', 10);
    const { search, authority, region } = req.query;

    const { items, total } = await listPublicExaminations({
      search,
      authority,
      region,
      page,
      pageSize,
    });

    ok(res, items, pageMeta(page, pageSize, total));
  })
);

publicExaminationsRouter.get(
  '/filter-options',
  asyncHandler(async (req, res) => {
    ok(res, await getPublicFilterOptions());
  })
);

publicExaminationsRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    ok(res, await getPublicExamination(req.params.slug));
  })
);

module.exports = { publicExaminationsRouter };
