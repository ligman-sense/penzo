'use strict';

const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { connectDB } = require('../server/config/database');
const User = require('../server/models/User');

const BASE_URL = 'http://localhost:3000';

function makeRequest(method, reqPath, body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
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

async function run() {
  await connectDB();
  console.log('Connected to DB. Starting Admin Modal Behavior & Lifecycle Verification...\n');

  // ─── 1. Check HTML Files Static State ─────────────────────────────────────────
  console.log('1. Checking HTML files modal markup...');
  const verifHtmlPath = path.join(__dirname, '../public/admin/verification.html');
  const reqHtmlPath = path.join(__dirname, '../public/admin/requests.html');
  const cssPath = path.join(__dirname, '../public/css/components.css');
  const modalJsPath = path.join(__dirname, '../public/js/modal.js');

  const verifHtml = fs.readFileSync(verifHtmlPath, 'utf8');
  const reqHtml = fs.readFileSync(reqHtmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  const modalJs = fs.readFileSync(modalJsPath, 'utf8');

  // Verification modal must have hidden attribute
  assert(verifHtml.includes('id="verification-modal" class="modal-backdrop" hidden'), 'verification-modal must have class="modal-backdrop" hidden');
  console.log('   ✓ verification.html modal starts hidden');

  // Requests modals must have hidden attribute
  assert(reqHtml.includes('id="matching-modal" class="modal-backdrop" hidden'), 'matching-modal must have class="modal-backdrop" hidden');
  assert(reqHtml.includes('id="propose-confirm-modal" class="modal-backdrop" hidden'), 'propose-confirm-modal must have class="modal-backdrop" hidden');
  assert(reqHtml.includes('id="request-detail-modal" class="modal-backdrop" hidden'), 'request-detail-modal must have class="modal-backdrop" hidden');
  assert(reqHtml.includes('id="volunteer-detail-modal" class="modal-backdrop" hidden'), 'volunteer-detail-modal must have class="modal-backdrop" hidden');
  console.log('   ✓ requests.html all 4 modals start hidden');

  // CSS must enforce hidden state
  assert(css.includes('.modal-backdrop[hidden]'), 'components.css must define .modal-backdrop[hidden]');
  assert(css.includes('display: none !important'), 'components.css must hide modal-backdrop when hidden');
  assert(css.includes('.modal-backdrop.is-open'), 'components.css must support .modal-backdrop.is-open');
  console.log('   ✓ components.css properly prevents automatic display:flex override');

  // modal.js utility functions
  assert(modalJs.includes('export function openModal'), 'modal.js must export openModal');
  assert(modalJs.includes('export function closeModal'), 'modal.js must export closeModal');
  assert(modalJs.includes('export function closeAllModals'), 'modal.js must export closeAllModals');
  assert(modalJs.includes('export function registerModal'), 'modal.js must export registerModal');
  console.log('   ✓ modal.js exports complete modal lifecycle API');

  // ─── 2. Test Admin Session & Endpoints ─────────────────────────────────────────
  console.log('\n2. Logging in as Admin to test authenticated responses...');
  const loginRes = await makeRequest('POST', '/api/admin/auth/login', {
    email: 'admin@example.invalid',
    password: 'Admin@123456',
  });
  assert.strictEqual(loginRes.status, 200, 'Admin login should succeed');
  const adminCookie = loginRes.rawCookie;
  assert(adminCookie, 'Admin cookie required');

  // Test Verification list
  const verifsRes = await makeRequest('GET', '/api/admin/verifications?page=1&pageSize=10', null, adminCookie);
  assert.strictEqual(verifsRes.status, 200);
  console.log(`   ✓ /api/admin/verifications returned ${verifsRes.data.data.length} records`);

  // If records exist, test individual verification record lookup
  if (verifsRes.data.data.length > 0) {
    const firstVerifId = verifsRes.data.data[0].id;
    const singleVerifRes = await makeRequest('GET', `/api/admin/verifications/${firstVerifId}`, null, adminCookie);
    assert.strictEqual(singleVerifRes.status, 200);
    assert(singleVerifRes.data.data.user, 'Verification record must include user data');
    console.log(`   ✓ /api/admin/verifications/${firstVerifId} retrieved for modal population`);
  }

  // Test Requests list
  const reqsRes = await makeRequest('GET', '/api/admin/requests?page=1&pageSize=10', null, adminCookie);
  assert.strictEqual(reqsRes.status, 200);
  console.log(`   ✓ /api/admin/requests returned ${reqsRes.data.data.length} requests`);

  // If requests exist, test request details lookup and matching lookup
  if (reqsRes.data.data.length > 0) {
    const firstReqId = reqsRes.data.data[0].id;
    const reqDetailRes = await makeRequest('GET', `/api/admin/requests/${firstReqId}`, null, adminCookie);
    assert.strictEqual(reqDetailRes.status, 200);
    console.log(`   ✓ /api/admin/requests/${firstReqId} retrieved for View Request modal`);

    const matchesRes = await makeRequest('GET', `/api/admin/requests/${firstReqId}/matches`, null, adminCookie);
    assert.strictEqual(matchesRes.status, 200);
    console.log(`   ✓ /api/admin/requests/${firstReqId}/matches retrieved for Find Suitable Volunteers modal`);
  }

  // Test Volunteer Interests list
  const interestsRes = await makeRequest('GET', '/api/admin/volunteer-interests?page=1&pageSize=10', null, adminCookie);
  assert.strictEqual(interestsRes.status, 200);
  console.log(`   ✓ /api/admin/volunteer-interests returned ${interestsRes.data.data.length} records`);

  // Test Matches list
  const matchesListRes = await makeRequest('GET', '/api/admin/matches?page=1&pageSize=10', null, adminCookie);
  assert.strictEqual(matchesListRes.status, 200);
  console.log(`   ✓ /api/admin/matches returned ${matchesListRes.data.data.length} records`);

  // ─── 3. Verify Static Asset Serving ───────────────────────────────────────────
  console.log('\n3. Verifying HTTP delivery of pages and scripts...');
  const verifPageRes = await makeRequest('GET', '/admin/verification.html');
  assert.strictEqual(verifPageRes.status, 200);

  const requestsPageRes = await makeRequest('GET', '/admin/requests.html');
  assert.strictEqual(requestsPageRes.status, 200);

  const modalModuleRes = await makeRequest('GET', '/js/modal.js');
  assert.strictEqual(modalModuleRes.status, 200);

  const verifScriptRes = await makeRequest('GET', '/js/admin/verification.js');
  assert.strictEqual(verifScriptRes.status, 200);

  const reqScriptRes = await makeRequest('GET', '/js/admin/requests.js');
  assert.strictEqual(reqScriptRes.status, 200);

  console.log('   ✓ /admin/verification.html served (HTTP 200)');
  console.log('   ✓ /admin/requests.html served (HTTP 200)');
  console.log('   ✓ /js/modal.js served (HTTP 200)');
  console.log('   ✓ /js/admin/verification.js served (HTTP 200)');
  console.log('   ✓ /js/admin/requests.js served (HTTP 200)');

  console.log('\n===============================================================');
  console.log(' MODAL SYSTEM & LIFECYCLE TESTS VERIFIED SUCCESSFULLY! ');
  console.log('===============================================================\n');

  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
