// Re-export embedded subdocument schema if needed standalone
// ExaminationSession is embedded in Examination — this file exists for import compatibility
const mongoose = require('mongoose');
const { Schema } = mongoose;

const examinationSessionSchema = new Schema({
  examinationId: { type: Schema.Types.ObjectId, ref: 'Examination', required: true },
  name: { type: String, required: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  reportingTime: { type: Date, default: null },
  durationMinutes: { type: Number, default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

examinationSessionSchema.index({ examinationId: 1 });

module.exports = mongoose.model('ExaminationSession', examinationSessionSchema);
