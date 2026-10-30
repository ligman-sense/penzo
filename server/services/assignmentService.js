'use strict';

const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const ScribeRequest = require('../models/ScribeRequest');

async function listAssignments(userId, role) {
  const filter = role === 'CANDIDATE' ? { candidateId: userId } : { volunteerId: userId };

  const items = await ConfirmedAssignment.find(filter)
    .populate({
      path: 'requestId',
      populate: [
        { path: 'examinationId', select: 'name title slug authority' },
        { path: 'candidateId', select: 'mobileE164' },
      ],
    })
    .populate('volunteerId', 'mobileE164')
    .populate('candidateId', 'mobileE164')
    .sort({ startsAt: 1 });

  return items.map((a) => {
    const req = a.requestId;
    const exam = req?.examinationId;
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
      examination: exam ? {
        id: exam._id.toString(),
        name: exam.name || exam.title,
        authority: exam.authority,
        slug: exam.slug,
      } : null,
    };
  });
}

module.exports = { listAssignments };
