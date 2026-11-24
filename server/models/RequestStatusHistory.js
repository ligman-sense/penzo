const mongoose = require('mongoose');
const { Schema } = mongoose;

const requestStatusHistorySchema = new Schema({
  requestId: { type: Schema.Types.ObjectId, ref: 'ScribeRequest', required: true },
  fromStatus: { type: String, default: null },
  toStatus: { type: String, required: true },
  actorType: {
    type: String,
    enum: ['CANDIDATE', 'VOLUNTEER', 'ADMIN', 'SYSTEM'],
    required: true,
  },
  actorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorAdminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  reason: { type: String, default: null },
}, { timestamps: true });

requestStatusHistorySchema.index({ requestId: 1, createdAt: 1 });

module.exports = mongoose.model('RequestStatusHistory', requestStatusHistorySchema);
