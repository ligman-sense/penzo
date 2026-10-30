const mongoose = require('mongoose');
const { Schema } = mongoose;

const examinationSessionSchema = new Schema({
  label: { type: String },
  name: { type: String },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  reportingTime: { type: Date, default: null },
  durationMinutes: { type: Number, default: null },
  location: {
    city: { type: String },
    state: { type: String },
  },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const examinationLocationSchema = new Schema({
  city: { type: String, required: true },
  state: { type: String, default: null },
  region: { type: String, default: null },
  address: { type: String, default: null },
  pincode: { type: String, default: null },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const examinationRuleSchema = new Schema({
  category: { type: String, default: 'OTHER' },
  title: { type: String },
  rule: { type: String },
  body: { type: String },
  sourceUrl: { type: String, default: null },
  requiresAdminReview: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
}, { _id: true });

const examinationSchema = new Schema({
  name: { type: String, required: true },
  title: { type: String }, // alias support
  slug: { type: String, required: true, unique: true },
  authority: { type: String, default: null },
  conductingBody: { type: String, default: null }, // alias support
  description: { type: String, default: null },
  officialUrl: { type: String, default: null },
  officialWebsite: { type: String, default: null }, // alias
  notificationUrl: { type: String, default: null },
  registrationOpensAt: { type: Date, default: null },
  registrationDeadline: { type: Date, default: null },
  startsOn: { type: Date, default: null },
  endsOn: { type: Date, default: null },
  status: {
    type: String,
    enum: ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'],
    default: 'DRAFT',
  },
  publishedAt: { type: Date, default: null },
  isFeatured: { type: Boolean, default: false },
  isSampleData: { type: Boolean, default: false },
  informationSource: { type: String, default: null },
  sourceType: { type: String, default: 'OFFICIAL_PORTAL' },
  lastVerifiedAt: { type: Date, default: null },
  adminNotes: { type: String, default: null },
  scribeEligibilityInfo: { type: String, default: null },
  qualificationConditions: { type: String, default: null },
  requiredDocuments: { type: String, default: null },
  accommodationInfo: { type: String, default: null },
  scribeRequestInstructions: { type: String, default: null },
  languagesAllowed: { type: [String], default: [] },
  sessions: { type: [examinationSessionSchema], default: [] },
  locations: { type: [examinationLocationSchema], default: [] },
  rules: { type: [examinationRuleSchema], default: [] },
}, { timestamps: true });

// Pre-save to synchronize name <-> title, authority <-> conductingBody
examinationSchema.pre('save', function (next) {
  if (!this.name && this.title) this.name = this.title;
  if (!this.title && this.name) this.title = this.name;
  if (!this.authority && this.conductingBody) this.authority = this.conductingBody;
  if (!this.conductingBody && this.authority) this.conductingBody = this.authority;
  next();
});

examinationSchema.index({ status: 1 });
examinationSchema.index({ isFeatured: 1 });
examinationSchema.index({ startsOn: 1 });

module.exports = mongoose.model('Examination', examinationSchema);
