'use strict';

const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const VerificationRecord = require('../models/VerificationRecord');
const AdminUser = require('../models/AdminUser');
const DocumentMetadata = require('../models/DocumentMetadata');
const { writeAudit } = require('./auditService');
const { notify } = require('./notificationService');
const { HttpError } = require('../utils/httpError');
const { syncUserVerification } = require('./profileService');
const { escapeRegex } = require('../utils/regex');

function resolveUserName(user, profile) {
  if (profile) {
    if (profile.fullName && profile.fullName.trim()) return profile.fullName.trim();
    const parts = [profile.firstName, profile.lastName].filter(Boolean).map((s) => s.trim()).join(' ');
    if (parts) return parts;
  }
  if (user) {
    if (user.name && user.name.trim()) return user.name.trim();
    if (user.email && user.email.trim()) return user.email.trim();
    if (user.mobileE164 && user.mobileE164.trim()) return user.mobileE164.trim();
  }
  return '(Name not provided)';
}

let syncInProgress = null;

/**
 * Self-healing sync between User verification status and VerificationRecord documents.
 * 1. Purges orphaned verification records referencing non-existent/deleted user accounts.
 * 2. Ensures every verified, pending, or profile-complete candidate has IDENTITY & ASSISTANCE_NEED records.
 * 3. Ensures every verified, pending, or profile-complete volunteer has an IDENTITY record.
 */
async function ensureVerificationSync() {
  if (syncInProgress) return syncInProgress;

  syncInProgress = (async () => {
    try {
      const allUsers = await User.find({ status: { $ne: 'DELETED' } });
      const validUserIds = allUsers.map((u) => u._id);

      // 1. Purge orphaned VerificationRecords whose user no longer exists
      await VerificationRecord.deleteMany({ userId: { $nin: validUserIds } });

      // 2. Ensure verification records exist for all valid candidates and volunteers
      for (const user of allUsers) {
        const isEligible = user.profileComplete || ['VERIFIED', 'PENDING', 'UNDER_REVIEW', 'REQUIRES_CORRECTION', 'REJECTED'].includes(user.verificationStatus);
        if (!isEligible) continue;

        const requiredKinds = user.role === 'CANDIDATE' ? ['IDENTITY', 'ASSISTANCE_NEED'] : ['IDENTITY'];

        for (const kind of requiredKinds) {
          let rec = await VerificationRecord.findOne({ userId: user._id, kind });
          if (!rec) {
            const targetStatus = user.verificationStatus && user.verificationStatus !== 'UNVERIFIED'
              ? user.verificationStatus
              : 'PENDING';

            await VerificationRecord.create({
              userId: user._id,
              kind,
              status: targetStatus,
              reviewedAt: targetStatus === 'VERIFIED' ? (user.updatedAt || new Date()) : null,
              createdAt: user.createdAt || new Date(),
            });
          } else if (user.verificationStatus === 'VERIFIED' && rec.status === 'PENDING') {
            rec.status = 'VERIFIED';
            rec.reviewedAt = rec.reviewedAt || user.updatedAt || new Date();
            await rec.save();
          }
        }
      }
    } catch (err) {
      console.error('[VerificationSync] Error syncing records:', err.message);
    } finally {
      syncInProgress = null;
    }
  })();

  return syncInProgress;
}

async function listUsers({ page = 1, pageSize = 20, role, status, search } = {}) {
  const query = {};
  if (role) query.role = role;
  if (status) query.status = status;
  if (search && typeof search === 'string' && search.trim()) {
    const reg = new RegExp(escapeRegex(search.trim()), 'i');
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
  await ensureVerificationSync();

  const validUsers = await User.find({ status: { $ne: 'DELETED' } }).select('_id role verificationStatus');
  const validUserIds = validUsers.map((u) => u._id);

  const [
    totalPending,
    underReview,
    verifiedCandidates,
    verifiedVolunteers,
    rejected,
    requiresCorrection,
  ] = await Promise.all([
    VerificationRecord.countDocuments({ userId: { $in: validUserIds }, status: 'PENDING' }),
    VerificationRecord.countDocuments({ userId: { $in: validUserIds }, status: 'UNDER_REVIEW' }),
    User.countDocuments({ role: 'CANDIDATE', verificationStatus: 'VERIFIED', status: { $ne: 'DELETED' } }),
    User.countDocuments({ role: 'VOLUNTEER', verificationStatus: 'VERIFIED', status: { $ne: 'DELETED' } }),
    VerificationRecord.countDocuments({ userId: { $in: validUserIds }, status: 'REJECTED' }),
    VerificationRecord.countDocuments({ userId: { $in: validUserIds }, status: 'REQUIRES_CORRECTION' }),
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
 * Lists verification queue records with rich filtering, name resolution, and user data.
 */
async function listVerifications({ page = 1, pageSize = 20, status, role, kind, search } = {}) {
  await ensureVerificationSync();

  // Find valid existing users, matching role and search if specified
  const userQuery = { status: { $ne: 'DELETED' } };
  if (role && role !== 'ALL') {
    userQuery.role = role;
  }

  let matchingUserIds = null;

  if (search && typeof search === 'string' && search.trim()) {
    const reg = new RegExp(escapeRegex(search.trim()), 'i');
    const [matchingUsers, cpUsers, vpUsers] = await Promise.all([
      User.find({
        ...userQuery,
        $or: [{ name: reg }, { mobileE164: reg }, { email: reg }],
      }).select('_id'),
      CandidateProfile.find({
        $or: [{ fullName: reg }, { firstName: reg }, { lastName: reg }],
      }).select('userId'),
      VolunteerProfile.find({
        $or: [{ fullName: reg }, { firstName: reg }, { lastName: reg }],
      }).select('userId'),
    ]);

    const idSet = new Set(matchingUsers.map((u) => u._id.toString()));
    cpUsers.forEach((c) => {
      if (c.userId) idSet.add(c.userId.toString());
    });
    vpUsers.forEach((v) => {
      if (v.userId) idSet.add(v.userId.toString());
    });

    if (role && role !== 'ALL') {
      const roleUsers = await User.find({ _id: { $in: Array.from(idSet) }, role, status: { $ne: 'DELETED' } }).select('_id');
      matchingUserIds = roleUsers.map((u) => u._id);
    } else {
      const existing = await User.find({ _id: { $in: Array.from(idSet) }, status: { $ne: 'DELETED' } }).select('_id');
      matchingUserIds = existing.map((u) => u._id);
    }
  } else if (role && role !== 'ALL') {
    const matchingUsers = await User.find(userQuery).select('_id');
    matchingUserIds = matchingUsers.map((u) => u._id);
  } else {
    const allExisting = await User.find(userQuery).select('_id');
    matchingUserIds = allExisting.map((u) => u._id);
  }

  const query = {
    userId: { $in: matchingUserIds },
  };

  if (status && status !== 'ALL') {
    query.status = status;
  }
  if (kind) {
    query.kind = kind;
  }

  const [records, total] = await Promise.all([
    VerificationRecord.find(query)
      .populate('userId', 'name role mobileE164 email status verificationStatus profileComplete')
      .populate('reviewedById', 'name email')
      .sort(status === 'PENDING' ? { createdAt: 1 } : { updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    VerificationRecord.countDocuments(query),
  ]);

  const items = (await Promise.all(
    records.map(async (r) => {
      if (!r.userId) return null;

      let profile = null;
      if (r.userId.role === 'CANDIDATE') {
        profile = await CandidateProfile.findOne({ userId: r.userId._id });
      } else if (r.userId.role === 'VOLUNTEER') {
        profile = await VolunteerProfile.findOne({ userId: r.userId._id });
      }

      const name = resolveUserName(r.userId, profile);

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
        user: {
          id: r.userId._id.toString(),
          role: r.userId.role,
          name,
          mobile: r.userId.mobileE164,
          email: r.userId.email,
          profileComplete: r.userId.profileComplete,
          verificationStatus: r.userId.verificationStatus || 'UNVERIFIED',
          profile: profile ? {
            fullName: profile.fullName || name,
            city: profile.city || profile.preferredExamCity,
            state: profile.state,
            pincode: profile.pincode,
            languages: profile.languages || profile.preferredLanguages,
            subjects: profile.subjects,
            education: profile.education || profile.qualification,
            qualification: profile.qualification || profile.education,
            currentlyPursuing: profile.currentlyPursuing,
            assistanceNeeds: profile.assistanceNeeds || profile.disabilityType,
            disabilityType: profile.disabilityType,
            disabilityDescription: profile.disabilityDescription,
            hasExperience: profile.hasPriorExperience || profile.hasScribeExperience,
            completionPercentage: profile.completionPercentage,
          } : null,
        },
      };
    })
  )).filter(Boolean);

  return { items, total };
}

/**
 * Get detailed verification info for review modal.
 */
async function getVerification(id, { adminId, ip } = {}) {
  const record = await VerificationRecord.findById(id)
    .populate('userId')
    .populate('reviewedById', 'name email');

  if (!record || !record.userId) throw HttpError.notFound('Verification record not found.');

  await writeAudit({ adminId, action: 'verification.view', entityType: 'VerificationRecord', entityId: id, ip });

  let profile = null;
  if (record.userId.role === 'CANDIDATE') {
    profile = await CandidateProfile.findOne({ userId: record.userId._id });
  } else if (record.userId.role === 'VOLUNTEER') {
    profile = await VolunteerProfile.findOne({ userId: record.userId._id });
  }

  const name = resolveUserName(record.userId, profile);

  // Get all verification records for this user to show full context, along with uploaded documents
  const [allUserVerifications, documents] = await Promise.all([
    VerificationRecord.find({ userId: record.userId._id }).sort({ createdAt: -1 }),
    DocumentMetadata.find({ userId: record.userId._id }).sort({ uploadedAt: -1 }),
  ]);

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
    user: {
      id: record.userId._id.toString(),
      role: record.userId.role,
      name,
      mobile: record.userId.mobileE164,
      email: record.userId.email,
      status: record.userId.status,
      profileComplete: record.userId.profileComplete,
      verificationStatus: record.userId.verificationStatus || 'UNVERIFIED',
      profile: profile ? (profile.toObject ? profile.toObject() : profile) : {},
    },
    documents: documents.map((d) => ({
      id: d._id.toString(),
      kind: d.kind,
      originalName: d.originalName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt,
      storageKey: d.storageKey,
    })),
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
