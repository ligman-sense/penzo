'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { formatDate, formatDateTime, renderStatusBadge, escapeHtml, getQueryParam, timeAgo, setLoading } from '../utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _requestId = null;
let _request   = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const detailContainer = document.getElementById('request-detail');
const loadingEl       = document.getElementById('loading-indicator');
const cancelModal     = document.getElementById('cancel-modal');
const cancelForm      = document.getElementById('cancel-form');
const cancelReasonEl  = document.getElementById('cancel-reason');
const cancelCloseBtn  = document.getElementById('cancel-modal-close');
const cancelTrigger   = document.getElementById('cancel-request-btn');

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

  await loadRequest();
  setupCancelModal();
})();

// ─── Load Request ─────────────────────────────────────────────────────────────
async function loadRequest() {
  if (loadingEl) loadingEl.hidden = false;

  try {
    const { data } = await api.get(`/requests/${_requestId}`);
    _request = data.request || data;
    if (loadingEl) loadingEl.hidden = true;
    renderRequest(_request);
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
function renderRequest(req) {
  if (!detailContainer) return;

  const canCancel = ['SUBMITTED', 'PENDING_REVIEW', 'AWAITING_VOLUNTEER', 'MATCH_PROPOSED'].includes(req.status);

  detailContainer.innerHTML = `
    <section class="detail-card" aria-label="Request Details">
      <header class="detail-card__header">
        <div>
          <h1 class="detail-card__title">${escapeHtml(req.examination?.name || 'Exam Request')}</h1>
          <p class="detail-card__subtitle">${escapeHtml(req.examination?.authority || '')}</p>
        </div>
        <div>${renderStatusBadge(req.status)}</div>
      </header>

      <dl class="detail-grid">
        <div><dt>Request ID</dt><dd><code>${escapeHtml(req.id)}</code></dd></div>
        <div><dt>Submitted On</dt><dd>${formatDate(req.createdAt)}</dd></div>
        <div><dt>Exam Date</dt><dd>${formatDate(req.examination?.startsOn)}</dd></div>
        <div><dt>Exam Location</dt><dd>${escapeHtml(req.preferredLocation || req.examination?.locations?.[0]?.city || 'TBD')}</dd></div>
        ${req.volunteerName ? `<div><dt>Assigned Volunteer</dt><dd>${escapeHtml(req.volunteerName)}</dd></div>` : ''}
        ${req.session ? `<div><dt>Session</dt><dd>${escapeHtml(req.session)}</dd></div>` : ''}
        ${req.specialRequirements ? `<div><dt>Special Requirements</dt><dd>${escapeHtml(req.specialRequirements)}</dd></div>` : ''}
      </dl>

      ${canCancel ? `
        <div class="detail-card__actions">
          <button id="cancel-request-btn" class="btn btn--danger btn--sm">Cancel Request</button>
        </div>` : ''}
    </section>

    <section class="detail-card" aria-label="Status History">
      <h2>Status Timeline</h2>
      ${renderTimeline(req.statusHistory || [])}
    </section>`;

  // Re-bind cancel button after render
  const cancelBtn = detailContainer.querySelector('#cancel-request-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => openCancelModal());
}

function renderTimeline(history) {
  if (!history.length) return '<p class="empty-state">No history available.</p>';

  return `<ol class="timeline" aria-label="Status history">
    ${history.map(h => `
      <li class="timeline__item">
        <span class="timeline__icon" aria-hidden="true">●</span>
        <div class="timeline__content">
          ${renderStatusBadge(h.status)}
          <p class="timeline__note">${h.note ? escapeHtml(h.note) : ''}</p>
          <time class="timeline__time" datetime="${h.changedAt}">${timeAgo(h.changedAt)}</time>
        </div>
      </li>`).join('')}
  </ol>`;
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
        await loadRequest(); // Refresh
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
    cancelReasonEl?.focus();
  }
}

function closeCancelModal() {
  if (cancelModal) {
    cancelModal.hidden = true;
    document.body.style.overflow = '';
  }
}
