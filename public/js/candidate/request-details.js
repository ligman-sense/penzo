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
    const alloc = req.allocation || _proposedMatch || {};
    const allocId = alloc.allocationId || _proposedMatch?.allocationId || 'PNZ20260001';
    const examName = req.examination?.name || req.examination?.title || 'Examination';
    const examAuthority = req.examination?.authority || '';
    const examDate = formatDate(req.session?.startsAt || req.examination?.startsOn);
    const examTime = req.session?.label || (req.session?.startsAt ? formatDateTime(req.session.startsAt) : (req.examination?.startsOn ? formatDateTime(req.examination.startsOn) : '10:00 AM'));
    const reportingTime = alloc.reportingTime || 'To be communicated by coordinator';
    const meetingPoint = alloc.meetingPoint || 'Main Examination Centre Entrance';
    const reportingInstructions = alloc.reportingInstructions || '';
    const venueName = req.venue?.centreName || 'Examination Centre';
    const venueAddress = [req.venue?.address, req.venue?.area, req.venue?.city || req.city, req.venue?.state, req.venue?.pincode].filter(Boolean).join(', ') || 'Address details pending';
    const mapLink = req.venue?.mapLink || '';

    matchSectionHtml = `
      <section class="card confirmation-card" style="border-left: 5px solid var(--color-success, #16a34a); margin-bottom: 1.75rem; background: var(--color-surface); box-shadow: var(--shadow-sm); border-radius: var(--radius-md);">
        <div class="card-body" style="padding: 1.75rem;">
          <!-- Header with Status Badge and Allocation ID -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                <span class="badge badge--success" style="font-weight: 700; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem;">
                  <svg class="icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  Allocation Confirmed
                </span>
              </div>
              <h2 style="margin: 0; font-size: 1.4rem; font-family: var(--font-display); font-weight: 800; color: var(--color-espresso);">
                Allocation Confirmed
              </h2>
            </div>

            <!-- Allocation ID with Copy Button -->
            <div style="display: flex; align-items: center; gap: 0.5rem; background: var(--color-surface-2); padding: 0.5rem 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
              <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Allocation ID:</span>
              <code id="candidate-allocation-id" style="font-size: 1.1rem; font-weight: 800; color: var(--color-primary); letter-spacing: 0.06em;">${escapeHtml(allocId)}</code>
              <button type="button" class="btn btn--ghost btn--sm copy-candidate-alloc-btn" data-copy="${escapeHtml(allocId)}" title="Copy Allocation ID" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; font-weight: 600;">
                Copy
              </button>
            </div>
          </div>

          <!-- Official Candidate Guidance Message -->
          <div class="alert alert--info" style="margin: 0.5rem 0 1.25rem 0; font-size: 0.925rem; line-height: 1.55; border-radius: var(--radius-sm); background: rgba(30, 64, 175, 0.06); border-left: 3px solid var(--color-primary); color: var(--color-text);">
            <p style="margin: 0;">Your scribe allocation has been confirmed. Please report to the designated meeting point at the specified reporting time. Use your Allocation ID to identify your assigned scribe or seek assistance from an authorized examination coordinator, where available.</p>
          </div>

          <!-- Examination & Coordination Details Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
            <!-- Examination -->
            <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
              <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Examination</span>
              <strong style="font-size: 1rem; color: var(--color-text);">${escapeHtml(examName)}</strong>
              ${examAuthority ? `<div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.15rem;">${escapeHtml(examAuthority)}</div>` : ''}
            </div>

            <!-- Examination Date -->
            <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
              <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Examination Date</span>
              <strong style="font-size: 1rem; color: var(--color-text);">${examDate}</strong>
            </div>

            <!-- Examination Time -->
            <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
              <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Examination Time</span>
              <strong style="font-size: 1rem; color: var(--color-text);">${escapeHtml(examTime)}</strong>
            </div>

            <!-- Reporting Time (HIGHLIGHTED) -->
            <div style="padding: 0.85rem 1.15rem; background: rgba(22, 163, 74, 0.08); border-radius: var(--radius-sm); border: 1.5px solid var(--color-success, #16a34a);">
              <span style="display: block; font-size: 0.72rem; color: var(--color-success, #16a34a); text-transform: uppercase; font-weight: 800; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Reporting Time</span>
              <strong style="font-size: 1.15rem; color: var(--color-success, #16a34a);">${escapeHtml(reportingTime)}</strong>
              <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">Report on or before this time</div>
            </div>

            <!-- Meeting Point (HIGHLIGHTED) -->
            <div style="padding: 0.85rem 1.15rem; background: rgba(217, 119, 6, 0.08); border-radius: var(--radius-sm); border: 1.5px solid var(--color-ochre, #d97706);">
              <span style="display: block; font-size: 0.72rem; color: var(--color-ochre, #d97706); text-transform: uppercase; font-weight: 800; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Meeting Point</span>
              <strong style="font-size: 1.05rem; color: var(--color-text);">${escapeHtml(meetingPoint)}</strong>
              <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">Designated coordination area</div>
            </div>

            <!-- Allocation Status -->
            <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
              <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Allocation Status</span>
              <strong style="font-size: 1rem; color: var(--color-success, #16a34a);">Confirmed</strong>
            </div>

            <!-- Venue (Full-width) -->
            <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border); grid-column: 1 / -1;">
              <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Examination Venue</span>
              <strong style="font-size: 1rem; color: var(--color-text);">${escapeHtml(venueName)}</strong>
              <div style="font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 0.2rem; line-height: 1.4;">${escapeHtml(venueAddress)}</div>
              ${mapLink ? `<div style="margin-top: 0.35rem;"><a href="${escapeHtml(mapLink)}" target="_blank" rel="noopener noreferrer" style="color: var(--color-primary); font-size: 0.825rem; text-decoration: underline;">View on Google Maps ↗</a></div>` : ''}
            </div>

            <!-- Additional Instructions (Full-width, if available) -->
            ${reportingInstructions ? `
              <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border); grid-column: 1 / -1;">
                <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Additional Reporting Instructions</span>
                <div style="font-size: 0.9rem; color: var(--color-text); line-height: 1.5;">${escapeHtml(reportingInstructions)}</div>
              </div>
            ` : ''}
          </div>
        </div>
      </section>
    `;
  } else if (isMatchProposed) {
    matchSectionHtml = `
      <div class="card" style="border-left: 4px solid var(--color-warning); margin-bottom: 1.75rem; background: var(--color-surface); padding: 1.5rem 1.75rem; box-shadow: var(--shadow-sm);">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
          <span class="badge badge--ochre">Match Proposed</span>
        </div>
        <h3 style="margin: 0 0 0.35rem 0; font-size: 1.2rem; font-family: var(--font-display); font-weight: 800;">Awaiting Volunteer Acceptance</h3>
        <p style="margin: 0; font-size: 0.9rem; color: var(--color-text-secondary); line-height: 1.5;">
          Our administrative team has matched your request with an eligible volunteer. We will update your status as soon as the volunteer accepts.
        </p>
      </div>
    `;
  }

  detailContainer.innerHTML = `
    ${matchSectionHtml}

    <section class="detail-card" aria-label="Request Details" style="margin-bottom: 1.75rem;">
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
        <div style="margin-top: 1.5rem; padding: 1.25rem 1.5rem; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.65rem; flex-wrap: wrap; gap: 0.5rem;">
            <strong style="font-size: 1rem; display: flex; align-items: center; gap: 0.4rem; color: var(--color-terracotta);">
              <svg class="icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> Examination Centre Venue
            </strong>
            ${req.venue.confirmed 
              ? '<span class="badge badge--success" style="font-size: 0.75rem;"><svg class="icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Venue Confirmed by Admin</span>'
              : '<span class="badge badge--amber" style="font-size: 0.75rem;">Pending Admin Confirmation</span>'
            }
          </div>
          <p style="margin: 0.35rem 0; font-weight: 700; font-size: 1.05rem; color: var(--color-text);">${escapeHtml(req.venue.centreName)}</p>
          <p style="margin: 0.25rem 0; color: var(--color-text-secondary); font-size: 0.9rem; line-height: 1.5;">
            ${escapeHtml([req.venue.address, req.venue.area, req.venue.city, req.venue.state, req.venue.pincode].filter(Boolean).join(', '))}
          </p>
          ${req.venue.landmark ? `<p style="margin: 0.35rem 0 0; font-size: 0.85rem; color: var(--color-text-muted);"><strong>Landmark:</strong> ${escapeHtml(req.venue.landmark)}</p>` : ''}
          ${req.venue.mapLink ? `<p style="margin: 0.5rem 0 0; font-size: 0.875rem;"><a href="${escapeHtml(req.venue.mapLink)}" target="_blank" rel="noopener noreferrer" style="color: var(--color-terracotta); font-weight: 600; text-decoration: underline;">View on Google Maps ↗</a></p>` : ''}
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

  // Wire Copy Allocation ID button
  const copyBtn = detailContainer.querySelector('.copy-candidate-alloc-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const text = copyBtn.dataset.copy;
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        } catch (err) {
          showSuccess(`Allocation ID: ${text}`);
        }
      }
    });
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
