'use strict';

/**
 * PENZO — Google OAuth 2.0 Integration Test Suite
 * Validates:
 * 1. Google OAuth configuration check & URL generation
 * 2. GET /api/auth/google redirect and state cookie generation
 * 3. GET /api/auth/google/callback CSRF state validation & error handling
 * 4. User creation with authProvider: 'GOOGLE', googleId, and CandidateProfile
 * 5. Account linking for existing users with matching email
 * 6. Session establishment, cookie persistence, and dashboard access
 * 7. Role selection transition for new Google users
 */

const http = require('http');
const mongoose = require('mongoose');
const { createApp } = require('../server/app');
const { connectDB } = require('../server/config/database');
const env = require('../server/config/env');

const User = require('../server/models/User');
const CandidateProfile = require('../server/models/CandidateProfile');
const VolunteerProfile = require('../server/models/VolunteerProfile');
const {
  isGoogleOAuthConfigured,
  getGoogleAuthUrl,
  authenticateWithGoogle,
} = require('../server/services/googleAuthService');

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
          const setCookieHeaders = res.headers['set-cookie'] || [];
          let sessionCookie = null;
          let stateCookie = null;
          for (const c of setCookieHeaders) {
            if (c.startsWith('penzo_session=')) sessionCookie = c.split(';')[0];
            if (c.startsWith('penzo_oauth_state=')) stateCookie = c.split(';')[0];
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            location: res.headers.location,
            body: json || raw,
            sessionCookie,
            stateCookie,
            setCookieHeaders,
          });
        });
      }
    );
    r.on('error', reject);
    if (postData) r.write(postData);
    r.end();
  });
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
  console.log(' PENZO GOOGLE OAUTH INTEGRATION TEST SUITE');
  console.log('============================================================\n');

  // Provide mock Google env credentials for test validation
  env.GOOGLE_CLIENT_ID = 'test-client-id-12345.apps.googleusercontent.com';
  env.GOOGLE_CLIENT_SECRET = 'test-client-secret-abcde';
  env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/auth/google/callback';

  await connectDB({ exitOnError: false });
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
  console.log(`Test server running on port ${port}\n`);

  // -------------------------------------------------------------
  // Test 1: Configuration check and Google Auth URL generation
  // -------------------------------------------------------------
  console.log('--- Test Group 1: Configuration & Auth URL Construction ---');
  assert(isGoogleOAuthConfigured(), 'isGoogleOAuthConfigured() returns true when credentials exist');

  const testState = 'sample_secure_state_token_123';
  const authUrl = getGoogleAuthUrl(testState);
  assert(authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), 'Auth URL targets Google OAuth endpoint');
  assert(authUrl.includes(`client_id=${env.GOOGLE_CLIENT_ID}`), 'Auth URL includes client_id');
  assert(authUrl.includes(`state=${testState}`), 'Auth URL includes state parameter');
  assert(authUrl.includes('scope=openid+email+profile') || authUrl.includes('scope=openid%20email%20profile'), 'Auth URL requests openid, email, and profile scopes');

  // -------------------------------------------------------------
  // Test 2: GET /api/auth/google endpoint behavior
  // -------------------------------------------------------------
  console.log('\n--- Test Group 2: GET /api/auth/google Endpoint Flow ---');
  const initRes = await req('GET', '/api/auth/google');
  assert(initRes.status === 302, 'Initiating Google OAuth redirects with status 302');
  assert(Boolean(initRes.location && initRes.location.startsWith('https://accounts.google.com/')), 'Location header points to Google Accounts');
  assert(Boolean(initRes.stateCookie), 'Sets penzo_oauth_state HTTP-only cookie');

  // Extract state from location
  const redirectUrl = new URL(initRes.location);
  const stateFromUrl = redirectUrl.searchParams.get('state');
  const stateFromCookie = initRes.stateCookie.split('=')[1];
  assert(stateFromUrl === stateFromCookie, 'State param in redirect URL matches state stored in cookie');

  // -------------------------------------------------------------
  // Test 3: GET /api/auth/google/callback CSRF State Validation
  // -------------------------------------------------------------
  console.log('\n--- Test Group 3: Callback CSRF State & Error Handling ---');
  // Error returned by Google (e.g. user denied consent)
  const errorCallback = await req('GET', '/api/auth/google/callback?error=access_denied');
  assert(errorCallback.status === 302, 'Google error returns 302 redirect');
  assert(errorCallback.location.includes('/login.html?error=access_denied'), 'Redirects to login page with error param');

  // Missing code or state
  const missingCode = await req('GET', '/api/auth/google/callback?state=xyz');
  assert(missingCode.location.includes('/login.html?error=MISSING_AUTH_CODE'), 'Missing code redirects with MISSING_AUTH_CODE');

  // Tampered/invalid state
  const invalidState = await req('GET', '/api/auth/google/callback?code=mock_code&state=tampered_state', null, initRes.stateCookie);
  assert(invalidState.location.includes('/login.html?error=INVALID_OAUTH_STATE'), 'Mismatched state redirects with INVALID_OAUTH_STATE');

  // -------------------------------------------------------------
  // Test 4: New User Creation via Google Profile
  // -------------------------------------------------------------
  console.log('\n--- Test Group 4: New User Creation & Profile Setup ---');
  const googleUserEmail = 'new.google.user@example.com';
  const googleId1 = 'google_sub_100000000001';
  await User.deleteOne({ email: googleUserEmail });
  await User.deleteOne({ googleId: googleId1 });

  const mockGoogleProfile = {
    sub: googleId1,
    email: googleUserEmail,
    email_verified: true,
    name: 'Google Scholar',
    given_name: 'Google',
    family_name: 'Scholar',
    picture: 'https://lh3.googleusercontent.com/a/sample_avatar_url',
  };

  const authResult = await authenticateWithGoogle({
    profile: mockGoogleProfile,
    ip: '127.0.0.1',
    userAgent: 'PenzoTestRunner/1.0',
  });

  assert(authResult.isNewUser === true, 'authenticateWithGoogle flags user as isNewUser: true');
  assert(authResult.user.googleId === googleId1, 'User record created with googleId');
  assert(authResult.user.authProvider === 'GOOGLE', 'User record created with authProvider: GOOGLE');
  assert(authResult.user.email === googleUserEmail, 'User record has normalized email');
  assert(authResult.user.avatarUrl === mockGoogleProfile.picture, 'User record captures avatarUrl');

  // Verify CandidateProfile created
  const cp = await CandidateProfile.findOne({ userId: authResult.user._id });
  assert(cp && cp.fullName === 'Google Scholar', 'CandidateProfile created with Google name');

  // -------------------------------------------------------------
  // Test 5: Account Linking with Existing Email
  // -------------------------------------------------------------
  console.log('\n--- Test Group 5: Account Linking via Verified Email ---');
  const existingEmail = 'existing.student@example.com';
  const googleId2 = 'google_sub_200000000002';
  await User.deleteOne({ email: existingEmail });

  // Create an existing user (e.g. originally registered via OTP)
  const existingUser = await User.create({
    role: 'VOLUNTEER',
    email: existingEmail,
    mobileE164: '+919999111222',
    authProvider: 'OTP',
    status: 'ACTIVE',
  });

  const linkResult = await authenticateWithGoogle({
    profile: {
      sub: googleId2,
      email: existingEmail,
      name: 'Linked Volunteer',
      picture: 'https://lh3.googleusercontent.com/avatar2.jpg',
    },
    ip: '127.0.0.1',
    userAgent: 'PenzoTestRunner/1.0',
  });

  assert(linkResult.isNewUser === false, 'Account linking flags user as isNewUser: false');
  assert(linkResult.user._id.toString() === existingUser._id.toString(), 'Linked to existing user account');
  assert(linkResult.user.googleId === googleId2, 'Existing user account updated with googleId');
  assert(linkResult.user.role === 'VOLUNTEER', 'Existing user role preserved');

  // -------------------------------------------------------------
  // Test 6: Session & Dashboard Access for Google Authenticated User
  // -------------------------------------------------------------
  console.log('\n--- Test Group 6: Session & Dashboard Retrieval ---');
  const cookieHeader = `penzo_session=${authResult.token}`;

  const sessionRes = await req('GET', '/api/auth/session', null, cookieHeader);
  assert(sessionRes.status === 200, 'GET /api/auth/session returns 200');
  assert(sessionRes.body?.data?.authenticated === true, 'Session is authenticated');
  assert(sessionRes.body?.data?.user?.authProvider === 'GOOGLE', 'Session user has authProvider: GOOGLE');
  assert(sessionRes.body?.data?.user?.avatarUrl === mockGoogleProfile.picture, 'Session user has avatarUrl');

  const dashRes = await req('GET', '/api/dashboard', null, cookieHeader);
  assert(dashRes.status === 200, 'GET /api/dashboard accessible with Google session cookie (200)');

  // -------------------------------------------------------------
  // Test 7: Role Selection Transition for New Google User
  // -------------------------------------------------------------
  console.log('\n--- Test Group 7: Role Selection Transition ---');
  // New Google user switches to VOLUNTEER
  const roleUpdateRes = await req('POST', '/api/auth/register', { role: 'VOLUNTEER' }, cookieHeader);
  assert(roleUpdateRes.status === 200, 'POST /api/auth/register succeeds for Google user');
  assert(roleUpdateRes.body?.data?.role === 'VOLUNTEER', 'User role transitioned to VOLUNTEER');

  const updatedUser = await User.findById(authResult.user._id);
  assert(updatedUser.role === 'VOLUNTEER', 'User role persisted in MongoDB as VOLUNTEER');

  const vp = await VolunteerProfile.findOne({ userId: authResult.user._id });
  assert(Boolean(vp), 'VolunteerProfile created upon role selection');

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
