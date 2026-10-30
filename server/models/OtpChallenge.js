const mongoose = require('mongoose');
const { Schema } = mongoose;

const otpChallengeSchema = new Schema({
  mobileE164: { type: String, required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  maxAttempts: { type: Number, default: 5 },
  attempts: { type: Number, default: 0 },
  consumedAt: { type: Date, default: null },
  provider: { type: String, default: 'development' },
  ipAddress: { type: String, default: null },
  sentAt: { type: Date, default: Date.now },
}, { timestamps: true });

// TTL index: MongoDB will auto-remove expired documents
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpChallengeSchema.index({ mobileE164: 1, createdAt: -1 });

module.exports = mongoose.model('OtpChallenge', otpChallengeSchema);
