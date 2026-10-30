'use strict';

const FAQ = require('../models/FAQ');
const AdminAuditLog = require('../models/AdminAuditLog');
const SupportRequest = require('../models/SupportRequest');
const { HttpError } = require('../utils/httpError');

async function listAuditLogs({ page = 1, pageSize = 30 } = {}) {
  const [items, total] = await Promise.all([
    AdminAuditLog.find()
      .populate('adminId', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    AdminAuditLog.countDocuments(),
  ]);

  return {
    items: items.map((a) => ({
      id: a._id.toString(),
      adminName: a.adminId ? a.adminId.name : 'Unknown',
      adminEmail: a.adminId ? a.adminId.email : '',
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      details: a.details,
      ipAddress: a.ipAddress,
      createdAt: a.createdAt,
    })),
    total,
  };
}

async function listFaqs(publishedOnly = false) {
  const query = publishedOnly ? { isPublished: true } : {};
  return FAQ.find(query).sort({ sortOrder: 1, createdAt: 1 });
}

async function createFaq(data) {
  return FAQ.create({
    question: data.question,
    answer: data.answer,
    category: data.category || 'General',
    sortOrder: data.sortOrder || 0,
    isPublished: data.isPublished !== undefined ? Boolean(data.isPublished) : true,
  });
}

async function updateFaq(id, data) {
  const faq = await FAQ.findById(id);
  if (!faq) throw HttpError.notFound('FAQ not found.');

  if (data.question !== undefined) faq.question = data.question;
  if (data.answer !== undefined) faq.answer = data.answer;
  if (data.category !== undefined) faq.category = data.category;
  if (data.sortOrder !== undefined) faq.sortOrder = Number(data.sortOrder);
  if (data.isPublished !== undefined) faq.isPublished = Boolean(data.isPublished);

  await faq.save();
  return faq;
}

async function deleteFaq(id) {
  await FAQ.findByIdAndDelete(id);
  return { id, deleted: true };
}

module.exports = {
  listAuditLogs,
  listFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
};
