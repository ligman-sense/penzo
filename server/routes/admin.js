'use strict';

const { Router } = require('express');
const { noStore, requireAdmin } = require('../middleware/auth');
const {
  listExaminations,
  getExamination,
  createExamination,
  updateExamination,
  publishExamination,
  unpublishExamination,
  archiveExamination,
} = require('../services/adminExaminationService');
const {
  listUsers,
  getUser,
  setUserStatus,
  listVerifications,
  getVerification,
  decideVerification,
} = require('../services/adminPeopleService');
const {
  listRequests,
  getRequest,
  updateRequestStatus,
} = require('../services/adminRequestService');
const { getDashboardMetrics, getReports } = require('../services/adminReportService');
const {
  listAuditLogs,
  listFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
} = require('../services/adminMiscService');
const { findPotentialMatches } = require('../services/matchingService');
const { getExaminationPreview } = require('../services/examinationService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created, pageMeta } = require('../utils/response');

const adminRouter = Router();
adminRouter.use(noStore, requireAdmin);

// Dashboard
adminRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    ok(res, await getDashboardMetrics());
  })
);

// Reports
adminRouter.get(
  '/reports',
  asyncHandler(async (req, res) => {
    ok(res, await getReports());
  })
);

// Audit
adminRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '30', 10);
    const { items, total } = await listAuditLogs({ page, pageSize });
    ok(res, items, pageMeta(page, pageSize, total));
  })
);

// Examinations
adminRouter.get(
  '/examinations',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const { status, search } = req.query;
    const { items, total } = await listExaminations({ page, pageSize, status, search });
    ok(res, items, pageMeta(page, pageSize, total));
  })
);

adminRouter.post(
  '/examinations',
  asyncHandler(async (req, res) => {
    created(res, await createExamination(req.body, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

adminRouter.get(
  '/examinations/:id',
  asyncHandler(async (req, res) => {
    ok(res, await getExamination(req.params.id));
  })
);

adminRouter.put(
  '/examinations/:id',
  asyncHandler(async (req, res) => {
    ok(res, await updateExamination(req.params.id, req.body, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

adminRouter.post(
  '/examinations/:id/publish',
  asyncHandler(async (req, res) => {
    ok(res, await publishExamination(req.params.id, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

adminRouter.post(
  '/examinations/:id/unpublish',
  asyncHandler(async (req, res) => {
    ok(res, await unpublishExamination(req.params.id, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

adminRouter.post(
  '/examinations/:id/archive',
  asyncHandler(async (req, res) => {
    ok(res, await archiveExamination(req.params.id, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

adminRouter.get(
  '/examinations/:id/preview',
  asyncHandler(async (req, res) => {
    ok(res, await getExaminationPreview(req.params.id));
  })
);

// Users
adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const { role, status, search } = req.query;
    const { items, total } = await listUsers({ page, pageSize, role, status, search });
    ok(res, items, pageMeta(page, pageSize, total));
  })
);

adminRouter.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    ok(res, await getUser(req.params.id));
  })
);

adminRouter.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body;
    ok(res, await setUserStatus(req.params.id, status, reason, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

// Verifications
adminRouter.get(
  '/verifications',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const { status, kind } = req.query;
    const { items, total } = await listVerifications({ page, pageSize, status, kind });
    ok(res, items, pageMeta(page, pageSize, total));
  })
);

adminRouter.get(
  '/verifications/:id',
  asyncHandler(async (req, res) => {
    ok(res, await getVerification(req.params.id, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

adminRouter.post(
  '/verifications/:id/decide',
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body;
    ok(res, await decideVerification(req.params.id, status, reason, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

// Requests
adminRouter.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const { status, search, examinationId } = req.query;
    const { items, total } = await listRequests({ page, pageSize, status, search, examinationId });
    ok(res, items, pageMeta(page, pageSize, total));
  })
);

adminRouter.get(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    ok(res, await getRequest(req.params.id));
  })
);

adminRouter.patch(
  '/requests/:id/status',
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body;
    ok(res, await updateRequestStatus(req.params.id, status, reason, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

adminRouter.get(
  '/requests/:id/matches',
  asyncHandler(async (req, res) => {
    ok(res, await findPotentialMatches(req.params.id));
  })
);

// FAQs
adminRouter.get(
  '/faqs',
  asyncHandler(async (req, res) => {
    ok(res, await listFaqs(false));
  })
);

adminRouter.post(
  '/faqs',
  asyncHandler(async (req, res) => {
    created(res, await createFaq(req.body));
  })
);

adminRouter.put(
  '/faqs/:id',
  asyncHandler(async (req, res) => {
    ok(res, await updateFaq(req.params.id, req.body));
  })
);

adminRouter.delete(
  '/faqs/:id',
  asyncHandler(async (req, res) => {
    ok(res, await deleteFaq(req.params.id));
  })
);

module.exports = { adminRouter };
