const mongoose = require('mongoose');
const { Schema } = mongoose;

const documentMetadataSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, required: true },
  storageKey: { type: String, required: true },
  originalName: { type: String, default: null },
  mimeType: { type: String, default: null },
  sizeBytes: { type: Number, default: null },
  uploadedAt: { type: Date, default: Date.now },
}, { timestamps: true });

documentMetadataSchema.index({ userId: 1, kind: 1 });

module.exports = mongoose.model('DocumentMetadata', documentMetadataSchema);
