'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { formatDate, formatDateTime, renderStatusBadge, escapeHtml, getQueryParam, timeAgo, setLoading } from '../utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _requestId     = null;
let _request       = null;
let _proposedMatch = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const detailContainer    = document.getElementById('request-detail');
const loadingEl          = document.getElementById('loading-indicator');
const cancelModal        = document.getElementById('cancel-modal');
const cancelForm         = document.getElementById('cancel-form');
const cancelReasonEl     = document.getElementById('cancel-reason');
const cancelCloseBtn     = document.getElementById('cancel-modal-close');

const declineMatchModal  = document.getElementById('decline-match-modal');
const declineMatchForm   = document.getElementById('decline-match-form');
const declineMatchReason = document.getElementById('decline-match-reason');
const declineMatchClose  = document.getElementById('decline-match-close');
const declineMatchCancel = document.getElementById('decline-match-cancel');
const declineMatchSubmit = document.getElementById('decline-match-submit');

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  const user = await requireAuth('/login.html');
  if (!user) return;

  initNavigation();
  updateUnreadCount();

  _requestId = getQueryParam('id');
  if (!_requestId) {
    window.location.href = '/candidate/requests.html';
    return;
  }

  setupCancelModal();
  setupDeclineMatchModal();
  await loadRequest();
})();

// ─── Load Request ─────────────────────────────────────────────────────────────
async function loadRequest() {
  if (loadingEl) loadingEl.hidden = false;

  try {
    const { data } = await api.get(`/requests/${_requestId}`);
    _request = data.request || data;

    // If request has matching workflow status, load proposed match details
    if (['MATCH_PROPOSED', 'VOLUNTEER_ACCEPTED', 'AWAITING_CANDIDATE_CONFIRMATION', 'CONFIRMED'].includes(_request.status)) {
      try {
        const matchRes = await api.get(`/requests/${_requestId}/proposed-match`);
        _proposedMatch = matchRes.data;
      } catch (e) {
        _proposedMatch = null;
      }
    } else {
      _proposedMatch = null;
    }

    if (loadingEl) loadingEl.hidden = true;
    renderRequest(_request, _proposedMatch);
  } catch (err) {
    if (loadingEl) loadingEl.hidden = true;
    if (detailContainer) {
      detailContainer.innerHTML = `
        <div class="alert alert--error" role="alert">
          <p>${err.status === 404 ? 'Request not found.' : 'Failed to load request details.'}</p>
          <a href="/candidate/requests.html" class="btn btn--ghost btn--sm">Back to Requests</a>
        </div>`;
    }
    showError(err.message || 'Could not fetch request details.');
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderRequest(req, match) {
  if (!detailContainer) return;

  const canCancel = ['SUBMITTED', 'PENDING_REVIEW', 'AWAITING_VOLUNTEER', 'MATCH_PROPOSED'].includes(req.status);
  const isAwaitingCandidate = ['VOLUNTEER_ACCEPTED', 'AWAITING_CANDIDATE_CONFIRMATION'].includes(req.status);
  const isConfirmed = req.status === 'CONFIRMED';
  const isMatchProposed = req.status === 'MATCH_PROPOSED';

  const history = req.history || req.statusHistory || [];

  let matchSectionHtml = '';

  if (isAwaitingCandidate && match) {
    const vol = match.volunteer || {};
    matchSectionHtml = `
      <section class="card" style="border: 2px solid var(--color-success, #16a34a); margin-bottom: 1.5rem; background: var(--color-surface);">
        <div class="card-body" style="padding: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                <span class="badge badge--success" style="font-weight: 700;">Action Required: Confirm Scribe Match</span>
                <span class="badge badge--teal">Match ${escapeHtml(match.matchReference || '')}</span>
              </div>
              <h2 style="margin: 0; font-size: 1.35rem; color: var(--color-text);">
                Volunteer Accepted: ${escapeHtml(vol.name || 'Volunteer')}
              </h2>
              <p style="margin: 0.25rem 0 0; font-size: 0.875rem; color: var(--color-text-muted);">
                A verified volunteer scribe who expressed interest in your examination has accepted. Please review and confirm.
              </p>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items: center;">
              <button id="btn-decline-match" class="btn btn--outline btn--sm" style="color: var(--color-danger); border-color: var(--color-danger);">
                Decline Match
              </button>
              <button id="btn-confirm-match" class="btn btn--primary btn--sm" style="background-color: var(--color-success, #16a34a);">
                Confirm Scribe Match
              </button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; padding: 1rem; background: var(--color-bg-secondary, rgba(0,0,0,0.02)); border-radius: 6px; font-size: 0.9rem;">
            <div>
              <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; display: block;">Verification Status</span>
              <span class="badge badge--success" style="font-size: 0.75rem; margin-top: 0.25rem;">✓ Verified Volunteer Scribe</span>
            </div>
            <div>
              <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; display: block;">Compatibility Score</span>
              <strong style="color: var(--color-success, #16a34a); font-size: 1.1rem;">${match.score || 100}%</strong>
            </div>
            <div>
              <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; display: block;">Location / City</span>
              <strong>${escapeHtml(vol.city || 'Location compatible')}</strong>
            </div>
            <div>
              <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; display: block;">Languages</span>
              <strong>${escapeHtml((vol.languages && vol.languages.length) ? vol.languages.join(', ') : 'Fluent in required languages')}</strong>
            </div>
            <div>
              <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; display: block;">Subjects</span>
              <strong>${escapeHtml((vol.subjects && vol.subjects.length) ? vol.subjects.join(', ') : 'All general subjects')}</strong>
            </div>
            <div>
              <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; display: block;">Prior Experience</span>
              <strong>${vol.hasExperience ? 'Experienced scribe' : 'Trained volunteer'}</strong>
            </div>
          </div>

          ${match.adminNote ? `
            <div style="margin-top: 1rem; font-size: 0.85rem; color: var(--color-text-secondary);">
              <strong>Admin Note:</strong> ${escapeHtml(match.adminNote)}
            </div>
          ` : ''}
        </div>
      </section>
    `;
  } else if (isConfirmed) {
    const vol = match?.volunteer || {};
    matchSectionHtml = `
      <section class="card" style="border-left: 4px solid var(--color-success, #16a34a); margin-bottom: 1.5rem; background: var(--color-surface);">
        <div class="card-body" style="padding: 1.25rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
            <span class="badge badge--success">✓ Scribe Arrangement Confirmed</span>
          </div>
          <h2 style="margin: 0 0 0.5rem 0; font-size: 1.25rem;">
            Assigned Scribe: ${escapeHtml(vol.name || req.volunteerName || 'Volunteer Scribe')}
          </h2>
          <p style="margin: 0; font-size: 0.9rem; color: var(--color-text-muted);">
            Your scribe has been confirmed for this examination. Please reach out if coordination is required before exam day.
          </p>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; margin-top: 1rem; font-size: 0.875rem;">
            <div>
              <span style="color: var(--color-text-muted); display: block; font-size: 0.75rem;">Scribe Contact</span>
              <strong>Available via Penzo Support</strong>
            </div>
            <div>
              <span style="color: var(--color-text-muted); display: block; font-size: 0.75rem;">Languages</span>
              <strong>${escapeHtml(vol.languages ? vol.languages.join(', ') : req.language || 'English')}</strong>
            </div>
            <div>
              <span style="color: var(--color-text-muted); display: block; font-size: 0.75rem;">City</span>
              <strong>${escapeHtml(vol.city || req.city || 'Local')}</strong>
            </div>
          </div>
        </div>
      </section>
    `;
  } else if (isMatchProposed) {
    matchSectionHtml = `
      <div class="card" style="border-left: 4px solid var(--color-warning, #d97706); margin-bottom: 1.5rem; background: var(--color-surface); padding: 1.25rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
          <span class="badge badge--amber">Match Proposed</span>
        </div>
        <h3 style="margin: 0; font-size: 1.1rem;">Awaiting Volunteer Acceptance</h3>
        <p style="margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--color-text-muted);">
          Our administrative team has matched your request with a verified volunteer who expressed interest in this examination. We will notify you as soon as the volunteer accepts.
        </p>
      </div>
    `;
  }

  detailContainer.innerHTML = `
    ${matchSectionHtml}

    <section class="detail-card" aria-label="Request Details" style="margin-bottom: 1.5rem;">
      <header class="detail-card__header">
        <div>
          <h1 class="detail-card__title">${escapeHtml(req.examination?.name || 'Exam Request')}</h1>
          <p class="detail-card__subtitle">${escapeHtml(req.examination?.authority || '')}</p>
        </div>
        <div>${renderStatusBadge(req.status)}</div>
      </header>

      <dl class="detail-grid">
        <div><dt>Request ID / Ref</dt><dd><code>${escapeHtml(req.reference || req.id)}</code></dd></div>
        <div><dt>Submitted On</dt><dd>${formatDate(req.createdAt)}</dd></div>
        <div><dt>Exam Date</dt><dd>${formatDate(req.examination?.startsOn)}</dd></div>
        <div><dt>Required Language</dt><dd>${escapeHtml(req.language || 'English')}</dd></div>
        <div><dt>City / Location</dt><dd>${escapeHtml(req.city || req.examination?.locations?.[0]?.city || 'TBD')}</dd></div>
        ${req.requirements ? `<div><dt>Special Needs / Requirements</dt><dd>${escapeHtml(req.requirements)}</dd></div>` : ''}
      </dl>

      ${canCancel ? `
        <div class="detail-card__actions" style="margin-top: 1.5rem; border-top: 1px solid var(--color-border); padding-top: 1rem;">
          <button id="cancel-request-btn" class="btn btn--danger btn--sm">Cancel Request</button>
        </div>` : ''}
    </section>

    <section class="detail-card" aria-label="Status History">
      <h2>Status Timeline</h2>
      ${renderTimeline(history)}
    </section>
  `;

  // Attach button event listeners
  const cancelBtn = detailContainer.querySelector('#cancel-request-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => openCancelModal());

  const confirmMatchBtn = detailContainer.querySelector('#btn-confirm-match');
  if (confirmMatchBtn) {
    confirmMatchBtn.addEventListener('click', () => handleConfirmMatch(confirmMatchBtn));
  }

  const declineMatchBtn = detailContainer.querySelector('#btn-decline-match');
  if (declineMatchBtn) {
    declineMatchBtn.addEventListener('click', () => openDeclineMatchModal());
  }
}

// ─── Confirm Match Action ─────────────────────────────────────────────────────
async function handleConfirmMatch(btn) {
  if (!confirm('Are you sure you want to confirm this scribe match? This will finalize your scribe arrangement for the examination.')) {
    return;
  }

  setLoading(btn, true, 'Confirming…');
  try {
    await api.post(`/requests/${_requestId}/confirm-match`);
    showSuccess('Scribe arrangement confirmed! Your volunteer has been assigned.');
    await loadRequest();
  } catch (err) {
    showError(err.message || 'Failed to confirm match. Please try again.');
    setLoading(btn, false);
  }
}

// ─── Timeline ─────────────────────────────────────────────────────────────────
function renderTimeline(history) {
  if (!history.length) return '<p class="empty-state">No history available.</p>';

  return `<ol class="timeline" aria-label="Status history">
    ${history.map(h => `
      <li class="timeline__item">
        <span class="timeline__icon" aria-hidden="true">●</span>
        <div class="timeline__content">
          ${renderStatusBadge(h.toStatus || h.status)}
          <p class="timeline__note">${h.reason || h.note ? escapeHtml(h.reason || h.note) : ''}</p>
          <time class="timeline__time" datetime="${h.createdAt || h.changedAt}">${timeAgo(h.createdAt || h.changedAt)}</time>
        </div>
      </li>`).join('')}
  </ol>`;
}

// ─── Decline Match Modal ──────────────────────────────────────────────────────
function setupDeclineMatchModal() {
  if (!declineMatchModal) return;

  function closeModal() {
    declineMatchModal.hidden = true;
    document.body.style.overflow = '';
    if (declineMatchReason) declineMatchReason.value = '';
  }

  if (declineMatchClose) declineMatchClose.addEventListener('click', closeModal);
  if (declineMatchCancel) declineMatchCancel.addEventListener('click', closeModal);

  declineMatchModal.addEventListener('click', (e) => {
    if (e.target === declineMatchModal) closeModal();
  });

  if (declineMatchForm) {
    declineMatchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = declineMatchReason ? declineMatchReason.value.trim() : '';
      setLoading(declineMatchSubmit, true, 'Declining…');

      try {
        await api.post(`/requests/${_requestId}/decline-match`, { reason });
        showSuccess('Match declined. Your request has been returned to the queue.');
        closeModal();
        await loadRequest();
      } catch (err) {
        showError(err.message || 'Failed to decline match.');
      } finally {
        setLoading(declineMatchSubmit, false);
      }
    });
  }
}

function openDeclineMatchModal() {
  if (declineMatchModal) {
    declineMatchModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (declineMatchReason) {
      declineMatchReason.value = '';
      declineMatchReason.focus();
    }
  }
}

// ─── Cancel Modal ─────────────────────────────────────────────────────────────
function setupCancelModal() {
  if (!cancelModal) return;
  if (cancelCloseBtn) cancelCloseBtn.addEventListener('click', closeCancelModal);
  cancelModal.addEventListener('click', (e) => { if (e.target === cancelModal) closeCancelModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !cancelModal.hidden) closeCancelModal(); });

  if (cancelForm) {
    cancelForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = cancelReasonEl?.value.trim() || '';
      const submitBtn = cancelForm.querySelector('[type="submit"]');
      setLoading(submitBtn, true, 'Cancelling…');

      try {
        await api.post(`/requests/${_requestId}/cancel`, { reason });
        showSuccess('Request cancelled successfully.');
        closeCancelModal();
        await loadRequest();
      } catch (err) {
        showError(err.message || 'Failed to cancel request. Please try again.');
      } finally {
        setLoading(submitBtn, false);
      }
    });
  }
}

function openCancelModal() {
  if (cancelModal) {
    cancelModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (cancelReasonEl) {
      cancelReasonEl.value = '';
      cancelReasonEl.focus();
    }
  }
}

function closeCancelModal() {
  if (cancelModal) {
    cancelModal.hidden = true;
    document.body.style.overflow = '';
  }
}
