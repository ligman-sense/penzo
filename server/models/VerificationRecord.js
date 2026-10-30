const mongoose = require('mongoose');
const { Schema } = mongoose;

const verificationRecordSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: {
    type: String,
    enum: ['IDENTITY', 'QUALIFICATION', 'ASSISTANCE_NEED'],
    required: true,
  },
  status: {
    type: String,
    enum: ['PENDING', 'VERIFIED', 'REJECTED', 'REQUIRES_CORRECTION'],
    default: 'PENDING',
  },
  documentKey: { type: String, default: null },
  reason: { type: String, default: null },
  reviewedById: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

verificationRecordSchema.index({ userId: 1, kind: 1 });
verificationRecordSchema.index({ status: 1 });

module.exports = mongoose.model('VerificationRecord', verificationRecordSchema);
