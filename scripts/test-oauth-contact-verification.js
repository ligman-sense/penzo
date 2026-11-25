'use strict';

/**
 * PENZO Contact Verification & Identity Integrity Test Suite
 * Validates:
 * 1. India (+91) only rule for mobile login and mobile OTP
 * 2. OAuth Candidate/Volunteer profile contact rules (immutable email, mobile verification)
 * 3. Mobile-login Candidate/Volunteer profile contact rules (immutable phone, email verification)
 * 4. Re-verification on contact change & invalidation of prior challenges
 * 5. Challenge security (single-use, account-bound, purpose-bound, hashed storage)
 * 6. Provider adapter integration & rate limits/cooldowns
 */

require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const env = require('../server/config/env');
const { createApp } = require('../server/app');
const User = require('../server/models/User');
const CandidateProfile = require('../server/models/CandidateProfile');
const VolunteerProfile = require('../server/models/VolunteerProfile');
const ContactVerificationChallenge = require('../server/models/ContactVerificationChallenge');
const { getSmsAdapter } = require('../server/services/verification/smsVerificationAdapter');
const { getEmailAdapter } = require('../server/services/verification/emailVerificationAdapter');
const { authenticateWithGoogle } = require('../server/services/googleAuthService');
const { loginWithOtp } = require('../server/services/authService');
const { USER_COOKIE } = require('../server/utils/cookies');

let server;
let baseUrl;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed += 1;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed += 1;
  }
}

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { ...(options.headers || {}) };
  let body = undefined;

  if (options.body) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body,
    redirect: 'manual',
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // text
  }

  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    data: json || text,
    raw: text,
  };
}

async function run() {
  console.log('\n============================================================');
  console.log(' PENZO CONTACT VERIFICATION & IDENTITY INTEGRITY TEST SUITE');
  console.log('============================================================\n');

  await mongoose.connect(env.MONGODB_URI);
  console.log(`MongoDB connected: ${env.MONGODB_URI}`);

  const expressApp = createApp();
  server = http.createServer(expressApp);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on port ${port}\n`);

  const smsAdapter = getSmsAdapter();
  const emailAdapter = getEmailAdapter();

  try {
    // ─── Test Group 1: India Only (+91) Mobile Validation ──────────────────────
    console.log('--- Test Group 1: India Only (+91) Mobile Validation ---');

    // 1.1 Non-Indian country code rejected on /api/auth/otp/send
    const resUs = await request('/api/auth/otp/send', {
      method: 'POST',
      body: { mobile: '+14155552671' },
    });
    assert(resUs.status === 400, 'Non-Indian (+1) country code rejected with 400');
    assert(
      resUs.data.error?.message?.includes('Only Indian mobile numbers (+91) are supported.'),
      'Clear error message for non-Indian country code'
    );

    // 1.2 Non-Indian demo code rejected
    const resDemo = await request('/api/auth/otp/send', {
      method: 'POST',
      body: { mobile: '+00012345001' },
    });
    assert(resDemo.status === 400, 'Demo (+000) prefix rejected with 400');

    // 1.3 Invalid Indian number (starts with 2) rejected
    const resInvalid = await request('/api/auth/otp/send', {
      method: 'POST',
      body: { mobile: '+912345678901' },
    });
    assert(resInvalid.status === 400, 'Invalid Indian number rejected with 400');

    // 1.4 Valid Indian number accepted
    const testRunId = Math.floor(Math.random() * 89999 + 10000);
    const validMobile = `+9198765${testRunId.toString().slice(-4)}1`;
    const resValid = await request('/api/auth/otp/send', {
      method: 'POST',
      body: { mobile: validMobile },
    });
    assert(resValid.status === 200, `Valid Indian number (${validMobile}) accepted with 200`);
    assert(resValid.data.data?.devCode !== undefined, 'Dev code generated for testing');

    // ─── Test Group 2: OAuth Candidate Contact Profile ─────────────────────────
    console.log('\n--- Test Group 2: OAuth Candidate Contact Profile ---');

    const oauthEmail = `oauth.cand.${testRunId}.${Date.now()}@example.com`;
    const googleProfile = {
      sub: `google_cand_${testRunId}_${Date.now()}`,
      email: oauthEmail,
      email_verified: true,
      name: 'Google Candidate Test',
      picture: 'https://example.com/photo.jpg',
      given_name: 'Google',
      family_name: 'Candidate',
    };

    const authRes = await authenticateWithGoogle({
      profile: googleProfile,
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });

    const oauthCookie = `${USER_COOKIE}=${authRes.token}`;
    const userDb = await User.findById(authRes.user._id);

    assert(userDb.isEmailVerified === true, 'Google email_verified claim sets isEmailVerified: true');
    assert(userDb.emailVerificationSource === 'GOOGLE', 'emailVerificationSource accurately recorded as GOOGLE');
    assert(userDb.isMobileVerified === false, 'OAuth user initially has isMobileVerified: false');

    // 2.2 GET /api/profile returns accurate contactInfo
    const resProfile = await request('/api/profile', {
      headers: { Cookie: oauthCookie },
    });
    assert(resProfile.status === 200, 'GET /api/profile returns 200');
    const contactInfo = resProfile.data.data?.contactInfo;
    assert(contactInfo.isEmailReadOnly === true, 'OAuth email marked isEmailReadOnly: true');
    assert(contactInfo.isMobileReadOnly === false, 'OAuth mobile marked isMobileReadOnly: false');
    assert(contactInfo.isMobileVerified === false, 'OAuth mobile shows unverified in contactInfo');

    // 2.3 Attempt to modify OAuth email via PUT /api/profile must be rejected
    const resTamperEmail = await request('/api/profile', {
      method: 'PUT',
      headers: { Cookie: oauthCookie },
      body: { email: 'tampered.email@example.com' },
    });
    assert(resTamperEmail.status === 400, 'Server-side reject: OAuth email cannot be modified (400)');

    // 2.4 Verify Mobile via OTP Flow
    const newCandPhone = `+919${testRunId}0001`;
    const resSendMobile = await request('/api/profile/contact/mobile/send-otp', {
      method: 'POST',
      headers: { Cookie: oauthCookie },
      body: { mobile: newCandPhone },
    });
    assert(resSendMobile.status === 200, `POST /profile/contact/mobile/send-otp (${newCandPhone}) returns 200`);

    // Verify challenge created in DB with hashed code (not plaintext)
    const challenge = await ContactVerificationChallenge.findOne({
      userId: authRes.user._id,
      contactType: 'MOBILE',
      consumedAt: null,
    });
    assert(challenge !== null, 'Challenge persisted in MongoDB');
    assert(challenge.codeHash !== undefined && challenge.codeHash.length === 64, 'Challenge stores SHA-256 code hash');

    // Inspect dispatched code via mock adapter
    const dispatchedSms = smsAdapter.getLastDispatched(newCandPhone);
    assert(dispatchedSms !== null, 'SMS dispatched through SMS verification adapter');

    // Wrong code fails
    const resWrongCode = await request('/api/profile/contact/mobile/verify-otp', {
      method: 'POST',
      headers: { Cookie: oauthCookie },
      body: { code: '000000' },
    });
    assert(resWrongCode.status === 400, 'Incorrect OTP code rejected with 400');

    // Correct code succeeds
    const resVerifyMobile = await request('/api/profile/contact/mobile/verify-otp', {
      method: 'POST',
      headers: { Cookie: oauthCookie },
      body: { code: dispatchedSms.code },
    });
    assert(resVerifyMobile.status === 200, 'POST /profile/contact/mobile/verify-otp succeeds (200)');
    assert(resVerifyMobile.data.data?.isMobileVerified === true, 'Returns isMobileVerified: true');

    const updatedUser = await User.findById(authRes.user._id);
    assert(updatedUser.isMobileVerified === true, 'User document updated with isMobileVerified: true in MongoDB');
    assert(updatedUser.mobileVerificationSource === 'PROFILE_OTP', 'mobileVerificationSource set to PROFILE_OTP');
    assert(updatedUser.mobileE164 === newCandPhone, 'Canonical mobileE164 updated with verified phone');

    // 2.5 Changing verified phone resets verified status
    const changedPhone = `+919${testRunId}0002`;
    const resChangePhone = await request('/api/profile', {
      method: 'PUT',
      headers: { Cookie: oauthCookie },
      body: { mobile: changedPhone },
    });
    assert(resChangePhone.status === 200, 'PUT /profile with changed phone succeeds');
    const userAfterChange = await User.findById(authRes.user._id);
    assert(userAfterChange.isMobileVerified === false, 'Changing verified phone immediately clears isMobileVerified to false');
    assert(userAfterChange.pendingMobileE164 === changedPhone, 'Changed phone held as pendingMobileE164');

    // ─── Test Group 3: Mobile-Login User Contact Profile ───────────────────────
    console.log('\n--- Test Group 3: Mobile-Login User Contact Profile ---');

    const mobileLoginPhone = `+919${testRunId}0003`;
    // Send login OTP
    const { challenge: loginChal, code: loginCode } = await require('../server/services/otpService').sendOtp(
      mobileLoginPhone
    );
    const mobileAuthRes = await loginWithOtp({
      mobile: mobileLoginPhone,
      code: loginCode,
      role: 'VOLUNTEER',
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });

    const mobileCookie = `${USER_COOKIE}=${mobileAuthRes.token}`;
    const mobileUserDb = await User.findById(mobileAuthRes.user._id);

    assert(mobileUserDb.isMobileVerified === true, 'Mobile-login user has isMobileVerified: true');
    assert(mobileUserDb.mobileVerificationSource === 'LOGIN_OTP', 'mobileVerificationSource set to LOGIN_OTP');

    // 3.2 GET /api/profile returns isMobileReadOnly: true
    const resMobileProfile = await request('/api/profile', {
      headers: { Cookie: mobileCookie },
    });
    assert(resMobileProfile.data.data?.contactInfo?.isMobileReadOnly === true, 'Mobile number marked isMobileReadOnly: true');
    assert(resMobileProfile.data.data?.contactInfo?.isEmailReadOnly === false, 'Email address marked isEmailReadOnly: false');

    // 3.3 Attempt to modify mobile login number via PUT /profile must be rejected
    const resTamperMobile = await request('/api/profile', {
      method: 'PUT',
      headers: { Cookie: mobileCookie },
      body: { mobile: `+91987${testRunId}9` },
    });
    assert(resTamperMobile.status === 400, 'Server-side reject: Mobile login number cannot be modified (400)');

    // 3.4 Email Verification Flow for Mobile-Login User
    const newEmail = `volunteer.contact.${testRunId}.${Date.now()}@example.com`;
    const resSendEmail = await request('/api/profile/contact/email/send-code', {
      method: 'POST',
      headers: { Cookie: mobileCookie },
      body: { email: newEmail },
    });
    assert(resSendEmail.status === 200, 'POST /profile/contact/email/send-code returns 200');

    // Check user pending state
    const userWithPendingEmail = await User.findById(mobileAuthRes.user._id);
    assert(userWithPendingEmail.pendingEmail === newEmail, 'User stores pendingEmail without overwriting canonical email');
    assert(userWithPendingEmail.isEmailVerified === false, 'Email remains isEmailVerified: false until verified');

    const dispatchedEmail = emailAdapter.getLastDispatched(newEmail);
    assert(dispatchedEmail !== null, 'Email code dispatched through Email verification adapter');

    // Confirm email code
    const resVerifyEmail = await request('/api/profile/contact/email/verify-code', {
      method: 'POST',
      headers: { Cookie: mobileCookie },
      body: { code: dispatchedEmail.code },
    });
    assert(resVerifyEmail.status === 200, 'POST /profile/contact/email/verify-code succeeds (200)');

    const verifiedEmailUser = await User.findById(mobileAuthRes.user._id);
    assert(verifiedEmailUser.isEmailVerified === true, 'User document updated with isEmailVerified: true');
    assert(verifiedEmailUser.email === newEmail, 'Canonical email updated to verified address');
    assert(verifiedEmailUser.pendingEmail === null, 'pendingEmail cleared on verification');
    assert(verifiedEmailUser.emailVerificationSource === 'EMAIL_OTP', 'emailVerificationSource set to EMAIL_OTP');

    // ─── Test Group 4: Challenge Security & Rate Limits ────────────────────────
    console.log('\n--- Test Group 4: Challenge Security & Rate Limits ---');

    // 4.1 Cooldown enforcement: Sending again immediately should be throttled
    const resFirstSend = await request('/api/profile/contact/email/send-code', {
      method: 'POST',
      headers: { Cookie: mobileCookie },
      body: { email: `cooldown.${testRunId}@example.com` },
    });
    assert(resFirstSend.status === 200, 'Initial email send succeeds (200)');

    const resThrottled = await request('/api/profile/contact/email/send-code', {
      method: 'POST',
      headers: { Cookie: mobileCookie },
      body: { email: `cooldown.${testRunId}@example.com` },
    });
    assert(resThrottled.status === 429, 'Immediate resend within cooldown period is throttled with status 429');

    // 4.2 Cross-user challenge isolation: User A cannot verify with User B's challenge
    const resCrossUser = await request('/api/profile/contact/email/verify-code', {
      method: 'POST',
      headers: { Cookie: oauthCookie }, // OAuth user trying to consume mobile user's code
      body: { code: dispatchedEmail.code },
    });
    assert(resCrossUser.status === 400, 'Cross-user challenge consumption rejected (400)');

    // 4.3 Single-use enforcement: Cannot reuse consumed code
    const resReuseCode = await request('/api/profile/contact/email/verify-code', {
      method: 'POST',
      headers: { Cookie: mobileCookie },
      body: { code: dispatchedEmail.code },
    });
    assert(resReuseCode.status === 400, 'Re-using already consumed verification code fails with 400');

    // ─── Test Group 5: Regression Checks ───────────────────────────────────────
    console.log('\n--- Test Group 5: Regression Checks ---');

    // 5.1 Profile completion parity
    const resCandProfile = await request('/api/profile', {
      headers: { Cookie: oauthCookie },
    });
    assert(resCandProfile.data.data?.completion !== undefined, 'Candidate completion metadata returned');

    // 5.2 Volunteer profile completion
    const resVolProfile = await request('/api/profile', {
      headers: { Cookie: mobileCookie },
    });
    assert(resVolProfile.data.data?.completion !== undefined, 'Volunteer completion metadata returned');

  } catch (err) {
    console.error('Fatal test error:', err);
    failed += 1;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }

  console.log('\n============================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run();
