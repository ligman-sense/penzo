const mongoose = require('mongoose');
const { Schema } = mongoose;

const volunteerInterestSchema = new Schema({
  volunteerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  examinationId: { type: Schema.Types.ObjectId, ref: 'Examination', required: true },
  status: { type: String, enum: ['ACTIVE', 'WITHDRAWN'], default: 'ACTIVE' },
  notes: { type: String, default: null },
  qualificationsConfirmed: { type: Boolean, default: false },
  languagesConfirmed: { type: Boolean, default: false },
  availabilityConfirmed: { type: Boolean, default: false },
  locationConfirmed: { type: Boolean, default: false },
}, { timestamps: true });

volunteerInterestSchema.index({ volunteerId: 1, examinationId: 1 }, { unique: true });
volunteerInterestSchema.index({ examinationId: 1, status: 1 });

module.exports = mongoose.model('VolunteerInterest', volunteerInterestSchema);
