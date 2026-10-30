'use strict';

const Examination = require('../models/Examination');
const { HttpError } = require('../utils/httpError');
const { slugify, canMoveExam, publishBlockers } = require('./examinationRules');
const { writeAudit } = require('./auditService');

async function listExaminations({ page = 1, pageSize = 20, status, search } = {}) {
  const query = {};
  if (status) query.status = status;
  if (search) {
    const reg = new RegExp(search, 'i');
    query.$or = [{ name: reg }, { title: reg }, { authority: reg }];
  }

  const [items, total] = await Promise.all([
    Examination.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    Examination.countDocuments(query),
  ]);

  return {
    items: items.map((e) => ({
      id: e._id.toString(),
      name: e.name || e.title,
      slug: e.slug,
      authority: e.authority,
      status: e.status,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      isFeatured: e.isFeatured,
      sessionsCount: (e.sessions || []).length,
      createdAt: e.createdAt,
    })),
    total,
  };
}

async function getExamination(id) {
  const exam = await Examination.findById(id);
  if (!exam) throw HttpError.notFound('Examination not found.');
  return exam;
}

async function createExamination(input, { adminId, ip } = {}) {
  const name = input.name || input.title;
  if (!name) throw HttpError.badRequest('Examination name is required.');

  let slug = slugify(name);
  const existing = await Examination.findOne({ slug });
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  const exam = await Examination.create({
    name,
    title: name,
    slug,
    authority: input.authority || input.conductingBody || 'General Authority',
    description: input.description || null,
    officialUrl: input.officialUrl || null,
    notificationUrl: input.notificationUrl || null,
    registrationOpensAt: input.registrationOpensAt || null,
    registrationDeadline: input.registrationDeadline || null,
    startsOn: input.startsOn || null,
    endsOn: input.endsOn || null,
    status: input.status || 'DRAFT',
    isFeatured: Boolean(input.isFeatured),
    scribeEligibilityInfo: input.scribeEligibilityInfo || null,
    qualificationConditions: input.qualificationConditions || null,
    requiredDocuments: input.requiredDocuments || null,
    accommodationInfo: input.accommodationInfo || null,
    scribeRequestInstructions: input.scribeRequestInstructions || null,
    adminNotes: input.adminNotes || null,
    sessions: input.sessions || [],
    locations: input.locations || [],
    rules: input.rules || [],
    lastVerifiedAt: new Date(),
  });

  await writeAudit({
    adminId,
    action: 'examination.create',
    entityType: 'Examination',
    entityId: exam._id,
    details: { name: exam.name, slug: exam.slug },
    ip,
  });

  return exam;
}

async function updateExamination(id, input, { adminId, ip } = {}) {
  const exam = await Examination.findById(id);
  if (!exam) throw HttpError.notFound('Examination not found.');

  const fields = [
    'name', 'title', 'authority', 'description', 'officialUrl', 'notificationUrl',
    'registrationOpensAt', 'registrationDeadline', 'startsOn', 'endsOn', 'isFeatured',
    'scribeEligibilityInfo', 'qualificationConditions', 'requiredDocuments',
    'accommodationInfo', 'scribeRequestInstructions', 'adminNotes', 'sessions', 'locations', 'rules'
  ];

  for (const f of fields) {
    if (input[f] !== undefined) exam[f] = input[f];
  }
  if (input.name) exam.name = input.name;
  if (input.authority) exam.authority = input.authority;
  exam.lastVerifiedAt = new Date();

  await exam.save();

  await writeAudit({
    adminId,
    action: 'examination.update',
    entityType: 'Examination',
    entityId: exam._id,
    details: { name: exam.name },
    ip,
  });

  return exam;
}

async function publishExamination(id, { adminId, ip } = {}) {
  const exam = await Examination.findById(id);
  if (!exam) throw HttpError.notFound('Examination not found.');

  if (!canMoveExam(exam.status, 'PUBLISHED')) {
    throw HttpError.badRequest(`Cannot publish examination from ${exam.status} status.`);
  }

  const blockers = publishBlockers(exam);
  if (blockers.length > 0) {
    throw HttpError.badRequest(`Cannot publish: ${blockers.join(', ')}`);
  }

  exam.status = 'PUBLISHED';
  exam.publishedAt = new Date();
  await exam.save();

  await writeAudit({
    adminId,
    action: 'examination.publish',
    entityType: 'Examination',
    entityId: exam._id,
    ip,
  });

  return exam;
}

async function unpublishExamination(id, { adminId, ip } = {}) {
  const exam = await Examination.findById(id);
  if (!exam) throw HttpError.notFound('Examination not found.');

  exam.status = 'UNPUBLISHED';
  await exam.save();

  await writeAudit({
    adminId,
    action: 'examination.unpublish',
    entityType: 'Examination',
    entityId: exam._id,
    ip,
  });

  return exam;
}

async function archiveExamination(id, { adminId, ip } = {}) {
  const exam = await Examination.findById(id);
  if (!exam) throw HttpError.notFound('Examination not found.');

  exam.status = 'ARCHIVED';
  await exam.save();

  await writeAudit({
    adminId,
    action: 'examination.archive',
    entityType: 'Examination',
    entityId: exam._id,
    ip,
  });

  return exam;
}

module.exports = {
  listExaminations,
  getExamination,
  createExamination,
  updateExamination,
  publishExamination,
  unpublishExamination,
  archiveExamination,
};
