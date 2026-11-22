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
  getVerificationMetrics,
  listVerifications,
  getVerification,
  decideVerification,
} = require('../services/adminPeopleService');
const {
  listRequests,
  getRequest,
  updateRequestStatus,
  updateRequestVenue,
  confirmRequestVenue,
} = require('../services/adminRequestService');
const { getDashboardMetrics, getReports } = require('../services/adminReportService');
const {
  listAuditLogs,
  exportAuditLogsCsv,
  listFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
} = require('../services/adminMiscService');
const {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
} = require('../services/notificationService');
const {
  findPotentialMatches,
  proposeMatch,
  listAllVolunteerInterests,
  listAllMatches,
} = require('../services/matchingService');
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
    const { action, entityType, search } = req.query;
    const { items, total } = await listAuditLogs({ page, pageSize, action, entityType, search });
    ok(res, items, pageMeta(page, pageSize, total));
  })
);

adminRouter.get(
  '/audit/export',
  asyncHandler(async (req, res) => {
    const { action, entityType, search } = req.query;
    const csvData = await exportAuditLogsCsv({ action, entityType, search, limit: 500 });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="admin_audit_logs.csv"');
    res.send(csvData);
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
  '/verifications/metrics',
  asyncHandler(async (req, res) => {
    ok(res, await getVerificationMetrics());
  })
);

adminRouter.get(
  '/verifications',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const { status, role, kind, search } = req.query;
    const { items, total } = await listVerifications({ page, pageSize, status, role, kind, search });
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

adminRouter.patch(
  '/requests/:id/venue',
  asyncHandler(async (req, res) => {
    ok(res, await updateRequestVenue(req.params.id, req.body, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

adminRouter.post(
  '/requests/:id/confirm-venue',
  asyncHandler(async (req, res) => {
    ok(res, await confirmRequestVenue(req.params.id, { adminId: req.auth.admin._id, ip: req.ip }));
  })
);

adminRouter.get(
  '/requests/:id/matches',
  asyncHandler(async (req, res) => {
    ok(res, await findPotentialMatches(req.params.id));
  })
);

adminRouter.post(
  '/requests/:id/propose-match',
  asyncHandler(async (req, res) => {
    const { volunteerId, note, isOverride, overrideJustification } = req.body;
    created(res, await proposeMatch(req.params.id, volunteerId, note, { adminId: req.auth.admin._id, ip: req.ip, isOverride, overrideJustification }));
  })
);

adminRouter.get(
  '/matches',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const { status } = req.query;
    const { items, total } = await listAllMatches({ page, pageSize, status });
    ok(res, items, pageMeta(page, pageSize, total));
  })
);

adminRouter.get(
  '/volunteer-interests',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const { examinationId, search } = req.query;
    const { items, total } = await listAllVolunteerInterests({ page, pageSize, examinationId, search });
    ok(res, items, pageMeta(page, pageSize, total));
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

// Admin Notifications & Alerts
adminRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const unreadOnly = req.query.unread === 'true';

    const { items, total, unread } = await listNotifications(req.auth.admin._id, {
      page,
      pageSize,
      unreadOnly,
    });
    ok(res, { items, unread }, pageMeta(page, pageSize, total));
  })
);

adminRouter.get(
  '/notifications/unread-count',
  asyncHandler(async (req, res) => {
    ok(res, { unread: await unreadCount(req.auth.admin._id) });
  })
);

adminRouter.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    ok(res, { updated: await markAllRead(req.auth.admin._id) });
  })
);

adminRouter.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    await markRead(req.auth.admin._id, req.params.id);
    ok(res, { read: true });
  })
);

module.exports = { adminRouter };
