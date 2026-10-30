const mongoose = require('mongoose');
const { Schema } = mongoose;

const examinationRuleSchema = new Schema({
  examinationId: { type: Schema.Types.ObjectId, ref: 'Examination', required: true },
  rule: { type: String, required: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

examinationRuleSchema.index({ examinationId: 1, sortOrder: 1 });

module.exports = mongoose.model('ExaminationRule', examinationRuleSchema);
