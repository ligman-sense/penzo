const mongoose = require('mongoose');
const { Schema } = mongoose;

const scribeRequestSchema = new Schema({
  candidateId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  examinationId: { type: Schema.Types.ObjectId, ref: 'Examination', required: true },
  // The chosen session from the examination's embedded sessions array
  sessionId: { type: Schema.Types.ObjectId, default: null },
  reference: { type: String, unique: true, default: null },
  status: {
    type: String,
    enum: [
      'DRAFT',
      'SUBMITTED',
      'PENDING_REVIEW',
      'AWAITING_VOLUNTEER',
      'MATCH_PROPOSED',
      'VOLUNTEER_ACCEPTED',
      'AWAITING_CANDIDATE_CONFIRMATION',
      'CONFIRMED',
      'REJECTED',
      'CANCELLED',
      'REPLACEMENT_REQUIRED',
      'COMPLETED',
    ],
    default: 'DRAFT',
  },
  language: { type: String, default: null },
  city: { type: String, default: null },
  requirements: { type: String, default: null },
  cancelReason: { type: String, default: null },
  submittedAt: { type: Date, default: null },
}, { timestamps: true });

scribeRequestSchema.index({ candidateId: 1, status: 1 });
scribeRequestSchema.index({ examinationId: 1, status: 1 });

module.exports = mongoose.model('ScribeRequest', scribeRequestSchema);
