const mongoose = require('mongoose');
const { Schema } = mongoose;

const adminUserSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('AdminUser', adminUserSchema);
