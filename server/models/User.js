const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
  role: { type: String, enum: ['CANDIDATE', 'VOLUNTEER'], required: true },
  name: { type: String, default: null },
  mobileE164: { type: String, default: null },
  isMobileVerified: { type: Boolean, default: false },
  mobileVerifiedAt: { type: Date, default: null },
  mobileVerificationSource: {
    type: String,
    enum: ['NONE', 'LOGIN_OTP', 'PROFILE_OTP'],
    default: 'NONE',
  },
  pendingMobileE164: { type: String, default: null },
  email: { type: String, default: null },
  isEmailVerified: { type: Boolean, default: false },
  emailVerifiedAt: { type: Date, default: null },
  emailVerificationSource: {
    type: String,
    enum: ['NONE', 'GOOGLE', 'EMAIL_OTP', 'EMAIL_TOKEN'],
    default: 'NONE',
  },
  pendingEmail: { type: String, default: null },
  googleId: { type: String, default: null },
  passwordHash: { type: String, default: null },
  primaryIdentifier: { type: String, enum: ['EMAIL', 'MOBILE'], default: null },
  authProvider: { type: String, enum: ['PASSWORD', 'GOOGLE', 'OTP'], default: 'PASSWORD' },
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
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);

module.exports = mongoose.model('User', userSchema);
