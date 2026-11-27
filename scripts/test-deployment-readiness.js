'use strict';

/**
 * PENZO Production Deployment-Readiness Test Suite
 * Validates production environment configuration, security headers, health-checks,
 * Atlas connection compatibility, NoSQL injection prevention, and core business workflows.
 */

const assert = require('assert');
const mongoose = require('mongoose');
const { createApp } = require('../server/app');
const { connectDB, maskMongoUri, validateMongoUri, isDBConnected } = require('../server/config/database');
const { bootstrapAdminIfNeeded } = require('../server/services/adminAuthService');
const AdminUser = require('../server/models/AdminUser');
const User = require('../server/models/User');
const Examination = require('../server/models/Examination');
const ScribeRequest = require('../server/models/ScribeRequest');
const ConfirmedAssignment = require('../server/models/ConfirmedAssignment');
const MatchProposal = require('../server/models/MatchProposal');
const Notification = require('../server/models/Notification');
const { generateAllocationId } = require('../server/utils/allocationId');
const { proposeMatch, allocateScribe } = require('../server/services/matchingService');
const { cancelAssignment } = require('../server/services/assignmentService');

let passedTests = 0;
let totalTests = 0;

function it(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

async function itAsync(description, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

async function runDeploymentReadinessTests() {
  console.log('\n====================================================');
  console.log('🧪 RUNNING PENZO DEPLOYMENT-READINESS AUDIT TESTS');
  console.log('====================================================\n');

  // ─── 1. Production URI Validation & Secret Masking ──────────
  console.log('Test Suite 1: Production Configuration & Credential Masking');

  it('Masks credentials in standard MongoDB URIs', () => {
    const raw = 'mongodb://app_user:SuperSecretP@ss123@cluster0.abcde.mongodb.net/penzo';
    const masked = maskMongoUri(raw);
    assert.strictEqual(masked, 'mongodb://app_user:****@cluster0.abcde.mongodb.net/penzo');
    assert.ok(!masked.includes('SuperSecretP@ss123'), 'Secret must be masked');
  });

  it('Masks credentials in SRV MongoDB Atlas URIs', () => {
    const raw = 'mongodb+srv://atlasAdmin:P@ssw0rd!@mycluster.xyz.mongodb.net/penzo?retryWrites=true';
    const masked = maskMongoUri(raw);
    assert.strictEqual(masked, 'mongodb+srv://atlasAdmin:****@mycluster.xyz.mongodb.net/penzo?retryWrites=true');
    assert.ok(!masked.includes('P@ssw0rd!'), 'Atlas secret must be masked');
  });

  it('Rejects empty MONGODB_URI with clear diagnostic instructions', () => {
    const res = validateMongoUri('');
    assert.strictEqual(res.valid, false);
    assert.ok(res.message.includes('MONGODB_URI environment variable is required'));
  });

  it('Rejects malformed connection strings', () => {
    const res = validateMongoUri('http://my-database.com/penzo');
    assert.strictEqual(res.valid, false);
    assert.ok(res.message.includes('malformed'));
  });

  it('Rejects localhost connection strings when in production mode', () => {
    const res = validateMongoUri('mongodb://127.0.0.1:27017/penzo', 'production');
    assert.strictEqual(res.valid, false);
    assert.ok(res.message.includes('points to localhost'), 'Must warn about localhost in production');
    assert.ok(res.message.includes('MongoDB Atlas'), 'Must mention MongoDB Atlas');
  });

  it('Permits localhost connection strings in development mode', () => {
    const res = validateMongoUri('mongodb://127.0.0.1:27017/penzo', 'development');
    assert.strictEqual(res.valid, true);
  });

  // ─── 2. Database Connectivity & Indexes ─────────────────────
  console.log('\nTest Suite 2: Database Connectivity & Index Validation');

  await itAsync('Connects to MongoDB successfully using connectDB()', async () => {
    await connectDB({ exitOnError: false });
    assert.strictEqual(isDBConnected(), true);
  });

  it('ConfirmedAssignment has unique index on allocationId', () => {
    const schema = ConfirmedAssignment.schema;
    const paths = schema.paths;
    assert.ok(paths.allocationId, 'allocationId field exists');
    assert.strictEqual(paths.allocationId.options.unique, true, 'allocationId must be unique');
    assert.strictEqual(paths.allocationId.options.sparse, true, 'allocationId must be sparse');
  });

  it('ConfirmedAssignment has partial unique index preventing duplicate active allocations per request', () => {
    const indexes = ConfirmedAssignment.schema.indexes();
    const activeIndex = indexes.find(
      (idx) => idx[1]?.name === 'unique_active_assignment_per_request'
    );
    assert.ok(activeIndex, 'unique_active_assignment_per_request index must exist');
    assert.strictEqual(activeIndex[1].unique, true);
    assert.deepStrictEqual(activeIndex[1].partialFilterExpression, { status: 'CONFIRMED' });
  });

  it('ScribeRequest has partial unique index preventing duplicate active requests per candidate/exam', () => {
    const indexes = ScribeRequest.schema.indexes();
    const duplicateIndex = indexes.find(
      (idx) => idx[0]?.candidateId === 1 && idx[0]?.examinationId === 1 && idx[1]?.unique === true
    );
    assert.ok(duplicateIndex, 'Active request unique index must exist');
    assert.ok(duplicateIndex[1].partialFilterExpression.status.$in.includes('CONFIRMED'));
  });

  // ─── 3. Express App, Security Headers & Health Check ────────
  console.log('\nTest Suite 3: Security Headers, Health-Check & Sanitization');

  const app = createApp();

  await itAsync('Responds to GET /health with HTTP 200 and database connected', async () => {
    // Mock req and res for /health
    let statusSet = 0;
    let jsonOutput = null;
    const req = {};
    const res = {
      status(code) {
        statusSet = code;
        return this;
      },
      json(data) {
        jsonOutput = data;
      },
    };

    // Find the /health route handler
    const healthRoute = app._router.stack.find((r) => r.route && r.route.path === '/health');
    assert.ok(healthRoute, 'GET /health route must be registered');
    await healthRoute.route.stack[0].handle(req, res);

    assert.strictEqual(statusSet, 200);
    assert.strictEqual(jsonOutput.status, 'ok');
    assert.strictEqual(jsonOutput.database, 'connected');
    assert.strictEqual(typeof jsonOutput.uptime, 'number');
  });

  it('Sanitizes NoSQL operator injections from request payloads', () => {
    const maliciousBody = {
      email: 'user@example.com',
      $where: 'sleep(5000)',
      nested: {
        $gt: '',
        validField: 'hello',
      },
    };

    const req = { body: maliciousBody, query: {}, params: {} };
    const res = {};
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    // Locate sanitizeMongoQuery middleware in stack
    const sanitizeLayer = app._router.stack.find(
      (layer) => layer.name === 'sanitizeMongoQuery'
    );
    assert.ok(sanitizeLayer, 'sanitizeMongoQuery middleware must be present');
    sanitizeLayer.handle(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.body.$where, undefined, '$where operator must be removed');
    assert.strictEqual(req.body.nested.$gt, undefined, '$gt operator must be removed');
    assert.strictEqual(req.body.nested.validField, 'hello', 'Valid fields must be preserved');
  });

  // ─── 4. Super-Admin Idempotent Provisioning ─────────────────
  console.log('\nTest Suite 4: Super-Admin Idempotent Provisioning');

  await itAsync('Provisions Super-Admin account safely without duplicates or overwrites', async () => {
    const testEmail = `admin_test_${Date.now()}@penzo.internal`;
    process.env.ADMIN_BOOTSTRAP_EMAIL = testEmail;
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'TestPassword123!@#';
    process.env.ADMIN_BOOTSTRAP_NAME = 'Test Super Administrator';

    // First run creates account
    await bootstrapAdminIfNeeded();
    const admin1 = await AdminUser.findOne({ email: testEmail });
    assert.ok(admin1, 'Admin user must be created on first bootstrap');
    assert.strictEqual(admin1.name, 'Test Super Administrator');

    const originalPasswordHash = admin1.passwordHash;

    // Second run must be idempotent and preserve password hash
    await bootstrapAdminIfNeeded();
    const admin2 = await AdminUser.findOne({ email: testEmail });
    assert.strictEqual(admin2.passwordHash, originalPasswordHash, 'Password hash must not be overwritten');

    const totalMatching = await AdminUser.countDocuments({ email: testEmail });
    assert.strictEqual(totalMatching, 1, 'Duplicate admin accounts must not be created');

    // Clean up
    await AdminUser.deleteOne({ _id: admin1._id });
  });

  // ─── 5. Complete Allocation, Withdrawal & Replacement Workflow ───
  console.log('\nTest Suite 5: Allocation, Privacy, Withdrawal & Replacement Workflow');

  await itAsync('Full end-to-end allocation, privacy verification, withdrawal and replacement', async () => {
    const suffix = Date.now();
    // 1. Create synthetic candidate & volunteers
    const candidate = await User.create({
      mobileE164: `+9198765${String(suffix).slice(-5)}`,
      email: `candidate_${suffix}@example.com`,
      role: 'CANDIDATE',
      name: 'E2E Candidate',
      verificationStatus: 'VERIFIED',
      profileComplete: true,
    });

    const volunteer1 = await User.create({
      mobileE164: `+9191234${String(suffix).slice(-5)}`,
      email: `vol1_${suffix}@example.com`,
      role: 'VOLUNTEER',
      name: 'Volunteer One',
      verificationStatus: 'VERIFIED',
      profileComplete: true,
    });
    const VolunteerProfile = require('../server/models/VolunteerProfile');
    await VolunteerProfile.create({
      userId: volunteer1._id,
      fullName: 'Volunteer One',
      city: 'Coimbatore',
      languages: ['English', 'Tamil'],
      qualifications: [{ level: 'GRADUATE', degree: 'B.Sc', fieldOfStudy: 'Maths' }],
    });

    const volunteer2 = await User.create({
      mobileE164: `+9195678${String(suffix).slice(-5)}`,
      email: `vol2_${suffix}@example.com`,
      role: 'VOLUNTEER',
      name: 'Volunteer Two',
      verificationStatus: 'VERIFIED',
      profileComplete: true,
    });
    await VolunteerProfile.create({
      userId: volunteer2._id,
      fullName: 'Volunteer Two',
      city: 'Coimbatore',
      languages: ['English', 'Tamil'],
      qualifications: [{ level: 'GRADUATE', degree: 'B.Tech', fieldOfStudy: 'IT' }],
    });

    const exam = await Examination.create({
      name: `Final Deployment Audit Exam ${suffix}`,
      slug: `exam-deploy-${suffix}`,
      authority: 'PENZO Testing Board',
      startsOn: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      endsOn: new Date(Date.now() + 7 * 24 * 3600 * 1000 + 3 * 3600 * 1000),
      sessions: [
        {
          name: 'Main Session',
          startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          endsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000 + 3 * 3600 * 1000),
          type: 'EXAMINATION',
        },
      ],
      locations: [{ city: 'Coimbatore', state: 'Tamil Nadu' }],
    });

    // 2. Candidate creates request
    const request = await ScribeRequest.create({
      candidateId: candidate._id,
      examinationId: exam._id,
      sessionId: exam.sessions[0]._id,
      reference: `REQ-AUDIT-${suffix}`,
      status: 'AWAITING_VOLUNTEER',
      city: 'Coimbatore',
      language: 'English',
      venue: {
        centreName: 'PSG College of Technology',
        city: 'Coimbatore',
        confirmed: true,
      },
    });

    // 3. Admin allocates Volunteer 1
    const res1 = await allocateScribe(
      request._id.toString(),
      volunteer1._id.toString(),
      {
        reportingTime: '09:00 AM',
        meetingPoint: 'Gate 2 Main Entrance',
        reportingInstructions: 'Carry valid photo ID',
      }
    );
    const alloc1 = res1.assignment || res1;

    assert.ok(alloc1.allocationId, 'Allocation ID must be generated');
    assert.strictEqual(alloc1.status, 'CONFIRMED');
    assert.strictEqual(alloc1.reportingTime, '09:00 AM');
    assert.strictEqual(alloc1.meetingPoint, 'Gate 2 Main Entrance');

    // Verify candidate and volunteer see the exact same Allocation ID
    const savedAlloc1 = await ConfirmedAssignment.findOne({ requestId: request._id, status: 'CONFIRMED' });
    assert.strictEqual(savedAlloc1.allocationId, alloc1.allocationId);

    // 4. Volunteer 1 withdraws
    await cancelAssignment(savedAlloc1._id.toString(), volunteer1._id.toString(), 'VOLUNTEER', {
      cancellationReason: 'Emergency conflict',
    });

    // Verify request transitioned to REPLACEMENT_REQUIRED
    const reqAfterWithdraw = await ScribeRequest.findById(request._id);
    assert.strictEqual(reqAfterWithdraw.status, 'REPLACEMENT_REQUIRED');

    // Verify apology notification delivered to candidate concealing volunteer PII
    const notif = await Notification.findOne({ userId: candidate._id }).sort({ createdAt: -1 });
    assert.ok(notif, 'Apology notification must be sent to candidate');
    assert.ok(notif.body.includes('withdrawn from the examination commitment'));
    assert.ok(notif.body.includes('arrange a replacement scribe'));
    assert.ok(!notif.body.includes('Volunteer One'), 'Must NOT disclose volunteer name');
    assert.ok(!notif.body.includes(volunteer1.mobileE164), 'Must NOT disclose volunteer phone');

    // 5. Verify Withdrawn Volunteer 1 is excluded from replacement matching
    await assert.rejects(
      async () => {
        await allocateScribe(request._id.toString(), volunteer1._id.toString(), {
          reportingTime: '09:00 AM',
          meetingPoint: 'Gate 2 Main Entrance',
        });
      },
      /previously withdrew from this request/,
      'Must reject allocating the withdrawn volunteer'
    );

    // 6. Allocate replacement Volunteer 2
    const res2 = await allocateScribe(
      request._id.toString(),
      volunteer2._id.toString(),
      {
        reportingTime: '08:30 AM',
        meetingPoint: 'Central Administrative Hall',
        reportingInstructions: 'Reporting time updated to 08:30 AM',
      }
    );
    const alloc2 = res2.assignment || res2;

    assert.ok(alloc2.allocationId, 'Replacement allocation must have Allocation ID');
    assert.notStrictEqual(alloc2.allocationId, alloc1.allocationId, 'Replacement Allocation ID must be unique and distinct');

    // Verify both allocation records are preserved in database history
    const allAssignments = await ConfirmedAssignment.find({ requestId: request._id });
    assert.strictEqual(allAssignments.length, 2, 'History of both initial and replacement allocation must be preserved');

    const cancelledAss = allAssignments.find((a) => a.status === 'CANCELLED');
    const confirmedAss = allAssignments.find((a) => a.status === 'CONFIRMED');
    assert.ok(cancelledAss, 'Initial assignment must be preserved as CANCELLED');
    assert.ok(confirmedAss, 'Replacement assignment must be preserved as CONFIRMED');
    assert.strictEqual(confirmedAss.allocationId, alloc2.allocationId);

    // Clean up synthetic test records
    await VolunteerProfile.deleteMany({ userId: { $in: [volunteer1._id, volunteer2._id] } });
    await ConfirmedAssignment.deleteMany({ requestId: request._id });
    await ScribeRequest.deleteOne({ _id: request._id });
    await Examination.deleteOne({ _id: exam._id });
    await Notification.deleteMany({ userId: candidate._id });
    await User.deleteMany({ _id: { $in: [candidate._id, volunteer1._id, volunteer2._id] } });
  });

  console.log('\n====================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('====================================================\n');
}

runDeploymentReadinessTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  });
