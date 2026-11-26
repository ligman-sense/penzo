'use strict';

/**
 * Verification test suite for PENZO Allocation Confirmation and Examination-Day Coordination
 * Run with: node scripts/test-allocation-coordination.js
 */

const mongoose = require('mongoose');
const { connectDB } = require('../server/config/database');
const User = require('../server/models/User');
const Examination = require('../server/models/Examination');
const ScribeRequest = require('../server/models/ScribeRequest');
const ConfirmedAssignment = require('../server/models/ConfirmedAssignment');
const MatchProposal = require('../server/models/MatchProposal');
const VolunteerInterest = require('../server/models/VolunteerInterest');
const VolunteerProfile = require('../server/models/VolunteerProfile');
const CandidateProfile = require('../server/models/CandidateProfile');
const Notification = require('../server/models/Notification');
const AdminUser = require('../server/models/AdminUser');

const { generateAllocationId } = require('../server/utils/allocationId');
const { proposeMatch, allocateScribe, acceptInvitation } = require('../server/services/matchingService');
const { updateReportingDetails, getRequest: getAdminRequest } = require('../server/services/adminRequestService');
const { getRequest: getCandidateRequest, listRequests: listCandidateRequests } = require('../server/services/requestService');
const { listAssignments, cancelAssignment } = require('../server/services/assignmentService');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    passedTests++;
    console.log(`✅ PASS: ${message}`);
  }
}

async function run() {
  console.log('\n============================================================');
  console.log('🧪 RUNNING PENZO ALLOCATION & COORDINATION TEST SUITE');
  console.log('============================================================\n');

  await connectDB();

  // Test identifiers
  const testSuffix = `test_${Date.now()}`;
  const testCandidateMobile = '+919876500001';
  const testVolunteerMobile = '+919876500002';
  const testAdminEmail = `admin_${testSuffix}@example.com`;

  try {
    // 1. Setup Admin, Candidate, and Volunteer
    const admin = await AdminUser.create({
      name: 'Super Admin Tester',
      email: testAdminEmail,
      passwordHash: 'dummyhash',
      role: 'SUPER_ADMIN',
    });

    const candidate = await User.create({
      mobileE164: testCandidateMobile,
      email: `candidate_${testSuffix}@example.com`,
      role: 'CANDIDATE',
      status: 'ACTIVE',
      profileComplete: true,
    });

    await CandidateProfile.create({
      userId: candidate._id,
      fullName: 'Vigneshwaran Candidate',
      disabilityCategory: 'VISUAL_IMPAIRMENT',
      disabilityPercentage: 75,
      city: 'Coimbatore',
      languages: ['English', 'Tamil'],
    });

    const volunteer = await User.create({
      mobileE164: testVolunteerMobile,
      email: `volunteer_${testSuffix}@example.com`,
      role: 'VOLUNTEER',
      status: 'ACTIVE',
      profileComplete: true,
      verificationStatus: 'VERIFIED',
    });

    await VolunteerProfile.create({
      userId: volunteer._id,
      fullName: 'Haresh Volunteer',
      city: 'Coimbatore',
      languages: ['English', 'Tamil'],
      qualifications: [{ level: 'GRADUATE', degree: 'B.E', fieldOfStudy: 'CSE' }],
    });

    const exam = await Examination.create({
      name: `Civil Services Prelims ${testSuffix}`,
      authority: 'UPSC',
      slug: `upsc-prelims-${testSuffix}`,
      startsOn: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days in future
      endsOn: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'PUBLISHED',
      locations: [{ city: 'Coimbatore', state: 'Tamil Nadu' }],
    });

    await VolunteerInterest.create({
      volunteerId: volunteer._id,
      examinationId: exam._id,
      status: 'ACTIVE',
    });

    const request = await ScribeRequest.create({
      candidateId: candidate._id,
      examinationId: exam._id,
      reference: `REQ-${Date.now()}`,
      status: 'AWAITING_VOLUNTEER',
      language: 'English',
      city: 'Coimbatore',
      requirements: 'Screen reading assistance',
      venue: {
        centreName: 'ABC Examination Centre',
        address: '123 College Road, Peelamedu',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pincode: '641004',
        confirmed: true,
        confirmedAt: new Date(),
        confirmedBy: admin._id,
      },
    });

    console.log('--- TEST 1: Allocation ID Format and Sequential Uniqueness ---');
    const allocId1 = await generateAllocationId();
    const currentYear = new Date().getFullYear();
    assert(
      new RegExp(`^PNZ${currentYear}\\d{4,}$`).test(allocId1),
      `Allocation ID ${allocId1} matches required PNZ<YEAR><0001> format`
    );

    console.log('\n--- TEST 2: Super-Admin Propose Match Validation ---');
    // Try proposing without reportingTime or meetingPoint -> must throw 400 Bad Request
    let errorThrown = false;
    try {
      await proposeMatch(request._id, volunteer._id, 'Note', {
        adminId: admin._id,
        reportingTime: '',
        meetingPoint: 'Main Gate',
      });
    } catch (e) {
      errorThrown = true;
      assert(e.status === 400, 'proposeMatch throws 400 when reportingTime is missing');
    }
    assert(errorThrown, 'Reporting time is mandatory before finalizing proposal');

    errorThrown = false;
    try {
      await proposeMatch(request._id, volunteer._id, 'Note', {
        adminId: admin._id,
        reportingTime: '08:30 AM',
        meetingPoint: '',
      });
    } catch (e) {
      errorThrown = true;
      assert(e.status === 400, 'proposeMatch throws 400 when meetingPoint is missing');
    }
    assert(errorThrown, 'Meeting point is mandatory before finalizing proposal');

    console.log('\n--- TEST 3: Super-Admin Proposing Match with Valid Details ---');
    const proposal = await proposeMatch(request._id, volunteer._id, 'Please report early', {
      adminId: admin._id,
      reportingTime: '08:30 AM',
      meetingPoint: 'Main Entrance – Help Desk',
      reportingInstructions: 'Please bring original government photo ID and admit card copy.',
    });
    assert(proposal.status === 'PROPOSED', 'Match proposal created with PROPOSED status');
    assert(proposal.reportingTime === '08:30 AM', 'Proposal stores reportingTime');
    assert(proposal.meetingPoint === 'Main Entrance – Help Desk', 'Proposal stores meetingPoint');

    console.log('\n--- TEST 4: Volunteer Accepts Invitation -> Generates Confirmed Assignment with Allocation ID ---');
    const acceptRes = await acceptInvitation(proposal._id, volunteer._id, {
      termsAccepted: true,
      termsVersion: '1.0',
    });
    const assignment = acceptRes.assignment;
    assert(assignment.status === 'CONFIRMED', 'Assignment is CONFIRMED');
    assert(
      new RegExp(`^PNZ${currentYear}\\d{4,}$`).test(assignment.allocationId),
      `Assignment has unique Allocation ID: ${assignment.allocationId}`
    );
    assert(assignment.reportingTime === '08:30 AM', 'Assignment inherited reportingTime');
    assert(assignment.meetingPoint === 'Main Entrance – Help Desk', 'Assignment inherited meetingPoint');
    assert(
      assignment.reportingInstructions === 'Please bring original government photo ID and admit card copy.',
      'Assignment inherited reportingInstructions'
    );

    console.log('\n--- TEST 5: Allocation ID Persistence Across Page Refreshes ---');
    const assignmentReloaded = await ConfirmedAssignment.findById(assignment._id);
    assert(
      assignmentReloaded.allocationId === assignment.allocationId,
      'Allocation ID does not change on subsequent fetch (persists without regenerating)'
    );

    console.log('\n--- TEST 6: Candidate Request Details Endpoint & Strict Privacy ---');
    const candReq = await getCandidateRequest(candidate._id, request._id);
    assert(candReq.status === 'CONFIRMED', 'Candidate sees request status CONFIRMED');
    assert(candReq.allocation !== null, 'Candidate response includes allocation object');
    assert(
      candReq.allocation.allocationId === assignment.allocationId,
      'Candidate receives identical Allocation ID'
    );
    assert(candReq.allocation.reportingTime === '08:30 AM', 'Candidate receives reportingTime');
    assert(candReq.allocation.meetingPoint === 'Main Entrance – Help Desk', 'Candidate receives meetingPoint');
    assert(
      candReq.allocation.reportingInstructions === 'Please bring original government photo ID and admit card copy.',
      'Candidate receives reportingInstructions'
    );
    // ZERO volunteer PII in candidate API response:
    assert(candReq.volunteer === undefined, 'No volunteer object in candidate response');
    assert(candReq.volunteerName === undefined, 'No volunteerName in candidate response');
    assert(candReq.volunteerMobile === undefined, 'No volunteerMobile in candidate response');
    assert(candReq.volunteerEmail === undefined, 'No volunteerEmail in candidate response');

    console.log('\n--- TEST 7: Volunteer Commitments Endpoint & Strict Privacy ---');
    const volAssignments = await listAssignments(volunteer._id, 'VOLUNTEER');
    assert(volAssignments.length === 1, 'Volunteer receives 1 commitment');
    const volCommitment = volAssignments[0];
    assert(
      volCommitment.allocationId === assignment.allocationId,
      'Volunteer receives identical Allocation ID'
    );
    assert(volCommitment.reportingTime === '08:30 AM', 'Volunteer receives reportingTime');
    assert(volCommitment.meetingPoint === 'Main Entrance – Help Desk', 'Volunteer receives meetingPoint');
    // ZERO candidate PII in volunteer API response:
    assert(volCommitment.candidateName === undefined, 'No candidateName exposed to volunteer');
    assert(volCommitment.candidateMobile === undefined, 'No candidateMobile exposed to volunteer');
    assert(volCommitment.candidateEmail === undefined, 'No candidateEmail exposed to volunteer');
    assert(volCommitment.candidateId === undefined, 'No candidateId exposed to volunteer');

    console.log('\n--- TEST 8: Super-Admin Updates Reporting Details Post-Confirmation ---');
    const updatedAdminReq = await updateReportingDetails(request._id, {
      reportingTime: '08:15 AM',
      meetingPoint: 'Block B – Ground Floor Help Desk',
      reportingInstructions: 'Report 15 minutes earlier due to security badge issuance.',
    }, { adminId: admin._id, ip: '127.0.0.1' });

    assert(
      updatedAdminReq.activeAssignment.reportingTime === '08:15 AM',
      'Super-Admin updated reportingTime to 08:15 AM'
    );
    assert(
      updatedAdminReq.activeAssignment.meetingPoint === 'Block B – Ground Floor Help Desk',
      'Super-Admin updated meetingPoint'
    );

    // Verify candidate immediately sees updated details
    const candReqUpdated = await getCandidateRequest(candidate._id, request._id);
    assert(candReqUpdated.allocation.reportingTime === '08:15 AM', 'Candidate dashboard reflects updated reportingTime');
    assert(candReqUpdated.allocation.meetingPoint === 'Block B – Ground Floor Help Desk', 'Candidate dashboard reflects updated meetingPoint');

    // Verify volunteer immediately sees updated details
    const volAssignmentsUpdated = await listAssignments(volunteer._id, 'VOLUNTEER');
    assert(volAssignmentsUpdated[0].reportingTime === '08:15 AM', 'Volunteer commitments reflects updated reportingTime');
    assert(volAssignmentsUpdated[0].meetingPoint === 'Block B – Ground Floor Help Desk', 'Volunteer commitments reflects updated meetingPoint');

    // Verify in-app notifications were dispatched to both parties
    const candNotifications = await Notification.find({
      userId: candidate._id,
      type: 'REPORTING_DETAILS_UPDATED',
    });
    assert(candNotifications.length > 0, 'Candidate received REPORTING_DETAILS_UPDATED notification');

    const volNotifications = await Notification.find({
      userId: volunteer._id,
      type: 'REPORTING_DETAILS_UPDATED',
    });
    assert(volNotifications.length > 0, 'Volunteer received REPORTING_DETAILS_UPDATED notification');

    console.log('\n--- TEST 9: Cancellation & Replaced Commitments Workflow ---');
    // Volunteer cancels commitment
    await cancelAssignment(assignment._id, volunteer._id, 'VOLUNTEER', {
      reason: 'Urgent transit delay',
    });

    const cancelledAssignment = await ConfirmedAssignment.findById(assignment._id);
    assert(cancelledAssignment.status === 'CANCELLED', 'Assignment marked CANCELLED');

    // Request is moved to AWAITING_VOLUNTEER or REPLACEMENT_REQUIRED
    const reloadedReq = await ScribeRequest.findById(request._id);
    assert(
      reloadedReq.status === 'AWAITING_VOLUNTEER' || reloadedReq.status === 'REPLACEMENT_REQUIRED',
      `Request status updated to ${reloadedReq.status}`
    );

    // Active commitments for volunteer no longer shows it as CONFIRMED
    const volActive = await listAssignments(volunteer._id, 'VOLUNTEER', { status: 'CONFIRMED' });
    assert(volActive.length === 0, 'Cancelled allocation is no longer returned as active confirmed commitment');

    // Direct Super-Admin Allocate workflow for replacement
    reloadedReq.status = 'REPLACEMENT_REQUIRED';
    await reloadedReq.save();

    const replacementVolunteer = await User.create({
      mobileE164: '+919876500003',
      email: `rep_vol_${testSuffix}@example.com`,
      role: 'VOLUNTEER',
      status: 'ACTIVE',
      profileComplete: true,
      verificationStatus: 'VERIFIED',
    });
    await VolunteerProfile.create({
      userId: replacementVolunteer._id,
      fullName: 'Ananya Replacement Volunteer',
      city: 'Coimbatore',
      languages: ['English', 'Tamil'],
    });
    await VolunteerInterest.create({
      volunteerId: replacementVolunteer._id,
      examinationId: exam._id,
      status: 'ACTIVE',
    });

    const repAllocateRes = await allocateScribe(request._id, replacementVolunteer._id, {
      reportingTime: '08:00 AM',
      meetingPoint: 'Administrative Block Room 101',
      reportingInstructions: 'Contact Chief Superintendent.',
    }, { adminId: admin._id, ip: '127.0.0.1' });

    assert(repAllocateRes.assignment.status === 'CONFIRMED', 'Replacement allocation is CONFIRMED');
    assert(
      repAllocateRes.assignment.allocationId !== assignment.allocationId,
      `New unique Allocation ID generated: ${repAllocateRes.assignment.allocationId}`
    );
    assert(
      repAllocateRes.assignment.reportingTime === '08:00 AM',
      'Replacement assignment has reportingTime'
    );

    // Candidate receives replacement notification
    const candRepNotifications = await Notification.find({
      userId: candidate._id,
      type: 'REPLACEMENT_ALLOCATED',
    });
    assert(candRepNotifications.length > 0, 'Candidate received REPLACEMENT_ALLOCATED notification');

    console.log('\n============================================================');
    console.log(`🎉 ALL TESTS PASSED: ${passedTests}/${totalTests}`);
    console.log('============================================================\n');

  } finally {
    // Cleanup test data
    const users = await User.find({ mobileE164: { $in: [testCandidateMobile, testVolunteerMobile, '+919876500003'] } });
    const userIds = users.map(u => u._id);
    await ScribeRequest.deleteMany({ candidateId: { $in: userIds } });
    await ConfirmedAssignment.deleteMany({ candidateId: { $in: userIds } });
    await MatchProposal.deleteMany({ candidateId: { $in: userIds } });
    await VolunteerInterest.deleteMany({ volunteerId: { $in: userIds } });
    await CandidateProfile.deleteMany({ fullName: 'Vigneshwaran Candidate' });
    await VolunteerProfile.deleteMany({ fullName: { $in: ['Haresh Volunteer', 'Ananya Replacement Volunteer'] } });
    await User.deleteMany({ _id: { $in: userIds } });
    await AdminUser.deleteMany({ email: testAdminEmail });
    await Examination.deleteMany({ slug: `upsc-prelims-${testSuffix}` });
    await Notification.deleteMany({ type: { $in: ['REPORTING_DETAILS_UPDATED', 'REPLACEMENT_ALLOCATED', 'ASSIGNMENT_CONFIRMED', 'SCRIBE_ALLOCATED'] } });
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:\n', err);
  process.exit(1);
});
