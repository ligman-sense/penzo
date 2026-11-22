'use strict';

/**
 * PENZO Day 3 Integration & Verification Suite
 * Tests:
 * 1. 2-Day Unresolved Request Alert Timing, Lifecycle Messages, & Idempotency
 * 2. In-App Notification Center & Recipient Ownership Safeguards
 * 3. Admin Audit Log Filtering & CSV Injection Escaping
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../server/config/database');
const User = require('../server/models/User');
const AdminUser = require('../server/models/AdminUser');
const Examination = require('../server/models/Examination');
const ScribeRequest = require('../server/models/ScribeRequest');
const Notification = require('../server/models/Notification');
const AdminAuditLog = require('../server/models/AdminAuditLog');
const { checkUnresolvedRequests } = require('../server/services/alertSchedulerService');
const { listNotifications, markRead, unreadCount } = require('../server/services/notificationService');
const { listAuditLogs, exportAuditLogsCsv } = require('../server/services/adminMiscService');
const { writeAudit } = require('../server/services/auditService');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedTests++;
  }
}

async function run() {
  console.log('\n============================================================');
  console.log(' PENZO Day 3 Integration & Verification Test Suite');
  console.log('============================================================\n');

  await connectDB();

  const timestamp = Date.now();
  const testEmailCandidateA = `test.cand.a.${timestamp}@example.com`;
  const testEmailCandidateB = `test.cand.b.${timestamp}@example.com`;
  const testEmailAdmin = `test.admin.${timestamp}@example.com`;

  let userA, userB, adminUser, testExam, testRequest;

  try {
    // -------------------------------------------------------------
    // Setup Test Data
    // -------------------------------------------------------------
    userA = await User.create({
      email: testEmailCandidateA,
      mobileE164: `+9199${String(timestamp).slice(-8)}`,
      role: 'CANDIDATE',
      verificationStatus: 'VERIFIED',
    });

    userB = await User.create({
      email: testEmailCandidateB,
      mobileE164: `+9198${String(timestamp).slice(-8)}`,
      role: 'CANDIDATE',
      verificationStatus: 'VERIFIED',
    });

    adminUser = await AdminUser.create({
      email: testEmailAdmin,
      name: 'Integration Test Admin',
      passwordHash: 'dummyhash',
      isActive: true,
    });

    // Create exam scheduled 36 hours from now (within the 48h 2-day window)
    const examDate = new Date(Date.now() + 36 * 60 * 60 * 1000);
    testExam = await Examination.create({
      name: `Test Civil Services Examination ${timestamp}`,
      title: `Test CSE ${timestamp}`,
      slug: `test-cse-${timestamp}`,
      startsOn: examDate,
      sessions: [
        {
          name: 'Morning Session',
          startsAt: examDate,
          endsAt: new Date(examDate.getTime() + 3 * 3600000),
        },
      ],
      status: 'PUBLISHED',
    });

    const sessionId = testExam.sessions[0]._id;

    testRequest = await ScribeRequest.create({
      candidateId: userA._id,
      examinationId: testExam._id,
      sessionId,
      reference: `REQ-TEST-${timestamp}`,
      status: 'AWAITING_VOLUNTEER',
      venue: {
        centreName: 'National Testing Centre',
        city: 'Bengaluru',
        confirmed: true,
      },
    });

    // -------------------------------------------------------------
    // TEST 1: Two-Day Alert Scheduling & Idempotency
    // -------------------------------------------------------------
    console.log('Test Suite 1: Two-Day Alert Scheduling & Idempotency');

    const result1 = await checkUnresolvedRequests();
    assert(result1.checked >= 1, `Checked at least 1 unresolved request (got ${result1.checked})`);
    assert(result1.alerted >= 1, `Alerted at least 1 request (got ${result1.alerted})`);

    const reloadedReq = await ScribeRequest.findById(testRequest._id);
    assert(reloadedReq.twoDayAlertSentAt !== null, 'ScribeRequest.twoDayAlertSentAt is persisted');
    assert(reloadedReq.twoDayAlertCandidateSentAt !== null, 'ScribeRequest.twoDayAlertCandidateSentAt is persisted');

    // Verify candidate notification
    const candNotifs = await Notification.find({ userId: userA._id, requestId: testRequest._id });
    assert(candNotifs.length === 1, 'Exactly one candidate notification was generated');
    assert(candNotifs[0].type === 'TWO_DAY_UNRESOLVED_UPDATE', 'Notification type is TWO_DAY_UNRESOLVED_UPDATE');
    assert(candNotifs[0].body.includes('volunteer scribe has not yet been confirmed'), 'Candidate body is respectful and lifecycle-aware');
    assert(!candNotifs[0].body.includes('password') && !candNotifs[0].body.includes('+91'), 'Candidate body is privacy-safe');

    // Verify admin alert notification
    const adminNotifs = await Notification.find({ userId: adminUser._id, requestId: testRequest._id });
    assert(adminNotifs.length === 1, 'Exactly one admin notification was generated for active admin');
    assert(adminNotifs[0].adminAlert === true, 'adminAlert flag is true');
    assert(adminNotifs[0].type === 'TWO_DAY_UNRESOLVED_ALERT', 'Admin alert type is TWO_DAY_UNRESOLVED_ALERT');
    assert(adminNotifs[0].body.includes('AWAITING_VOLUNTEER'), 'Admin alert mentions request status');

    // Run checkUnresolvedRequests a second time — must be 100% IDEMPOTENT
    const result2 = await checkUnresolvedRequests();
    const candNotifsAfter = await Notification.find({ userId: userA._id, requestId: testRequest._id });
    const adminNotifsAfter = await Notification.find({ userId: adminUser._id, requestId: testRequest._id });

    assert(candNotifsAfter.length === 1, 'Idempotency verified: Candidate notification count remains 1 on rerun');
    assert(adminNotifsAfter.length === 1, 'Idempotency verified: Admin alert count remains 1 on rerun');

    // -------------------------------------------------------------
    // TEST 2: Notification Center & Recipient Ownership Safeguards
    // -------------------------------------------------------------
    console.log('\nTest Suite 2: Notification Center & Recipient Ownership Safeguards');

    const notifA = candNotifs[0];
    assert(notifA.readAt === null, 'Initial readAt is null');

    // User B attempts to mark User A's notification as read
    const unauthorizedMark = await markRead(userB._id, notifA._id);
    assert(unauthorizedMark === null, 'Unauthorized cross-user markRead returns null');

    const notifACheck = await Notification.findById(notifA._id);
    assert(notifACheck.readAt === null, 'User A notification readAt remains null after cross-user attempt');

    // User A marks their own notification as read
    const authorizedMark = await markRead(userA._id, notifA._id);
    assert(authorizedMark !== null && authorizedMark.readAt !== null, 'Authorized recipient markRead succeeds');

    const unreadCountA = await unreadCount(userA._id);
    assert(unreadCountA === 0, 'Unread count for User A is now 0');

    // List notifications for User A
    const listA = await listNotifications(userA._id, { page: 1, pageSize: 10 });
    assert(listA.total === 1 && listA.items[0]._id.toString() === notifA._id.toString(), 'listNotifications correctly retrieves recipient items');

    // -------------------------------------------------------------
    // TEST 3: Admin Audit Filtering & CSV Formula Injection Protection
    // -------------------------------------------------------------
    console.log('\nTest Suite 3: Admin Audit Filtering & CSV Injection Escaping');

    // Write audit entries with potential formula injection payloads
    await writeAudit({
      adminId: adminUser._id,
      action: '=cmd|\' /C calc\'!A0',
      entityType: 'TestEntity',
      entityId: '+12345',
      details: { formula: '@SUM(1,2)', note: '-dangerous' },
      ip: '127.0.0.1',
    });

    await writeAudit({
      adminId: adminUser._id,
      action: 'examination.publish',
      entityType: 'Examination',
      entityId: testExam._id.toString(),
      details: { slug: testExam.slug },
      ip: '127.0.0.1',
    });

    // Test listAuditLogs with filter
    const auditFiltered = await listAuditLogs({ entityType: 'TestEntity' });
    assert(auditFiltered.items.length >= 1, 'listAuditLogs filters by entityType');
    assert(auditFiltered.items[0].entityType === 'TestEntity', 'Filtered item matches requested entityType');

    // Test exportAuditLogsCsv
    const csvContent = await exportAuditLogsCsv({ entityType: 'TestEntity' });
    assert(typeof csvContent === 'string', 'exportAuditLogsCsv returns CSV string');

    // Verify formula injection sanitization:
    // Any field starting with =, +, -, @ must be prepended with a single quote (')
    assert(csvContent.includes(`"'=cmd|' /C calc'!A0"`), 'Formula =cmd is safely sanitized with leading apostrophe');
    assert(csvContent.includes(`"'+12345"`), 'Formula +12345 is safely sanitized with leading apostrophe');
    assert(csvContent.includes('"ID","Admin Name","Admin Email"'), 'CSV contains standard expected headers');

  } catch (err) {
    console.error('Unexpected test error:', err);
    failedTests++;
  } finally {
    // -------------------------------------------------------------
    // Cleanup Test Data
    // -------------------------------------------------------------
    console.log('\nCleaning up test records...');
    if (testRequest) await ScribeRequest.deleteOne({ _id: testRequest._id });
    if (testExam) await Examination.deleteOne({ _id: testExam._id });
    if (userA) {
      await Notification.deleteMany({ userId: userA._id });
      await User.deleteOne({ _id: userA._id });
    }
    if (userB) {
      await Notification.deleteMany({ userId: userB._id });
      await User.deleteOne({ _id: userB._id });
    }
    if (adminUser) {
      await Notification.deleteMany({ userId: adminUser._id });
      await AdminAuditLog.deleteMany({ adminId: adminUser._id });
      await AdminUser.deleteOne({ _id: adminUser._id });
    }
    await mongoose.disconnect();
  }

  console.log('\n============================================================');
  console.log(` Summary: ${passedTests} passed, ${failedTests} failed`);
  console.log('============================================================\n');

  if (failedTests > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
