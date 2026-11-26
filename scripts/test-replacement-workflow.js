'use strict';

/**
 * End-to-end verification test for:
 * 1. Email field "Required" text validation
 * 2. Dynamic Default Reporting Time calculation (1h prior, handling rollover)
 * 3. Volunteer withdrawal notification with exact apology message
 * 4. Request status transition to REPLACEMENT_REQUIRED
 * 5. Backend-level exclusion of withdrawn volunteer for replacement matching
 * 6. Non-permanent exclusion (volunteer remains eligible for other requests)
 * 7. Replacement allocation generating new unique Allocation ID
 * 8. Super-Admin request list populating session & examination date
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { connectDB } = require('../server/config/database');
const User = require('../server/models/User');
const Examination = require('../server/models/Examination');
const ScribeRequest = require('../server/models/ScribeRequest');
const ConfirmedAssignment = require('../server/models/ConfirmedAssignment');
const MatchProposal = require('../server/models/MatchProposal');
const VolunteerInterest = require('../server/models/VolunteerInterest');
const VolunteerProfile = require('../server/models/VolunteerProfile');
const CandidateProfile = require('../server/models/CandidateProfile');
const Notification = require('../server/models/Notification');
const AdminUser = require('../server/models/AdminUser');

const { findPotentialMatches, proposeMatch, allocateScribe } = require('../server/services/matchingService');
const { listRequests, getRequest: getAdminRequest } = require('../server/services/adminRequestService');
const { cancelAssignment } = require('../server/services/assignmentService');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    passedTests++;
    console.log(`✅ PASS: ${message}`);
  }
}

async function run() {
  console.log('\n============================================================');
  console.log('🧪 VERIFYING PENZO REPLACEMENT & COORDINATION REQUIREMENTS');
  console.log('============================================================\n');

  // ─── 1. Check Profile Management Email Field "Required" ─────────────────
  console.log('--- 1. Profile Management Email Field Label Check ---');
  const candidateProfileJs = fs.readFileSync(path.join(__dirname, '../public/js/candidate/profile.js'), 'utf8');
  const volunteerProfileJs = fs.readFileSync(path.join(__dirname, '../public/js/volunteer/profile.js'), 'utf8');

  assert(candidateProfileJs.includes("emailBadge.textContent = 'Required';"), "Candidate profile email badge shows 'Required'");
  assert(!candidateProfileJs.includes("emailBadge.textContent = contactInfo.authProvider === 'GOOGLE' ? 'Google Login (Required)' : 'Login Identifier (Required)';"), "Candidate profile no longer sets 'Login Identifier (Required)' for email badge");
  assert(volunteerProfileJs.includes("emailBadge.textContent = 'Required';"), "Volunteer profile email badge shows 'Required'");
  assert(!volunteerProfileJs.includes("emailBadge.textContent = contactInfo.authProvider === 'GOOGLE' ? 'Google Login (Required)' : 'Login Identifier (Required)';"), "Volunteer profile no longer sets 'Login Identifier (Required)' for email badge");

  // ─── 2. Default Reporting Time Dynamic Calculation ───────────────────────
  console.log('\n--- 2. Default Reporting Time Dynamic Calculation ---');
  const utilsJs = fs.readFileSync(path.join(__dirname, '../public/js/utils.js'), 'utf8');
  assert(utilsJs.includes('computeDefaultReportingTime'), 'computeDefaultReportingTime exported in utils.js');

  // Evaluate function extracted from utils.js
  const computeFnMatch = utilsJs.match(/export function computeDefaultReportingTime[\s\S]*?\n\}/);
  assert(Boolean(computeFnMatch), 'Found computeDefaultReportingTime function body in utils.js');
  const computeDefaultReportingTime = new Function('sessionStartsAt', computeFnMatch[0].replace('export function computeDefaultReportingTime(sessionStartsAt) {', '').slice(0, -1));
  // Normal session at 10:00 AM IST on Dec 21, 2026
  const session10am = new Date('2026-12-21T04:30:00.000Z'); // 10:00 AM IST
  const rep10am = computeDefaultReportingTime(session10am);
  assert(rep10am.includes('09:00 AM'), `10:00 AM session correctly calculates default reporting time as 09:00 AM (got: ${rep10am})`);

  // Rollover test: 00:30 AM IST (falls on previous day)
  const sessionMidnight = new Date('2026-12-21T19:00:00.000Z'); // Dec 22, 00:30 AM IST
  const repMidnight = computeDefaultReportingTime(sessionMidnight);
  assert(repMidnight.includes('11:30 PM') && repMidnight.includes('21/12/2026'), `Rollover session calculates previous-day time correctly (got: ${repMidnight})`);

  // ─── 3. Database & Workflow Setup ─────────────────────────────────────────
  console.log('\n--- 3. Database Workflow Setup ---');
  await connectDB();

  const suffix = `rw_${Date.now()}`;
  const randNum = Math.floor(100000 + Math.random() * 800000);
  const admin = await AdminUser.create({
    name: 'Super Admin Replacer',
    email: `admin_${suffix}@example.com`,
    passwordHash: 'dummy',
    role: 'SUPER_ADMIN',
  });

  const candidate = await User.create({
    mobileE164: `+91${randNum}01`,
    email: `cand_${suffix}@example.com`,
    role: 'CANDIDATE',
    status: 'ACTIVE',
    profileComplete: true,
  });

  await CandidateProfile.create({
    userId: candidate._id,
    fullName: 'Test Candidate',
    city: 'Coimbatore',
    languages: ['English', 'Tamil'],
  });

  // Volunteer 1 (will be allocated then withdraw)
  const vol1 = await User.create({
    mobileE164: `+91${randNum}02`,
    email: `vol1_${suffix}@example.com`,
    role: 'VOLUNTEER',
    status: 'ACTIVE',
    profileComplete: true,
    verificationStatus: 'VERIFIED',
  });
  await VolunteerProfile.create({
    userId: vol1._id,
    fullName: 'Volunteer Withdrawer',
    city: 'Coimbatore',
    languages: ['English', 'Tamil'],
    qualifications: [{ level: 'GRADUATE', degree: 'B.Sc', fieldOfStudy: 'Maths' }],
  });

  // Volunteer 2 (replacement volunteer)
  const vol2 = await User.create({
    mobileE164: `+91${randNum}03`,
    email: `vol2_${suffix}@example.com`,
    role: 'VOLUNTEER',
    status: 'ACTIVE',
    profileComplete: true,
    verificationStatus: 'VERIFIED',
  });
  await VolunteerProfile.create({
    userId: vol2._id,
    fullName: 'Volunteer Replacement',
    city: 'Coimbatore',
    languages: ['English', 'Tamil'],
    qualifications: [{ level: 'GRADUATE', degree: 'B.Tech', fieldOfStudy: 'IT' }],
  });

  // Examination with session
  const exam = await Examination.create({
    name: `TNPSC Group II ${suffix}`,
    authority: 'TNPSC',
    slug: `tnpsc-${suffix}`,
    startsOn: new Date('2026-12-25T04:30:00.000Z'),
    endsOn: new Date('2026-12-25T07:30:00.000Z'),
    status: 'PUBLISHED',
    locations: [{ city: 'Coimbatore', centreCount: 2 }],
    sessions: [{
      name: 'Forenoon Session',
      startsAt: new Date('2026-12-25T04:30:00.000Z'), // 10:00 AM IST
      endsAt: new Date('2026-12-25T07:30:00.000Z'),
      date: new Date('2026-12-25T00:00:00.000Z'),
    }],
  });
  const sessionId = exam.sessions[0]._id;

  // Both volunteers express interest
  await VolunteerInterest.create({ volunteerId: vol1._id, examinationId: exam._id, status: 'ACTIVE' });
  await VolunteerInterest.create({ volunteerId: vol2._id, examinationId: exam._id, status: 'ACTIVE' });

  // Candidate Scribe Request
  const req1 = await ScribeRequest.create({
    reference: `REQ-${suffix}-1`,
    candidateId: candidate._id,
    examinationId: exam._id,
    sessionId: sessionId,
    city: 'Coimbatore',
    language: 'English',
    status: 'AWAITING_VOLUNTEER',
    venue: {
      centreName: 'Govt College of Technology',
      address: 'Thadagam Road',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      pincode: '641013',
      confirmed: true,
    },
  });

  // ─── 4. Initial Allocation to Volunteer 1 ─────────────────────────────────
  console.log('\n--- 4. Initial Allocation to Volunteer 1 ---');
  const allocRes1 = await allocateScribe(req1._id, vol1._id, {
    reportingTime: '09:00 AM',
    meetingPoint: 'Main Gate Help Desk',
    reportingInstructions: 'Carry hall ticket copy.',
  }, { adminId: admin._id });

  assert(allocRes1.assignment.status === 'CONFIRMED', 'Initial allocation is CONFIRMED');
  const allocId1 = allocRes1.assignment.allocationId;
  assert(Boolean(allocId1), `Allocation ID generated: ${allocId1}`);

  // ─── 5. Volunteer 1 Withdraws ─────────────────────────────────────────────
  console.log('\n--- 5. Volunteer 1 Withdraws & Apology Notification ---');
  await cancelAssignment(allocRes1.assignment._id, vol1._id, 'VOLUNTEER', {
    reason: 'Family emergency',
    explanation: 'Unable to travel to centre',
  });

  // Verify assignment is cancelled
  const cancelledAssign = await ConfirmedAssignment.findById(allocRes1.assignment._id);
  assert(cancelledAssign.status === 'CANCELLED', 'Assignment marked as CANCELLED');

  // Verify request status is REPLACEMENT_REQUIRED
  const updatedReq1 = await ScribeRequest.findById(req1._id);
  assert(updatedReq1.status === 'REPLACEMENT_REQUIRED', `Request status updated to REPLACEMENT_REQUIRED (got: ${updatedReq1.status})`);

  // Verify candidate notification has exact required apology message
  const notif = await Notification.findOne({
    userId: candidate._id,
    type: 'VOLUNTEER_CANCELLED',
  }).sort({ createdAt: -1 });

  assert(Boolean(notif), 'Candidate notification created on volunteer withdrawal');
  const expectedMsg = 'Your allocated scribe has withdrawn from the examination commitment. The administrator will arrange a replacement scribe, and you will be notified once a new allocation is confirmed. We are sorry for the inconvenience.';
  assert(notif.body === expectedMsg, `Candidate notification body matches exact apology text`);
  assert(!notif.body.includes('Volunteer Withdrawer') && !notif.body.includes(vol1._id.toString()), 'Notification strictly conceals volunteer identity/PII');

  // ─── 6. Backend-Level Exclusion in Replacement Matching ──────────────────
  console.log('\n--- 6. Backend-Level Exclusion of Withdrawn Volunteer ---');
  const matchesForReq1 = await findPotentialMatches(req1._id);
  const eligibleVolIdsReq1 = [...matchesForReq1.eligible, ...matchesForReq1.requiresReview].map(v => v.volunteerId.toString());

  assert(!eligibleVolIdsReq1.includes(vol1._id.toString()), 'Withdrawn volunteer 1 is EXCLUDED from replacement matching results for req1');
  assert(eligibleVolIdsReq1.includes(vol2._id.toString()), 'Eligible volunteer 2 is PRESENT in replacement matching results for req1');

  // Attempting to propose withdrawn volunteer on req1 must throw 400
  let proposeBlocked = false;
  try {
    await proposeMatch(req1._id, vol1._id, 'Attempting to re-propose', {
      adminId: admin._id,
      reportingTime: '09:00 AM',
      meetingPoint: 'Gate A',
    });
  } catch (err) {
    proposeBlocked = true;
    assert(err.message.includes('previously withdrew'), `proposeMatch correctly rejected withdrawn volunteer (${err.message})`);
  }
  assert(proposeBlocked, 'proposeMatch threw error when attempting to propose withdrawn volunteer');

  // Attempting to direct-allocate withdrawn volunteer on req1 must throw 400
  let directAllocBlocked = false;
  try {
    await allocateScribe(req1._id, vol1._id, {
      reportingTime: '09:00 AM',
      meetingPoint: 'Gate A',
    }, { adminId: admin._id });
  } catch (err) {
    directAllocBlocked = true;
    assert(err.message.includes('previously withdrew'), `allocateScribe correctly rejected withdrawn volunteer (${err.message})`);
  }
  assert(directAllocBlocked, 'allocateScribe threw error when attempting to direct allocate withdrawn volunteer');

  // ─── 7. Non-Permanent Exclusion (Volunteer 1 eligible for OTHER requests) ─
  console.log('\n--- 7. Non-Permanent Exclusion (Other Requests) ---');
  // Create another candidate and request for the same exam
  const candidate2 = await User.create({
    mobileE164: `+91${randNum}04`,
    email: `cand2_${suffix}@example.com`,
    role: 'CANDIDATE',
    status: 'ACTIVE',
  });
  const req2 = await ScribeRequest.create({
    reference: `REQ-${suffix}-2`,
    candidateId: candidate2._id,
    examinationId: exam._id,
    sessionId: sessionId,
    city: 'Coimbatore',
    language: 'English',
    status: 'AWAITING_VOLUNTEER',
  });

  const matchesForReq2 = await findPotentialMatches(req2._id);
  const eligibleVolIdsReq2 = [...matchesForReq2.eligible, ...matchesForReq2.requiresReview].map(v => v.volunteerId.toString());
  assert(eligibleVolIdsReq2.includes(vol1._id.toString()), 'Volunteer 1 IS ELIGIBLE and included for unrelated request 2 (non-permanent exclusion)');

  // ─── 8. Replacement Scribe Allocation & New Allocation ID ────────────────
  console.log('\n--- 8. Replacement Allocation & New Allocation ID ---');
  const replAllocRes = await allocateScribe(req1._id, vol2._id, {
    reportingTime: '09:00 AM',
    meetingPoint: 'Main Gate Help Desk',
    reportingInstructions: 'Replacement confirmed.',
  }, { adminId: admin._id });

  assert(replAllocRes.assignment.status === 'CONFIRMED', 'Replacement assignment is CONFIRMED');
  const allocId2 = replAllocRes.assignment.allocationId;
  assert(Boolean(allocId2), `Replacement Allocation ID generated: ${allocId2}`);
  assert(allocId1 !== allocId2, `New unique Allocation ID generated (${allocId2} !== ${allocId1})`);

  // Verify previous allocation is retained in history
  const allAssignmentsForReq1 = await ConfirmedAssignment.find({ requestId: req1._id }).sort({ createdAt: 1 });
  assert(allAssignmentsForReq1.length === 2, `Both initial and replacement allocations retained in DB (found: ${allAssignmentsForReq1.length})`);
  assert(allAssignmentsForReq1[0].status === 'CANCELLED', 'Initial assignment retained with CANCELLED status');
  assert(allAssignmentsForReq1[1].status === 'CONFIRMED', 'Replacement assignment retained with CONFIRMED status');

  // Verify candidate replacement notification
  const replNotif = await Notification.findOne({
    userId: candidate._id,
    type: 'REPLACEMENT_ALLOCATED',
  }).sort({ createdAt: -1 });
  assert(Boolean(replNotif), 'Candidate received REPLACEMENT_ALLOCATED notification');
  assert(replNotif.body.includes(allocId2), 'Candidate notification includes new replacement Allocation ID');

  // ─── 9. Super-Admin Requests List Session & Examination Details ─────────
  console.log('\n--- 9. Super-Admin Requests List Session & Examination Details ---');
  const adminReqList = await listRequests({ page: 1, pageSize: 20 });
  const foundReq = adminReqList.items.find(r => r.id === req1._id.toString());
  assert(Boolean(foundReq), 'Found req1 in Super-Admin listRequests');
  assert(Boolean(foundReq.examination.startsOn), `examination.startsOn populated in admin list: ${foundReq.examination.startsOn}`);
  assert(Boolean(foundReq.session), 'session populated in admin list');
  assert(foundReq.session.name === 'Forenoon Session', `session.name correctly resolved: ${foundReq.session.name}`);

  console.log('\n============================================================');
  console.log(`🎉 ALL TESTS PASSED: ${passedTests}/${totalTests}`);
  console.log('============================================================\n');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\n❌ TEST RUNNER ERROR:', err);
  process.exit(1);
});
