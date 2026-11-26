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

/**
 * Validate Origin or Referer against server host and configured allowlists.
 */
function isTrustedOrigin(headerValue, req) {
  if (!headerValue) return true;
  if (headerValue === 'null') return false; // Sandboxed frame or opaque origin

  try {
    const parsed = new URL(headerValue);
    const originHost = parsed.host.toLowerCase();
    const reqHost = (req.get('host') || '').toLowerCase();

    // 1. Same-origin match against current Host header
    if (reqHost && originHost === reqHost) {
      return true;
    }

    // 2. Explicitly configured allowed origins in environment
    const allowed = (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (allowed.includes(parsed.origin.toLowerCase()) || allowed.includes(originHost)) {
      return true;
    }

    // 3. In non-production, permit localhost and 127.0.0.1
    if (env.NODE_ENV !== 'production') {
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function originGuard(req, res, next) {
  const method = req.method.toUpperCase();
  // Safe HTTP methods do not mutate server state
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');

  // Reject untrusted Origin header
  if (origin && !isTrustedOrigin(origin, req)) {
    return next(new HttpError(403, 'FORBIDDEN_ORIGIN', 'Cross-origin request rejected: untrusted Origin.'));
  }

  // Reject untrusted Referer header when Origin is absent
  if (!origin && referer && !isTrustedOrigin(referer, req)) {
    return next(new HttpError(403, 'FORBIDDEN_ORIGIN', 'Cross-origin request rejected: untrusted Referer.'));
  }

  // In production, block cross-site fetch if sec-fetch-site indicates cross-site
  if (env.NODE_ENV === 'production' && !origin && !referer) {
    const secFetchSite = req.get('sec-fetch-site');
    if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
      return next(new HttpError(403, 'FORBIDDEN_ORIGIN', 'Cross-site request rejected.'));
    }
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
  isTrustedOrigin,
  originGuard,
};
