'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const passwordResetChallengeSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  otpHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  expiresAt: { type: Date, required: true },
  resendAvailableAt: { type: Date, required: true },
  used: { type: Boolean, default: false },
  resetTokenHash: { type: String, default: null },
  resetTokenExpiresAt: { type: Date, default: null },
}, { timestamps: true });

passwordResetChallengeSchema.index({ email: 1, used: 1 });
passwordResetChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PasswordResetChallenge', passwordResetChallengeSchema);
