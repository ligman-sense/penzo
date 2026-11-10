const mongoose = require('mongoose');
const { Schema } = mongoose;

const matchProposalSchema = new Schema({
  requestId: { type: Schema.Types.ObjectId, ref: 'ScribeRequest', required: true },
  volunteerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  candidateId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  examinationId: { type: Schema.Types.ObjectId, ref: 'Examination', default: null },
  interestId: { type: Schema.Types.ObjectId, ref: 'VolunteerInterest', default: null },
  matchReference: { type: String, default: null },
  score: { type: Number, default: 0 },
  scoreBreakdown: {
    dateTime: { type: Number, default: 0 },
    location: { type: Number, default: 0 },
    language: { type: Number, default: 0 },
    qualification: { type: Number, default: 0 },
    experience: { type: Number, default: 0 },
  },
  compatibility: { type: Schema.Types.Mixed, default: null },
  hasBlockingFailure: { type: Boolean, default: false },
  blockingReason: { type: String, default: null },
  needsReview: { type: Boolean, default: false },
  adminNote: { type: String, default: null },
  declineReason: { type: String, default: null },
  candidateDeclineReason: { type: String, default: null },
  status: {
    type: String,
    enum: [
      'PROPOSED',
      'INVITED',
      'ACCEPTED',
      'DECLINED',
      'EXPIRED',
      'WITHDRAWN',
      'CANDIDATE_CONFIRMED',
      'CANDIDATE_REJECTED',
    ],
    default: 'PROPOSED',
  },
  reviewedById: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  invitedAt: { type: Date, default: null },
  respondedAt: { type: Date, default: null },
}, { timestamps: true });

matchProposalSchema.index({ requestId: 1, status: 1 });
matchProposalSchema.index({ volunteerId: 1, status: 1 });
matchProposalSchema.index({ examinationId: 1 });

module.exports = mongoose.model('MatchProposal', matchProposalSchema);
