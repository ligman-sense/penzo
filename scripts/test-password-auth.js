'use strict';

/**
 * PENZO — Candidate & Volunteer Password Authentication Test Suite
 *
 * Verifies:
 * 1. Password Policy Validation (length, uppercase, number, special character)
 * 2. Candidate Registration with Email + Password & Uniqueness
 * 3. Volunteer Registration with +91 Indian Mobile + Password & Non-+91 Rejection
 * 4. Sign-in via Email / Mobile + Password with Generic Credentials Error on Mismatch
 * 5. Profile Immutability: Required login identifier cannot be removed or changed via profile API
 * 6. Optional Contact Fields: Can be updated directly without OTP
 * 7. Deprecation of all OTP Endpoints (410 Gone)
 * 8. Authenticated Password Setup & Change
 */

const http = require('http');
const mongoose = require('mongoose');
const { createApp } = require('../server/app');
const { connectDB } = require('../server/config/database');
const { validatePasswordPolicy } = require('../server/utils/password');

const User = require('../server/models/User');
const CandidateProfile = require('../server/models/CandidateProfile');
const VolunteerProfile = require('../server/models/VolunteerProfile');

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
  console.log(' PENZO PASSWORD AUTHENTICATION INTEGRATION TEST SUITE');
  console.log('============================================================\n');

  await connectDB();
  console.log(`MongoDB connected: ${mongoose.connection.client.s.url}`);

  const app = createApp();
  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', () => {
      port = server.address().port;
      console.log(`Test server running on port ${port}\n`);
      resolve();
    });
  });

  const timestamp = Date.now();
  const testCandidateEmail = `cand_${timestamp}@example.com`;
  const testVolunteerMobile = `+9198${String(timestamp).slice(-8)}`;
  const validPassword = 'SecurePass123!@';

  // ─── Test Group 1: Password Policy Validation ─────────────────────────────────
  console.log('--- Test Group 1: Password Policy Validation ---');
  {
    const short = validatePasswordPolicy('Ab1!');
    assert(!short.isValid, 'Rejects password shorter than 8 characters');

    const noUpper = validatePasswordPolicy('password123!');
    assert(!noUpper.isValid, 'Rejects password without uppercase letter');

    const noNumber = validatePasswordPolicy('Password!@#');
    assert(!noNumber.isValid, 'Rejects password without number');

    const noSpecial = validatePasswordPolicy('Password123');
    assert(!noSpecial.isValid, 'Rejects password without special character');

    const valid = validatePasswordPolicy(validPassword);
    assert(valid.isValid && valid.errors.length === 0, 'Accepts password meeting all 4 criteria');
  }

  // ─── Test Group 2: Candidate Registration with Email ──────────────────────────
  console.log('\n--- Test Group 2: Candidate Registration with Email ---');
  let candidateCookie = null;
  {
    // Missing email
    const resNoEmail = await req('POST', '/api/auth/register', {
      role: 'CANDIDATE',
      identifierType: 'EMAIL',
      identifier: '',
      password: validPassword,
    });
    assert(resNoEmail.status === 400, 'Rejects registration with missing email (400)');

    // Invalid email format
    const resBadEmail = await req('POST', '/api/auth/register', {
      role: 'CANDIDATE',
      identifierType: 'EMAIL',
      identifier: 'not-an-email',
      password: validPassword,
    });
    assert(resBadEmail.status === 400, 'Rejects registration with malformed email (400)');

    // Weak password
    const resWeakPass = await req('POST', '/api/auth/register', {
      role: 'CANDIDATE',
      identifierType: 'EMAIL',
      identifier: testCandidateEmail,
      password: 'weak',
    });
    assert(resWeakPass.status === 400, 'Rejects registration with weak password (400)');

    // Successful Candidate registration
    const resSuccess = await req('POST', '/api/auth/register', {
      role: 'CANDIDATE',
      identifierType: 'EMAIL',
      identifier: testCandidateEmail,
      password: validPassword,
      name: 'Ramesh Candidate',
    });
    assert(resSuccess.status === 200, 'Candidate registration succeeds (200)');
    assert(Boolean(resSuccess.sessionCookie), 'Sets session cookie on registration');
    assert(resSuccess.body.data?.user?.email === testCandidateEmail.toLowerCase(), 'User record has normalized email');
    assert(resSuccess.body.data?.user?.primaryIdentifier === 'EMAIL', 'User record primaryIdentifier is EMAIL');
    assert(resSuccess.body.data?.user?.authProvider === 'PASSWORD', 'User authProvider is PASSWORD');
    candidateCookie = resSuccess.sessionCookie;

    // Verify DB state
    const candUser = await User.findOne({ email: testCandidateEmail.toLowerCase() });
    assert(candUser !== null, 'User saved in MongoDB');
    assert(candUser.passwordHash && candUser.passwordHash.startsWith('scrypt$'), 'Password hashed with scrypt, not plaintext');
    const candProfile = await CandidateProfile.findOne({ userId: candUser._id });
    assert(candProfile !== null, 'CandidateProfile record created');

    // Duplicate email registration rejected
    const resDup = await req('POST', '/api/auth/register', {
      role: 'CANDIDATE',
      identifierType: 'EMAIL',
      identifier: testCandidateEmail,
      password: validPassword,
    });
    assert(resDup.status === 400, 'Rejects duplicate email registration (400)');
  }

  // ─── Test Group 3: Volunteer Registration with Indian Mobile (+91) ────────────
  console.log('\n--- Test Group 3: Volunteer Registration with Indian Mobile (+91) ---');
  let volunteerCookie = null;
  {
    // Non-+91 country code rejected
    const resUS = await req('POST', '/api/auth/register', {
      role: 'VOLUNTEER',
      identifierType: 'MOBILE',
      identifier: '+14155552671',
      password: validPassword,
    });
    assert(resUS.status === 400, 'Rejects non-+91 country code (400)');

    // Malformed mobile
    const resBadNum = await req('POST', '/api/auth/register', {
      role: 'VOLUNTEER',
      identifierType: 'MOBILE',
      identifier: '12345',
      password: validPassword,
    });
    assert(resBadNum.status === 400, 'Rejects invalid mobile number (400)');

    // Successful Volunteer registration
    const resSuccess = await req('POST', '/api/auth/register', {
      role: 'VOLUNTEER',
      identifierType: 'MOBILE',
      identifier: testVolunteerMobile,
      password: validPassword,
      name: 'Priya Volunteer',
    });
    assert(resSuccess.status === 200, 'Volunteer registration succeeds (200)');
    assert(Boolean(resSuccess.sessionCookie), 'Sets session cookie for Volunteer');
    assert(resSuccess.body.data?.user?.mobile === testVolunteerMobile, 'User record has canonical mobile');
    assert(resSuccess.body.data?.user?.primaryIdentifier === 'MOBILE', 'User record primaryIdentifier is MOBILE');
    volunteerCookie = resSuccess.sessionCookie;

    // Verify DB state
    const volUser = await User.findOne({ mobileE164: testVolunteerMobile });
    assert(volUser !== null, 'Volunteer saved in MongoDB');
    const volProfile = await VolunteerProfile.findOne({ userId: volUser._id });
    assert(volProfile !== null, 'VolunteerProfile record created');

    // Duplicate mobile registration rejected
    const resDup = await req('POST', '/api/auth/register', {
      role: 'VOLUNTEER',
      identifierType: 'MOBILE',
      identifier: testVolunteerMobile,
      password: validPassword,
    });
    assert(resDup.status === 400, 'Rejects duplicate mobile registration (400)');
  }

  // ─── Test Group 4: Sign In via Email & Mobile ─────────────────────────────────
  console.log('\n--- Test Group 4: Sign In via Email & Mobile ---');
  {
    // Wrong password (Candidate)
    const resWrongPass = await req('POST', '/api/auth/login', {
      identifier: testCandidateEmail,
      password: 'WrongPassword123!',
    });
    assert(resWrongPass.status === 401, 'Rejects wrong password with 401');
    assert(resWrongPass.body.error?.message === 'Invalid identifier or password.', 'Generic error message for wrong password');

    // Unknown identifier
    const resUnknown = await req('POST', '/api/auth/login', {
      identifier: 'unknown_user_99999@example.com',
      password: validPassword,
    });
    assert(resUnknown.status === 401, 'Rejects unknown identifier with 401');
    assert(resUnknown.body.error?.message === 'Invalid identifier or password.', 'Generic error message for unknown identifier (no user enumeration)');

    // Correct Candidate login with email
    const resCandLogin = await req('POST', '/api/auth/login', {
      identifier: testCandidateEmail,
      password: validPassword,
    });
    assert(resCandLogin.status === 200, 'Candidate logs in with email + password (200)');
    assert(Boolean(resCandLogin.sessionCookie), 'Candidate login sets session cookie');
    assert(resCandLogin.body.data?.user?.email === testCandidateEmail.toLowerCase(), 'Session user email matches');

    // Correct Volunteer login with mobile
    const resVolLogin = await req('POST', '/api/auth/login', {
      identifier: testVolunteerMobile,
      password: validPassword,
    });
    assert(resVolLogin.status === 200, 'Volunteer logs in with mobile + password (200)');
    assert(Boolean(resVolLogin.sessionCookie), 'Volunteer login sets session cookie');
    assert(resVolLogin.body.data?.user?.mobile === testVolunteerMobile, 'Session user mobile matches');
  }

  // ─── Test Group 5: Profile Immutability & Required Login Identifier ───────────
  console.log('\n--- Test Group 5: Profile Immutability & Required Login Identifier ---');
  {
    // Candidate Profile
    const resCandProf = await req('GET', '/api/profile', null, candidateCookie);
    assert(resCandProf.status === 200, 'Candidate retrieves profile (200)');
    assert(resCandProf.body.data?.contactInfo?.primaryIdentifier === 'EMAIL', 'contactInfo specifies EMAIL as primary');
    assert(resCandProf.body.data?.contactInfo?.isEmailRequired === true, 'contactInfo flags isEmailRequired: true');
    assert(resCandProf.body.data?.contactInfo?.isEmailReadOnly === true, 'contactInfo flags isEmailReadOnly: true');

    // Attempting to remove registered email
    const resRemoveEmail = await req('PUT', '/api/profile', { email: '' }, candidateCookie);
    assert(resRemoveEmail.status === 400, 'Rejects attempt to remove required login email (400)');

    // Attempting to change registered email via profile update
    const resChangeEmail = await req('PUT', '/api/profile', { email: 'different@example.com' }, candidateCookie);
    assert(resChangeEmail.status === 400, 'Rejects attempt to modify required login email (400)');

    // Updating optional mobile on candidate profile succeeds directly without OTP
    const resAddMobile = await req('PUT', '/api/profile', { mobile: '+919712345678' }, candidateCookie);
    assert(resAddMobile.status === 200, 'Candidate successfully updates optional mobile number (200)');
    assert(resAddMobile.body.data?.mobile === '+919712345678', 'Optional mobile persisted on user profile');

    // Volunteer Profile
    const resVolProf = await req('GET', '/api/profile', null, volunteerCookie);
    assert(resVolProf.status === 200, 'Volunteer retrieves profile (200)');
    assert(resVolProf.body.data?.contactInfo?.primaryIdentifier === 'MOBILE', 'contactInfo specifies MOBILE as primary');
    assert(resVolProf.body.data?.contactInfo?.isMobileRequired === true, 'contactInfo flags isMobileRequired: true');
    assert(resVolProf.body.data?.contactInfo?.isMobileReadOnly === true, 'contactInfo flags isMobileReadOnly: true');

    // Attempting to remove registered mobile
    const resRemoveMobile = await req('PUT', '/api/profile', { mobile: '' }, volunteerCookie);
    assert(resRemoveMobile.status === 400, 'Rejects attempt to remove required login mobile (400)');

    // Attempting to change registered mobile
    const resChangeMobile = await req('PUT', '/api/profile', { mobile: '+919999999999' }, volunteerCookie);
    assert(resChangeMobile.status === 400, 'Rejects attempt to modify required login mobile (400)');

    // Updating optional email on volunteer profile succeeds directly without OTP
    const resAddEmail = await req('PUT', '/api/profile', { email: 'optional_vol@example.com' }, volunteerCookie);
    assert(resAddEmail.status === 200, 'Volunteer successfully updates optional email address (200)');
    assert(resAddEmail.body.data?.email === 'optional_vol@example.com', 'Optional email persisted on user profile');
  }

  // ─── Test Group 6: Deprecated OTP Endpoints (410 Gone) ────────────────────────
  console.log('\n--- Test Group 6: Deprecated OTP Endpoints (410 Gone) ---');
  {
    const resOtpSend = await req('POST', '/api/auth/otp/send', { mobile: '+919876543210' });
    assert(resOtpSend.status === 410, 'POST /api/auth/otp/send returns 410 Gone');

    const resOtpVerify = await req('POST', '/api/auth/otp/verify', { mobile: '+919876543210', otp: '123456' });
    assert(resOtpVerify.status === 410, 'POST /api/auth/otp/verify returns 410 Gone');

    const resProfileMobOtp = await req('POST', '/api/profile/contact/mobile/send-otp', {}, candidateCookie);
    assert(resProfileMobOtp.status === 410, 'POST /api/profile/contact/mobile/send-otp returns 410 Gone');

    const resProfileEmailOtp = await req('POST', '/api/profile/contact/email/send-code', {}, candidateCookie);
    assert(resProfileEmailOtp.status === 410, 'POST /api/profile/contact/email/send-code returns 410 Gone');
  }

  // ─── Test Group 7: Authenticated Password Setup & Change ──────────────────────
  console.log('\n--- Test Group 7: Authenticated Password Setup & Change ---');
  {
    const newPassword = 'NewSecurePassword456!#';

    // Wrong current password
    const resWrongCur = await req(
      'POST',
      '/api/auth/set-password',
      { currentPassword: 'WrongCurrent123!', newPassword },
      candidateCookie
    );
    assert(resWrongCur.status === 401, 'Rejects password change with incorrect current password (401)');

    // Successful password change
    const resSuccessChange = await req(
      'POST',
      '/api/auth/set-password',
      { currentPassword: validPassword, newPassword },
      candidateCookie
    );
    assert(resSuccessChange.status === 200, 'Password updated successfully (200)');

    // Login with new password succeeds
    const resLoginNew = await req('POST', '/api/auth/login', {
      identifier: testCandidateEmail,
      password: newPassword,
    });
    assert(resLoginNew.status === 200, 'Candidate can log in with new password (200)');

    // Login with old password fails
    const resLoginOld = await req('POST', '/api/auth/login', {
      identifier: testCandidateEmail,
      password: validPassword,
    });
    assert(resLoginOld.status === 401, 'Candidate cannot log in with old password (401)');
  }

  // ─── Clean Up Test Data ───────────────────────────────────────────────────────
  console.log('\nCleaning up test records...');
  const testUsers = await User.find({
    $or: [
      { email: testCandidateEmail.toLowerCase() },
      { mobileE164: testVolunteerMobile },
      { email: 'optional_vol@example.com' },
    ],
  });
  for (const u of testUsers) {
    await CandidateProfile.deleteMany({ userId: u._id });
    await VolunteerProfile.deleteMany({ userId: u._id });
    await User.deleteOne({ _id: u._id });
  }

  console.log('\n============================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('============================================================\n');

  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
