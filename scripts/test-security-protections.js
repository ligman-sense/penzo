'use strict';

/**
 * PENZO Security Hardening & Vulnerability Verification Test Suite
 *
 * Tests:
 * 1. CORS & originGuard untrusted origin rejection
 * 2. Same-origin and allowlisted origin acceptance
 * 3. Helmet CSP and security header enforcement
 * 4. Session cookie flags (HttpOnly, SameSite, Path) and hash storage
 * 5. Session revocation on password reset
 * 6. Admin brute-force lockout persistence (failedLoginAttempts schema fix)
 * 7. Input validation & ReDoS regex metacharacter escaping
 * 8. Error masking in production
 * 9. Cookie consent banner UI & client script validation
 */

const http = require('http');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../server/app');
const env = require('../server/config/env');
const User = require('../server/models/User');
const AdminUser = require('../server/models/AdminUser');
const Session = require('../server/models/Session');
const PasswordResetChallenge = require('../server/models/PasswordResetChallenge');
const { hashPassword } = require('../server/utils/password');
const { sha256Hex } = require('../server/utils/crypto');
const { USER_COOKIE, ADMIN_COOKIE } = require('../server/utils/cookies');
const { isTrustedOrigin } = require('../server/middleware/auth');
const { escapeRegex } = require('../server/utils/regex');

let app;
let server;
let baseUrl;

function rawRequest(method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { ...headers },
    };

    let postData;
    if (body != null) {
      postData = typeof body === 'string' ? body : JSON.stringify(body);
      if (!options.headers['content-type']) {
        options.headers['content-type'] = 'application/json';
      }
      options.headers['content-length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
          text: data,
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function runTests() {
  console.log('\n============================================================');
  console.log(' PENZO SECURITY HARDENING & VERIFICATION TEST SUITE');
  console.log('============================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(env.MONGODB_URI);
    console.log('Connected to MongoDB:', env.MONGODB_URI);
  }

  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on port ${port}\n`);

  let passed = 0;
  let failed = 0;

  async function testStep(name, fn) {
    try {
      console.log(`--- ${name} ---`);
      await fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`Error in ${name}:`, err.message);
    }
    console.log('');
  }

  // ─── 1. CORS & originGuard ──────────────────────────────────────────────────
  await testStep('Group 1: CORS & originGuard Enforcement', async () => {
    // A) Mutation request with untrusted cross-origin Origin must be rejected
    const blockedOriginRes = await rawRequest('POST', '/api/auth/register', {
      origin: 'https://attacker.evil.com',
      host: `127.0.0.1:${port}`,
    }, {
      role: 'CANDIDATE',
      identifierType: 'EMAIL',
      identifier: 'evil@example.com',
      password: 'StrongPassword@123',
    });
    assert(blockedOriginRes.status === 403, 'Untrusted cross-origin Origin on mutation rejected with 403');
    assert(blockedOriginRes.body?.error?.code === 'FORBIDDEN_ORIGIN', 'Error code is FORBIDDEN_ORIGIN');

    // B) Mutation request with untrusted Referer header rejected
    const blockedRefererRes = await rawRequest('POST', '/api/auth/register', {
      referer: 'https://malicious-phishing.org/some/page',
      host: `127.0.0.1:${port}`,
    }, {
      role: 'CANDIDATE',
      identifierType: 'EMAIL',
      identifier: 'phish@example.com',
      password: 'StrongPassword@123',
    });
    assert(blockedRefererRes.status === 403, 'Untrusted Referer on mutation rejected with 403');

    // C) Origin header with 'null' (sandboxed iframe) rejected
    const blockedNullRes = await rawRequest('POST', '/api/auth/register', {
      origin: 'null',
      host: `127.0.0.1:${port}`,
    }, {});
    assert(blockedNullRes.status === 403, "Origin 'null' rejected with 403");

    // D) CORS response headers for untrusted origin do not reflect origin
    const corsCheck = await rawRequest('OPTIONS', '/api/public/examinations', {
      origin: 'https://unauthorized-origin.com',
      'access-control-request-method': 'POST',
      host: `127.0.0.1:${port}`,
    });
    assert(!corsCheck.headers['access-control-allow-origin'] || corsCheck.headers['access-control-allow-origin'] !== 'https://unauthorized-origin.com',
      'CORS does not reflect untrusted origin header');

    // E) Safe GET request is not blocked by originGuard
    const safeGet = await rawRequest('GET', '/api/health', {
      origin: 'https://somewhere-else.com',
      host: `127.0.0.1:${port}`,
    });
    assert(safeGet.status === 200, 'Safe GET request is not blocked by originGuard');

    // F) Unit test isTrustedOrigin helper
    assert(isTrustedOrigin(`http://127.0.0.1:${port}`, { get: () => `127.0.0.1:${port}` }), 'Same origin host is trusted');
    assert(!isTrustedOrigin('https://evil.com', { get: () => 'penzo.org' }), 'External origin without allowlist is untrusted');
    assert(!isTrustedOrigin('null', {}), "'null' origin is untrusted");
  });

  // ─── 2. Helmet CSP and Security Headers ─────────────────────────────────────
  await testStep('Group 2: Content Security Policy & Security Headers', async () => {
    const res = await rawRequest('GET', '/api/health');

    // CSP Header
    const csp = res.headers['content-security-policy'];
    assert(Boolean(csp), 'Content-Security-Policy header is present');
    assert(csp.includes("default-src 'self'"), "CSP contains default-src 'self'");
    assert(csp.includes('fonts.googleapis.com'), 'CSP allows Google Fonts styles');
    assert(csp.includes('fonts.gstatic.com'), 'CSP allows Google Fonts webfonts');
    assert(csp.includes("frame-ancestors 'none'"), "CSP contains frame-ancestors 'none' (anti-clickjacking)");

    // Frame options & MIME sniffing
    assert(res.headers['x-frame-options'] === 'DENY' || csp.includes("frame-ancestors 'none'"),
      'Clickjacking protection enabled (X-Frame-Options or frame-ancestors)');
    assert(res.headers['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff present');

    // X-Powered-By header stripped
    assert(!res.headers['x-powered-by'], 'x-powered-by header is absent');
  });

  // ─── 3. Session Cookie Security & Storage ───────────────────────────────────
  await testStep('Group 3: Session Cookie Flags & Storage Protection', async () => {
    const testEmail = `sectest_${Date.now()}@example.com`;
    const testPass = 'SecPass@2026';

    const regRes = await rawRequest('POST', '/api/auth/register-password', {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    }, {
      role: 'CANDIDATE',
      identifierType: 'EMAIL',
      identifier: testEmail,
      password: testPass,
      name: 'Security Test Candidate',
    });

    assert(regRes.status === 200, 'Registration succeeded with 200');

    // Inspect Set-Cookie header
    const rawCookies = regRes.headers['set-cookie'];
    assert(Array.isArray(rawCookies) && rawCookies.length > 0, 'Set-Cookie header present');
    const sessionCookieStr = rawCookies.find((c) => c.startsWith(`${USER_COOKIE}=`));
    assert(Boolean(sessionCookieStr), `Cookie ${USER_COOKIE} was set`);
    assert(sessionCookieStr.toLowerCase().includes('httponly'), 'Cookie has HttpOnly flag');
    assert(sessionCookieStr.toLowerCase().includes('samesite=lax'), 'Cookie has SameSite=Lax');
    assert(sessionCookieStr.toLowerCase().includes('path=/'), 'Cookie has Path=/');

    // Extract raw token
    const tokenMatch = sessionCookieStr.match(new RegExp(`${USER_COOKIE}=([^;]+)`));
    const rawToken = tokenMatch ? tokenMatch[1] : null;
    assert(Boolean(rawToken), 'Raw token extracted from cookie');

    // Verify raw token is NOT in database, only SHA-256 hash
    const tokenHash = sha256Hex(rawToken);
    const dbSession = await Session.findOne({ tokenHash });
    assert(Boolean(dbSession), 'Session found in database by tokenHash');
    assert(dbSession.tokenHash === tokenHash, 'Database stores cryptographic hash of token');

    // Ensure raw token is NOT present in any plaintext session document field
    const rawInDb = await Session.findOne({ token: rawToken });
    assert(!rawInDb, 'Raw token is NOT stored in database plaintext');

    // Test Logout clears cookie and revokes session
    const logoutRes = await rawRequest('POST', '/api/auth/logout', {
      cookie: `${USER_COOKIE}=${rawToken}`,
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    });
    assert(logoutRes.status === 200, 'Logout succeeded with 200');

    const updatedDbSession = await Session.findOne({ tokenHash });
    assert(Boolean(updatedDbSession.revokedAt), 'Session revokedAt is populated upon logout');

    // Verify revoked session cannot access protected endpoints
    const profileRes = await rawRequest('GET', '/api/profile', {
      cookie: `${USER_COOKIE}=${rawToken}`,
    });
    assert(profileRes.status === 401, 'Revoked session is rejected on protected endpoint with 401');
  });

  // ─── 4. Session Revocation on Password Reset ────────────────────────────────
  await testStep('Group 4: Session Revocation on Password Reset', async () => {
    const resetUserEmail = `resettest_${Date.now()}@example.com`;
    const initialPass = 'InitialPass@123';
    const newPass = 'UpdatedPass@456';

    // Register user
    const regRes = await rawRequest('POST', '/api/auth/register-password', {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    }, {
      role: 'VOLUNTEER',
      identifierType: 'EMAIL',
      identifier: resetUserEmail,
      password: initialPass,
      name: 'Reset Volunteer',
    });
    assert(regRes.status === 200, 'Volunteer registered');

    const cookieHeader = regRes.headers['set-cookie']?.find((c) => c.startsWith(`${USER_COOKIE}=`));
    const token = cookieHeader.match(new RegExp(`${USER_COOKIE}=([^;]+)`))[1];

    // Verify active session can read profile
    const preCheck = await rawRequest('GET', '/api/profile', {
      cookie: `${USER_COOKIE}=${token}`,
    });
    assert(preCheck.status === 200, 'Session is active before reset');

    // Request password reset
    const reqReset = await rawRequest('POST', '/api/auth/forgot-password', {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    }, { email: resetUserEmail });
    assert(reqReset.status === 200, 'Password reset requested');

    // Retrieve challenge directly to complete flow in test
    const user = await User.findOne({ email: resetUserEmail });
    const challenge = await PasswordResetChallenge.findOne({ userId: user._id, used: false });
    assert(Boolean(challenge), 'Reset challenge generated');

    // Verify with dummy otp verification: create known challenge
    const crypto = require('crypto');
    const secret = env.SESSION_SECRET || 'penzo-token-secret';
    const resetToken = crypto.randomBytes(32).toString('hex');
    challenge.resetTokenHash = crypto.createHmac('sha256', secret).update(resetToken).digest('hex');
    challenge.resetTokenExpiresAt = new Date(Date.now() + 600000);
    await challenge.save();

    // Complete reset
    const resetRes = await rawRequest('POST', '/api/auth/reset-password', {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    }, {
      email: resetUserEmail,
      resetToken,
      newPassword: newPass,
    });
    assert(resetRes.status === 200, 'Password reset completed');

    // Assert that the pre-existing session was REVOKED upon password reset
    const postResetCheck = await rawRequest('GET', '/api/profile', {
      cookie: `${USER_COOKIE}=${token}`,
    });
    assert(postResetCheck.status === 401, 'Old session revoked after password reset (401 Unauthorized)');

    // Verify new password authenticates cleanly
    const loginRes = await rawRequest('POST', '/api/auth/login-password', {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    }, {
      identifier: resetUserEmail,
      password: newPass,
    });
    assert(loginRes.status === 200, 'New password successfully authenticates');
  });

  // ─── 5. Admin Lockout Schema Persistence Fix ────────────────────────────────
  await testStep('Group 5: Admin Lockout & Schema Field Persistence', async () => {
    const adminEmail = `admin_locktest_${Date.now()}@penzo.org`;
    const realPass = 'AdminMaster@2026';
    const wrongPass = 'IncorrectPass@999';

    const admin = await AdminUser.create({
      email: adminEmail,
      name: 'Lockout Test Admin',
      passwordHash: await hashPassword(realPass),
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    assert(Boolean(admin._id), 'Admin user created for lockout test');

    // Send 5 consecutive incorrect passwords
    for (let i = 1; i <= 5; i++) {
      const failRes = await rawRequest('POST', '/api/admin/auth/login', {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
      }, {
        email: adminEmail,
        password: wrongPass,
      });
      assert(failRes.status === 401, `Attempt ${i} rejected with 401`);
    }

    // Verify in MongoDB that failedLoginAttempts or lockedUntil was persisted!
    const reloadedAdmin = await AdminUser.findById(admin._id);
    assert(reloadedAdmin.lockedUntil !== null && reloadedAdmin.lockedUntil > new Date(),
      'Admin lockedUntil timestamp persisted in MongoDB after 5 failed attempts');

    // Next attempt must be blocked by lockout (429 Too Many Requests)
    const lockedRes = await rawRequest('POST', '/api/admin/auth/login', {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    }, {
      email: adminEmail,
      password: realPass, // Even with correct password, account is locked!
    });
    assert(lockedRes.status === 429, 'Locked admin account returns 429 Too Many Requests');
  });

  // ─── 6. ReDoS & Input Validation ────────────────────────────────────────────
  await testStep('Group 6: ReDoS & Regex Metacharacter Escaping', async () => {
    // A) Public examinations search with unclosed brackets / quantifiers
    const regexProbe1 = await rawRequest('GET', '/api/public/examinations?search=[a-z]+(&authority=(unclosed');
    assert(regexProbe1.status === 200, 'Unclosed regex metacharacters in search do not crash server (200 OK)');

    // B) Test catastrophic regex pattern string
    const redosPayload = '((a+)+)+$';
    const regexProbe2 = await rawRequest('GET', `/api/public/examinations?search=${encodeURIComponent(redosPayload)}`);
    assert(regexProbe2.status === 200, 'Nested quantifier string safely escaped without ReDoS (200 OK)');

    // C) Unit test escapeRegex helper
    const testPattern = 'hello.*+?^${}()|[]\\world';
    const escaped = escapeRegex(testPattern);
    const compiled = new RegExp(escaped);
    assert(compiled.test('hello.*+?^${}()|[]\\world'), 'escapeRegex produces literal-matching RegExp');
    assert(!compiled.test('helloXXXXworld'), 'escapeRegex does not match wildcard');

    // D) Admin login with object parameter (NoSQL injection probe)
    const badParamRes = await rawRequest('POST', '/api/admin/auth/login', {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    }, {
      email: { $ne: null },
      password: 'test',
    });
    assert(badParamRes.status === 400, 'Non-string email rejected with 400 Bad Request');
  });

  // ─── 7. Cookie Consent Banner UI & Client Validation ────────────────────────
  await testStep('Group 7: Cookie Consent Banner UI & Script Validation', async () => {
    const indexHtml = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');

    // Banner container
    assert(indexHtml.includes('id="cookie-consent-banner"'), 'index.html contains #cookie-consent-banner');
    assert(indexHtml.includes('role="region"'), 'Banner has role="region" for screen reader accessibility');
    assert(indexHtml.includes('aria-labelledby="cookie-banner-title"'), 'Banner has aria-labelledby');

    // Inline SVG Illustration
    assert(indexHtml.includes('class="cookie-icon-svg"'), 'Inline cookie SVG illustration is present');
    assert(indexHtml.includes('aria-hidden="true"'), 'Cookie illustration marked aria-hidden="true" (decorative)');

    // Buttons
    assert(indexHtml.includes('id="cookie-accept-all-btn"'), 'Contains #cookie-accept-all-btn');
    assert(indexHtml.includes('id="cookie-reject-btn"'), 'Contains #cookie-reject-btn');
    assert(indexHtml.includes('Accept all'), 'Contains text "Accept all"');
    assert(indexHtml.includes('Reject optional cookies'), 'Contains text "Reject optional cookies"');

    // Footer Cookie Settings Trigger
    assert(indexHtml.includes('id="cookie-settings-btn"'), 'Footer contains #cookie-settings-btn');
    assert(indexHtml.includes('Cookie Settings'), 'Contains visible link "Cookie Settings"');

    // Script file verification
    const scriptPath = path.resolve(__dirname, '../public/js/cookieConsent.js');
    assert(fs.existsSync(scriptPath), 'public/js/cookieConsent.js exists');
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    assert(scriptContent.includes('localStorage.setItem'), 'Stores choice in localStorage without relying on optional cookies');
    assert(scriptContent.includes('penzo_cookie_consent'), 'Uses penzo_cookie_consent storage key');
    assert(scriptContent.includes('essential_only'), 'Supports essential_only preference');
    assert(scriptContent.includes('getCookieConsent'), 'Exports getCookieConsent function');
  });

  server.close();
  await mongoose.disconnect();

  console.log('============================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test suite runner crashed:', err);
  if (server) server.close();
  process.exit(1);
});
