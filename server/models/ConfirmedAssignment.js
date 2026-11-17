const mongoose = require('mongoose');
const { Schema } = mongoose;

const confirmedAssignmentSchema = new Schema({
  requestId: { type: Schema.Types.ObjectId, ref: 'ScribeRequest', required: true },
  matchProposalId: { type: Schema.Types.ObjectId, ref: 'MatchProposal', default: null },
  candidateId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  volunteerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ['CONFIRMED', 'CANCELLED', 'COMPLETED'],
    default: 'CONFIRMED',
  },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: Schema.Types.ObjectId, default: null },
  cancelReason: { type: String, default: null },
  replacedById: { type: Schema.Types.ObjectId, ref: 'ConfirmedAssignment', default: null },
  confirmedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  lockDeadline: { type: Date, default: null },
  isLocked: { type: Boolean, default: false },
  isEmergencyCancelled: { type: Boolean, default: false },
  cancellationReason: { type: String, default: null },
  cancellationExplanation: { type: String, default: null },
  termsAccepted: { type: Boolean, default: false },
  termsVersion: { type: String, default: null },
  termsAcceptedAt: { type: Date, default: null },
}, { timestamps: true });

confirmedAssignmentSchema.index({ candidateId: 1, status: 1 });
confirmedAssignmentSchema.index({ volunteerId: 1, status: 1 });
confirmedAssignmentSchema.index({ requestId: 1 });

module.exports = mongoose.model('ConfirmedAssignment', confirmedAssignmentSchema);
