const mongoose = require('mongoose');
const { Schema } = mongoose;

const examinationLocationSchema = new Schema({
  examinationId: { type: Schema.Types.ObjectId, ref: 'Examination', required: true },
  name: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  address: { type: String, default: null },
  pincode: { type: String, default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

examinationLocationSchema.index({ examinationId: 1 });

module.exports = mongoose.model('ExaminationLocation', examinationLocationSchema);
