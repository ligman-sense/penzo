'use strict';

const AdminUser = require('../models/AdminUser');
const { verifyPassword, dummyHash } = require('../utils/password');
const { HttpError } = require('../utils/httpError');
const { writeAudit } = require('./auditService');
const { createAdminSession } = require('./sessionService');
const env = require('../config/env');

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

async function adminLogin(email, password, { ip, userAgent } = {}) {
  const now = new Date();
  const admin = await AdminUser.findOne({ email: email.toLowerCase().trim() });

  if (!admin || !admin.isActive) {
    await verifyPassword(password, await dummyHash());
    throw HttpError.invalidCredentials();
  }

  if (admin.lockedUntil && admin.lockedUntil > now) {
    await writeAudit({
      adminId: admin._id,
      action: 'admin.login.blocked_locked',
      entityType: 'AdminUser',
      entityId: admin._id,
      ip,
    });
    throw HttpError.tooMany('Too many sign-in attempts. Please try again later.');
  }

  const correct = await verifyPassword(password, admin.passwordHash);
  if (!correct) {
    const failures = (admin.failedLoginCount || 0) + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    admin.failedLoginCount = lock ? 0 : failures;
    admin.lockedUntil = lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null;
    await admin.save();

    await writeAudit({
      adminId: admin._id,
      action: lock ? 'admin.login.locked' : 'admin.login.failed',
      entityType: 'AdminUser',
      entityId: admin._id,
      ip,
    });
    throw HttpError.invalidCredentials();
  }

  admin.failedLoginCount = 0;
  admin.lockedUntil = null;
  admin.lastLoginAt = now;
  await admin.save();

  const { token, session } = await createAdminSession(admin._id, { ipAddress: ip, userAgent });

  await writeAudit({
    adminId: admin._id,
    action: 'admin.login.success',
    entityType: 'AdminUser',
    entityId: admin._id,
    ip,
  });

  return { admin, session, token };
}

module.exports = {
  adminLogin,
  MAX_FAILED_LOGINS,
  LOCK_MINUTES,
};
