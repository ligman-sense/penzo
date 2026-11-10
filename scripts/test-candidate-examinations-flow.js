'use strict';

const http = require('http');
const assert = require('assert');
const { connectDB } = require('../server/config/database');
const User = require('../server/models/User');
const OtpChallenge = require('../server/models/OtpChallenge');
const Examination = require('../server/models/Examination');
const ScribeRequest = require('../server/models/ScribeRequest');

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
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
          rawCookie: res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0] : null,
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
  console.log('Connected to DB. Starting Candidate Examinations & Request Flow Test...');

  const mobileE164 = '+919988776655';

  // Clean up fresh state for this candidate
  const existingUser = await User.findOne({ mobileE164 });
  if (existingUser) {
    await ScribeRequest.deleteMany({ candidateId: existingUser._id });
    const CandidateProfile = require('../server/models/CandidateProfile');
    await CandidateProfile.deleteMany({ userId: existingUser._id });
    await User.deleteMany({ _id: existingUser._id });
  }

  // 1. Send OTP
  console.log('\n1. Sending OTP for Candidate...');
  const otpSendRes = await makeRequest('POST', '/api/auth/otp/send', {
    mobile: mobileE164,
    role: 'CANDIDATE',
  });
  assert.strictEqual(otpSendRes.status, 200, 'OTP send should succeed');

  const devCode = otpSendRes.data?.data?.devCode;
  assert(devCode, 'devCode must be returned in dev mode');
  console.log(`✓ OTP generated: ${devCode}`);

  // 2. Verify OTP and obtain Session Cookie
  console.log('\n2. Verifying OTP...');
  const otpVerifyRes = await makeRequest('POST', '/api/auth/otp/verify', {
    mobile: mobileE164,
    otp: devCode,
  });
  assert.strictEqual(otpVerifyRes.status, 200, 'OTP verify should succeed');
  const sessionCookie = otpVerifyRes.rawCookie;
  assert(sessionCookie, 'Must receive session cookie');
  console.log(`✓ Logged in as Candidate. Session: ${sessionCookie}`);

  // 3. Check Initial Profile & Completion
  console.log('\n3. Checking Profile Completion...');
  const profileRes = await makeRequest('GET', '/api/profile', null, sessionCookie);
  assert.strictEqual(profileRes.status, 200);
  const pData = profileRes.data.data || profileRes.data;
  console.log(`Initial Completion: ${pData.completion.percentage}% (Complete: ${pData.completion.isComplete})`);

  // 4. Save Incomplete Profile (Only Name)
  console.log('\n4. Updating partial profile (Name only)...');
  const partialRes = await makeRequest('PUT', '/api/profile', {
    firstName: 'Arun',
    lastName: 'Kumar',
  }, sessionCookie);
  assert.strictEqual(partialRes.status, 200);
  const partialData = partialRes.data.data || partialRes.data;
  assert.strictEqual(partialData.completion.percentage, 20, '1 of 5 items should give 20%');
  assert.strictEqual(partialData.completion.isComplete, false);
  console.log(`✓ Partial Completion: ${partialData.completion.percentage}% (Missing: ${partialData.completion.missingLabels.join(', ')})`);

  // 5. Try to create Scribe Request with Incomplete Profile -> Expect 400
  console.log('\n5. Attempting to create scribe request with incomplete profile...');
  const candidateUserId = (otpVerifyRes.data.data || otpVerifyRes.data).user?.id;
  await ScribeRequest.deleteMany({ candidateId: candidateUserId });

  const exam = await Examination.findOne({ status: 'PUBLISHED' });
  assert(exam, 'Need at least one published exam in DB');
  const incompleteReqRes = await makeRequest('POST', '/api/requests', {
    examinationId: exam._id.toString(),
    city: 'Chennai',
    language: 'Tamil',
  }, sessionCookie);
  console.log('incompleteReqRes:', incompleteReqRes.status, incompleteReqRes.data);
  assert.strictEqual(incompleteReqRes.status, 409, 'Should reject with 409 PROFILE_INCOMPLETE when profile is incomplete');
  assert.strictEqual(incompleteReqRes.data.error.code, 'PROFILE_INCOMPLETE');
  console.log(`✓ Correctly rejected: ${incompleteReqRes.data.error || incompleteReqRes.data.message}`);

  // 6. Complete Profile fully
  console.log('\n6. Completing all required fields in Candidate Profile...');
  const completeRes = await makeRequest('PUT', '/api/profile', {
    firstName: 'Arun',
    lastName: 'Kumar',
    email: 'arun.kumar@example.com',
    city: 'Chennai',
    languages: ['English', 'Tamil'],
    education: 'Bachelor of Arts',
    disabilityType: 'Visual Impairment (60%)',
    assistanceNeeds: 'Requires scribe for dictation',
  }, sessionCookie);
  assert.strictEqual(completeRes.status, 200);
  const completeData = completeRes.data.data || completeRes.data;
  assert.strictEqual(completeData.completion.percentage, 100, 'All 5 items should give 100%');
  assert.strictEqual(completeData.completion.isComplete, true);
  console.log(`✓ Profile is 100% complete: ${completeData.completion.percentage}%`);

  // 7. Browse Examinations via API
  console.log('\n7. Candidate browsing public examinations...');
  const examsRes = await makeRequest('GET', '/api/public/examinations', null, sessionCookie);
  assert.strictEqual(examsRes.status, 200);
  const examsData = examsRes.data.data || examsRes.data;
  const exams = Array.isArray(examsData) ? examsData : (examsData.examinations || examsData.items || []);
  assert(exams.length > 0, 'Exams list should not be empty');
  console.log(`✓ Found ${exams.length} examinations available for candidate.`);

  // 8. View Examination Details by slug AND by id
  console.log('\n8. Viewing examination details by slug and ID...');
  const slugRes = await makeRequest('GET', `/api/public/examinations/${exam.slug}`, null, sessionCookie);
  assert.strictEqual(slugRes.status, 200);
  const slugData = slugRes.data.data || slugRes.data;
  assert.strictEqual(slugData.slug, exam.slug);

  const idRes = await makeRequest('GET', `/api/public/examinations/${exam._id.toString()}`, null, sessionCookie);
  assert.strictEqual(idRes.status, 200);
  const idData = idRes.data.data || idRes.data;
  assert.strictEqual(idData.id, exam._id.toString());
  console.log(`✓ Exam lookup by slug and ID both returned: ${idData.name}`);

  // 9. Clean up any previous test requests for this user/exam
  await ScribeRequest.deleteMany({ candidateId: candidateUserId });

  // 10. Submit Scribe Request
  console.log('\n9. Submitting Scribe Request...');
  const createRes = await makeRequest('POST', '/api/requests', {
    examinationId: exam._id.toString(),
    city: 'Chennai',
    language: 'Tamil',
    requirements: 'Need scribe comfortable with reading questions aloud clearly.',
  }, sessionCookie);
  assert.strictEqual(createRes.status, 201, 'Request creation should return 201 Created');
  const createData = createRes.data.data || createRes.data;
  const newReq = createData.request || createData;
  assert(newReq.id, 'Should have request id');
  assert.strictEqual(newReq.status, 'SUBMITTED');
  console.log(`✓ Scribe Request created successfully! Reference: ${newReq.reference}, ID: ${newReq.id}`);

  // 11. List Requests for candidate
  console.log('\n10. Fetching candidate requests list...');
  const listRes = await makeRequest('GET', '/api/requests', null, sessionCookie);
  assert.strictEqual(listRes.status, 200);
  const listData = listRes.data.data || listRes.data;
  const requests = Array.isArray(listData) ? listData : (listData.requests || listData.items || []);
  assert(requests.length > 0, 'Candidate should have at least 1 request');
  console.log(`✓ Candidate has ${requests.length} active request(s).`);

  // 12. View Request Details
  console.log('\n11. Fetching request details...');
  const detailRes = await makeRequest('GET', `/api/requests/${newReq.id}`, null, sessionCookie);
  assert.strictEqual(detailRes.status, 200);
  const detailData = detailRes.data.data || detailRes.data;
  const reqDetails = detailData.request || detailData;
  assert.strictEqual(reqDetails.reference, newReq.reference);
  console.log(`✓ Request details fetched: Reference ${reqDetails.reference}, Status ${reqDetails.status}`);

  // 13. Test Duplicate Request Prevention (409 Conflict)
  console.log('\n12. Testing duplicate request prevention...');
  const dupRes = await makeRequest('POST', '/api/requests', {
    examinationId: exam._id.toString(),
    city: 'Chennai',
    language: 'English',
  }, sessionCookie);
  assert.strictEqual(dupRes.status, 409, 'Duplicate active request should be rejected with 409');
  console.log(`✓ Duplicate active request correctly rejected with 409 Conflict: ${dupRes.data.error || dupRes.data.message}`);

  console.log('\n🎉 ALL CANDIDATE EXAMINATION & REQUEST FLOW TESTS PASSED!');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
