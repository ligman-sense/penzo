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
  await loadRequest();
})();

// ─── Load Request ─────────────────────────────────────────────────────────────
async function loadRequest() {
  if (loadingEl) loadingEl.hidden = false;

  try {
    const { data } = await api.get(`/requests/${_requestId}`);
    _request = data.request || data;

    // Load non-identifying allocation metadata if available
    if (['MATCH_PROPOSED', 'CONFIRMED'].includes(_request.status)) {
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
  const isConfirmed = req.status === 'CONFIRMED';
  const isMatchProposed = req.status === 'MATCH_PROPOSED';

  const history = req.history || req.statusHistory || [];

  let matchSectionHtml = '';

  if (isConfirmed) {
    matchSectionHtml = `
      <section class="card" style="border-left: 4px solid var(--color-success, #16a34a); margin-bottom: 1.5rem; background: var(--color-surface);">
        <div class="card-body" style="padding: 1.25rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
            <span class="badge badge--success">✓ Scribe Allocated & Confirmed</span>
          </div>
          <h2 style="margin: 0 0 0.5rem 0; font-size: 1.25rem;">
            Scribe Allocated
          </h2>
          <p style="margin: 0; font-size: 0.9rem; color: var(--color-text-muted);">
            A qualified volunteer scribe has been allocated and confirmed for your examination assistance.
          </p>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; margin-top: 1rem; font-size: 0.875rem;">
            <div>
              <span style="color: var(--color-text-muted); display: block; font-size: 0.75rem;">Allocation Status</span>
              <strong style="color: var(--color-success, #16a34a);">Confirmed</strong>
            </div>
            <div>
              <span style="color: var(--color-text-muted); display: block; font-size: 0.75rem;">Coordination</span>
              <strong>Facilitated via PENZO</strong>
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
          Our administrative team has matched your request with an eligible volunteer. We will update your status as soon as the volunteer accepts.
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
        <div><dt>Exam Date</dt><dd>${formatDate(req.session?.startsAt || req.examination?.startsOn)}</dd></div>
        <div><dt>Required Language</dt><dd>${escapeHtml(req.language || 'English')}</dd></div>
        <div><dt>City / Location</dt><dd>${escapeHtml(req.city || req.examination?.locations?.[0]?.city || 'TBD')}</dd></div>
        ${req.requirements ? `<div><dt>Special Needs / Requirements</dt><dd>${escapeHtml(req.requirements)}</dd></div>` : ''}
      </dl>

      ${req.venue && req.venue.centreName ? `
        <div style="margin-top: 1.25rem; padding: 1rem; background: var(--color-bg-secondary, rgba(0,0,0,0.02)); border: 1px solid var(--color-border); border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <strong style="font-size: 0.95rem; display: flex; align-items: center; gap: 0.35rem;">
              <span>📍</span> Examination Centre Venue
            </strong>
            ${req.venue.confirmed 
              ? '<span class="badge badge--success" style="font-size: 0.75rem;">✓ Venue Confirmed by Admin</span>'
              : '<span class="badge badge--amber" style="font-size: 0.75rem;">Pending Admin Confirmation</span>'
            }
          </div>
          <p style="margin: 0.25rem 0; font-weight: 600; font-size: 0.95rem;">${escapeHtml(req.venue.centreName)}</p>
          <p style="margin: 0.25rem 0; color: var(--color-text-secondary); font-size: 0.875rem;">
            ${escapeHtml([req.venue.address, req.venue.area, req.venue.city, req.venue.state, req.venue.pincode].filter(Boolean).join(', '))}
          </p>
          ${req.venue.landmark ? `<p style="margin: 0.25rem 0; font-size: 0.85rem; color: var(--color-text-muted);"><strong>Landmark:</strong> ${escapeHtml(req.venue.landmark)}</p>` : ''}
          ${req.venue.mapLink ? `<p style="margin: 0.25rem 0; font-size: 0.85rem;"><a href="${escapeHtml(req.venue.mapLink)}" target="_blank" rel="noopener noreferrer" style="color: var(--color-primary); text-decoration: underline;">View on Google Maps ↗</a></p>` : ''}
        </div>
      ` : ''}

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
