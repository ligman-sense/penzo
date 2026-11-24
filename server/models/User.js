const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
  role: { type: String, enum: ['CANDIDATE', 'VOLUNTEER'], required: true },
  name: { type: String, default: null },
  mobileE164: { type: String, default: null },
  mobileVerifiedAt: { type: Date, default: null },
  email: { type: String, default: null },
  googleId: { type: String, default: null },
  authProvider: { type: String, enum: ['OTP', 'GOOGLE'], default: 'OTP' },
  avatarUrl: { type: String, default: null },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  profileComplete: { type: Boolean, default: false },
  verificationStatus: {
    type: String,
    enum: ['UNVERIFIED', 'PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'REQUIRES_CORRECTION'],
    default: 'UNVERIFIED',
  },
  termsAcceptedAt: { type: Date, default: null },
  privacyAcceptedAt: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
}, { timestamps: true });

userSchema.index({ role: 1, status: 1 });
userSchema.index(
  { mobileE164: 1 },
  { unique: true, partialFilterExpression: { mobileE164: { $type: 'string' } } }
);
userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
);
userSchema.index(
  { email: 1 },
  { partialFilterExpression: { email: { $type: 'string' } } }
);

module.exports = mongoose.model('User', userSchema);
