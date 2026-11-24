const Session = require('../models/Session');
const { randomToken, sha256Hex } = require('../utils/crypto');
const env = require('../config/env');

/**
 * Create a new user session. Returns { token, session }.
 */
async function createUserSession(userId, { ipAddress, userAgent } = {}) {
  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);

  const session = await Session.create({
    tokenHash,
    csrfToken,
    userId,
    expiresAt,
    lastSeenAt: new Date(),
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  });

  return { token, session };
}

/**
 * Create a new admin session. Returns { token, session }.
 */
async function createAdminSession(adminId, { ipAddress, userAgent } = {}) {
  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + env.ADMIN_SESSION_TTL_HOURS * 3_600_000);

  const session = await Session.create({
    tokenHash,
    csrfToken,
    adminId,
    expiresAt,
    lastSeenAt: new Date(),
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  });

  return { token, session };
}

/**
 * Look up and validate a user session by raw token.
 * Returns { session, user } or null.
 */
async function getUserSession(token) {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const session = await Session.findOne({ tokenHash })
    .populate({ path: 'userId', select: '-__v' });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt < new Date()) return null;
  if (!session.userId) return null;
  const user = session.userId;
  if (user.status !== 'ACTIVE') return null;

  // Refresh lastSeenAt (fire-and-forget)
  Session.updateOne({ _id: session._id }, { lastSeenAt: new Date() }).catch(() => {});

  return { session, user };
}

/**
 * Look up and validate an admin session by raw token.
 * Returns { session, admin } or null.
 */
async function getAdminSession(token) {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const session = await Session.findOne({ tokenHash })
    .populate({ path: 'adminId', select: '-__v' });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt < new Date()) return null;
  if (!session.adminId) return null;
  const admin = session.adminId;
  if (!admin.isActive) return null;

  Session.updateOne({ _id: session._id }, { lastSeenAt: new Date() }).catch(() => {});

  return { session, admin };
}

/**
 * Revoke a session by its tokenHash (from raw token).
 */
async function revokeSession(token) {
  const tokenHash = sha256Hex(token);
  await Session.updateOne({ tokenHash }, { revokedAt: new Date() });
}

/**
 * Revoke all sessions for a given userId.
 */
async function revokeAllUserSessions(userId) {
  await Session.updateMany(
    { userId, revokedAt: null, expiresAt: { $gt: new Date() } },
    { revokedAt: new Date() }
  );
}

/**
 * Purge expired and revoked sessions older than 1 day.
 */
async function purgeExpired() {
  const cutoff = new Date(Date.now() - 86_400_000);
  const result = await Session.deleteMany({
    $or: [
      { expiresAt: { $lt: cutoff } },
      { revokedAt: { $lt: cutoff } },
    ],
  });
  if (result.deletedCount) {
    console.log(`[sessionService] Purged ${result.deletedCount} expired/revoked sessions`);
  }
}

module.exports = {
  createUserSession,
  createAdminSession,
  getUserSession,
  getAdminSession,
  revokeSession,
  revokeAllUserSessions,
  purgeExpired,
};
