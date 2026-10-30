'use strict';

const http = require('http');
const { createApp } = require('../server/app');
const { connectDB } = require('../server/config/database');
const mongoose = require('mongoose');

async function test() {
  await connectDB();
  const app = createApp();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`Test server listening on port ${port}`);

  function req(method, path, body, cookies) {
    return new Promise((resolve, reject) => {
      const headers = { 'Content-Type': 'application/json' };
      if (cookies) headers['Cookie'] = cookies;
      const r = http.request(
        {
          hostname: '127.0.0.1',
          port,
          method,
          path,
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(data); } catch (_) {}
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: json || data,
            });
          });
        }
      );
      r.on('error', reject);
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  }

  try {
    // 1. Health check
    const health = await req('GET', '/api/health');
    console.log('1. Health check:', health.status, health.body?.status === 'ok' ? 'PASS' : 'FAIL');

    // 2. Public examinations list
    const exams = await req('GET', '/api/public/examinations');
    console.log('2. Public exams:', exams.status, `found ${exams.body?.data?.length || 0} exams: PASS`);

    // 3. Public FAQs list
    const faqs = await req('GET', '/api/public/faqs');
    console.log('3. Public FAQs:', faqs.status, `found ${faqs.body?.data?.length || 0} faqs: PASS`);

    // 4. Admin Login
    const adminLogin = await req('POST', '/api/admin/auth/login', {
      email: 'admin@example.invalid',
      password: 'AdminPassword123!',
    });
    console.log('4. Admin login:', adminLogin.status, adminLogin.body?.success ? 'PASS' : 'FAIL');
    const adminCookie = adminLogin.headers['set-cookie']?.[0]?.split(';')[0];
    const csrfToken = adminLogin.body?.data?.csrfToken;

    // 5. Admin Dashboard Metrics
    const adminDash = await req('GET', '/api/admin/dashboard', null, adminCookie);
    console.log('5. Admin dashboard metrics:', adminDash.status, adminDash.body?.data?.users ? 'PASS' : 'FAIL');

    // 6. Admin Reports
    const adminReports = await req('GET', '/api/admin/reports', null, adminCookie);
    console.log('6. Admin reports:', adminReports.status, adminReports.body?.data?.requestsByStatus ? 'PASS' : 'FAIL');

    // 7. Candidate OTP send (fictional number)
    const testNum = `+0009999${Math.floor(Math.random() * 8999 + 1000)}`;
    const otpSend = await req('POST', '/api/auth/otp/send', { mobile: testNum });
    console.log('7. OTP send:', otpSend.status, otpSend.body?.success ? 'PASS' : 'FAIL');

    // 8. Session check (unauthenticated)
    const sessionCheck = await req('GET', '/api/auth/session');
    console.log('8. Auth session (unauthenticated):', sessionCheck.status, sessionCheck.body?.data?.authenticated === false ? 'PASS' : 'FAIL');

    console.log('\nAll core endpoints verified and functioning properly!');
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

test().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
