'use strict';

/**
 * PENZO — Automated Verification Suite for 8 Updated Requirements
 *
 * Requirements Verified:
 * 1. Remove candidate acceptance/rejection of allocated scribes (Auto-confirm)
 * 2. Maintain complete privacy between candidates and scribes (No PII leakage)
 * 3. Make mobile number mandatory in user profiles & profile completion
 * 4. Fix examination date displaying as TBD in scribe request details (DD/MM/YYYY in IST)
 * 5. Fix infinite loading on volunteer Confirmed Commitments page & 4 UI states
 * 6. Fix My Expressed Interests page in volunteer portal & persistence
 * 7. Profile read-only default, dynamic auto-save, and hide progress bar at 100%
 * 8. Secure password change & Forgot Password via Resend (OTP, limits, hashing)
 */

const http = require('http');
const fs = require('fs');
const mongoose = require('mongoose');
const { createApp } = require('../server/app');
const { connectDB } = require('../server/config/database');
const { candidateCompletion, volunteerCompletion } = require('../server/services/profileCompletion');
const { validatePasswordPolicy, hashPassword, verifyPassword } = require('../server/utils/password');

const User = require('../server/models/User');
const CandidateProfile = require('../server/models/CandidateProfile');
const VolunteerProfile = require('../server/models/VolunteerProfile');
const Examination = require('../server/models/Examination');
const ScribeRequest = require('../server/models/ScribeRequest');
const MatchProposal = require('../server/models/MatchProposal');
const ConfirmedAssignment = require('../server/models/ConfirmedAssignment');
const VolunteerInterest = require('../server/models/VolunteerInterest');
const PasswordResetChallenge = require('../server/models/PasswordResetChallenge');

let server;
let port;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function req(method, path, body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (postData) headers['Content-Length'] = Buffer.byteLength(postData);
    if (cookie) headers['Cookie'] = cookie;

    const r = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            json = raw;
          }
          const setCookieHeaders = res.headers['set-cookie'] || [];
          let sessionCookie = null;
          for (const c of setCookieHeaders) {
            if (c.startsWith('penzo_session=')) {
              sessionCookie = c.split(';')[0];
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, body: json, sessionCookie });
        });
      }
    );
    r.on('error', reject);
    if (postData) r.write(postData);
    r.end();
  });
}

async function runTests() {
  console.log('\n============================================================');
  console.log(' PENZO EIGHT UPDATED REQUIREMENTS VERIFICATION SUITE');
  console.log('============================================================\n');

  const utilsCode = fs.readFileSync('public/js/utils.js', 'utf8');
  const { formatDate, formatDateTime } = await import('data:text/javascript,' + encodeURIComponent(utilsCode));

  await connectDB();
  console.log(`MongoDB connected: ${mongoose.connection.client.s.url}`);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      console.log(`Test server running on port ${port}\n`);
      resolve();
    });
  });

  const testId = Date.now();
  const candidateEmail = `req_cand_${testId}@example.com`;
  const candidateMobile = `+9198765${String(testId).slice(-5)}`;
  const volunteerEmail = `req_vol_${testId}@example.com`;
  const volunteerMobile = `+9197654${String(testId).slice(-5)}`;
  const strongPassword = 'Password@123';

  let candidateCookie = null;
  let volunteerCookie = null;
  let candidateUser = null;
  let volunteerUser = null;
  let testExam = null;
  let testRequest = null;
  let testAssignment = null;

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // SETUP: Create Candidate, Volunteer, Examination
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Setup: Test Accounts & Data ---');

    // Register Candidate
    const candReg = await req('POST', '/api/auth/register', {
      role: 'CANDIDATE',
      identifierType: 'EMAIL',
      identifier: candidateEmail,
      password: strongPassword,
      name: 'Test Candidate',
    });
    candidateCookie = candReg.sessionCookie;
    candidateUser = await User.findOne({ email: candidateEmail });
    assert(candReg.status === 200 && candidateUser, 'Candidate registered successfully');

    // Update candidate mobile
    await req('PUT', '/api/profile', {
      mobile: candidateMobile,
      city: 'Coimbatore',
      languages: ['English', 'Tamil'],
      education: 'Undergraduate',
      assistanceNeeds: 'Assistance in writing mathematics exam',
    }, candidateCookie);

    // Register Volunteer
    const volReg = await req('POST', '/api/auth/register', {
      role: 'VOLUNTEER',
      identifierType: 'EMAIL',
      identifier: volunteerEmail,
      password: strongPassword,
      name: 'Test Volunteer',
    });
    volunteerCookie = volReg.sessionCookie;
    volunteerUser = await User.findOne({ email: volunteerEmail });
    assert(volReg.status === 200 && volunteerUser, 'Volunteer registered successfully');

    // Update volunteer profile
    await req('PUT', '/api/profile', {
      mobile: volunteerMobile,
      city: 'Coimbatore',
      languages: ['English', 'Tamil'],
      education: 'Graduate',
      subjects: ['Mathematics', 'Science'],
    }, volunteerCookie);

    // Create Test Examination with sessions
    testExam = await Examination.create({
      code: `EXAM_${testId}`,
      slug: `exam-slug-${testId}`,
      name: `State Civil Examination ${testId}`,
      examLevel: 'STATE',
      startsOn: new Date('2026-12-15T09:30:00.000Z'),
      endsOn: new Date('2026-12-15T12:30:00.000Z'),
      locations: [{
        centreName: 'PSG Tech Exam Centre',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        venueDetails: 'Hall 302, Block A',
      }],
      sessions: [{
        startsAt: new Date('2026-12-15T09:30:00.000Z'),
        endsAt: new Date('2026-12-15T12:30:00.000Z'),
        label: 'Morning Session',
      }],
      registrationDeadline: new Date('2026-12-10T23:59:59.000Z'),
      status: 'PUBLISHED',
    });
    assert(testExam && testExam._id, 'Test Examination created with valid start date & sessions');

    // ──────────────────────────────────────────────────────────────────────────
    // REQUIREMENT 1: Auto-Confirm Assignment Without Candidate Acceptance
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Requirement 1: Scribe Auto-Confirm & Candidate Rejection Disabled ---');

    testRequest = await ScribeRequest.create({
      reference: `REQ_${testId}`,
      candidateId: candidateUser._id,
      examinationId: testExam._id,
      sessionId: testExam.sessions[0]._id,
      status: 'MATCH_PROPOSED',
      city: 'Coimbatore',
      requiredLanguages: ['English', 'Tamil'],
      requirements: 'Requires scribe for 3 hour written exam',
      examinationDetails: {
        startsAt: new Date('2026-12-15T09:30:00.000Z'),
        endsAt: new Date('2026-12-15T12:30:00.000Z'),
        centreName: 'PSG Tech Exam Centre',
        city: 'Coimbatore',
      },
      invitedVolunteers: [{
        volunteerId: volunteerUser._id,
        status: 'PENDING',
        invitedAt: new Date(),
      }],
    });
    assert(testRequest && testRequest._id, 'Initial scribe request created');

    const testProposal = await MatchProposal.create({
      requestId: testRequest._id,
      volunteerId: volunteerUser._id,
      candidateId: candidateUser._id,
      examinationId: testExam._id,
      matchReference: `MAT_${testId}`,
      score: 95,
      status: 'PROPOSED',
      invitedAt: new Date(),
    });
    assert(testProposal && testProposal._id, 'MatchProposal created for volunteer');

    // Volunteer accepts invitation via matchingService
    const { acceptInvitation } = require('../server/services/matchingService');
    const acceptRes = await acceptInvitation(
      testProposal._id.toString(),
      volunteerUser._id.toString(),
      { termsAccepted: true, termsVersion: '1.0' }
    );

    assert(acceptRes.assignment !== null, 'ConfirmedAssignment record is created automatically');

    const updatedRequest = await ScribeRequest.findById(testRequest._id);
    assert(updatedRequest.status === 'CONFIRMED', 'ScribeRequest status is directly CONFIRMED (no AWAITING_CANDIDATE_CONFIRMATION)');

    testAssignment = await ConfirmedAssignment.findOne({ requestId: testRequest._id });
    assert(testAssignment && testAssignment.status === 'CONFIRMED', 'ConfirmedAssignment status is CONFIRMED');
    assert(testAssignment.volunteerId.toString() === volunteerUser._id.toString(), 'Assignment points to accepted volunteer');

    // Verify candidate accept / reject routes return 400 Bad Request
    const candAccept = await req('POST', `/api/requests/${testRequest._id}/confirm-match`, {}, candidateCookie);
    assert(candAccept.status === 400, 'Candidate POST /:id/confirm-match is disabled and returns 400 Bad Request');

    const candDecline = await req('POST', `/api/requests/${testRequest._id}/decline-match`, {}, candidateCookie);
    assert(candDecline.status === 400, 'Candidate POST /:id/decline-match is disabled and returns 400 Bad Request');

    // ──────────────────────────────────────────────────────────────────────────
    // REQUIREMENT 2: Complete Privacy Between Candidate and Volunteer
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Requirement 2: Strict Privacy Between Candidate and Scribe ---');

    // Candidate retrieves request details
    const candReqDetails = await req('GET', `/api/requests/${testRequest._id}`, null, candidateCookie);
    assert(candReqDetails.status === 200, 'Candidate retrieves request details');
    const candData = candReqDetails.body.data;
    assert(!candData.volunteerName && !candData.volunteerMobile && !candData.volunteerEmail, 'Candidate response contains no volunteer name, mobile, or email');
    assert(!candData.proposedMatch, 'Candidate response does not leak proposedMatch volunteer PII');

    // Volunteer retrieves confirmed commitments
    const volCommitments = await req('GET', '/api/assignments', null, volunteerCookie);
    assert(volCommitments.status === 200, 'Volunteer retrieves confirmed commitments (GET /api/assignments)');
    const commitments = Array.isArray(volCommitments.body.data) ? volCommitments.body.data : (volCommitments.body.data?.assignments || []);
    assert(commitments.length > 0, 'Volunteer has at least 1 confirmed commitment');
    const firstComm = commitments[0];
    assert(!firstComm.candidateName, 'Volunteer commitment does NOT expose candidateName');
    assert(!firstComm.candidateMobile, 'Volunteer commitment does NOT expose candidateMobile');
    assert(!firstComm.candidateEmail, 'Volunteer commitment does NOT expose candidateEmail');
    assert(!firstComm.requirements, 'Volunteer commitment does NOT expose candidate medical/disability requirements');

    // Volunteer retrieves dashboard
    const volDash = await req('GET', '/api/dashboard', null, volunteerCookie);
    assert(volDash.status === 200, 'Volunteer retrieves dashboard');
    const dashBody = JSON.stringify(volDash.body);
    assert(!dashBody.includes(candidateEmail) && !dashBody.includes(candidateMobile), 'Volunteer dashboard does not leak candidate email or mobile');

    // Candidate retrieves dashboard
    const candDash = await req('GET', '/api/dashboard', null, candidateCookie);
    assert(candDash.status === 200, 'Candidate retrieves dashboard');
    const candDashBody = JSON.stringify(candDash.body);
    assert(!candDashBody.includes(volunteerEmail) && !candDashBody.includes(volunteerMobile), 'Candidate dashboard does not leak volunteer email or mobile');

    // ──────────────────────────────────────────────────────────────────────────
    // REQUIREMENT 3: Mandatory Mobile Number in User Profiles
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Requirement 3: Mandatory Mobile in User Profiles ---');

    // Check candidate completion without mobile
    const candWithoutMobile = candidateCompletion({
      fullName: 'Alice Smith',
      languages: ['English'],
      city: 'Coimbatore',
      education: 'Graduate',
      assistanceNeeds: 'Writing support',
    });
    assert(candWithoutMobile.isComplete === false, 'Candidate profile is INCOMPLETE when mobile is missing');
    assert(candWithoutMobile.missingFields.includes('mobile'), 'Candidate missingFields explicitly contains mobile');
    assert(candWithoutMobile.percentage < 100, `Candidate completion is ${candWithoutMobile.percentage}% (< 100%) without mobile`);

    // Check candidate completion with mobile
    const candWithMobile = candidateCompletion({
      fullName: 'Alice Smith',
      mobile: '+919876543210',
      languages: ['English'],
      city: 'Coimbatore',
      education: 'Graduate',
      assistanceNeeds: 'Writing support',
    });
    assert(candWithMobile.isComplete === true, 'Candidate profile is 100% COMPLETE when mobile is present');
    assert(candWithMobile.percentage === 100, 'Candidate percentage reaches 100%');

    // Check volunteer completion without mobile
    const volWithoutMobile = volunteerCompletion({
      fullName: 'Bob Scribe',
      preferredLanguages: ['English'],
      subjects: ['General'],
      city: 'Chennai',
    });
    assert(volWithoutMobile.isComplete === false, 'Volunteer profile is INCOMPLETE when mobile is missing');
    assert(volWithoutMobile.missingFields.includes('mobile'), 'Volunteer missingFields explicitly contains mobile');

    // Check volunteer completion with mobile
    const volWithMobile = volunteerCompletion({
      fullName: 'Bob Scribe',
      mobile: '+919876543210',
      preferredLanguages: ['English'],
      subjects: ['General'],
      city: 'Chennai',
    });
    assert(volWithMobile.isComplete === true, 'Volunteer profile is 100% COMPLETE when mobile is present');
    assert(volWithMobile.percentage === 100, 'Volunteer percentage reaches 100%');

    // ──────────────────────────────────────────────────────────────────────────
    // REQUIREMENT 4: Fix Examination Date Display (DD/MM/YYYY in IST, No TBD)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Requirement 4: Examination Date Consistency (No TBD) ---');

    const reqData = candReqDetails.body.data;
    assert(reqData.examination && reqData.examination.startsOn, 'Request examination contains populated startsOn date');

    const formattedDate = formatDate(reqData.examination.startsOn);
    assert(formattedDate !== 'TBD', `Examination date is formatted (${formattedDate}), NOT TBD`);
    assert(/^\d{2}\/\d{2}\/\d{4}$/.test(formattedDate), `Formatted date matches DD/MM/YYYY pattern: ${formattedDate}`);

    // Verify IST conversion: 2026-12-15T09:30:00.000Z -> 15/12/2026
    const expectedDate = '15/12/2026';
    assert(formattedDate === expectedDate, `IST Examination date correctly evaluates to ${expectedDate}`);

    // ──────────────────────────────────────────────────────────────────────────
    // REQUIREMENT 5: Volunteer Confirmed Commitments (4 UI States & Privacy)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Requirement 5: Volunteer Confirmed Commitments Page ---');

    assert(volCommitments.status === 200, 'GET /api/assignments responds with 200 OK');
    const commitmentItems = Array.isArray(volCommitments.body.data) ? volCommitments.body.data : (volCommitments.body.data?.assignments || []);
    assert(Array.isArray(commitmentItems), 'Commitments response data is an array');
    assert(commitmentItems.length >= 1, 'Contains confirmed assignment');
    assert(commitmentItems[0].status === 'CONFIRMED', 'Commitment status is CONFIRMED');
    assert(commitmentItems[0].examination.locations[0].city === 'Coimbatore', 'Examination location details populated');

    // Verify HTML states exist in commitments.html
    const commitmentsHtml = fs.readFileSync('public/volunteer/commitments.html', 'utf8');
    assert(commitmentsHtml.includes('id="commitments-loading"'), 'HTML contains #commitments-loading state');
    assert(commitmentsHtml.includes('id="commitments-list"'), 'HTML contains #commitments-list state');
    assert(commitmentsHtml.includes('id="commitments-empty"'), 'HTML contains #commitments-empty state');
    assert(commitmentsHtml.includes('id="commitments-error"'), 'HTML contains #commitments-error with retry state');

    // ──────────────────────────────────────────────────────────────────────────
    // REQUIREMENT 6: Volunteer Expressed Interests Workflow & Persistence
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Requirement 6: Volunteer Expressed Interests Workflow ---');

    // Create a second non-conflicting examination for interest testing
    const testExam2 = await Examination.create({
      code: `EXAM2_${testId}`,
      slug: `exam2-slug-${testId}`,
      name: `Second State Examination ${testId}`,
      examLevel: 'STATE',
      startsOn: new Date('2027-01-20T09:30:00.000Z'),
      endsOn: new Date('2027-01-20T12:30:00.000Z'),
      locations: [{
        city: 'Chennai',
        state: 'Tamil Nadu',
      }],
      sessions: [{
        startsAt: new Date('2027-01-20T09:30:00.000Z'),
        endsAt: new Date('2027-01-20T12:30:00.000Z'),
        label: 'Session 1',
      }],
      status: 'PUBLISHED',
    });

    // Volunteer expresses interest
    const postInterest = await req('PUT', `/api/interests/${testExam2._id}`, { status: 'AVAILABLE' }, volunteerCookie);
    assert(postInterest.status === 200, 'Volunteer successfully expresses interest (PUT /api/interests/:id)');

    // Volunteer retrieves interests
    const getInterests = await req('GET', '/api/interests', null, volunteerCookie);
    assert(getInterests.status === 200, 'GET /api/interests responds with 200 OK');
    const interestsList = getInterests.body.data;
    assert(Array.isArray(interestsList) && interestsList.length > 0, 'Expressed interests list contains active interest');
    const interestRecord = interestsList.find(i => (i.examinationId?._id || i.examinationId) == testExam2._id.toString());
    assert(interestRecord !== undefined, 'Expressed interest matches examination ID');

    // Verify interests HTML contains error and retry state
    const interestsHtml = fs.readFileSync('public/volunteer/interests.html', 'utf8');
    assert(interestsHtml.includes('id="interests-error"'), 'Interests HTML contains #interests-error state');
    assert(interestsHtml.includes('id="interests-empty"'), 'Interests HTML contains #interests-empty state');
    assert(interestsHtml.includes('id="interests-list"'), 'Interests HTML contains #interests-list state');

    // Withdraw interest
    const delInterest = await req('DELETE', `/api/interests/${testExam2._id}`, null, volunteerCookie);
    assert(delInterest.status === 200, 'Volunteer successfully withdraws interest (DELETE /api/interests/:id)');

    await Examination.deleteOne({ _id: testExam2._id });

    // ──────────────────────────────────────────────────────────────────────────
    // REQUIREMENT 7: Profile Read-Only Default, Dynamic Auto-Save & 100% Progress Hiding
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Requirement 7: Profile Read-Only & 100% Completion Hiding ---');

    // Verify candidate and volunteer profile HTML elements
    const candProfileHtml = fs.readFileSync('public/candidate/profile.html', 'utf8');
    assert(candProfileHtml.includes('id="edit-profile-btn"'), 'Candidate profile has #edit-profile-btn');
    assert(candProfileHtml.includes('id="save-status-indicator"'), 'Candidate profile has #save-status-indicator');
    assert(candProfileHtml.includes('id="change-password-btn"'), 'Candidate profile has #change-password-btn');

    const volProfileHtml = fs.readFileSync('public/volunteer/profile.html', 'utf8');
    assert(volProfileHtml.includes('id="edit-profile-btn"'), 'Volunteer profile has #edit-profile-btn');
    assert(volProfileHtml.includes('id="save-status-indicator"'), 'Volunteer profile has #save-status-indicator');
    assert(volProfileHtml.includes('id="change-password-btn"'), 'Volunteer profile has #change-password-btn');

    // Verify profileCompletion.js hides widget at 100%
    const clientCode = fs.readFileSync('public/js/profileCompletion.js', 'utf8');
    assert(clientCode.includes('containerEl.hidden = true') && clientCode.includes("containerEl.style.display = 'none'"),
      'renderCompletionWidget hides container at 100% (containerEl.hidden = true, display: none)');
    assert(clientCode.includes('containerEl.hidden = false') && clientCode.includes("containerEl.style.display = ''"),
      'renderCompletionWidget unhides container if completion drops below 100%');

    // ──────────────────────────────────────────────────────────────────────────
    // REQUIREMENT 8: Password Reset & Authenticated Password Change via Resend
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Requirement 8: Password Reset & Change via Resend ---');

    // Request reset for registered email
    const resetReq = await req('POST', '/api/auth/forgot-password', { email: candidateEmail });
    assert(resetReq.status === 200, 'POST /api/auth/forgot-password returns 200 OK');
    assert(resetReq.body.data.success === true, 'Returns success response');
    assert(!resetReq.body.data.otp, 'OTP is NEVER returned in API response');

    // Request reset for non-existent email -> Same generic response (No enumeration)
    const unknownResetReq = await req('POST', '/api/auth/forgot-password', { email: 'nonexistent_account@example.com' });
    assert(unknownResetReq.status === 200, 'Non-existent email returns 200 OK');
    assert(unknownResetReq.body.data.message === resetReq.body.data.message, 'Generic response prevents account enumeration');

    // Resend cooldown enforcement (within 60s)
    const cooldownReq = await req('POST', '/api/auth/forgot-password', { email: candidateEmail });
    assert(cooldownReq.status === 429, 'Immediate second reset request is rate-limited (429 RATE_LIMITED)');

    // Inspect challenge in MongoDB
    const challenge = await PasswordResetChallenge.findOne({ email: candidateEmail, used: false });
    assert(challenge !== null, 'PasswordResetChallenge persisted in MongoDB');
    assert(challenge.otpHash && challenge.otpHash.length === 64, 'OTP is stored as HMAC-SHA256 hash, not plaintext');
    assert(challenge.maxAttempts === 5, 'Challenge enforces maxAttempts: 5');

    // Verify invalid OTP rejected
    const badOtp = await req('POST', '/api/auth/verify-reset-otp', {
      email: candidateEmail,
      otp: '000000',
    });
    assert(badOtp.status === 400, 'Invalid OTP rejected with 400 Bad Request');
    const challengeAfterFail = await PasswordResetChallenge.findById(challenge._id);
    assert(challengeAfterFail.attempts === 1, 'Verification attempt count incremented to 1');

    // For test purposes, generate valid OTP matching the challenge
    const crypto = require('crypto');
    const env = require('../server/config/env');
    const secret = env.SESSION_SECRET || 'penzo-otp-secret';
    const testOtpCode = '583921';
    challenge.otpHash = crypto.createHmac('sha256', secret).update(testOtpCode).digest('hex');
    await challenge.save();

    // Verify valid OTP
    const goodOtp = await req('POST', '/api/auth/verify-reset-otp', {
      email: candidateEmail,
      otp: testOtpCode,
    });
    assert(goodOtp.status === 200, 'Valid OTP confirmed with 200 OK');
    assert(goodOtp.body.data.resetToken !== undefined, 'Returns single-use resetToken');
    const resetToken = goodOtp.body.data.resetToken;

    // Reset password using resetToken
    const newPassword = 'NewSecretPassword@456';
    const completeReset = await req('POST', '/api/auth/reset-password', {
      email: candidateEmail,
      resetToken,
      newPassword,
    });
    assert(completeReset.status === 200, 'POST /api/auth/reset-password returns 200 OK');

    // Verify old password no longer works
    const oldLogin = await req('POST', '/api/auth/login', {
      identifier: candidateEmail,
      password: strongPassword,
    });
    assert(oldLogin.status === 401, 'Old password fails login (401 Unauthorized)');

    // Verify new password works
    const newLogin = await req('POST', '/api/auth/login', {
      identifier: candidateEmail,
      password: newPassword,
    });
    assert(newLogin.status === 200, 'New password successfully authenticates user (200 OK)');
    assert(newLogin.sessionCookie !== null, 'New session established');

    // Authenticated Password Change
    const authChange = await req('POST', '/api/auth/change-password', {
      currentPassword: newPassword,
      newPassword: 'AnotherPassword@789',
    }, newLogin.sessionCookie);
    assert(authChange.status === 200, 'Authenticated POST /api/auth/change-password succeeds with valid current password');

    // Authenticated Password Change with wrong current password
    const badAuthChange = await req('POST', '/api/auth/change-password', {
      currentPassword: 'WrongPassword@999',
      newPassword: 'ThirdPassword@111',
    }, newLogin.sessionCookie);
    assert(badAuthChange.status === 401, 'Authenticated password change rejected when current password is wrong');

    // Verify login.html contains Forgot Password link and forgot view
    const loginHtml = fs.readFileSync('public/login.html', 'utf8');
    assert(loginHtml.includes('id="forgot-password-link"'), 'public/login.html contains #forgot-password-link');
    assert(loginHtml.includes('id="step-forgot"'), 'public/login.html contains #step-forgot view');
    assert(loginHtml.includes('id="forgot-resend-btn"'), 'public/login.html contains #forgot-resend-btn with cooldown');

  } finally {
    console.log('\n--- Cleaning up test records ---');
    try {
      if (candidateUser) {
        await User.deleteOne({ _id: candidateUser._id });
        await CandidateProfile.deleteOne({ userId: candidateUser._id });
      }
      if (volunteerUser) {
        await User.deleteOne({ _id: volunteerUser._id });
        await VolunteerProfile.deleteOne({ userId: volunteerUser._id });
      }
      if (testExam) {
        await Examination.deleteOne({ _id: testExam._id });
      }
      if (testRequest) {
        await ScribeRequest.deleteOne({ _id: testRequest._id });
      }
      if (testAssignment) {
        await ConfirmedAssignment.deleteOne({ _id: testAssignment._id });
      }
      if (testRequest) {
        await MatchProposal.deleteMany({ requestId: testRequest._id });
      }
      await PasswordResetChallenge.deleteMany({ email: candidateEmail });
      await VolunteerInterest.deleteMany({ examinationId: testExam?._id });
    } catch (err) {
      console.warn('Cleanup warning:', err.message);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n============================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
