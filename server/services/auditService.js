'use strict';

const AdminAuditLog = require('../models/AdminAuditLog');

async function writeAudit({ adminId, action, entityType, entityId, details, ip }) {
  try {
    if (!adminId) return;
    await AdminAuditLog.create({
      adminId,
      action,
      entityType: entityType || 'System',
      entityId: entityId ? entityId.toString() : null,
      details: details || null,
      ipAddress: ip || null,
    });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { writeAudit };
