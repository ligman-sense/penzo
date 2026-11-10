'use strict';

const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const ScribeRequest = require('../models/ScribeRequest');
const CandidateProfile = require('../models/CandidateProfile');
const VolunteerProfile = require('../models/VolunteerProfile');

async function listAssignments(userId, role) {
  const filter = role === 'CANDIDATE' ? { candidateId: userId } : { volunteerId: userId };

  const items = await ConfirmedAssignment.find(filter)
    .populate({
      path: 'requestId',
      populate: [
        { path: 'examinationId', select: 'name title slug authority startsOn locations' },
        { path: 'candidateId', select: 'mobileE164' },
      ],
    })
    .populate('volunteerId', 'mobileE164 verificationStatus')
    .populate('candidateId', 'mobileE164')
    .sort({ startsAt: 1 });

  return Promise.all(
    items.map(async (a) => {
      const req = a.requestId;
      const exam = req?.examinationId;

      let candidateName = 'Candidate';
      let volunteerName = 'Volunteer';

      if (a.candidateId) {
        const cp = await CandidateProfile.findOne({ userId: a.candidateId._id });
        if (cp) candidateName = cp.fullName || `${cp.firstName || ''} ${cp.lastName || ''}`.trim() || 'Candidate';
      }

      if (a.volunteerId) {
        const vp = await VolunteerProfile.findOne({ userId: a.volunteerId._id });
        if (vp) volunteerName = vp.fullName || `${vp.firstName || ''} ${vp.lastName || ''}`.trim() || 'Volunteer';
      }

      return {
        id: a._id.toString(),
        requestId: req ? req._id.toString() : null,
        status: a.status,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        confirmedAt: a.confirmedAt,
        completedAt: a.completedAt,
        cancelledAt: a.cancelledAt,
        cancelReason: a.cancelReason,
        candidateName,
        volunteerName,
        candidateMobile: a.candidateId?.mobileE164,
        volunteerMobile: a.volunteerId?.mobileE164,
        examination: exam ? {
          id: exam._id.toString(),
          name: exam.name || exam.title,
          authority: exam.authority,
          slug: exam.slug,
          startsOn: exam.startsOn,
          locations: exam.locations,
        } : null,
      };
    })
  );
}

module.exports = { listAssignments };
