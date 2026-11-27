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
    const failures = (admin.failedLoginAttempts || 0) + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    admin.failedLoginAttempts = lock ? 0 : failures;
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

  admin.failedLoginAttempts = 0;
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

/**
 * Idempotently provision the Super-Administrator account if bootstrap credentials
 * are configured in environment variables and the user does not yet exist.
 * Preserves existing credentials without modification or duplicate creation.
 */
async function bootstrapAdminIfNeeded() {
  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || env.ADMIN_BOOTSTRAP_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || env.ADMIN_BOOTSTRAP_PASSWORD;
  const name = process.env.ADMIN_BOOTSTRAP_NAME || env.ADMIN_BOOTSTRAP_NAME || 'Super Administrator';

  if (!email || !password) {
    return;
  }

  const existing = await AdminUser.findOne({ email });
  if (existing) {
    console.log(`[BOOTSTRAP] Super-Admin verified (${email}).`);
    return;
  }

  const { hashPassword } = require('../utils/password');
  const passwordHash = await hashPassword(password);
  await AdminUser.create({
    email,
    name,
    passwordHash,
    isActive: true,
  });
  console.log(`[BOOTSTRAP] Super-Admin account initialized successfully for: ${email}`);
}

module.exports = {
  adminLogin,
  bootstrapAdminIfNeeded,
  MAX_FAILED_LOGINS,
  LOCK_MINUTES,
};
