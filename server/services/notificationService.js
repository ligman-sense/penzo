'use strict';

const Notification = require('../models/Notification');

async function notify({ userId, type, title, body, linkPath }) {
  try {
    return await Notification.create({
      userId,
      type: type || 'GENERAL',
      title,
      body: body || '',
      linkPath: linkPath || null,
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
