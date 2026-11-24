'use strict';

const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const VerificationRecord = require('../models/VerificationRecord');
const { writeAudit } = require('./auditService');
const { notify } = require('./notificationService');
const { HttpError } = require('../utils/httpError');
const { syncUserVerification } = require('./profileService');

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
        verificationStatus: u.verificationStatus || 'UNVERIFIED',
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
    verificationStatus: user.verificationStatus || 'UNVERIFIED',
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

/**
 * Returns summary counts for the verification dashboard.
 */
async function getVerificationMetrics() {
  const [
    totalPending,
    underReview,
    verifiedCandidates,
    verifiedVolunteers,
    rejected,
    requiresCorrection,
  ] = await Promise.all([
    VerificationRecord.countDocuments({ status: 'PENDING' }),
    VerificationRecord.countDocuments({ status: 'UNDER_REVIEW' }),
    User.countDocuments({ role: 'CANDIDATE', verificationStatus: 'VERIFIED' }),
    User.countDocuments({ role: 'VOLUNTEER', verificationStatus: 'VERIFIED' }),
    VerificationRecord.countDocuments({ status: 'REJECTED' }),
    VerificationRecord.countDocuments({ status: 'REQUIRES_CORRECTION' }),
  ]);

  return {
    totalPending,
    underReview,
    verifiedCandidates,
    verifiedVolunteers,
    rejected,
    requiresCorrection,
  };
}

/**
 * Lists verification queue records with rich filtering and user data.
 */
async function listVerifications({ page = 1, pageSize = 20, status, role, kind, search } = {}) {
  const query = {};
  if (status && status !== 'ALL') {
    query.status = status;
  }
  if (kind) {
    query.kind = kind;
  }

  // Filter by user role or search query if provided
  if ((role && role !== 'ALL') || search) {
    const userQuery = {};
    if (role && role !== 'ALL') userQuery.role = role;
    if (search) {
      const reg = new RegExp(search, 'i');
      userQuery.$or = [{ mobileE164: reg }, { email: reg }];
    }
    const matchingUsers = await User.find(userQuery).select('_id');
    const userIds = matchingUsers.map((u) => u._id);

    // Also search candidate and volunteer profile names
    if (search) {
      const reg = new RegExp(search, 'i');
      const [cpUsers, vpUsers] = await Promise.all([
        CandidateProfile.find({ $or: [{ fullName: reg }, { firstName: reg }, { lastName: reg }] }).select('userId'),
        VolunteerProfile.find({ $or: [{ fullName: reg }, { firstName: reg }, { lastName: reg }] }).select('userId'),
      ]);
      cpUsers.forEach((c) => userIds.push(c.userId));
      vpUsers.forEach((v) => userIds.push(v.userId));
    }

    query.userId = { $in: userIds };
  }

  const [records, total] = await Promise.all([
    VerificationRecord.find(query)
      .populate('userId', 'role mobileE164 email status verificationStatus profileComplete')
      .populate('reviewedById', 'name email')
      .sort(status === 'PENDING' ? { createdAt: 1 } : { updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    VerificationRecord.countDocuments(query),
  ]);

  const items = await Promise.all(
    records.map(async (r) => {
      let name = null;
      let profile = null;
      if (r.userId?.role === 'CANDIDATE') {
        profile = await CandidateProfile.findOne({ userId: r.userId._id });
        name = profile?.fullName || (profile?.firstName ? `${profile.firstName} ${profile.lastName || ''}`.trim() : null);
      } else if (r.userId?.role === 'VOLUNTEER') {
        profile = await VolunteerProfile.findOne({ userId: r.userId._id });
        name = profile?.fullName || (profile?.firstName ? `${profile.firstName} ${profile.lastName || ''}`.trim() : null);
      }

      return {
        id: r._id.toString(),
        kind: r.kind,
        status: r.status,
        reason: r.reason,
        documentKey: r.documentKey,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        reviewedBy: r.reviewedById?.name || null,
        history: r.history || [],
        user: r.userId ? {
          id: r.userId._id.toString(),
          role: r.userId.role,
          name: name || '(Not specified)',
          mobile: r.userId.mobileE164,
          email: r.userId.email,
          profileComplete: r.userId.profileComplete,
          verificationStatus: r.userId.verificationStatus || 'UNVERIFIED',
          profile: profile ? {
            city: profile.city,
            state: profile.state,
            languages: profile.languages || profile.preferredLanguages,
            subjects: profile.subjects,
            education: profile.education,
            assistanceNeeds: profile.assistanceNeeds || profile.disabilityType,
            hasExperience: profile.hasPriorExperience || profile.hasScribeExperience,
            completionPercentage: profile.completionPercentage,
          } : null,
        } : null,
      };
    })
  );

  return { items, total };
}

/**
 * Get detailed verification info for review modal.
 */
async function getVerification(id, { adminId, ip } = {}) {
  const record = await VerificationRecord.findById(id)
    .populate('userId')
    .populate('reviewedById', 'name email');

  if (!record) throw HttpError.notFound('Verification record not found.');

  await writeAudit({ adminId, action: 'verification.view', entityType: 'VerificationRecord', entityId: id, ip });

  let profile = null;
  if (record.userId?.role === 'CANDIDATE') {
    profile = await CandidateProfile.findOne({ userId: record.userId._id });
  } else if (record.userId?.role === 'VOLUNTEER') {
    profile = await VolunteerProfile.findOne({ userId: record.userId._id });
  }

  // Get all verification records for this user to show full context
  const allUserVerifications = await VerificationRecord.find({ userId: record.userId?._id }).sort({ createdAt: -1 });

  return {
    id: record._id.toString(),
    kind: record.kind,
    status: record.status,
    reason: record.reason,
    documentKey: record.documentKey,
    createdAt: record.createdAt,
    reviewedAt: record.reviewedAt,
    reviewedBy: record.reviewedById?.name || null,
    history: record.history || [],
    user: record.userId ? {
      id: record.userId._id.toString(),
      role: record.userId.role,
      mobile: record.userId.mobileE164,
      email: record.userId.email,
      status: record.userId.status,
      profileComplete: record.userId.profileComplete,
      verificationStatus: record.userId.verificationStatus || 'UNVERIFIED',
      profile,
    } : null,
    allVerifications: allUserVerifications.map((v) => ({
      id: v._id.toString(),
      kind: v.kind,
      status: v.status,
      reason: v.reason,
      reviewedAt: v.reviewedAt,
    })),
  };
}

/**
 * Approve, reject, or request corrections for a verification record.
 */
async function decideVerification(id, status, reason, { adminId, ip } = {}) {
  const record = await VerificationRecord.findById(id).populate('userId');
  if (!record) throw HttpError.notFound('Verification record not found.');

  const allowedStatuses = ['VERIFIED', 'REJECTED', 'REQUIRES_CORRECTION', 'UNDER_REVIEW'];
  if (!allowedStatuses.includes(status)) {
    throw HttpError.badRequest('Invalid verification status decision.');
  }

  if (['REJECTED', 'REQUIRES_CORRECTION'].includes(status) && (!reason || !reason.trim())) {
    throw HttpError.badRequest(`A mandatory reason is required when status is set to ${status}.`);
  }

  const prevStatus = record.status;
  record.status = status;
  record.reason = reason ? reason.trim() : null;
  record.reviewedById = adminId;
  record.reviewedAt = new Date();

  // Record audit history entry
  record.history = record.history || [];
  record.history.push({
    fromStatus: prevStatus,
    toStatus: status,
    reason: record.reason,
    adminId,
    timestamp: new Date(),
  });

  await record.save();

  // Sync overall user and profile verification status
  const overallStatus = await syncUserVerification(record.userId._id);

  // Send in-app notification
  let notifTitle = 'Verification Update';
  let notifBody = `Your verification status has been updated to ${status}.`;
  if (status === 'VERIFIED') {
    notifTitle = 'Verification Approved! 🎉';
    notifBody = 'Congratulations! Your profile verification has been approved. You now hold Verified status on PENZO.';
  } else if (status === 'REQUIRES_CORRECTION') {
    notifTitle = 'Profile Correction Requested';
    notifBody = `The administrator requested corrections for your profile verification. Reason: ${reason}. Please update your profile.`;
  } else if (status === 'REJECTED') {
    notifTitle = 'Verification Rejected';
    notifBody = `Your verification was not approved. Reason: ${reason}.`;
  }

  const linkPath = record.userId.role === 'CANDIDATE' ? '/candidate/profile.html' : '/volunteer/profile.html';

  await notify({
    userId: record.userId._id,
    type: 'VERIFICATION_UPDATE',
    title: notifTitle,
    body: notifBody,
    linkPath,
  });

  await writeAudit({
    adminId,
    action: 'verification.decide',
    entityType: 'VerificationRecord',
    entityId: id,
    details: { fromStatus: prevStatus, toStatus: status, reason: record.reason, overallStatus },
    ip,
  });

  return {
    id: record._id.toString(),
    status: record.status,
    overallVerificationStatus: overallStatus,
  };
}

module.exports = {
  listUsers,
  getUser,
  setUserStatus,
  getVerificationMetrics,
  listVerifications,
  getVerification,
  decideVerification,
};
