'use strict';

/**
 * PENZO — Day 1 Foundation Verification Test Suite
 * Validates:
 * 1. Protected route authentication and role checks
 * 2. Record ownership and unauthorized cross-user mutation rejection
 * 3. Database startup resilience and URI masking
 * 4. Duplicate candidate active request prevention (in-app & DB constraint)
 * 5. Volunteer schedule conflict & double-booking prevention
 * 6. Durable OTP resend limits persisting in MongoDB
 * 7. Profile email validation, normalization, and navigation safe name fallback
 */

const http = require('http');
const mongoose = require('mongoose');
const { createApp } = require('../server/app');
const { connectDB, maskMongoUri, validateMongoUri } = require('../server/config/database');
const env = require('../server/config/env');

const User = require('../server/models/User');
const CandidateProfile = require('../server/models/CandidateProfile');
const VolunteerProfile = require('../server/models/VolunteerProfile');
const Examination = require('../server/models/Examination');
const ScribeRequest = require('../server/models/ScribeRequest');
const ConfirmedAssignment = require('../server/models/ConfirmedAssignment');
const MatchProposal = require('../server/models/MatchProposal');
const VolunteerInterest = require('../server/models/VolunteerInterest');
const OtpChallenge = require('../server/models/OtpChallenge');
const { sendOtp } = require('../server/services/otpService');
const { findVolunteerScheduleConflict } = require('../server/utils/conflictChecker');

let server;
let port;

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
          const setCookie = res.headers['set-cookie'];
          let sessionCookie = null;
          if (setCookie) {
            const found = setCookie.find((c) => c.startsWith('penzo_session=') || c.startsWith('penzo_admin='));
            if (found) sessionCookie = found.split(';')[0];
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
            sessionCookie,
          });
        });
      }
    );
    r.on('error', reject);
    if (postData) r.write(postData);
    r.end();
  });
}

async function loginUser(mobile, role = 'CANDIDATE') {
  const password = 'Password@123';
  let res = await req('POST', '/api/auth/login', { identifier: mobile, password });
  if (res.status !== 200 || !res.body?.data?.user) {
    res = await req('POST', '/api/auth/register', {
      role,
      identifierType: 'MOBILE',
      identifier: mobile,
      password,
      name: role === 'CANDIDATE' ? 'Test Candidate' : 'Test Volunteer',
    });
  }
  return {
    cookie: res.sessionCookie,
    user: res.body?.data?.user,
    csrfToken: res.body?.data?.csrfToken,
  };
}

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

async function runTests() {
  console.log('\n============================================================');
  console.log(' PENZO DAY 1 FOUNDATION TEST SUITE');
  console.log('============================================================\n');

  await connectDB({ exitOnError: false });
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
  console.log(`Test server running on port ${port}\n`);

  // -------------------------------------------------------------
  // Test 1: Database Startup Resilience & Credential Masking
  // -------------------------------------------------------------
  console.log('--- Test Group 1: Database Startup Resilience & URI Masking ---');
  const v1 = validateMongoUri('');
  assert(!v1.valid, 'Empty MONGODB_URI correctly rejected');

  const v2 = validateMongoUri('http://localhost:27017/penzo');
  assert(!v2.valid && v2.message.includes('mongodb://'), 'Malformed URI without mongodb protocol rejected');

  const v3 = validateMongoUri('mongodb://127.0.0.1:27017/penzo');
  assert(v3.valid, 'Valid mongodb:// URI accepted');

  const v4 = validateMongoUri('mongodb+srv://cluster.mongodb.net/penzo');
  assert(v4.valid, 'Valid mongodb+srv:// URI accepted');

  const masked = maskMongoUri('mongodb://dbuser:SecretPass123@cluster0.net/penzo');
  assert(masked === 'mongodb://dbuser:****@cluster0.net/penzo', 'Credentials masked properly without leakage');

  // -------------------------------------------------------------
  // Test 2: Protected Route Authentication & Role Checks
  // -------------------------------------------------------------
  console.log('\n--- Test Group 2: Protected Route Auth & Role Checks ---');
  const publicHealth = await req('GET', '/api/health');
  assert(publicHealth.status === 200, 'Public /api/health accessible without auth (200)');

  const publicExams = await req('GET', '/api/public/examinations');
  assert(publicExams.status === 200, 'Public /api/public/examinations accessible without auth (200)');

  const publicFaqs = await req('GET', '/api/public/faqs');
  assert(publicFaqs.status === 200, 'Public /api/public/faqs accessible without auth (200)');

  const unauthProfile = await req('GET', '/api/profile');
  assert(unauthProfile.status === 401 && unauthProfile.body?.error?.code === 'UNAUTHENTICATED', 'Unauthenticated /api/profile returns 401 UNAUTHENTICATED');

  const unauthRequests = await req('GET', '/api/requests');
  assert(unauthRequests.status === 401, 'Unauthenticated /api/requests returns 401 UNAUTHENTICATED');

  const unauthInterests = await req('GET', '/api/interests');
  assert(unauthInterests.status === 401, 'Unauthenticated /api/interests returns 401 UNAUTHENTICATED');

  const unauthDashboard = await req('GET', '/api/dashboard');
  assert(unauthDashboard.status === 401, 'Unauthenticated /api/dashboard returns 401 UNAUTHENTICATED');

  const unauthAdminDash = await req('GET', '/api/admin/dashboard');
  assert(unauthAdminDash.status === 403, 'Unauthenticated /api/admin/dashboard returns 403 FORBIDDEN');

  const unauthRegister = await req('POST', '/api/auth/register', { role: 'VOLUNTEER' });
  assert(unauthRegister.status === 401, 'Unauthenticated /api/auth/register returns 401 UNAUTHENTICATED');

  // -------------------------------------------------------------
  // Test 3: Record Ownership & Cross-User Security
  // -------------------------------------------------------------
  console.log('\n--- Test Group 3: Record Ownership & Cross-User Isolation ---');
  const candA = await loginUser('+919000000001', 'CANDIDATE');
  const candB = await loginUser('+919000000002', 'CANDIDATE');

  // Clean up any previous test requests for these candidate accounts to ensure idempotent runs
  await ScribeRequest.deleteMany({ candidateId: { $in: [candA.user.id, candB.user.id] } });

  // Complete profile for Candidate A so request creation succeeds
  await req(
    'PUT',
    '/api/profile',
    {
      fullName: 'Candidate Alpha',
      city: 'Coimbatore',
      education: 'Undergraduate',
      languages: ['English', 'Tamil'],
      assistanceNeeds: 'Visual Assistance',
      email: 'alpha@example.com',
    },
    candA.cookie
  );

  // Candidate A creates request
  let testExam = await Examination.findOne({ status: 'PUBLISHED' });
  if (!testExam) {
    testExam = await Examination.create({
      name: 'Foundation Test Exam 2026',
      title: 'Foundation Test Exam 2026',
      slug: 'foundation-test-exam-2026',
      authority: 'PENZO Testing Authority',
      status: 'PUBLISHED',
      startsOn: new Date('2026-12-15T09:00:00Z'),
      endsOn: new Date('2026-12-15T13:00:00Z'),
    });
  }

  const createReqRes = await req(
    'POST',
    '/api/requests',
    {
      examinationId: testExam._id.toString(),
      language: 'English',
      city: 'Coimbatore',
      requirements: 'Scribe for 3 hours',
    },
    candA.cookie
  );

  assert(createReqRes.status === 201, `Candidate A created request: status ${createReqRes.status}`);
  const reqAId = createReqRes.body?.data?.id;

  // Candidate B attempts to read Candidate A's request
  const readOtherReq = await req('GET', `/api/requests/${reqAId}`, null, candB.cookie);
  assert(readOtherReq.status === 404, "Candidate B cannot read Candidate A's request (404 Not Found)");

  // Candidate B attempts to read proposed match on Candidate A's request
  const readOtherProposal = await req('GET', `/api/requests/${reqAId}/proposed-match`, null, candB.cookie);
  assert(readOtherProposal.status === 404, "Candidate B cannot read Candidate A's proposed match (404 Not Found)");

  // Candidate B attempts to cancel Candidate A's request
  const cancelOtherReq = await req('POST', `/api/requests/${reqAId}/cancel`, { reason: 'malicious' }, candB.cookie);
  assert(cancelOtherReq.status === 404, "Candidate B cannot cancel Candidate A's request (404 Not Found)");

  // Candidate A attempts to mutate another user's role in /api/auth/register
  const spoofRegister = await req('POST', '/api/auth/register', { mobile: '+919000000002', role: 'VOLUNTEER' }, candA.cookie);
  assert(spoofRegister.status === 403, "User cannot mutate another user's role via spoofed mobile in /api/auth/register (403)");

  // -------------------------------------------------------------
  // Test 4: Candidate Duplicate Active Request Prevention
  // -------------------------------------------------------------
  console.log('\n--- Test Group 4: Duplicate Active Request Prevention ---');
  const dupeReqRes = await req(
    'POST',
    '/api/requests',
    {
      examinationId: testExam._id.toString(),
      language: 'Tamil',
      city: 'Coimbatore',
      requirements: 'Second request attempt',
    },
    candA.cookie
  );
  assert(dupeReqRes.status === 409, 'Duplicate active request for same exam rejected with 409 Conflict');
  assert(
    dupeReqRes.body?.error?.message?.includes('already have an active request'),
    'Actionable error message returned on duplicate active request'
  );

  // -------------------------------------------------------------
  // Test 5: Volunteer Schedule Conflict & Double-Booking
  // -------------------------------------------------------------
  console.log('\n--- Test Group 5: Volunteer Schedule Conflict & Double-Booking ---');
  const volUser = await loginUser('+919000000003', 'VOLUNTEER');
  const volUserId = volUser.user.id;

  // Simulate an existing confirmed assignment for Volunteer overlapping with testExam
  const examRange = {
    startsAt: testExam.startsOn ? new Date(testExam.startsOn) : new Date('2026-12-15T09:00:00Z'),
    endsAt: testExam.endsOn ? new Date(testExam.endsOn) : new Date('2026-12-15T13:00:00Z'),
  };

  const dummyAssignment = await ConfirmedAssignment.create({
    requestId: new mongoose.Types.ObjectId(),
    candidateId: new mongoose.Types.ObjectId(),
    volunteerId: volUserId,
    startsAt: examRange.startsAt,
    endsAt: examRange.endsAt,
    status: 'CONFIRMED',
    confirmedAt: new Date(),
  });

  // Volunteer tries to register interest for testExam which is at the exact same time
  const interestConflict = await req(
    'PUT',
    `/api/interests/${testExam._id.toString()}`,
    { notes: 'I want to help' },
    volUser.cookie
  );
  assert(
    interestConflict.status === 409,
    `Interest registration on overlapping confirmed schedule rejected with 409 Conflict (got ${interestConflict.status})`
  );

  // Conflict checker direct validation
  const directConflict = await findVolunteerScheduleConflict(volUserId, {
    startsAt: new Date(examRange.startsAt.getTime() + 1000),
    endsAt: new Date(examRange.endsAt.getTime() - 1000),
  });
  assert(directConflict.hasConflict && directConflict.conflictType === 'CONFIRMED_ASSIGNMENT', 'findVolunteerScheduleConflict correctly detects overlapping window');

  const nonConflict = await findVolunteerScheduleConflict(volUserId, {
    startsAt: new Date(examRange.endsAt.getTime() + 24 * 60 * 60 * 1000),
    endsAt: new Date(examRange.endsAt.getTime() + 28 * 60 * 60 * 1000),
  });
  assert(!nonConflict.hasConflict, 'findVolunteerScheduleConflict returns false for non-overlapping window');

  // Clean up test assignment
  await ConfirmedAssignment.deleteOne({ _id: dummyAssignment._id });

  // -------------------------------------------------------------
  // Test 6: Durable OTP Resend Limits in MongoDB
  // -------------------------------------------------------------
  console.log('\n--- Test Group 6: Durable OTP Resend Limits in MongoDB ---');
  const testMobile = '+919888888888';
  await OtpChallenge.deleteMany({ mobileE164: testMobile });

  // 1. Initial send
  const otp1 = await sendOtp(testMobile, { skipCooldown: true });
  assert(otp1.challenge.resendCount === 0, 'Initial OTP challenge has resendCount = 0');

  // Verify MongoDB document directly
  let docInDb = await OtpChallenge.findById(otp1.challenge._id);
  assert(docInDb && docInDb.resendCount === 0, 'Initial OTP challenge persisted in MongoDB');

  // 2. Cooldown rejection when attempting immediate send
  let cooldownCaught = false;
  try {
    await sendOtp(testMobile, { skipCooldown: false });
  } catch (err) {
    if (err.status === 429 && err.message.includes('Please wait')) {
      cooldownCaught = true;
    }
  }
  assert(cooldownCaught, 'Immediate OTP resend within cooldown rejected with 429');

  // 3. Resend with skipCooldown increments resendCount
  const otp2 = await sendOtp(testMobile, { skipCooldown: true });
  assert(otp2.challenge.resendCount === 1, 'First resend increments resendCount to 1 in MongoDB');

  const otp3 = await sendOtp(testMobile, { skipCooldown: true });
  assert(otp3.challenge.resendCount === 2, 'Second resend increments resendCount to 2 in MongoDB');

  const otp4 = await sendOtp(testMobile, { skipCooldown: true });
  assert(otp4.challenge.resendCount === 3, 'Third resend increments resendCount to 3 in MongoDB');

  const otp5 = await sendOtp(testMobile, { skipCooldown: true });
  assert(otp5.challenge.resendCount === 4, 'Fourth resend reaches MAX_RESENDS (resendCount = 4)');

  // 4. Exceeding max resends
  let maxResendsCaught = false;
  try {
    await sendOtp(testMobile, { skipCooldown: true });
  } catch (err) {
    if (err.status === 429 && err.message.includes('Maximum OTP resend attempts exceeded')) {
      maxResendsCaught = true;
    }
  }
  assert(maxResendsCaught, 'Exceeding max OTP resends rejected with 429 and durable limit message');

  // -------------------------------------------------------------
  // Test 7: Profile Email Validation & Safe Name Fallback
  // -------------------------------------------------------------
  console.log('\n--- Test Group 7: Profile Email Validation & Safe Name Fallback ---');
  // Invalid email formats
  const invalidEmail1 = await req('PUT', '/api/profile', { email: 'not-an-email' }, candA.cookie);
  assert(invalidEmail1.status === 400, 'Invalid email "not-an-email" rejected with 400 Bad Request');

  const invalidEmail2 = await req('PUT', '/api/profile', { email: 'user@' }, candA.cookie);
  assert(invalidEmail2.status === 400, 'Invalid email "user@" rejected with 400 Bad Request');

  const invalidEmail3 = await req('PUT', '/api/profile', { email: '@missinguser.com' }, candA.cookie);
  assert(invalidEmail3.status === 400, 'Invalid email "@missinguser.com" rejected with 400 Bad Request');

  // Valid email normalized
  const validEmail = await req('PUT', '/api/profile', { email: '   Valid.User@Example.COM   ' }, candA.cookie);
  assert(validEmail.status === 200, 'Valid email with surrounding whitespace accepted (200)');
  assert(validEmail.body?.data?.email === 'valid.user@example.com', 'Email correctly trimmed and lowercased');

  // Clear email
  const clearEmail = await req('PUT', '/api/profile', { email: '' }, candA.cookie);
  assert(clearEmail.status === 200 && clearEmail.body?.data?.email === null, 'Empty string email clears email to null');

  // Session user safe fallback
  const sessionCheck = await req('GET', '/api/auth/session', null, candA.cookie);
  assert(
    sessionCheck.body?.data?.user?.name !== undefined && sessionCheck.body?.data?.user?.name !== 'undefined',
    `Session user has safe non-undefined name: "${sessionCheck.body?.data?.user?.name}"`
  );

  console.log('\n============================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('============================================================\n');

  server.close(async () => {
    await mongoose.disconnect();
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  });
}

runTests().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  if (server) server.close();
  mongoose.disconnect();
  process.exit(1);
});
