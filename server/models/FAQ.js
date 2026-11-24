const mongoose = require('mongoose');
const { Schema } = mongoose;

const faqSchema = new Schema({
  question: { type: String, required: true },
  answer: { type: String, required: true },
  category: { type: String, default: 'General' },
  sortOrder: { type: Number, default: 0 },
  isPublished: { type: Boolean, default: false },
}, { timestamps: true });

faqSchema.index({ isPublished: 1, sortOrder: 1 });
faqSchema.index({ category: 1 });

module.exports = mongoose.model('FAQ', faqSchema);
