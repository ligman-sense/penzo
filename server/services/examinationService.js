'use strict';

const Examination = require('../models/Examination');
const { HttpError } = require('../utils/httpError');

async function listPublicExaminations({ search, authority, region, page = 1, pageSize = 12 } = {}) {
  const query = { status: 'PUBLISHED' };

  if (search) {
    const regex = new RegExp(search, 'i');
    query.$or = [{ name: regex }, { title: regex }, { authority: regex }, { description: regex }];
  }
  if (authority) {
    query.authority = new RegExp(authority, 'i');
  }
  if (region) {
    query['locations.city'] = new RegExp(region, 'i');
  }

  const [items, total] = await Promise.all([
    Examination.find(query)
      .sort({ isFeatured: -1, startsOn: 1, name: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    Examination.countDocuments(query),
  ]);

  return {
    items: items.map((e) => ({
      id: e._id.toString(),
      slug: e.slug,
      name: e.name || e.title,
      authority: e.authority,
      description: e.description,
      officialUrl: e.officialUrl || e.officialWebsite,
      notificationUrl: e.notificationUrl,
      registrationOpensAt: e.registrationOpensAt,
      registrationDeadline: e.registrationDeadline,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      isFeatured: e.isFeatured,
      isSampleData: e.isSampleData,
      lastVerifiedAt: e.lastVerifiedAt,
      locations: (e.locations || []).map((l) => ({ city: l.city, state: l.state, region: l.region })),
    })),
    total,
  };
}

async function getPublicFilterOptions() {
  const authorities = await Examination.distinct('authority', { status: 'PUBLISHED' });
  const cities = await Examination.distinct('locations.city', { status: 'PUBLISHED' });
  return {
    authorities: authorities.filter(Boolean).sort(),
    regions: cities.filter(Boolean).sort(),
  };
}

async function getPublicExamination(slug) {
  const exam = await Examination.findOne({ slug, status: 'PUBLISHED' });
  if (!exam) throw HttpError.notFound('Examination not found.');

  return {
    id: exam._id.toString(),
    slug: exam.slug,
    name: exam.name || exam.title,
    authority: exam.authority,
    description: exam.description,
    officialUrl: exam.officialUrl || exam.officialWebsite,
    notificationUrl: exam.notificationUrl,
    registrationOpensAt: exam.registrationOpensAt,
    registrationDeadline: exam.registrationDeadline,
    startsOn: exam.startsOn,
    endsOn: exam.endsOn,
    isFeatured: exam.isFeatured,
    isSampleData: exam.isSampleData,
    lastVerifiedAt: exam.lastVerifiedAt,
    scribeEligibilityInfo: exam.scribeEligibilityInfo,
    qualificationConditions: exam.qualificationConditions,
    requiredDocuments: exam.requiredDocuments,
    accommodationInfo: exam.accommodationInfo,
    scribeRequestInstructions: exam.scribeRequestInstructions,
    locations: exam.locations,
    sessions: exam.sessions,
    rules: exam.rules,
  };
}

async function getExaminationPreview(id) {
  const exam = await Examination.findById(id);
  if (!exam) throw HttpError.notFound('Examination not found.');
  return exam;
}

module.exports = {
  listPublicExaminations,
  getPublicFilterOptions,
  getPublicExamination,
  getExaminationPreview,
};
