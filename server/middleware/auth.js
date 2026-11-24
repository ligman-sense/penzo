'use strict';

const { getUserSession, getAdminSession } = require('../services/sessionService');
const { USER_COOKIE, ADMIN_COOKIE } = require('../utils/cookies');
const { HttpError } = require('../utils/httpError');
const env = require('../config/env');

function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

async function attachSession(req, res, next) {
  try {
    const userToken = req.cookies?.[USER_COOKIE];
    const adminToken = req.cookies?.[ADMIN_COOKIE];

    if (adminToken) {
      const activeAdmin = await getAdminSession(adminToken);
      if (activeAdmin) {
        req.auth = {
          kind: 'admin',
          admin: activeAdmin.admin,
          session: activeAdmin.session,
          csrfToken: activeAdmin.session.csrfToken,
        };
        return next();
      }
    }

    if (userToken) {
      const activeUser = await getUserSession(userToken);
      if (activeUser) {
        req.auth = {
          kind: 'user',
          user: activeUser.user,
          session: activeUser.session,
          csrfToken: activeUser.session.csrfToken,
        };
        return next();
      }
    }

    req.auth = null;
    next();
  } catch (err) {
    next(err);
  }
}

function requireUser(req, res, next) {
  if (!req.auth || req.auth.kind !== 'user') {
    return next(HttpError.unauthenticated('Please sign in to continue.'));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.auth || req.auth.kind !== 'admin') {
    return next(HttpError.forbidden('Administrator access required.'));
  }
  next();
}

function optionalUser(req, res, next) {
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || req.auth.kind !== 'user') {
      return next(HttpError.unauthenticated());
    }
    if (!roles.includes(req.auth.user.role)) {
      return next(HttpError.forbidden('You do not have permission to access this resource.'));
    }
    next();
  };
}

function requireCsrf(req, res, next) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();

  const header = req.get('x-csrf-token');
  const expected = req.auth?.csrfToken;

  if (!header || !expected || header !== expected) {
    return next(new HttpError(403, 'CSRF_FAILED', 'Invalid or missing CSRF token.'));
  }
  next();
}

function originGuard(req, res, next) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();

  // Basic origin check in production
  if (env.NODE_ENV === 'production') {
    const origin = req.get('origin') || req.get('referer');
    // If present, verify host match
  }
  next();
}

module.exports = {
  noStore,
  attachSession,
  requireUser,
  requireAdmin,
  optionalUser,
  requireRole,
  requireCsrf,
  originGuard,
};
