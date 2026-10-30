const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
  role: { type: String, enum: ['CANDIDATE', 'VOLUNTEER'], required: true },
  mobileE164: { type: String, required: true, unique: true },
  mobileVerifiedAt: { type: Date, default: null },
  email: { type: String, default: null },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  profileComplete: { type: Boolean, default: false },
  termsAcceptedAt: { type: Date, default: null },
  privacyAcceptedAt: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
}, { timestamps: true });

userSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model('User', userSchema);
