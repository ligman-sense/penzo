'use strict';

const User = require('../models/User');
const Examination = require('../models/Examination');
const ScribeRequest = require('../models/ScribeRequest');
const VerificationRecord = require('../models/VerificationRecord');
const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const AdminAuditLog = require('../models/AdminAuditLog');

async function getDashboardMetrics() {
  const [
    totalCandidates,
    totalVolunteers,
    publishedExams,
    totalRequests,
    activeRequests,
    pendingVerifications,
    confirmedAssignments,
    recentAudit,
  ] = await Promise.all([
    User.countDocuments({ role: 'CANDIDATE' }),
    User.countDocuments({ role: 'VOLUNTEER' }),
    Examination.countDocuments({ status: 'PUBLISHED' }),
    ScribeRequest.countDocuments(),
    ScribeRequest.countDocuments({ status: { $nin: ['COMPLETED', 'CANCELLED', 'REJECTED'] } }),
    VerificationRecord.countDocuments({ status: 'PENDING' }),
    ConfirmedAssignment.countDocuments({ status: 'CONFIRMED' }),
    AdminAuditLog.find()
      .populate('adminId', 'name email')
      .sort({ createdAt: -1 })
      .limit(10),
  ]);

  return {
    users: {
      candidates: totalCandidates,
      volunteers: totalVolunteers,
      total: totalCandidates + totalVolunteers,
    },
    examinations: {
      published: publishedExams,
    },
    requests: {
      total: totalRequests,
      active: activeRequests,
    },
    verifications: {
      pending: pendingVerifications,
    },
    assignments: {
      confirmed: confirmedAssignments,
    },
    recentAudit: recentAudit.map((a) => ({
      id: a._id.toString(),
      admin: a.adminId ? a.adminId.name : 'Admin',
      action: a.action,
      entityType: a.entityType,
      createdAt: a.createdAt,
    })),
  };
}

async function getReports() {
  const [
    requestsByStatus,
    examsByStatus,
    usersByRole,
    verificationsByStatus,
  ] = await Promise.all([
    ScribeRequest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Examination.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    VerificationRecord.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  return {
    requestsByStatus: requestsByStatus.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}),
    examsByStatus: examsByStatus.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}),
    usersByRole: usersByRole.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}),
    verificationsByStatus: verificationsByStatus.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}),
  };
}

module.exports = {
  getDashboardMetrics,
  getReports,
};
