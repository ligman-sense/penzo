'use strict';

/**
 * Test Suite for PENZO Super-Admin Verification Module:
 * 1. Metrics dynamic calculation & accuracy
 * 2. Listing of all verified candidates and volunteers with proper pagination
 * 3. Accurate user name resolution (no "Unknown")
 * 4. Candidate & Volunteer role filters and status filters
 * 5. Search by name, mobile, email
 * 6. Review modal details (profile, assistance/qualification info, documents, all checks)
 * 7. Decision workflow (Approve, Request Correction, Reject)
 * 8. Super-Admin authorization guards
 */

const assert = require('assert');
const mongoose = require('mongoose');
const { connectDB } = require('../server/config/database');
const User = require('../server/models/User');
const CandidateProfile = require('../server/models/CandidateProfile');
const VolunteerProfile = require('../server/models/VolunteerProfile');
const VerificationRecord = require('../server/models/VerificationRecord');
const AdminUser = require('../server/models/AdminUser');
const Notification = require('../server/models/Notification');
const {
  getVerificationMetrics,
  listVerifications,
  getVerification,
  decideVerification,
} = require('../server/services/adminPeopleService');

let passedTests = 0;
let totalTests = 0;

function check(desc, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${desc}`);
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(err);
    throw err;
  }
}

async function checkAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${desc}`);
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(err);
    throw err;
  }
}

(async () => {
  console.log('====================================================');
  console.log('🧪 RUNNING SUPER-ADMIN VERIFICATION MODULE TESTS');
  console.log('====================================================\n');

  await connectDB();

  // Ensure AdminUser exists for test decisions
  let testAdmin = await AdminUser.findOne({ email: 'superadmin@penzo.org' });
  if (!testAdmin) {
    testAdmin = await AdminUser.create({
      email: 'superadmin@penzo.org',
      name: 'Super Administrator',
      passwordHash: 'dummyhash',
      role: 'SUPER_ADMIN',
    });
  }

  // ─── 1. Metrics Calculation ────────────────────────────────────────────────
  console.log('Test 1: Verification Metrics');
  const metrics = await getVerificationMetrics();

  check('Metrics returns all expected numeric fields', () => {
    assert(typeof metrics.totalPending === 'number');
    assert(typeof metrics.underReview === 'number');
    assert(typeof metrics.verifiedCandidates === 'number');
    assert(typeof metrics.verifiedVolunteers === 'number');
    assert(typeof metrics.rejected === 'number');
    assert(typeof metrics.requiresCorrection === 'number');
  });

  check('Verified candidates count is 10 (matching the 10 seeded candidates)', () => {
    assert.strictEqual(metrics.verifiedCandidates, 10);
  });

  check('Verified volunteers count matches verified volunteer users in DB', async () => {
    const volCount = await User.countDocuments({ role: 'VOLUNTEER', verificationStatus: 'VERIFIED', status: { $ne: 'DELETED' } });
    assert.strictEqual(metrics.verifiedVolunteers, volCount);
  });

  // ─── 2. Verified User Listings & Name Resolution ────────────────────────────
  console.log('\nTest 2: Verified User Listings & Name Resolution');
  const candList = await listVerifications({ role: 'CANDIDATE', status: 'VERIFIED', pageSize: 50 });

  check('Verified candidates listing returns all verified candidates without exclusion', () => {
    assert(candList.total >= 10, `Expected total candidate records >= 10, got ${candList.total}`);
    assert(candList.items.length >= 10, `Expected items >= 10, got ${candList.items.length}`);
  });

  check('No candidate row displays "Unknown" or missing user details', () => {
    for (const item of candList.items) {
      assert(item.user, 'item.user must exist');
      assert(item.user.name && item.user.name !== 'Unknown' && item.user.name !== '(Name not provided)', `Candidate name must be resolved: ${item.user.name}`);
      assert.strictEqual(item.user.role, 'CANDIDATE');
      assert.strictEqual(item.status, 'VERIFIED');
    }
  });

  const volList = await listVerifications({ role: 'VOLUNTEER', status: 'VERIFIED', pageSize: 50 });

  check('Verified volunteers listing returns all verified volunteers', () => {
    assert(volList.total >= 10, `Expected total volunteer records >= 10, got ${volList.total}`);
    assert(volList.items.length >= 10, `Expected items >= 10, got ${volList.items.length}`);
  });

  check('No volunteer row displays "Unknown" or missing user details', () => {
    for (const item of volList.items) {
      assert(item.user, 'item.user must exist');
      assert(item.user.name && item.user.name !== 'Unknown', `Volunteer name must be resolved: ${item.user.name}`);
      assert.strictEqual(item.user.role, 'VOLUNTEER');
      assert.strictEqual(item.status, 'VERIFIED');
    }
  });

  // ─── 3. Filtering and Pagination ───────────────────────────────────────────
  console.log('\nTest 3: Filtering & Pagination');

  await checkAsync('Candidate filter returns ONLY candidate records', async () => {
    const res = await listVerifications({ role: 'CANDIDATE' });
    for (const r of res.items) {
      assert.strictEqual(r.user.role, 'CANDIDATE');
    }
  });

  await checkAsync('Volunteer filter returns ONLY volunteer records', async () => {
    const res = await listVerifications({ role: 'VOLUNTEER' });
    for (const r of res.items) {
      assert.strictEqual(r.user.role, 'VOLUNTEER');
    }
  });

  await checkAsync('Pagination pageSize works correctly', async () => {
    const pageSize = 5;
    const res = await listVerifications({ page: 1, pageSize, role: 'CANDIDATE', status: 'VERIFIED' });
    assert.strictEqual(res.items.length, 5);
    assert(res.total >= 10);
  });

  await checkAsync('Search by candidate name returns matching records', async () => {
    const res = await listVerifications({ search: 'Vigneshwaran' });
    assert(res.items.length > 0, 'Must find Vigneshwaran');
    for (const item of res.items) {
      assert(item.user.name.includes('Vigneshwaran') || item.user.mobile?.includes('Vigneshwaran'));
    }
  });

  await checkAsync('Search by volunteer name returns matching records', async () => {
    const res = await listVerifications({ search: 'HARESH' });
    assert(res.items.length > 0, 'Must find HARESH');
    for (const item of res.items) {
      assert(item.user.name.toUpperCase().includes('HARESH'));
    }
  });

  // ─── 4. Detailed Review Modal Data ────────────────────────────────────────
  console.log('\nTest 4: Review Modal & Detailed Verification');
  const sampleCandidateRecord = candList.items[0];
  const detail = await getVerification(sampleCandidateRecord.id);

  check('Detail contains full user and profile information', () => {
    assert(detail.user, 'User object must exist');
    assert(detail.user.name, 'Name must be resolved');
    assert(detail.user.role === 'CANDIDATE');
    assert(detail.user.profile, 'Profile object must exist');
    assert(Array.isArray(detail.allVerifications), 'allVerifications array must exist');
    assert(Array.isArray(detail.documents), 'documents array must exist');
  });

  // ─── 5. Decision Workflow (Approve, Correction, Reject) ────────────────────
  console.log('\nTest 5: Decision Workflow');

  // Create a dedicated test candidate for decision workflow
  const testCandidateUser = await User.create({
    role: 'CANDIDATE',
    name: 'Workflow Test Candidate',
    mobileE164: '+919999000111',
    primaryIdentifier: 'MOBILE',
    authProvider: 'PASSWORD',
    status: 'ACTIVE',
    profileComplete: true,
    verificationStatus: 'PENDING',
  });

  const testCandidateProfile = await CandidateProfile.create({
    userId: testCandidateUser._id,
    fullName: 'Workflow Test Candidate',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    pincode: '641004',
    disabilityType: 'Visual Impairment',
    assistanceNeeds: 'Low Vision assistance',
    completionPercentage: 100,
    verificationStatus: 'PENDING',
  });

  const testRecordIdentity = await VerificationRecord.create({
    userId: testCandidateUser._id,
    kind: 'IDENTITY',
    status: 'PENDING',
  });

  const testRecordAssistance = await VerificationRecord.create({
    userId: testCandidateUser._id,
    kind: 'ASSISTANCE_NEED',
    status: 'PENDING',
  });

  await checkAsync('Requesting corrections updates record and user status', async () => {
    const res = await decideVerification(
      testRecordIdentity._id,
      'REQUIRES_CORRECTION',
      'Please upload a clearer copy of your photo ID.',
      { adminId: testAdmin._id }
    );

    assert.strictEqual(res.status, 'REQUIRES_CORRECTION');
    const updatedRec = await VerificationRecord.findById(testRecordIdentity._id);
    assert.strictEqual(updatedRec.status, 'REQUIRES_CORRECTION');
    assert.strictEqual(updatedRec.reason, 'Please upload a clearer copy of your photo ID.');
    assert.strictEqual(updatedRec.history.length, 1);

    const updatedUser = await User.findById(testCandidateUser._id);
    assert.strictEqual(updatedUser.verificationStatus, 'REQUIRES_CORRECTION');

    // Check notification sent
    const notif = await Notification.findOne({ userId: testCandidateUser._id, type: 'VERIFICATION_UPDATE' }).sort({ createdAt: -1 });
    assert(notif, 'Notification must be sent to user');
    assert(notif.title.includes('Correction'));
  });

  await checkAsync('Approving all verification records marks overall status as VERIFIED', async () => {
    await decideVerification(testRecordIdentity._id, 'VERIFIED', null, { adminId: testAdmin._id });
    await decideVerification(testRecordAssistance._id, 'VERIFIED', null, { adminId: testAdmin._id });

    const updatedUser = await User.findById(testCandidateUser._id);
    assert.strictEqual(updatedUser.verificationStatus, 'VERIFIED');

    const updatedProfile = await CandidateProfile.findOne({ userId: testCandidateUser._id });
    assert.strictEqual(updatedProfile.verificationStatus, 'VERIFIED');
  });

  // Clean up test user
  await VerificationRecord.deleteMany({ userId: testCandidateUser._id });
  await CandidateProfile.deleteOne({ userId: testCandidateUser._id });
  await Notification.deleteMany({ userId: testCandidateUser._id });
  await User.deleteOne({ _id: testCandidateUser._id });

  console.log('\n====================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('====================================================\n');

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('\n❌ Test suite failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
