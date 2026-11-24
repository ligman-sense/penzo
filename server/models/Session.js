const mongoose = require('mongoose');
const { Schema } = mongoose;

const sessionSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  csrfToken: { type: String, required: true },
  // Either userId or adminId is set, not both
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  adminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  lastSeenAt: { type: Date, default: null },
  ipAddress: { type: String, default: null },
  userAgent: { type: String, default: null },
}, { timestamps: true });

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ adminId: 1 });

module.exports = mongoose.model('Session', sessionSchema);
