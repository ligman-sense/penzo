'use strict';

const User = require('../models/User');
const ScribeRequest = require('../models/ScribeRequest');
const VolunteerInterest = require('../models/VolunteerInterest');
const VolunteerAvailability = require('../models/VolunteerAvailability');
const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const Examination = require('../models/Examination');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');
const { candidateCompletion, volunteerCompletion } = require('./profileCompletion');
const { REQUEST_STATUS_LABEL } = require('./requestStateMachine');

async function getDashboard(userId, role) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  if (role === 'CANDIDATE') {
    const cp = await CandidateProfile.findOne({ userId });
    const completion = candidateCompletion(cp, user);

    const [totalRequests, activeRequests, recentRequests, upcomingExams, assignments] = await Promise.all([
      ScribeRequest.countDocuments({ candidateId: userId }),
      ScribeRequest.countDocuments({
        candidateId: userId,
        status: { $nin: ['COMPLETED', 'CANCELLED', 'REJECTED'] },
      }),
      ScribeRequest.find({ candidateId: userId })
        .populate('examinationId', 'name title slug authority startsOn')
        .sort({ createdAt: -1 })
        .limit(5),
      Examination.find({ status: 'PUBLISHED' })
        .sort({ isFeatured: -1, startsOn: 1 })
        .limit(4),
      ConfirmedAssignment.find({ candidateId: userId, status: 'CONFIRMED' })
        .populate({
          path: 'requestId',
          populate: { path: 'examinationId', select: 'name title authority' },
        })
        .sort({ startsAt: 1 })
        .limit(5),
    ]);

    return {
      user: {
        id: user._id.toString(),
        role: user.role,
        mobileMasked: `${user.mobileE164.slice(0, 3)}***${user.mobileE164.slice(-3)}`,
        profileComplete: user.profileComplete,
        name: cp?.fullName || (cp?.firstName ? `${cp.firstName} ${cp.lastName || ''}`.trim() : 'Candidate'),
      },
      completion,
      stats: {
        totalRequests,
        activeRequests,
        confirmedArrangements: assignments.length,
      },
      recentRequests: recentRequests.map((r) => ({
        id: r._id.toString(),
        reference: r.reference,
        status: r.status,
        statusLabel: REQUEST_STATUS_LABEL[r.status] || r.status,
        createdAt: r.createdAt,
        examination: r.examinationId ? {
          name: r.examinationId.name || r.examinationId.title,
          authority: r.examinationId.authority,
        } : null,
      })),
      upcomingExaminations: upcomingExams.map((e) => ({
        id: e._id.toString(),
        slug: e.slug,
        name: e.name || e.title,
        authority: e.authority,
        startsOn: e.startsOn,
        isFeatured: e.isFeatured,
      })),
      confirmedAssignments: assignments.map((a) => ({
        id: a._id.toString(),
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        examination: a.requestId?.examinationId ? {
          name: a.requestId.examinationId.name || a.requestId.examinationId.title,
        } : null,
      })),
    };
  } else {
    const vp = await VolunteerProfile.findOne({ userId });
    const completion = volunteerCompletion(vp, user);

    const [activeInterests, availabilityCount, commitments, upcomingExams] = await Promise.all([
      VolunteerInterest.countDocuments({ volunteerId: userId, status: 'ACTIVE' }),
      VolunteerAvailability.countDocuments({ volunteerId: userId, status: 'OPEN' }),
      ConfirmedAssignment.countDocuments({ volunteerId: userId, status: 'CONFIRMED' }),
      Examination.find({ status: 'PUBLISHED' })
        .sort({ isFeatured: -1, startsOn: 1 })
        .limit(4),
    ]);

    const recentInterests = await VolunteerInterest.find({ volunteerId: userId, status: 'ACTIVE' })
      .populate('examinationId', 'name title slug authority startsOn')
      .sort({ updatedAt: -1 })
      .limit(5);

    const upcomingCommitments = await ConfirmedAssignment.find({ volunteerId: userId, status: 'CONFIRMED' })
      .populate({
        path: 'requestId',
        populate: { path: 'examinationId', select: 'name title authority' },
      })
      .sort({ startsAt: 1 })
      .limit(5);

    return {
      user: {
        id: user._id.toString(),
        role: user.role,
        mobileMasked: `${user.mobileE164.slice(0, 3)}***${user.mobileE164.slice(-3)}`,
        profileComplete: user.profileComplete,
        name: vp?.fullName || (vp?.firstName ? `${vp.firstName} ${vp.lastName || ''}`.trim() : 'Volunteer'),
      },
      completion,
      stats: {
        activeInterests,
        openAvailabilitySlots: availabilityCount,
        confirmedCommitments: commitments,
      },
      recentInterests: recentInterests.map((i) => ({
        id: i._id.toString(),
        examination: i.examinationId ? {
          id: i.examinationId._id.toString(),
          name: i.examinationId.name || i.examinationId.title,
          authority: i.examinationId.authority,
          startsOn: i.examinationId.startsOn,
        } : null,
      })),
      upcomingCommitments: upcomingCommitments.map((c) => ({
        id: c._id.toString(),
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        examination: c.requestId?.examinationId ? {
          name: c.requestId.examinationId.name || c.requestId.examinationId.title,
          authority: c.requestId.examinationId.authority,
        } : null,
      })),
      upcomingExaminations: upcomingExams.map((e) => ({
        id: e._id.toString(),
        slug: e.slug,
        name: e.name || e.title,
        authority: e.authority,
        startsOn: e.startsOn,
        isFeatured: e.isFeatured,
      })),
    };
  }
}

module.exports = { getDashboard };
