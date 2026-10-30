const mongoose = require('mongoose');
const { Schema } = mongoose;

const candidateProfileSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  fullName: { type: String, default: null },
  firstName: { type: String, default: null },
  lastName: { type: String, default: null },
  dateOfBirth: { type: Date, default: null },
  gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY', null], default: null },
  languages: { type: [String], default: [] },
  preferredLanguages: { type: [String], default: [] },
  education: { type: String, default: null },
  city: { type: String, default: null },
  preferredExamCity: { type: String, default: null },
  state: { type: String, default: null },
  pincode: { type: String, default: null },
  disabilityType: { type: String, default: null },
  disabilityDescription: { type: String, default: null },
  assistanceNeeds: { type: Schema.Types.Mixed, default: null },
  emergencyContactName: { type: String, default: null },
  emergencyContactPhone: { type: String, default: null },
  completionPercentage: { type: Number, default: 0 },
}, { timestamps: true });

candidateProfileSchema.pre('save', function (next) {
  if (!this.fullName && (this.firstName || this.lastName)) {
    this.fullName = [this.firstName, this.lastName].filter(Boolean).join(' ');
  }
  if (this.languages && this.languages.length && (!this.preferredLanguages || !this.preferredLanguages.length)) {
    this.preferredLanguages = this.languages;
  }
  if (this.preferredLanguages && this.preferredLanguages.length && (!this.languages || !this.languages.length)) {
    this.languages = this.preferredLanguages;
  }
  next();
});

module.exports = mongoose.model('CandidateProfile', candidateProfileSchema);
