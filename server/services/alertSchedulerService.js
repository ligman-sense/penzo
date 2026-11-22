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
 * @returns {Promise<{ checked: number, alerted: number, errors: number, requests: Array }>}
 */
async function checkUnresolvedRequests(options = {}) {
  const now = options.asOf ? new Date(options.asOf) : new Date();

  const requests = await ScribeRequest.find({
    status: { $in: UNRESOLVED_STATUSES },
  })
    .populate('examinationId')
    .populate('candidateId', 'mobileE164 email');

  let alertedCount = 0;
  let errorCount = 0;
  const processedRequests = [];

  for (const req of requests) {
    try {
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

      // Trigger 2-day alert if within 48 hours in the future (not already past)
      if (diffHours <= 48 && diffHours > 0) {
        let triggeredForThis = false;

        const examName = exam.name || exam.title || 'Scheduled Examination';
        const venueInfo = req.venue?.centreName
          ? `${req.venue.centreName}${req.venue.city ? ', ' + req.venue.city : ''} (${req.venue.confirmed ? 'Confirmed' : 'Pending Confirmation'})`
          : 'Venue details pending submission';

        const unresolvedReason = UNRESOLVED_REASONS[req.status] || 'No confirmed volunteer arrangement is in place.';

        // Admin Alert (Idempotent: guarded by twoDayAlertSentAt + notification idempotencyKey)
        if (!req.twoDayAlertSentAt) {
          const adminBody = `URGENT: Scribe request ${req.reference || req._id} for examination '${examName}' remains unresolved with 2 days remaining. Status: ${req.status}. Reason: ${unresolvedReason}. Venue: ${venueInfo}. Immediate administrative intervention is required.`;

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

        // Candidate Notification (Idempotent & Lifecycle-aware)
        if (!req.twoDayAlertCandidateSentAt) {
          let candidateTitle = 'Scribe Coordination Update: 2 Days to Examination';
          let candidateBody = '';

          if (['AWAITING_VOLUNTEER', 'REPLACEMENT_REQUIRED'].includes(req.status)) {
            candidateTitle = 'Scribe Coordination Update: 2 Days to Examination';
            candidateBody = `We want to let you know that a volunteer scribe has not yet been confirmed for your examination (${examName}). Our administrative team has been alerted on high priority and is actively exploring alternative arrangements. Please check your request status on your dashboard or contact Penzo support for guidance.`;
          } else if (req.status === 'MATCH_PROPOSED') {
            candidateTitle = 'Scribe Request Update: Proposed Volunteer Pending';
            candidateBody = `A volunteer scribe has been proposed for your upcoming examination (${examName}) and is awaiting response. Our administrative team is monitoring the timeline closely as your exam approaches in 2 days.`;
          } else if (['VOLUNTEER_ACCEPTED', 'AWAITING_CANDIDATE_CONFIRMATION'].includes(req.status)) {
            candidateTitle = 'Action Required: Please Confirm Your Scribe';
            candidateBody = `A volunteer has accepted your scribe request for ${examName}! With only 2 days until your examination, please log in to your dashboard to confirm the arrangement so that details can be finalized.`;
          } else {
            // SUBMITTED or PENDING_REVIEW
            candidateTitle = 'Scribe Request Update: Priority Review';
            candidateBody = `Your scribe request for examination (${examName}) is undergoing expedited administrative review with 2 days remaining before your examination. Our team is actively processing your request.`;
          }

          await notify({
            userId: req.candidateId?._id || req.candidateId,
            type: 'TWO_DAY_UNRESOLVED_UPDATE',
            title: candidateTitle,
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
    } catch (err) {
      errorCount++;
      console.error(`[AlertScheduler] Error processing request ${req._id}:`, err.message);
    }
  }

  return {
    checked: requests.length,
    alerted: alertedCount,
    errors: errorCount,
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
