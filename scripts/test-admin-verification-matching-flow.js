'use strict';

const http = require('http');
const assert = require('assert');
const { connectDB } = require('../server/config/database');
const User = require('../server/models/User');
const CandidateProfile = require('../server/models/CandidateProfile');
const VolunteerProfile = require('../server/models/VolunteerProfile');
const VerificationRecord = require('../server/models/VerificationRecord');
const Examination = require('../server/models/Examination');
const VolunteerInterest = require('../server/models/VolunteerInterest');
const ScribeRequest = require('../server/models/ScribeRequest');
const MatchProposal = require('../server/models/MatchProposal');
const ConfirmedAssignment = require('../server/models/ConfirmedAssignment');
const Notification = require('../server/models/Notification');
const RequestStatusHistory = require('../server/models/RequestStatusHistory');

const BASE_URL = 'http://localhost:3000';

function makeRequest(method, path, body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (cookie) {
      options.headers['Cookie'] = cookie;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }

        const setCookies = res.headers['set-cookie'] || [];
        const rawCookie = setCookies.length ? setCookies[0].split(';')[0] : null;

        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
          rawCookie,
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function loginUserViaOtp(mobile, role) {
  const otpSendRes = await makeRequest('POST', '/api/auth/otp/send', { mobile, role });
  assert.strictEqual(otpSendRes.status, 200, `OTP send failed for ${mobile}`);
  const devCode = otpSendRes.data?.data?.devCode;
  assert(devCode, `devCode required for ${mobile}`);

  const otpVerifyRes = await makeRequest('POST', '/api/auth/otp/verify', {
    mobile,
    role,
    code: devCode,
  });
  assert.strictEqual(otpVerifyRes.status, 200, `OTP verify failed for ${mobile}`);
  const cookie = otpVerifyRes.rawCookie;
  assert(cookie, `Cookie required for ${mobile}`);
  return { user: otpVerifyRes.data.data.user, cookie };
}

async function run() {
  await connectDB();
  console.log('Connected to MongoDB. Starting End-to-End Verification & Matching Flow Test...\n');

  const CANDIDATE_MOBILE = '+919911223344';
  const VOLUNTEER_X_MOBILE = '+919922334455';
  const VOLUNTEER_Y_MOBILE = '+919933445566';

  // ─── 0. Clean Up Any Prior Test Data ─────────────────────────────────────────
  console.log('0. Cleaning up previous test data...');
  const testMobiles = [CANDIDATE_MOBILE, VOLUNTEER_X_MOBILE, VOLUNTEER_Y_MOBILE];
  const oldUsers = await User.find({ mobileE164: { $in: testMobiles } });
  const oldUserIds = oldUsers.map((u) => u._id);

  if (oldUserIds.length > 0) {
    await ScribeRequest.deleteMany({ candidateId: { $in: oldUserIds } });
    await MatchProposal.deleteMany({
      $or: [{ candidateId: { $in: oldUserIds } }, { volunteerId: { $in: oldUserIds } }],
    });
    await ConfirmedAssignment.deleteMany({
      $or: [{ candidateId: { $in: oldUserIds } }, { volunteerId: { $in: oldUserIds } }],
    });
    await VolunteerInterest.deleteMany({ volunteerId: { $in: oldUserIds } });
    await VerificationRecord.deleteMany({ userId: { $in: oldUserIds } });
    await Notification.deleteMany({ userId: { $in: oldUserIds } });
    await CandidateProfile.deleteMany({ userId: { $in: oldUserIds } });
    await VolunteerProfile.deleteMany({ userId: { $in: oldUserIds } });
    await User.deleteMany({ _id: { $in: oldUserIds } });
  }

  // Ensure two published examinations exist
  let exam1 = await Examination.findOne({ slug: 'upsc-civil-services-prelims-2026', status: 'PUBLISHED' });
  if (!exam1) {
    exam1 = await Examination.findOne({ status: 'PUBLISHED' });
  }
  let exam2 = await Examination.findOne({ _id: { $ne: exam1._id }, status: 'PUBLISHED' });

  assert(exam1 && exam2, 'At least two published examinations must exist in DB');
  console.log(`   Exam 1: "${exam1.name || exam1.title}" (${exam1._id})`);
  console.log(`   Exam 2: "${exam2.name || exam2.title}" (${exam2._id})`);

  // ─── 1. Candidate A Registration & Profile Completion ────────────────────────
  console.log('\n1. Registering Candidate A...');
  const candAuth = await loginUserViaOtp(CANDIDATE_MOBILE, 'CANDIDATE');

  console.log('   Completing Candidate A profile...');
  const candProfileRes = await makeRequest(
    'PUT',
    '/api/profile',
    {
      fullName: 'Aarav Sharma',
      dateOfBirth: '2001-05-15',
      gender: 'MALE',
      addressLine1: '12 Anna Salai',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600002',
      languages: ['English', 'Tamil'],
      education: 'Bachelor of Arts',
      assistanceNeeds: 'Visual impairment assistance',
      disabilityCategory: 'VISUAL_IMPAIRMENT',
      disabilityPercentage: 80,
      assistanceRequired: ['SCRIBE', 'EXTRA_TIME'],
      specialNeedsDescription: 'Requires scribe fluent in English',
    },
    candAuth.cookie
  );
  assert.strictEqual(candProfileRes.status, 200, 'Candidate profile update should succeed');
  assert.strictEqual(candProfileRes.data.data.completion.isComplete, true, 'Candidate profile must be complete');

  // Verify Candidate A records in DB
  const candUser = await User.findById(candAuth.user.id);
  assert.strictEqual(candUser.profileComplete, true);
  assert.strictEqual(candUser.verificationStatus, 'PENDING');
  const candVerifs = await VerificationRecord.find({ userId: candUser._id });
  assert.strictEqual(candVerifs.length, 2, 'Candidate must have IDENTITY and ASSISTANCE_NEED verification records');
  console.log('   Candidate A profile complete, verification status = PENDING (2 records created).');

  // ─── 2. Volunteer X Registration & Profile Completion ────────────────────────
  console.log('\n2. Registering Volunteer X (matches Exam 1)...');
  const volXAuth = await loginUserViaOtp(VOLUNTEER_X_MOBILE, 'VOLUNTEER');

  console.log('   Completing Volunteer X profile...');
  const volXProfileRes = await makeRequest(
    'PUT',
    '/api/profile',
    {
      fullName: 'Priya Raman',
      dateOfBirth: '1998-08-20',
      gender: 'FEMALE',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600004',
      languages: ['English', 'Tamil'],
      subjects: ['General Studies', 'History', 'Polity'],
      hasPriorExperience: true,
      hasScribeExperience: true,
      scribeExperienceDetails: 'Supported 3 candidates in state civil services',
    },
    volXAuth.cookie
  );
  assert.strictEqual(volXProfileRes.status, 200, 'Volunteer X profile update should succeed');
  assert.strictEqual(volXProfileRes.data.data.completion.isComplete, true, 'Volunteer X profile must be complete');

  const volXUser = await User.findById(volXAuth.user.id);
  assert.strictEqual(volXUser.profileComplete, true);
  assert.strictEqual(volXUser.verificationStatus, 'PENDING');
  const volXVerifs = await VerificationRecord.find({ userId: volXUser._id });
  assert.strictEqual(volXVerifs.length, 1, 'Volunteer must have 1 IDENTITY verification record');
  console.log('   Volunteer X profile complete, verification status = PENDING (1 record created).');

  // ─── 3. Volunteer Y Registration & Profile Completion ────────────────────────
  console.log('\n3. Registering Volunteer Y (will express interest in DIFFERENT Exam 2)...');
  const volYAuth = await loginUserViaOtp(VOLUNTEER_Y_MOBILE, 'VOLUNTEER');

  const volYProfileRes = await makeRequest(
    'PUT',
    '/api/profile',
    {
      fullName: 'Vikram Mehta',
      dateOfBirth: '1999-03-10',
      gender: 'MALE',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600010',
      languages: ['English', 'Hindi'],
      subjects: ['Reasoning', 'Mathematics'],
      hasPriorExperience: true,
    },
    volYAuth.cookie
  );
  assert.strictEqual(volYProfileRes.status, 200);
  console.log('   Volunteer Y profile complete.');

  // ─── 4. Super Admin Login & Verification Approval ─────────────────────────────
  console.log('\n4. Logging in as Super Administrator...');
  const adminLoginRes = await makeRequest('POST', '/api/admin/auth/login', {
    email: 'admin@example.invalid',
    password: 'Admin@123456',
  });
  assert.strictEqual(adminLoginRes.status, 200, 'Admin login should succeed');
  const adminCookie = adminLoginRes.rawCookie;
  assert(adminCookie, 'Admin session cookie required');

  console.log('   Checking Admin Verification Metrics...');
  const metricsRes = await makeRequest('GET', '/api/admin/verifications/metrics', null, adminCookie);
  assert.strictEqual(metricsRes.status, 200);
  assert(metricsRes.data.data.totalPending >= 3, 'Must have at least 3 pending verification records');
  console.log('   Metrics:', metricsRes.data.data);

  console.log('   Approving Candidate A verification records...');
  for (const v of candVerifs) {
    const decideRes = await makeRequest(
      'POST',
      `/api/admin/verifications/${v._id}/decide`,
      { status: 'VERIFIED', reason: `Verified by Super Admin for ${v.kind}` },
      adminCookie
    );
    assert.strictEqual(decideRes.status, 200, `Approval failed for verification ${v._id}`);
  }

  const refreshedCandUser = await User.findById(candUser._id);
  assert.strictEqual(refreshedCandUser.verificationStatus, 'VERIFIED', 'Candidate A overall status must be VERIFIED');
  console.log('   Candidate A verified successfully! Verification status: VERIFIED');

  console.log('   Approving Volunteer X verification record...');
  const decideVolXRes = await makeRequest(
    'POST',
    `/api/admin/verifications/${volXVerifs[0]._id}/decide`,
    { status: 'VERIFIED', reason: 'Volunteer identity documents verified' },
    adminCookie
  );
  assert.strictEqual(decideVolXRes.status, 200);

  const refreshedVolXUser = await User.findById(volXUser._id);
  assert.strictEqual(refreshedVolXUser.verificationStatus, 'VERIFIED', 'Volunteer X overall status must be VERIFIED');
  console.log('   Volunteer X verified successfully! Verification status: VERIFIED');

  // Also approve Volunteer Y so they are a valid volunteer
  const volYVerifs = await VerificationRecord.find({ userId: volYAuth.user.id });
  for (const v of volYVerifs) {
    await makeRequest(
      'POST',
      `/api/admin/verifications/${v._id}/decide`,
      { status: 'VERIFIED', reason: 'Volunteer Y verified' },
      adminCookie
    );
  }

  // ─── 5. Examination Interests & Scribe Request ────────────────────────────────
  console.log('\n5. Creating Exam Interests & Scribe Request...');

  console.log(`   Volunteer X expressing interest in Exam 1: ${exam1.name || exam1.title}...`);
  const volXInterestRes = await makeRequest(
    'PUT',
    `/api/interests/${exam1._id}`,
    { notes: 'Available full day for this exam' },
    volXAuth.cookie
  );
  assert.strictEqual(volXInterestRes.status, 200);

  console.log(`   Volunteer Y expressing interest in Exam 2: ${exam2.name || exam2.title}...`);
  const volYInterestRes = await makeRequest(
    'PUT',
    `/api/interests/${exam2._id}`,
    { notes: 'Available for Exam 2' },
    volYAuth.cookie
  );
  assert.strictEqual(volYInterestRes.status, 200);

  console.log(`   Candidate A submitting scribe request for Exam 1: ${exam1.name || exam1.title}...`);
  const reqRes = await makeRequest(
    'POST',
    '/api/requests',
    {
      examinationId: exam1._id.toString(),
      language: 'English',
      city: 'Chennai',
      requirements: 'Candidate needs assistance with English examination paper',
    },
    candAuth.cookie
  );
  assert.strictEqual(reqRes.status, 201, 'Request creation must return 201');
  const createdReq = reqRes.data.data;
  console.log(`   Scribe request created: ${createdReq.reference} (${createdReq.id}), status: ${createdReq.status}`);

  // ─── 6. Admin Matching Inspection (CRITICAL SAME-EXAM ENFORCEMENT) ────────────
  console.log('\n6. Admin inspecting matches for Candidate A request (SAME-EXAM MATCHING CHECK)...');
  const matchesRes = await makeRequest(
    'GET',
    `/api/admin/requests/${createdReq.id}/matches`,
    null,
    adminCookie
  );
  assert.strictEqual(matchesRes.status, 200, 'Matches query must succeed');

  const { eligible, requiresReview, totalInterested } = matchesRes.data.data;
  console.log(`   Total interested in Exam 1: ${totalInterested}`);
  console.log(`   Eligible matches: ${eligible.length}, Requires review: ${requiresReview.length}`);

  // Check that Volunteer X is in eligible list
  const matchX = eligible.find((m) => m.volunteerId === volXAuth.user.id);
  assert(matchX, 'Volunteer X MUST appear in eligible matches for Exam 1!');
  assert.strictEqual(matchX.isVerified, true);
  assert.strictEqual(matchX.verificationStatus, 'VERIFIED');
  console.log(`   Volunteer X found! Compatibility Score = ${matchX.score}%`);
  console.log('   Compatibility breakdown:', matchX.scoreBreakdown);

  // Check that Volunteer Y is NOT in eligible or requiresReview
  const matchYInEligible = eligible.find((m) => m.volunteerId === volYAuth.user.id);
  const matchYInReview = requiresReview.find((m) => m.volunteerId === volYAuth.user.id);
  assert(
    !matchYInEligible && !matchYInReview,
    'Volunteer Y MUST NOT appear in matches because Volunteer Y is interested in Exam 2, NOT Exam 1!'
  );
  console.log('   VERIFIED: Volunteer Y (Exam 2) was strictly excluded from Exam 1 matches.');

  // ─── 7. Admin Proposes Match ──────────────────────────────────────────────────
  console.log('\n7. Admin proposing match with Volunteer X...');
  const proposeRes = await makeRequest(
    'POST',
    `/api/admin/requests/${createdReq.id}/propose-match`,
    {
      volunteerId: volXAuth.user.id,
      adminNote: 'Verified volunteer with strong English fluency and prior experience.',
    },
    adminCookie
  );
  assert([200, 201].includes(proposeRes.status), `Propose match must succeed, got ${proposeRes.status}`);
  const proposal = proposeRes.data.data;
  assert.strictEqual(proposal.status, 'PROPOSED');
  assert(proposal.matchReference, 'Match reference must be generated (MAT-...)');
  console.log(`   Proposal created: ${proposal.matchReference} (${proposal._id}), status: ${proposal.status}`);

  const reqAfterProposal = await ScribeRequest.findById(createdReq.id);
  assert.strictEqual(reqAfterProposal.status, 'MATCH_PROPOSED');
  console.log(`   Request status transitioned to: ${reqAfterProposal.status}`);

  // ─── 8. Volunteer X Receives & Accepts Invitation ────────────────────────────
  console.log('\n8. Volunteer X checking invitations...');
  const volInvitationsRes = await makeRequest('GET', '/api/interests/invitations', null, volXAuth.cookie);
  assert.strictEqual(volInvitationsRes.status, 200);
  const invitations = volInvitationsRes.data.data;
  assert(invitations.length >= 1, 'Volunteer X must have at least 1 invitation');
  const targetInv = invitations.find((i) => i.id === proposal._id.toString());
  assert(targetInv, 'Volunteer X must find the proposal invitation');
  console.log(`   Invitation found: ${targetInv.matchReference} for ${targetInv.examination?.name}`);

  console.log('   Volunteer X accepting invitation...');
  const acceptRes = await makeRequest(
    'POST',
    `/api/interests/invitations/${proposal._id}/accept`,
    {},
    volXAuth.cookie
  );
  assert.strictEqual(acceptRes.status, 200, 'Accepting invitation must succeed');
  console.log('   Volunteer X accepted the invitation.');

  const proposalAfterAccept = await MatchProposal.findById(proposal._id);
  assert.strictEqual(proposalAfterAccept.status, 'ACCEPTED');

  const reqAfterAccept = await ScribeRequest.findById(createdReq.id);
  assert.strictEqual(reqAfterAccept.status, 'VOLUNTEER_ACCEPTED');
  console.log(`   Request status transitioned to: ${reqAfterAccept.status}`);

  // ─── 9. Candidate A Confirms Match ───────────────────────────────────────────
  console.log('\n9. Candidate A reviewing proposed match...');
  const candMatchRes = await makeRequest(
    'GET',
    `/api/requests/${createdReq.id}/proposed-match`,
    null,
    candAuth.cookie
  );
  assert.strictEqual(candMatchRes.status, 200);
  const proposedMatchData = candMatchRes.data.data;
  assert(proposedMatchData, 'Proposed match must exist');
  assert.strictEqual(proposedMatchData.volunteer.name, 'Priya Raman');
  assert.strictEqual(proposedMatchData.volunteer.isVerified, true);
  console.log(`   Candidate saw volunteer: ${proposedMatchData.volunteer.name} (Verified: ${proposedMatchData.volunteer.isVerified})`);

  console.log('   Candidate A confirming match...');
  const confirmRes = await makeRequest(
    'POST',
    `/api/requests/${createdReq.id}/confirm-match`,
    {},
    candAuth.cookie
  );
  assert.strictEqual(confirmRes.status, 200, 'Confirming match must succeed');
  console.log('   Candidate A confirmed match!');

  // Verify DB state
  const reqAfterConfirm = await ScribeRequest.findById(createdReq.id);
  assert.strictEqual(reqAfterConfirm.status, 'CONFIRMED');

  const assignment = await ConfirmedAssignment.findOne({ requestId: createdReq.id });
  assert(assignment, 'ConfirmedAssignment must be created in DB');
  assert.strictEqual(assignment.status, 'CONFIRMED');
  assert.strictEqual(assignment.volunteerId.toString(), volXAuth.user.id);
  assert.strictEqual(assignment.candidateId.toString(), candAuth.user.id);
  console.log(`   ConfirmedAssignment created: ${assignment._id}`);

  // ─── 10. Dashboard & Assignments Parity ───────────────────────────────────────
  console.log('\n10. Checking dashboards and assignments endpoints...');

  const candAssignmentsRes = await makeRequest('GET', '/api/assignments', null, candAuth.cookie);
  assert.strictEqual(candAssignmentsRes.status, 200);
  assert(candAssignmentsRes.data.data.length >= 1, 'Candidate must have confirmed assignment');
  assert.strictEqual(candAssignmentsRes.data.data[0].volunteerName, 'Priya Raman');

  const volAssignmentsRes = await makeRequest('GET', '/api/assignments', null, volXAuth.cookie);
  assert.strictEqual(volAssignmentsRes.status, 200);
  assert(volAssignmentsRes.data.data.length >= 1, 'Volunteer must have confirmed commitment');
  assert.strictEqual(volAssignmentsRes.data.data[0].candidateName, 'Aarav Sharma');

  const candDashRes = await makeRequest('GET', '/api/dashboard', null, candAuth.cookie);
  assert.strictEqual(candDashRes.status, 200);
  assert.strictEqual(candDashRes.data.data.stats.confirmedArrangements, 1);

  const volDashRes = await makeRequest('GET', '/api/dashboard', null, volXAuth.cookie);
  assert.strictEqual(volDashRes.status, 200);
  assert.strictEqual(volDashRes.data.data.stats.confirmedCommitments, 1);

  console.log('\n===============================================================');
  console.log(' ALL VERIFICATION & MATCHING WORKFLOW TESTS PASSED 100%! ');
  console.log('===============================================================\n');

  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
