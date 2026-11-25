'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const contactVerificationChallengeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contactType: { type: String, enum: ['MOBILE', 'EMAIL'], required: true },
    destination: { type: String, required: true },
    codeHash: { type: String, required: true },
    purpose: {
      type: String,
      enum: ['PROFILE_MOBILE_VERIFICATION', 'PROFILE_EMAIL_VERIFICATION'],
      required: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    sentAt: { type: Date, default: Date.now },
    provider: { type: String, default: 'mock' },
    ipAddress: { type: String, default: null },
  },
  { timestamps: true }
);

// TTL index to auto-clean expired verification challenges
contactVerificationChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Lookup index for user challenge verification
contactVerificationChallengeSchema.index({ userId: 1, contactType: 1, consumedAt: 1, createdAt: -1 });
contactVerificationChallengeSchema.index({ destination: 1, createdAt: -1 });

module.exports = mongoose.model('ContactVerificationChallenge', contactVerificationChallengeSchema);
