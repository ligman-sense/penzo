'use strict';

const mongoose = require('mongoose');
const env = require('../server/config/env');
const ScribeRequest = require('../server/models/ScribeRequest');
const ConfirmedAssignment = require('../server/models/ConfirmedAssignment');
const MatchProposal = require('../server/models/MatchProposal');
const VolunteerInterest = require('../server/models/VolunteerInterest');

async function run() {
  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to DB');

  const activeStatuses = [
    'SUBMITTED',
    'PENDING_REVIEW',
    'AWAITING_VOLUNTEER',
    'MATCH_PROPOSED',
    'VOLUNTEER_ACCEPTED',
    'AWAITING_CANDIDATE_CONFIRMATION',
    'CONFIRMED',
    'REPLACEMENT_REQUIRED',
  ];

  const requests = await ScribeRequest.find({ status: { $in: activeStatuses } }).lean();
  console.log(`Total active requests in DB: ${requests.length}`);
  const map = new Map();
  const dupes = [];
  for (const r of requests) {
    const key = `${r.candidateId}_${r.examinationId}`;
    if (map.has(key)) {
      dupes.push({ key, first: map.get(key), second: r._id });
    } else {
      map.set(key, r._id);
    }
  }

  console.log(`Duplicate active requests found: ${dupes.length}`);
  if (dupes.length > 0) {
    console.log('Details:', dupes);
  }

  const proposals = await MatchProposal.find({ status: { $in: ['ACCEPTED', 'CONFIRMED'] } }).lean();
  console.log(`Accepted/confirmed proposals: ${proposals.length}`);

  const assignments = await ConfirmedAssignment.find({ status: 'ACTIVE' }).lean();
  console.log(`Active assignments: ${assignments.length}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
