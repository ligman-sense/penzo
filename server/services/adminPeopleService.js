'use strict';

const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const VerificationRecord = require('../models/VerificationRecord');
const { writeAudit } = require('./auditService');
const { notify } = require('./notificationService');
const { HttpError } = require('../utils/httpError');

async function listUsers({ page = 1, pageSize = 20, role, status, search } = {}) {
  const query = {};
  if (role) query.role = role;
  if (status) query.status = status;
  if (search) {
    const reg = new RegExp(search, 'i');
    query.$or = [{ mobileE164: reg }, { email: reg }];
  }

  const [users, total] = await Promise.all([
    User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    User.countDocuments(query),
  ]);

  const items = await Promise.all(
    users.map(async (u) => {
      let name = null;
      if (u.role === 'CANDIDATE') {
        const cp = await CandidateProfile.findOne({ userId: u._id }).select('fullName firstName lastName');
        name = cp?.fullName || (cp?.firstName ? `${cp.firstName} ${cp.lastName || ''}`.trim() : null);
      } else {
        const vp = await VolunteerProfile.findOne({ userId: u._id }).select('fullName firstName lastName');
        name = vp?.fullName || (vp?.firstName ? `${vp.firstName} ${vp.lastName || ''}`.trim() : null);
      }
      return {
        id: u._id.toString(),
        role: u.role,
        mobile: u.mobileE164,
        email: u.email,
        status: u.status,
        name: name || '(Not specified)',
        profileComplete: u.profileComplete,
        createdAt: u.createdAt,
      };
    })
  );

  return { items, total };
}

async function getUser(id) {
  const user = await User.findById(id);
  if (!user) throw HttpError.notFound('User not found.');

  const [candidateProfile, volunteerProfile, verifications] = await Promise.all([
    user.role === 'CANDIDATE' ? CandidateProfile.findOne({ userId: id }) : null,
    user.role === 'VOLUNTEER' ? VolunteerProfile.findOne({ userId: id }) : null,
    VerificationRecord.find({ userId: id }).sort({ createdAt: -1 }),
  ]);

  return {
    id: user._id.toString(),
    role: user.role,
    mobile: user.mobileE164,
    email: user.email,
    status: user.status,
    profileComplete: user.profileComplete,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    profile: candidateProfile || volunteerProfile,
    verifications: verifications.map((v) => ({
      id: v._id.toString(),
      kind: v.kind,
      status: v.status,
      reason: v.reason,
      createdAt: v.createdAt,
      reviewedAt: v.reviewedAt,
    })),
  };
}

async function setUserStatus(id, toStatus, reason, { adminId, ip } = {}) {
  const user = await User.findById(id);
  if (!user) throw HttpError.notFound('User not found.');

  if (!['ACTIVE', 'SUSPENDED'].includes(toStatus)) {
    throw HttpError.badRequest('Invalid status.');
  }

  user.status = toStatus;
  await user.save();

  await writeAudit({
    adminId,
    action: toStatus === 'SUSPENDED' ? 'user.suspend' : 'user.reactivate',
    entityType: 'User',
    entityId: id,
    details: { role: user.role, reason },
    ip,
  });

  return { id: user._id.toString(), status: user.status };
}

async function listVerifications({ page = 1, pageSize = 20, status = 'PENDING', kind } = {}) {
  const query = { status };
  if (kind) query.kind = kind;

  const [records, total] = await Promise.all([
    VerificationRecord.find(query)
      .populate('userId', 'role mobileE164 email')
      .sort(status === 'PENDING' ? { createdAt: 1 } : { updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    VerificationRecord.countDocuments(query),
  ]);

  const items = await Promise.all(
    records.map(async (r) => {
      let name = null;
      if (r.userId?.role === 'CANDIDATE') {
        const cp = await CandidateProfile.findOne({ userId: r.userId._id }).select('fullName');
        name = cp?.fullName;
      } else if (r.userId?.role === 'VOLUNTEER') {
        const vp = await VolunteerProfile.findOne({ userId: r.userId._id }).select('fullName');
        name = vp?.fullName;
      }
      return {
        id: r._id.toString(),
        kind: r.kind,
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        user: r.userId ? {
          id: r.userId._id.toString(),
          role: r.userId.role,
          name: name || '(Unknown)',
        } : null,
      };
    })
  );

  return { items, total };
}

async function getVerification(id, { adminId, ip } = {}) {
  const record = await VerificationRecord.findById(id)
    .populate('userId')
    .populate('reviewedById', 'name');

  if (!record) throw HttpError.notFound('Verification record not found.');

  await writeAudit({ adminId, action: 'verification.view', entityType: 'VerificationRecord', entityId: id, ip });

  let profile = null;
  if (record.userId?.role === 'CANDIDATE') {
    profile = await CandidateProfile.findOne({ userId: record.userId._id });
  } else if (record.userId?.role === 'VOLUNTEER') {
    profile = await VolunteerProfile.findOne({ userId: record.userId._id });
  }

  return {
    id: record._id.toString(),
    kind: record.kind,
    status: record.status,
    reason: record.reason,
    createdAt: record.createdAt,
    reviewedAt: record.reviewedAt,
    reviewedBy: record.reviewedById?.name || null,
    user: record.userId ? {
      id: record.userId._id.toString(),
      role: record.userId.role,
      mobile: record.userId.mobileE164,
      email: record.userId.email,
      status: record.userId.status,
      profile,
    } : null,
  };
}

async function decideVerification(id, status, reason, { adminId, ip } = {}) {
  const record = await VerificationRecord.findById(id);
  if (!record) throw HttpError.notFound('Verification record not found.');

  if (!['VERIFIED', 'REJECTED', 'REQUIRES_CORRECTION'].includes(status)) {
    throw HttpError.badRequest('Invalid verification status decision.');
  }

  record.status = status;
  record.reason = reason || null;
  record.reviewedById = adminId;
  record.reviewedAt = new Date();
  await record.save();

  await notify({
    userId: record.userId,
    type: 'VERIFICATION_UPDATE',
    title: status === 'VERIFIED' ? 'Verification Approved' : 'Verification Update',
    body: reason ? `Your verification status has been updated to ${status}. Reason: ${reason}` : `Your verification has been marked as ${status}.`,
    linkPath: '/candidate/profile.html',
  });

  await writeAudit({
    adminId,
    action: 'verification.decide',
    entityType: 'VerificationRecord',
    entityId: id,
    details: { status, reason },
    ip,
  });

  return { id: record._id.toString(), status: record.status };
}

module.exports = {
  listUsers,
  getUser,
  setUserStatus,
  listVerifications,
  getVerification,
  decideVerification,
};
