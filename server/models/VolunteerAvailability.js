const mongoose = require('mongoose');
const { Schema } = mongoose;

const volunteerAvailabilitySchema = new Schema({
  volunteerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  status: { type: String, enum: ['OPEN', 'COMMITTED'], default: 'OPEN' },
}, { timestamps: true });

volunteerAvailabilitySchema.index({ volunteerId: 1, startsAt: 1 });
volunteerAvailabilitySchema.index({ status: 1, startsAt: 1 });

module.exports = mongoose.model('VolunteerAvailability', volunteerAvailabilitySchema);
