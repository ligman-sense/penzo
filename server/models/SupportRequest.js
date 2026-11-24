const mongoose = require('mongoose');
const { Schema } = mongoose;

const supportRequestSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, default: null },
  email: { type: String, default: null },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'], default: 'OPEN' },
  resolvedAt: { type: Date, default: null },
  assignedToId: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
}, { timestamps: true });

supportRequestSchema.index({ status: 1, createdAt: -1 });
supportRequestSchema.index({ userId: 1 });

module.exports = mongoose.model('SupportRequest', supportRequestSchema);
