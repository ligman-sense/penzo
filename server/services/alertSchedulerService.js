'use strict';

const ScribeRequest = require('../models/ScribeRequest');
const CandidateProfile = require('../models/CandidateProfile');
const { notify } = require('./notificationService');

const UNRESOLVED_STATUSES = [
  'SUBMITTED',
  'PENDING_REVIEW',
  'AWAITING_VOLUNTEER',
  'REPLACEMENT_REQUIRED',
  'MATCH_PROPOSED',
  'VOLUNTEER_ACCEPTED',
];

const UNRESOLVED_REASONS = {
  SUBMITTED: 'Request is newly submitted and awaits administrative review.',
  PENDING_REVIEW: 'Request is pending initial review.',
  AWAITING_VOLUNTEER: 'No volunteer match is currently assigned, or previous proposal was declined.',
  REPLACEMENT_REQUIRED: 'Assigned volunteer cancelled commitment; urgent replacement is required.',
  MATCH_PROPOSED: 'Match proposed to volunteer, but acceptance has not yet been received.',
  VOLUNTEER_ACCEPTED: 'Volunteer accepted invitation, but candidate confirmation is still pending.',
};

/**
 * Check all active scribe requests and trigger 2-day unresolved alerts if within 48 hours of examination.
 * @param {Object} options - Optional parameters for simulation/testing
 * @param {Date} [options.asOf] - Simulated current time
 * @returns {Promise<{ checked: number, alerted: number, requests: Array }>}
 */
async function checkUnresolvedRequests(options = {}) {
  const now = options.asOf ? new Date(options.asOf) : new Date();

  const requests = await ScribeRequest.find({
    status: { $in: UNRESOLVED_STATUSES },
  })
    .populate('examinationId')
    .populate('candidateId', 'mobileE164 email');

  let alertedCount = 0;
  const processedRequests = [];

  for (const req of requests) {
    const exam = req.examinationId;
    if (!exam) continue;

    let session = null;
    if (exam.sessions && req.sessionId) {
      session = exam.sessions.id(req.sessionId) || exam.sessions.find(s => s._id.toString() === req.sessionId.toString());
    }

    const examStart = session?.startsAt || session?.date || exam.startsOn;
    if (!examStart) continue;

    const examStartTime = new Date(examStart).getTime();
    const diffMs = examStartTime - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // Trigger alert if within 48 hours (and not past examination by more than 24 hours)
    if (diffHours <= 48 && diffHours >= -24) {
      let triggeredForThis = false;

      // Check candidate profile details
      let candidateName = 'Candidate';
      const cp = await CandidateProfile.findOne({ userId: req.candidateId?._id || req.candidateId });
      if (cp) {
        candidateName = cp.fullName || `${cp.firstName || ''} ${cp.lastName || ''}`.trim() || 'Candidate';
      }
      const candidateContact = req.candidateId?.mobileE164 || 'Contact on file';

      const venueInfo = req.venue?.centreName
        ? `${req.venue.centreName}, ${req.venue.city || ''} (${req.venue.confirmed ? 'Confirmed' : 'Pending Confirmation'})`
        : 'Venue details pending submission';

      const unresolvedReason = UNRESOLVED_REASONS[req.status] || 'No confirmed volunteer arrangement is in place.';

      // Admin Alert (Idempotent)
      if (!req.twoDayAlertSentAt) {
        const adminBody = `URGENT: A candidate's scribe request remains unresolved. The examination (${exam.name || exam.title}) is scheduled in 2 days. No confirmed volunteer assignment is available. Candidate: ${candidateName} (${candidateContact}). Venue: ${venueInfo}. Status: ${req.status}. Reason: ${unresolvedReason}. Please review immediately.`;

        await notify({
          adminAlert: true,
          type: 'TWO_DAY_UNRESOLVED_ALERT',
          title: 'URGENT: Unresolved Scribe Request (2 Days Remaining)',
          body: adminBody,
          linkPath: `/admin/requests.html?id=${req._id}`,
          idempotencyKey: `2day_admin_alert_${req._id}`,
          requestId: req._id,
        });

        req.twoDayAlertSentAt = now;
        triggeredForThis = true;
      }

      // Candidate Notification (Idempotent)
      if (!req.twoDayAlertCandidateSentAt) {
        const candidateBody = 'Your scribe request for the upcoming examination is still being coordinated. We have not yet confirmed a suitable volunteer. Our administrative team has been alerted and is reviewing the available options. Please continue to check your dashboard for updates.';

        await notify({
          userId: req.candidateId?._id || req.candidateId,
          type: 'TWO_DAY_UNRESOLVED_UPDATE',
          title: 'Scribe Coordination Update: 2 Days to Examination',
          body: candidateBody,
          linkPath: `/candidate/request-details.html?id=${req._id}`,
          idempotencyKey: `2day_cand_alert_${req._id}`,
          requestId: req._id,
        });

        req.twoDayAlertCandidateSentAt = now;
        triggeredForThis = true;
      }

      if (triggeredForThis) {
        await req.save();
        alertedCount++;
        processedRequests.push(req._id.toString());
      }
    }
  }

  return {
    checked: requests.length,
    alerted: alertedCount,
    requests: processedRequests,
  };
}

let _intervalHandle = null;

function startAlertScheduler(intervalMinutes = 15) {
  if (_intervalHandle) return;

  // Run on startup
  checkUnresolvedRequests().catch((err) => {
    console.error('[AlertScheduler] Initial check error:', err.message);
  });

  _intervalHandle = setInterval(() => {
    checkUnresolvedRequests().catch((err) => {
      console.error('[AlertScheduler] Periodic check error:', err.message);
    });
  }, intervalMinutes * 60 * 1000);
}

function stopAlertScheduler() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

module.exports = {
  checkUnresolvedRequests,
  startAlertScheduler,
  stopAlertScheduler,
};
