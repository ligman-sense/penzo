'use strict';

const FAQ = require('../models/FAQ');
const AdminAuditLog = require('../models/AdminAuditLog');
const SupportRequest = require('../models/SupportRequest');
const { HttpError } = require('../utils/httpError');

function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  // Neutralize CSV formula injection attacks (=, +, -, @, \t, \r)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

async function listAuditLogs({ page = 1, pageSize = 30, action, entityType, search } = {}) {
  const safePageSize = Math.min(Math.max(1, pageSize), 100);
  const safePage = Math.max(1, page);

  const query = {};
  if (action) query.action = action;
  if (entityType) query.entityType = entityType;
  if (search && search.trim()) {
    const s = search.trim();
    query.$or = [
      { action: { $regex: s, $options: 'i' } },
      { entityType: { $regex: s, $options: 'i' } },
      { entityId: { $regex: s, $options: 'i' } },
    ];
  }

  const [items, total] = await Promise.all([
    AdminAuditLog.find(query)
      .populate('adminId', 'name email')
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safePageSize)
      .limit(safePageSize),
    AdminAuditLog.countDocuments(query),
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

async function exportAuditLogsCsv({ action, entityType, search, limit = 500 } = {}) {
  const query = {};
  if (action) query.action = action;
  if (entityType) query.entityType = entityType;
  if (search && search.trim()) {
    const s = search.trim();
    query.$or = [
      { action: { $regex: s, $options: 'i' } },
      { entityType: { $regex: s, $options: 'i' } },
      { entityId: { $regex: s, $options: 'i' } },
    ];
  }

  const safeLimit = Math.min(Math.max(1, limit), 1000);
  const items = await AdminAuditLog.find(query)
    .populate('adminId', 'name email')
    .sort({ createdAt: -1 })
    .limit(safeLimit);

  const headers = ['ID', 'Admin Name', 'Admin Email', 'Action', 'Entity Type', 'Entity ID', 'IP Address', 'Timestamp', 'Details'];
  const rows = [headers.map(escapeCsvField).join(',')];

  for (const a of items) {
    const adminName = a.adminId ? a.adminId.name : 'Unknown';
    const adminEmail = a.adminId ? a.adminId.email : '';
    const details = a.details ? JSON.stringify(a.details) : '';
    const row = [
      a._id.toString(),
      adminName,
      adminEmail,
      a.action || '',
      a.entityType || '',
      a.entityId || '',
      a.ipAddress || '',
      a.createdAt ? a.createdAt.toISOString() : '',
      details,
    ];
    rows.push(row.map(escapeCsvField).join(','));
  }

  return rows.join('\r\n');
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
  exportAuditLogsCsv,
  listFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
};
