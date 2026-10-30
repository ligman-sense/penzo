const mongoose = require('mongoose');
const { Schema } = mongoose;

const volunteerProfileSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  fullName: { type: String, default: null },
  firstName: { type: String, default: null },
  lastName: { type: String, default: null },
  educationLevel: { type: String, default: null },
  highestEducation: { type: String, default: null },
  institution: { type: String, default: null },
  occupation: { type: String, default: null },
  languages: { type: [String], default: [] },
  subjects: { type: [String], default: [] },
  city: { type: String, default: null },
  state: { type: String, default: null },
  pincode: { type: String, default: null },
  serviceRadiusKm: { type: Number, default: 25 },
  serviceLocations: { type: [String], default: [] },
  hasPriorExperience: { type: Boolean, default: false },
  hasScribeExperience: { type: Boolean, default: false },
  previousScribeCount: { type: Number, default: 0 },
  bio: { type: String, default: null },
  completionPercentage: { type: Number, default: 0 },
}, { timestamps: true });

volunteerProfileSchema.pre('save', function (next) {
  if (!this.fullName && (this.firstName || this.lastName)) {
    this.fullName = [this.firstName, this.lastName].filter(Boolean).join(' ');
  }
  if (!this.educationLevel && this.highestEducation) {
    this.educationLevel = this.highestEducation;
  }
  if (!this.highestEducation && this.educationLevel) {
    this.highestEducation = this.educationLevel;
  }
  if (this.hasPriorExperience !== undefined && this.hasScribeExperience === undefined) {
    this.hasScribeExperience = this.hasPriorExperience;
  }
  next();
});

module.exports = mongoose.model('VolunteerProfile', volunteerProfileSchema);
