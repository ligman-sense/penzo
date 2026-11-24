#!/usr/bin/env node
'use strict';

/**
 * End-to-end verification script for Candidate & Volunteer login flows
 */
const http = require('http');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body, cookie = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
    };
    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    if (cookie) {
      headers['Cookie'] = cookie;
      console.log('Sending Cookie header:', cookie);
    }

    const req = http.request(
      url,
      { method, headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let data;
          try {
            data = JSON.parse(raw);
          } catch {
            data = raw;
          }
          const setCookie = res.headers['set-cookie'];
          let sessionCookie = null;
          if (setCookie) {
            console.log('Set-Cookie raw:', setCookie);
            const found = setCookie.find(c => c.startsWith('penzo_session='));
            if (found) {
              sessionCookie = found.split(';')[0];
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, data, sessionCookie });
        });
      }
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function testUserFlow(roleName, mobile) {
  console.log(`\n=== Testing ${roleName} Login Flow (${mobile}) ===`);

  // Step 1: Send OTP
  console.log(`1. Sending OTP to ${mobile}...`);
  const sendRes = await request('POST', '/api/auth/otp/send', { mobile });
  console.log(`Status: ${sendRes.status}`, sendRes.data);
  if (sendRes.status !== 200) {
    throw new Error(`Failed to send OTP: ${JSON.stringify(sendRes.data)}`);
  }
  const devCode = sendRes.data?.data?.devCode;
  console.log(`Received devCode: ${devCode}`);
  if (!devCode) {
    throw new Error('devCode was not returned in dev mode');
  }

  // Step 2: Verify OTP
  console.log(`2. Verifying OTP with code ${devCode}...`);
  const verifyRes = await request('POST', '/api/auth/otp/verify', {
    mobile,
    otp: devCode,
  });
  console.log(`Status: ${verifyRes.status}`, verifyRes.data);
  if (verifyRes.status !== 200) {
    throw new Error(`Failed to verify OTP: ${JSON.stringify(verifyRes.data)}`);
  }
  const sessionCookie = verifyRes.sessionCookie;
  console.log(`Session cookie obtained: ${sessionCookie ? 'YES' : 'NO'}`);

  // Step 3: Check Session
  console.log('3. Checking /api/auth/session...');
  const sessionRes = await request('GET', '/api/auth/session', null, sessionCookie);
  console.log(`Session info:`, sessionRes.data);
  if (!sessionRes.data?.data?.authenticated) {
    throw new Error('Session is not authenticated');
  }

  // Step 4: Check Dashboard
  console.log('4. Calling /api/dashboard...');
  const dashRes = await request('GET', '/api/dashboard', null, sessionCookie);
  console.log(`Dashboard data:`, dashRes.data);
  if (dashRes.status !== 200) {
    throw new Error(`Failed to fetch dashboard: ${JSON.stringify(dashRes.data)}`);
  }

  console.log(`PASS: ${roleName} login and dashboard access verified!`);
}

async function run() {
  try {
    await testUserFlow('Candidate', '+00012345001');
    await testUserFlow('Volunteer', '+00012345002');
    console.log('\n========================================');
    console.log('ALL CANDIDATE & VOLUNTEER TESTS PASSED!');
    console.log('========================================\n');
  } catch (err) {
    console.error('\nFAIL:', err.message);
    process.exit(1);
  }
}

run();
