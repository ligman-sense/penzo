'use strict';

const RequestStatusHistory = require('../models/RequestStatusHistory');
const VolunteerInterest = require('../models/VolunteerInterest');
const MatchProposal = require('../models/MatchProposal');
const ConfirmedAssignment = require('../models/ConfirmedAssignment');
const ScribeRequest = require('../models/ScribeRequest');
const { REQUEST_STATUS_LABEL } = require('./requestStateMachine');

async function getHistory(userId, role, limit = 100) {
  const events = [];

  if (role === 'CANDIDATE') {
    const requests = await ScribeRequest.find({ candidateId: userId }).select('_id');
    const reqIds = requests.map((r) => r._id);

    const rows = await RequestStatusHistory.find({ requestId: { $in: reqIds } })
      .populate({
        path: 'requestId',
        populate: { path: 'examinationId', select: 'name title' },
      })
      .sort({ createdAt: -1 })
      .limit(limit);

    for (const r of rows) {
      const examName = r.requestId?.examinationId?.name || r.requestId?.examinationId?.title || 'Examination';
      events.push({
        id: `rsh-${r._id}`,
        at: r.createdAt,
        kind: 'REQUEST_STATUS',
        title: `${REQUEST_STATUS_LABEL[r.toStatus] || r.toStatus}: ${examName}`,
        detail: [`Request ${r.requestId?.reference || ''}`, r.reason ? `Reason: ${r.reason}` : null]
          .filter(Boolean)
          .join('. '),
        linkPath: `/candidate/request-details.html?id=${r.requestId?._id}`,
      });
    }
  } else {
    const [interests, assignments] = await Promise.all([
      VolunteerInterest.find({ volunteerId: userId })
        .populate('examinationId', 'name title')
        .sort({ updatedAt: -1 })
        .limit(50),
      ConfirmedAssignment.find({ volunteerId: userId })
        .populate({
          path: 'requestId',
          populate: { path: 'examinationId', select: 'name title' },
        })
        .sort({ updatedAt: -1 })
        .limit(50),
    ]);

    for (const i of interests) {
      const examName = i.examinationId?.name || i.examinationId?.title || 'Examination';
      events.push({
        id: `int-${i._id}`,
        at: i.status === 'ACTIVE' ? i.createdAt : i.updatedAt,
        kind: 'INTEREST',
        title: i.status === 'ACTIVE' ? `Expressed interest in ${examName}` : `Withdrew interest in ${examName}`,
        detail: null,
        linkPath: '/volunteer/interests.html',
      });
    }

    for (const a of assignments) {
      const examName = a.requestId?.examinationId?.name || a.requestId?.examinationId?.title || 'Examination';
      events.push({
        id: `asg-${a._id}`,
        at: a.confirmedAt || a.createdAt,
        kind: 'COMMITMENT',
        title: `Commitment ${a.status.toLowerCase()}: ${examName}`,
        detail: a.cancelReason ? `Reason: ${a.cancelReason}` : null,
        linkPath: '/volunteer/commitments.html',
      });
    }
  }

  return events.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}

module.exports = { getHistory };
