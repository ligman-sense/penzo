'use strict';

const Notification = require('../models/Notification');

async function notify({ userId, adminAlert, type, title, body, linkPath, idempotencyKey, requestId }) {
  try {
    if (adminAlert) {
      const AdminUser = require('../models/AdminUser');
      const admins = await AdminUser.find({ isActive: true });
      const results = [];
      for (const admin of admins) {
        const adminKey = idempotencyKey ? `${idempotencyKey}_admin_${admin._id}` : null;
        if (adminKey) {
          const exists = await Notification.exists({ idempotencyKey: adminKey });
          if (exists) continue;
        }
        const notif = await Notification.create({
          userId: admin._id,
          adminAlert: true,
          type: type || 'ADMIN_ALERT',
          title,
          body: body || '',
          linkPath: linkPath || null,
          idempotencyKey: adminKey,
          requestId: requestId || null,
          readAt: null,
        });
        results.push(notif);
      }
      return results;
    }

    if (idempotencyKey) {
      const exists = await Notification.exists({ idempotencyKey });
      if (exists) return null;
    }

    return await Notification.create({
      userId,
      adminAlert: Boolean(adminAlert),
      type: type || 'GENERAL',
      title,
      body: body || '',
      linkPath: linkPath || null,
      idempotencyKey: idempotencyKey || null,
      requestId: requestId || null,
      readAt: null,
    });
  } catch (err) {
    console.error('Failed to create notification:', err.message);
    return null;
  }
}

async function listNotifications(userId, { page = 1, pageSize = 20, unreadOnly = false } = {}) {
  const query = { userId };
  if (unreadOnly) query.readAt = null;

  const [items, total, unread] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    Notification.countDocuments(query),
    Notification.countDocuments({ userId, readAt: null }),
  ]);

  return { items, total, unread };
}

async function unreadCount(userId) {
  return Notification.countDocuments({ userId, readAt: null });
}

async function markRead(userId, notificationId) {
  return Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { readAt: new Date() },
    { new: true }
  );
}

async function markAllRead(userId) {
  const res = await Notification.updateMany(
    { userId, readAt: null },
    { readAt: new Date() }
  );
  return res.modifiedCount;
}

module.exports = {
  notify,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
};
