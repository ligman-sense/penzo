'use strict';

const { Router } = require('express');
const { ADMIN_COOKIE, clearSessionCookie, setSessionCookie } = require('../utils/cookies');
const { noStore, requireAdmin, requireCsrf } = require('../middleware/auth');
const { adminLoginLimiter } = require('../middleware/rateLimits');
const { adminLogin } = require('../services/adminAuthService');
const { writeAudit } = require('../services/auditService');
const { revokeSession } = require('../services/sessionService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const { HttpError } = require('../utils/httpError');

const adminAuthRouter = Router();
adminAuthRouter.use(noStore);

adminAuthRouter.post(
  '/login',
  adminLoginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw HttpError.badRequest('Email and password are required.');
    }

    const previous = req.cookies?.[ADMIN_COOKIE];
    if (typeof previous === 'string') await revokeSession(previous);

    const { admin, session, token } = await adminLogin(email, password, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    setSessionCookie(res, ADMIN_COOKIE, token, session.expiresAt);
    ok(res, {
      admin: { id: admin._id.toString(), email: admin.email, name: admin.name },
      csrfToken: session.csrfToken,
    });
  })
);

adminAuthRouter.get('/session', requireAdmin, (req, res) => {
  ok(res, {
    authenticated: true,
    admin: {
      id: req.auth.admin._id.toString(),
      email: req.auth.admin.email,
      name: req.auth.admin.name,
    },
    csrfToken: req.auth.csrfToken,
  });
});

adminAuthRouter.post(
  '/logout',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[ADMIN_COOKIE];
    if (typeof token === 'string') await revokeSession(token);
    if (req.auth?.kind === 'admin') {
      await writeAudit({
        adminId: req.auth.admin._id,
        action: 'admin.logout',
        entityType: 'AdminUser',
        entityId: req.auth.admin._id,
        ip: req.ip,
      });
    }
    clearSessionCookie(res, ADMIN_COOKIE);
    ok(res, { loggedOut: true });
  })
);

module.exports = { adminAuthRouter };
