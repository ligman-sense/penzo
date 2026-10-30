const mongoose = require('mongoose');
const { Schema } = mongoose;

const adminAuditLogSchema = new Schema({
  adminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
  action: { type: String, required: true },
  entityType: { type: String, default: null },
  entityId: { type: String, default: null },
  details: { type: Schema.Types.Mixed, default: null },
  ipAddress: { type: String, default: null },
}, { timestamps: true });

adminAuditLogSchema.index({ adminId: 1, createdAt: -1 });
adminAuditLogSchema.index({ entityType: 1, entityId: 1 });
adminAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
