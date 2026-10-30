'use strict';

const { Router } = require('express');
const { noStore, requireUser, requireRole } = require('../middleware/auth');
const { getDashboard } = require('../services/dashboardService');
const { getHistory } = require('../services/historyService');
const { listAssignments } = require('../services/assignmentService');
const { listNotifications, unreadCount, markRead, markAllRead } = require('../services/notificationService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, pageMeta } = require('../utils/response');

const accountGuard = [noStore, requireUser, requireRole('CANDIDATE', 'VOLUNTEER')];

const dashboardRouter = Router();
dashboardRouter.use(...accountGuard);
dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { _id, role } = req.auth.user;
    ok(res, await getDashboard(_id, role));
  })
);

const historyRouter = Router();
historyRouter.use(...accountGuard);
historyRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { _id, role } = req.auth.user;
    ok(res, await getHistory(_id, role));
  })
);

const assignmentsRouter = Router();
assignmentsRouter.use(...accountGuard);
assignmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { _id, role } = req.auth.user;
    ok(res, await listAssignments(_id, role));
  })
);

const notificationsRouter = Router();
notificationsRouter.use(...accountGuard);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const unreadOnly = req.query.unread === 'true';

    const { items, total, unread } = await listNotifications(req.auth.user._id, {
      page,
      pageSize,
      unreadOnly,
    });

    ok(res, { items, unread }, pageMeta(page, pageSize, total));
  })
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    ok(res, { unread: await unreadCount(req.auth.user._id) });
  })
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    ok(res, { updated: await markAllRead(req.auth.user._id) });
  })
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await markRead(req.auth.user._id, req.params.id);
    ok(res, { read: true });
  })
);

module.exports = {
  dashboardRouter,
  historyRouter,
  assignmentsRouter,
  notificationsRouter,
};
