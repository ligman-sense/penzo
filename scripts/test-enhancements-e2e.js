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
const { checkUnresolvedRequests } = require('../server/services/alertSchedulerService');

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
  const u = otpVerifyRes.data.data.user;
  const userId = u.id || u._id;
  return { user: { ...u, _id: userId, id: userId }, cookie };
}

async function run() {
  await connectDB();
  console.log('Connected to MongoDB. Starting Complete Enhancements E2E Test Suite...\n');

  const CANDIDATE_A_MOBILE = '+919900000001';
  const CANDIDATE_B_MOBILE = '+919900000002';
  const CANDIDATE_C_MOBILE = '+919900000004';
  const VOLUNTEER_1_MOBILE = '+919900000003';
  const testMobiles = [CANDIDATE_A_MOBILE, CANDIDATE_B_MOBILE, CANDIDATE_C_MOBILE, VOLUNTEER_1_MOBILE];

  // Clean prior test data
  console.log('Cleaning up previous test data...');
  await Examination.deleteMany({ slug: 'upsc-prelims-2026-test' });
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

  // Admin login
  console.log('Logging in as Super Admin...');
  const adminLoginRes = await makeRequest('POST', '/api/admin/auth/login', {
    email: 'admin@example.invalid',
    password: 'Admin@123456',
  });
  assert.strictEqual(adminLoginRes.status, 200, 'Admin login failed');
  const adminCookie = adminLoginRes.rawCookie;

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST A: Candidate Profile (Qualification & Currently Pursuing)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST A: Candidate Profile (Qualification & Currently Pursuing) ===');
  const { user: candA, cookie: candACookie } = await loginUserViaOtp(CANDIDATE_A_MOBILE, 'CANDIDATE');

  // A1: Conditional validation - both empty should fail with 400
  console.log('   A1. Testing failure when both qualification & currentlyPursuing are omitted/empty...');
  const failProfileRes = await makeRequest('PUT', '/api/profile', {
    fullName: 'Candidate Alpha',
    qualification: '',
    currentlyPursuing: 'Not Currently Pursuing Any Course',
    languages: ['English', 'Tamil'],
    city: 'Coimbatore',
    assistanceNeeds: 'Visual Assistance',
  }, candACookie);
  assert.strictEqual(failProfileRes.status, 400, 'Expected 400 when qualification is missing and not currently pursuing');
  console.log('       ✓ Correctly rejected with 400 when not currently pursuing and qualification is empty');

  // A2: If currentlyPursuing is filled, qualification is optional
  console.log('   A2. Testing qualification optional when currentlyPursuing is filled...');
  const pursuingProfileRes = await makeRequest('PUT', '/api/profile', {
    fullName: 'Candidate Alpha',
    qualification: '',
    currentlyPursuing: 'Currently Pursuing MCA',
    languages: ['English', 'Tamil'],
    city: 'Coimbatore',
    assistanceNeeds: 'Visual Assistance',
  }, candACookie);
  assert.strictEqual(pursuingProfileRes.status, 200, 'Expected 200 when currentlyPursuing is provided');
  assert.strictEqual(pursuingProfileRes.data.data.profile.currentlyPursuing, 'Currently Pursuing MCA');
  console.log('       ✓ Profile saved successfully with Currently Pursuing MCA and empty qualification');

  // A3: Save with both completed qualification and currently pursuing
  console.log('   A3. Saving full profile with completed qualification (BCA) and currently pursuing (MCA)...');
  const fullProfileRes = await makeRequest('PUT', '/api/profile', {
    fullName: 'Candidate Alpha',
    qualification: 'BCA',
    currentlyPursuing: 'Currently Pursuing MCA',
    languages: ['English', 'Tamil'],
    city: 'Coimbatore',
    assistanceNeeds: 'Visual Assistance and Extra Time',
  }, candACookie);
  assert.strictEqual(fullProfileRes.status, 200);
  const candAProfile = fullProfileRes.data.data.profile;
  assert.strictEqual(candAProfile.qualification, 'BCA');
  assert.strictEqual(candAProfile.currentlyPursuing, 'Currently Pursuing MCA');
  assert.strictEqual(candAProfile.education, 'BCA', 'Legacy education field must match qualification');
  console.log('       ✓ Profile saved with qualification=BCA, currentlyPursuing=Currently Pursuing MCA, education=BCA');

  // Verify Candidate A
  await User.updateOne({ _id: candA._id }, { verificationStatus: 'VERIFIED', profileComplete: true });

  // ─────────────────────────────────────────────────────────────────────────────
  // Create / Verify Test Examination
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nSetting up test examination with sessions...');
  let testExam = await Examination.findOne({ slug: 'tnpsc-group-2-2026' });
  if (!testExam) {
    testExam = await Examination.create({
      name: 'TNPSC Group II Examination 2026',
      title: 'TNPSC Group II Examination 2026',
      slug: 'tnpsc-group-2-2026',
      authority: 'Tamil Nadu Public Service Commission',
      startsOn: new Date('2026-12-15T09:00:00.000Z'),
      endsOn: new Date('2026-12-15T12:30:00.000Z'),
      locations: [{ city: 'Coimbatore', state: 'Tamil Nadu' }],
      sessions: [
        {
          name: 'Morning Session',
          label: 'Morning Session (09:00 - 12:30)',
          startsAt: new Date('2026-12-15T09:00:00.000Z'),
          endsAt: new Date('2026-12-15T12:30:00.000Z'),
        },
        {
          name: 'Afternoon Session',
          label: 'Afternoon Session (14:30 - 17:30)',
          startsAt: new Date('2026-12-15T14:30:00.000Z'),
          endsAt: new Date('2026-12-15T17:30:00.000Z'),
        },
      ],
      status: 'PUBLISHED',
      isPublished: true,
    });
  }

  const morningSession = testExam.sessions[0];
  const afternoonSession = testExam.sessions[1];

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST B: Exact Examination Venue Submission
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST B: Exact Examination Venue Submission ===');
  const reqVenuePayload = {
    examinationId: testExam._id.toString(),
    sessionId: morningSession._id.toString(),
    city: 'Coimbatore',
    language: 'English',
    requirements: 'Visual assistance and scribe dictation',
    venue: {
      centreName: 'Government Model Higher Secondary School',
      address: '124 College Road, Gandhipuram',
      area: 'Gandhipuram',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      pincode: '641012',
      landmark: 'Opposite Central City Bus Terminal',
      mapLink: 'https://maps.google.com/?q=Govt+Model+HSS+Coimbatore',
    },
  };

  const createReqRes = await makeRequest('POST', '/api/requests', reqVenuePayload, candACookie);
  assert.strictEqual(createReqRes.status, 201, 'Request creation failed');
  const requestA = createReqRes.data.data;
  assert(requestA.id, 'Request ID required');
  assert(requestA.venue, 'Venue must be returned in created request');
  assert.strictEqual(requestA.venue.centreName, 'Government Model Higher Secondary School');
  assert.strictEqual(requestA.venue.confirmed, false, 'Venue must initially be unconfirmed');
  console.log('   ✓ Candidate submitted request with exact examination venue details (confirmed=false)');

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST C: Volunteer Interest
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST C: Volunteer Interest ===');
  const { user: vol1, cookie: vol1Cookie } = await loginUserViaOtp(VOLUNTEER_1_MOBILE, 'VOLUNTEER');

  // Complete Volunteer Profile
  await makeRequest('PUT', '/api/profile', {
    fullName: 'Volunteer Suresh',
    education: 'B.E. Computer Science',
    languages: ['English', 'Tamil'],
    city: 'Coimbatore',
    hasPriorExperience: true,
  }, vol1Cookie);

  await User.updateOne({ _id: vol1._id }, { verificationStatus: 'VERIFIED', profileComplete: true });

  // Volunteer expresses interest
  const interestRes = await makeRequest('PUT', `/api/interests/${testExam._id}`, {
    availabilityConfirmed: true,
    locationConfirmed: true,
    languagesConfirmed: true,
    qualificationsConfirmed: true,
  }, vol1Cookie);
  assert.strictEqual(interestRes.status, 200, 'Volunteer interest should succeed');
  console.log('   ✓ Volunteer Suresh expressed interest for TNPSC Group II Examination');

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST D: Admin Matching & Venue Management
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST D: Admin Matching & Venue Management ===');

  // D1: Proposing before venue is confirmed must fail with 400
  console.log('   D1. Attempting to propose match BEFORE venue is confirmed...');
  const proposeUnconfirmedRes = await makeRequest('POST', `/api/admin/requests/${requestA.id}/propose-match`, {
    volunteerId: vol1._id.toString(),
  }, adminCookie);
  assert.strictEqual(proposeUnconfirmedRes.status, 400, 'Should reject proposing when venue is unconfirmed');
  const errMsg = proposeUnconfirmedRes.data?.error?.message || proposeUnconfirmedRes.data?.message;
  assert(errMsg.includes('venue must be confirmed'), `Expected venue error message, got: ${errMsg}`);
  console.log('       ✓ Proposing correctly blocked because venue is unconfirmed');

  // D2: Admin confirms the venue
  console.log('   D2. Admin confirms the examination venue...');
  const confirmVenueRes = await makeRequest('POST', `/api/admin/requests/${requestA.id}/confirm-venue`, {}, adminCookie);
  assert.strictEqual(confirmVenueRes.status, 200, 'Venue confirmation should succeed');
  assert.strictEqual(confirmVenueRes.data.data.venue.confirmed, true);
  console.log('       ✓ Examination venue confirmed by Super Administrator');

  // D3: Admin proposes match with confirmed venue (unified propose workflow)
  console.log('   D3. Admin proposes volunteer match using unified proposal button...');
  const proposeRes = await makeRequest('POST', `/api/admin/requests/${requestA.id}/propose-match`, {
    volunteerId: vol1._id.toString(),
    note: 'Please bring your hall pass and photo ID.',
  }, adminCookie);
  assert.strictEqual(proposeRes.status, 201, 'Match proposal should succeed');
  const proposalA = proposeRes.data.data;
  assert(proposalA.matchReference, 'matchReference required');
  assert.strictEqual(proposalA.status, 'PROPOSED');
  console.log(`       ✓ Match proposed successfully with reference: ${proposalA.matchReference}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST E: Volunteer Acceptance & Commitment Terms
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST E: Volunteer Acceptance & Commitment Terms ===');

  // E1: Volunteer fetches invitations and verifies exact venue is visible
  const volInvitationsRes = await makeRequest('GET', '/api/interests/invitations', null, vol1Cookie);
  assert.strictEqual(volInvitationsRes.status, 200);
  const invitations = volInvitationsRes.data.data || volInvitationsRes.data;
  const targetInv = invitations.find((i) => i.id === proposalA._id || i.id === proposalA.id);
  assert(targetInv, 'Volunteer invitation must be in list');
  assert(targetInv.request.venue, 'Venue must be visible to volunteer before accepting');
  assert.strictEqual(targetInv.request.venue.centreName, 'Government Model Higher Secondary School');
  console.log('   E1. ✓ Volunteer views exact examination venue in invitation details');

  // E2: Attempt to accept WITHOUT terms -> must fail with 400
  console.log('   E2. Volunteer attempts to accept without terms consent...');
  const noTermsAcceptRes = await makeRequest('POST', `/api/interests/invitations/${targetInv.id}/accept`, {}, vol1Cookie);
  assert.strictEqual(noTermsAcceptRes.status, 400, 'Acceptance without terms must fail');
  console.log('       ✓ Acceptance blocked when terms consent is not provided');

  // E3: Accept with terms agreement
  console.log('   E3. Volunteer accepts Volunteer Commitment Agreement...');
  const acceptRes = await makeRequest('POST', `/api/interests/invitations/${targetInv.id}/accept`, {
    termsAccepted: true,
    termsVersion: '1.0',
  }, vol1Cookie);
  assert.strictEqual(acceptRes.status, 200, 'Acceptance with terms should succeed');
  const acceptedProposal = await MatchProposal.findById(targetInv.id);
  assert.strictEqual(acceptedProposal.status, 'ACCEPTED');
  assert.strictEqual(acceptedProposal.termsAccepted, true);
  assert.strictEqual(acceptedProposal.termsVersion, '1.0');
  console.log('       ✓ Volunteer Commitment Agreement accepted and recorded in MongoDB');

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST F: Candidate Confirmation & ConfirmedAssignment
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST F: Candidate Confirmation & ConfirmedAssignment ===');
  const confirmMatchRes = await makeRequest('POST', `/api/requests/${requestA.id}/confirm-match`, {}, candACookie);
  assert.strictEqual(confirmMatchRes.status, 200, 'Candidate confirmation should succeed');

  const assignmentA = await ConfirmedAssignment.findOne({ requestId: requestA.id });
  assert(assignmentA, 'ConfirmedAssignment must be created in MongoDB');
  assert.strictEqual(assignmentA.status, 'CONFIRMED');
  assert(assignmentA.lockDeadline, 'Lock deadline must be set');
  console.log(`   ✓ Assignment confirmed! Lock deadline: ${assignmentA.lockDeadline.toISOString()}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST G: Volunteer Double-Booking Prevention
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST G: Volunteer Double-Booking Prevention ===');

  // G1: Register Candidate B requesting the SAME exam and overlapping morning session
  const { user: candB, cookie: candBCookie } = await loginUserViaOtp(CANDIDATE_B_MOBILE, 'CANDIDATE');
  await makeRequest('PUT', '/api/profile', {
    fullName: 'Candidate Beta',
    qualification: 'B.Sc.',
    currentlyPursuing: 'Not Currently Pursuing Any Course',
    languages: ['English'],
    city: 'Coimbatore',
    assistanceNeeds: 'Mobility assistance',
  }, candBCookie);
  await User.updateOne({ _id: candB._id }, { verificationStatus: 'VERIFIED', profileComplete: true });

  const reqBRes = await makeRequest('POST', '/api/requests', {
    examinationId: testExam._id.toString(),
    sessionId: morningSession._id.toString(), // Overlapping 09:00 - 12:30
    city: 'Coimbatore',
    language: 'English',
    requirements: 'Scribe assistance',
    venue: {
      centreName: 'Stanes Anglo Indian School',
      address: 'Trichy Road',
      city: 'Coimbatore',
      confirmed: true,
    },
  }, candBCookie);
  assert.strictEqual(reqBRes.status, 201);
  const requestB = reqBRes.data.data;
  await ScribeRequest.updateOne({ _id: requestB.id }, { 'venue.confirmed': true });

  // G2: Admin tries to propose Volunteer Suresh for Candidate B (overlapping session)
  console.log('   G2. Admin attempts to propose Volunteer Suresh for an overlapping morning session...');
  const overlapProposeRes = await makeRequest('POST', `/api/admin/requests/${requestB.id}/propose-match`, {
    volunteerId: vol1._id.toString(),
  }, adminCookie);
  assert.strictEqual(overlapProposeRes.status, 409, 'Overlapping propose must return 409');
  const overlapErrMsg = overlapProposeRes.data?.error?.message || overlapProposeRes.data?.message;
  assert(overlapErrMsg.includes('already have a confirmed examination assignment'), `Expected conflict message, got: ${overlapErrMsg}`);
  console.log('       ✓ Overlapping proposal correctly blocked with 409 Conflict:');
  console.log(`         "${overlapErrMsg}"`);

  // G3: Test genuinely non-overlapping session on the same date (Afternoon Session 14:30 - 17:30)
  console.log('   G3. Testing genuinely non-overlapping session on the same date (Afternoon 14:30 - 17:30)...');
  const { user: candC, cookie: candCCookie } = await loginUserViaOtp(CANDIDATE_C_MOBILE, 'CANDIDATE');
  await makeRequest('PUT', '/api/profile', {
    fullName: 'Candidate Gamma',
    qualification: 'B.Com.',
    currentlyPursuing: 'Not Currently Pursuing Any Course',
    languages: ['English'],
    city: 'Coimbatore',
    assistanceNeeds: 'Dictation assistance',
  }, candCCookie);
  await User.updateOne({ _id: candC._id }, { verificationStatus: 'VERIFIED', profileComplete: true });

  const reqCRes = await makeRequest('POST', '/api/requests', {
    examinationId: testExam._id.toString(),
    sessionId: afternoonSession._id.toString(), // 14:30 - 17:30 (Non-overlapping, satisfies 45m buffer)
    city: 'Coimbatore',
    language: 'English',
    requirements: 'Scribe assistance',
    venue: {
      centreName: 'PSG College of Technology',
      address: 'Avinashi Road, Peelamedu',
      city: 'Coimbatore',
      confirmed: true,
    },
  }, candCCookie);
  assert.strictEqual(reqCRes.status, 201, `Candidate C request creation failed: ${JSON.stringify(reqCRes.data)}`);
  const requestC = reqCRes.data.data;
  await ScribeRequest.updateOne({ _id: requestC.id }, { 'venue.confirmed': true });

  const nonOverlapProposeRes = await makeRequest('POST', `/api/admin/requests/${requestC.id}/propose-match`, {
    volunteerId: vol1._id.toString(),
  }, adminCookie);
  assert.strictEqual(nonOverlapProposeRes.status, 201, `Non-overlapping propose failed: ${JSON.stringify(nonOverlapProposeRes.data)}`);
  console.log('       ✓ Non-overlapping afternoon session proposal succeeded without false block');

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST H: Five-Day Commitment Lock & Emergency Cancellation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST H: Five-Day Commitment Lock & Emergency Cancellation ===');

  // H1: Before lock deadline: standard cancellation works
  console.log('   H1. Testing standard cancellation BEFORE the 5-day lock deadline...');
  // Create test assignment 10 days in the future
  const futureAssignment = await ConfirmedAssignment.create({
    requestId: requestA.id,
    candidateId: candA._id,
    volunteerId: vol1._id,
    startsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days away
    lockDeadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    isLocked: false,
    status: 'CONFIRMED',
  });

  const normalCancelRes = await makeRequest('POST', `/api/assignments/${futureAssignment._id}/cancel`, {
    isEmergency: false,
    reason: 'Schedule adjustment needed',
  }, vol1Cookie);
  assert.strictEqual(normalCancelRes.status, 200, 'Ordinary cancellation before deadline should succeed');
  const cancelledA = await ConfirmedAssignment.findById(futureAssignment._id);
  assert.strictEqual(cancelledA.status, 'CANCELLED');
  assert.strictEqual(cancelledA.isEmergencyCancelled, false);
  console.log('       ✓ Standard cancellation succeeded before lock deadline');

  // H2: Locked assignment within 5 days
  console.log('   H2. Testing locked assignment within 5 days of examination...');
  const lockedAssignment = await ConfirmedAssignment.create({
    requestId: requestA.id,
    candidateId: candA._id,
    volunteerId: vol1._id,
    startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days away (locked!)
    lockDeadline: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // deadline passed 3 days ago
    isLocked: true,
    status: 'CONFIRMED',
  });

  // H3: Attempt ordinary cancellation when locked -> must fail
  console.log('   H3. Attempting ordinary cancellation when locked...');
  const lockedNormalCancelRes = await makeRequest('POST', `/api/assignments/${lockedAssignment._id}/cancel`, {
    isEmergency: false,
    reason: 'Personal work',
  }, vol1Cookie);
  assert.strictEqual(lockedNormalCancelRes.status, 400, 'Ordinary cancellation when locked must return 400');
  console.log('       ✓ Ordinary cancellation blocked because commitment is locked');

  // H4: Attempt emergency cancellation without explanation -> must fail
  console.log('   H4. Attempting emergency cancellation without required explanation...');
  const failEmergRes = await makeRequest('POST', `/api/assignments/${lockedAssignment._id}/cancel`, {
    isEmergency: true,
    reason: 'Medical Emergency',
    explanation: '',
  }, vol1Cookie);
  assert.strictEqual(failEmergRes.status, 400, 'Missing explanation must return 400');
  console.log('       ✓ Emergency cancellation blocked when explanation is missing');

  // H5: Submit valid emergency cancellation
  console.log('   H5. Submitting valid emergency cancellation with reason and explanation...');
  const validEmergRes = await makeRequest('POST', `/api/assignments/${lockedAssignment._id}/cancel`, {
    isEmergency: true,
    reason: 'Medical Emergency',
    explanation: 'Sudden high fever and hospitalization. Doctor advised complete rest.',
  }, vol1Cookie);
  assert.strictEqual(validEmergRes.status, 200, 'Valid emergency cancellation must succeed');

  const afterEmergAssignment = await ConfirmedAssignment.findById(lockedAssignment._id);
  assert.strictEqual(afterEmergAssignment.status, 'CANCELLED');
  assert.strictEqual(afterEmergAssignment.isEmergencyCancelled, true);
  assert.strictEqual(afterEmergAssignment.cancellationReason, 'Medical Emergency');
  assert(afterEmergAssignment.cancellationExplanation.includes('hospitalization'));

  const reqAfterEmerg = await ScribeRequest.findById(requestA.id);
  assert.strictEqual(reqAfterEmerg.status, 'REPLACEMENT_REQUIRED', 'Request status must transition to REPLACEMENT_REQUIRED');
  console.log('       ✓ Emergency cancellation recorded with reason & explanation');
  console.log('       ✓ Request status transitioned to REPLACEMENT_REQUIRED');

  // Verify candidate notification
  const candNotifs = await Notification.find({ userId: candA._id }).sort({ createdAt: -1 });
  assert(candNotifs.some(n => n.title.includes('Replacement Required')), 'Candidate must receive replacement required alert');
  console.log('       ✓ Candidate received urgent replacement notification');

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST I: Two-Day Admin Alert Scheduler
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== TEST I: Two-Day Admin Alert Scheduler ===');

  // Create an unresolved request scheduled 36 hours from now
  const unresolvedExam = await Examination.create({
    name: 'UPSC Civil Services Preliminary 2026',
    title: 'UPSC Civil Services Preliminary 2026',
    slug: 'upsc-prelims-2026-test',
    authority: 'Union Public Service Commission',
    startsOn: new Date(Date.now() + 36 * 60 * 60 * 1000), // 36 hours from now
    status: 'PUBLISHED',
    isPublished: true,
  });

  const unresolvedReq = await ScribeRequest.create({
    candidateId: candA._id,
    examinationId: unresolvedExam._id,
    reference: 'REQ-UPSC-UNRESOLVED',
    status: 'AWAITING_VOLUNTEER',
    language: 'English',
    city: 'Coimbatore',
    venue: {
      centreName: 'Kendriya Vidyalaya Sulur',
      city: 'Coimbatore',
      confirmed: false,
    },
    submittedAt: new Date(),
  });

  console.log('   Running alert check for unresolved request at 36 hours before exam...');
  const alertResult1 = await checkUnresolvedRequests();
  assert(alertResult1.alerted > 0, 'Should generate alert for unresolved request within 48h');
  console.log(`   ✓ Scheduler executed: ${alertResult1.alerted} alerts triggered`);

  const updatedUnresolvedReq = await ScribeRequest.findById(unresolvedReq._id);
  assert(updatedUnresolvedReq.twoDayAlertSentAt, 'twoDayAlertSentAt must be set');
  assert(updatedUnresolvedReq.twoDayAlertCandidateSentAt, 'twoDayAlertCandidateSentAt must be set');

  // Verify admin notification in DB
  const adminAlert = await Notification.findOne({
    adminAlert: true,
    type: 'TWO_DAY_UNRESOLVED_ALERT',
    requestId: unresolvedReq._id,
  });
  assert(adminAlert, 'Admin alert notification must be created');
  assert(adminAlert.body.includes('URGENT: A candidate\'s scribe request remains unresolved'));
  console.log('   ✓ Admin alert stored with exact required format and urgent notice');

  // Verify candidate notification in DB
  const candAlert = await Notification.findOne({
    userId: candA._id,
    type: 'TWO_DAY_UNRESOLVED_UPDATE',
    requestId: unresolvedReq._id,
  });
  assert(candAlert, 'Candidate notification must be created');
  assert(candAlert.body.includes('Your scribe request for the upcoming examination is still being coordinated'));
  console.log('   ✓ Candidate received honest coordination notification');

  // Verify Idempotency: Running scheduler again should not produce duplicate alerts
  console.log('   Testing idempotency: Running scheduler again...');
  const alertResult2 = await checkUnresolvedRequests();
  const duplicateAlerts = await Notification.countDocuments({
    adminAlert: true,
    requestId: unresolvedReq._id,
  });
  assert.strictEqual(duplicateAlerts, 1, 'Duplicate admin alert must NOT be created');
  console.log('   ✓ Scheduler is strictly idempotent (no duplicate alerts produced)');

  console.log('\n=============================================================');
  console.log(' ALL TESTS (A THROUGH I) PASSED WITH 100% SUCCESS!');
  console.log('=============================================================\n');

  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
