'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { formatDate, formatDateTime, renderStatusBadge, escapeHtml, renderPagination, getQueryParam, setQueryParam, setLoading } from '../utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _page       = 1;
let _totalPages = 1;
let _declineProposalId = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const invitationsSection = document.getElementById('invitations-section');
const invitationsContainer = document.getElementById('invitations-container');
const invitationsCountBadge = document.getElementById('invitations-count-badge');

const listEl  = document.getElementById('commitments-list');
const emptyEl = document.getElementById('commitments-empty');
const paginEl = document.getElementById('pagination');
const filterEl = document.getElementById('status-filter');

const declineModal = document.getElementById('decline-modal');
const declineForm = document.getElementById('decline-form');
const declineReasonInput = document.getElementById('decline-reason');
const declineModalClose = document.getElementById('decline-modal-close');
const declineModalCancel = document.getElementById('decline-modal-cancel');
const declineModalSubmit = document.getElementById('decline-modal-submit');

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  const user = await requireAuth('/login.html');
  if (!user) return;

  if (user.role !== 'VOLUNTEER') {
    window.location.href = '/candidate/dashboard.html';
    return;
  }

  initNavigation();
  updateUnreadCount();

  _page = parseInt(getQueryParam('page') || '1', 10);

  if (filterEl) {
    filterEl.value = getQueryParam('status') || '';
    filterEl.addEventListener('change', () => {
      setQueryParam('status', filterEl.value);
      _page = 1;
      loadCommitments();
    });
  }

  setupDeclineModal();

  await Promise.all([
    loadInvitations(),
    loadCommitments(),
  ]);
})();

// ─── Load Invitations ────────────────────────────────────────────────────────
async function loadInvitations() {
  if (!invitationsContainer || !invitationsSection) return;

  try {
    const res = await api.get('/interests/invitations');
    const invitations = Array.isArray(res.data) ? res.data : (res.data?.invitations || []);

    if (!invitations.length) {
      invitationsSection.hidden = true;
      return;
    }

    invitationsSection.hidden = false;
    if (invitationsCountBadge) {
      invitationsCountBadge.textContent = `${invitations.length} Action Needed`;
    }

    invitationsContainer.innerHTML = invitations.map((inv) => renderInvitationCard(inv)).join('');

    // Attach event listeners to buttons
    invitationsContainer.querySelectorAll('.btn-accept-invitation').forEach((btn) => {
      btn.addEventListener('click', () => handleAcceptInvitation(btn.dataset.id, btn));
    });

    invitationsContainer.querySelectorAll('.btn-decline-invitation').forEach((btn) => {
      btn.addEventListener('click', () => openDeclineModal(btn.dataset.id));
    });

  } catch (err) {
    console.error('Failed to load invitations:', err);
    invitationsSection.hidden = true;
  }
}

// ─── Render Invitation Card ───────────────────────────────────────────────────
function renderInvitationCard(inv) {
  const exam = inv.examination || {};
  const req = inv.request || {};

  return `
    <div class="card" style="border-left: 4px solid var(--color-primary); background: var(--color-surface);" id="invitation-card-${escapeHtml(inv.id)}">
      <div class="card-body" style="padding: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
              <span class="badge badge--teal" style="font-size: 0.75rem;">Match ${escapeHtml(inv.matchReference || 'INV')}</span>
              <span class="badge badge--success" style="font-size: 0.75rem;">Compatibility: ${inv.score}%</span>
            </div>
            <h3 style="margin: 0.25rem 0; font-size: 1.15rem; color: var(--color-text);">
              ${escapeHtml(exam.name || 'Examination Scribe Request')}
            </h3>
            <p style="margin: 0; font-size: 0.85rem; color: var(--color-text-muted);">
              ${escapeHtml(exam.authority || '')}
            </p>
          </div>

          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button class="btn btn--danger btn--sm btn-decline-invitation" data-id="${escapeHtml(inv.id)}">
              Decline
            </button>
            <button class="btn btn--primary btn--sm btn-accept-invitation" data-id="${escapeHtml(inv.id)}">
              Accept Invitation
            </button>
          </div>
        </div>

        <hr style="border: none; border-top: 1px solid var(--color-border); margin: 0.75rem 0;">

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; font-size: 0.875rem;">
          <div>
            <span style="color: var(--color-text-muted); display: block; font-size: 0.75rem; text-transform: uppercase;">Exam Date</span>
            <strong>${formatDate(exam.startsOn)}</strong>
          </div>
          <div>
            <span style="color: var(--color-text-muted); display: block; font-size: 0.75rem; text-transform: uppercase;">Required Language</span>
            <strong>${escapeHtml(req.language || 'Any')}</strong>
          </div>
          <div>
            <span style="color: var(--color-text-muted); display: block; font-size: 0.75rem; text-transform: uppercase;">Location / City</span>
            <strong>${escapeHtml(req.city || exam.locations?.[0]?.city || 'TBD')}</strong>
          </div>
          <div>
            <span style="color: var(--color-text-muted); display: block; font-size: 0.75rem; text-transform: uppercase;">Request Ref</span>
            <code>${escapeHtml(req.reference || 'REQ')}</code>
          </div>
        </div>

        ${inv.adminNote ? `
          <div style="margin-top: 0.75rem; padding: 0.6rem 0.85rem; background: var(--color-bg-secondary, rgba(0,0,0,0.03)); border-radius: 4px; font-size: 0.85rem;">
            <strong style="color: var(--color-text-muted);">Admin Note:</strong> ${escapeHtml(inv.adminNote)}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ─── Accept Invitation ────────────────────────────────────────────────────────
async function handleAcceptInvitation(proposalId, btn) {
  if (!confirm('Are you sure you want to accept this examination scribe invitation? Your acceptance will be sent to the candidate.')) {
    return;
  }

  setLoading(btn, true, 'Accepting…');
  try {
    await api.post(`/interests/invitations/${proposalId}/accept`);
    showSuccess('Invitation accepted! Candidate has been notified to finalize confirmation.');
    await loadInvitations();
    await loadCommitments();
  } catch (err) {
    showError(err.message || 'Failed to accept invitation. Please try again.');
    setLoading(btn, false);
  }
}

// ─── Decline Modal Setup ──────────────────────────────────────────────────────
function setupDeclineModal() {
  if (!declineModal) return;

  function closeModal() {
    declineModal.hidden = true;
    document.body.style.overflow = '';
    _declineProposalId = null;
    if (declineReasonInput) declineReasonInput.value = '';
  }

  if (declineModalClose) declineModalClose.addEventListener('click', closeModal);
  if (declineModalCancel) declineModalCancel.addEventListener('click', closeModal);

  declineModal.addEventListener('click', (e) => {
    if (e.target === declineModal) closeModal();
  });

  if (declineForm) {
    declineForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!_declineProposalId) return;

      const reason = declineReasonInput ? declineReasonInput.value.trim() : '';
      setLoading(declineModalSubmit, true, 'Declining…');

      try {
        await api.post(`/interests/invitations/${_declineProposalId}/decline`, { reason });
        showSuccess('Invitation declined.');
        closeModal();
        await loadInvitations();
      } catch (err) {
        showError(err.message || 'Failed to decline invitation.');
      } finally {
        setLoading(declineModalSubmit, false);
      }
    });
  }
}

function openDeclineModal(proposalId) {
  _declineProposalId = proposalId;
  if (declineModal) {
    declineModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (declineReasonInput) {
      declineReasonInput.value = '';
      declineReasonInput.focus();
    }
  }
}

// ─── Load Commitments ─────────────────────────────────────────────────────────
async function loadCommitments() {
  if (listEl) listEl.innerHTML = '<li class="loading-cell">Loading…</li>';

  const params = new URLSearchParams({ page: _page, pageSize: 15 });
  const status = filterEl?.value;
  if (status) params.set('status', status);

  try {
    const res = await api.get(`/assignments?${params.toString()}`);
    const assignments = Array.isArray(res.data) ? res.data : (res.data?.assignments || res.data?.items || []);
    _totalPages       = res.meta?.totalPages || res.data?.totalPages || 1;

    if (!assignments.length) {
      if (listEl)  listEl.hidden  = true;
      if (emptyEl) emptyEl.hidden = false;
      if (paginEl) paginEl.innerHTML = '';
      return;
    }

    if (listEl)  listEl.hidden  = false;
    if (emptyEl) emptyEl.hidden = true;

    if (listEl) {
      listEl.innerHTML = assignments.map(a => renderCommitmentItem(a)).join('');
    }

    if (paginEl) renderPagination(paginEl, { page: _page, totalPages: _totalPages }, goToPage);

  } catch (err) {
    if (listEl) listEl.innerHTML = '<li class="text-error">Failed to load commitments.</li>';
    showError(err.message || 'Could not fetch commitments.');
  }
}

// ─── Render Commitment Item ───────────────────────────────────────────────────
function renderCommitmentItem(assignment) {
  const sessions = assignment.examination?.sessions?.map(s =>
    `<li>${escapeHtml(s.name || s.type)}: ${formatDateTime(s.date)}</li>`
  ).join('') || '';

  return `<li class="commitment-item" style="border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; background: var(--color-surface);">
    <div class="commitment-item__info">
      <h3 class="commitment-item__exam" style="margin: 0 0 0.25rem 0; font-size: 1.15rem;">
        ${escapeHtml(assignment.examination?.name || 'Examination Session')}
      </h3>
      <p class="commitment-item__authority" style="margin: 0 0 0.75rem 0; font-size: 0.85rem; color: var(--color-text-muted);">
        ${escapeHtml(assignment.examination?.authority || '')}
      </p>
      <dl class="commitment-item__meta" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; margin: 0; font-size: 0.875rem;">
        <div><dt style="color: var(--color-text-muted); font-size: 0.75rem;">Exam Date</dt><dd style="margin: 0; font-weight: 600;">${formatDate(assignment.startsAt || assignment.examination?.startsOn)}</dd></div>
        <div><dt style="color: var(--color-text-muted); font-size: 0.75rem;">Candidate Name</dt><dd style="margin: 0; font-weight: 600;">${escapeHtml(assignment.candidateName || 'Candidate')}</dd></div>
        <div><dt style="color: var(--color-text-muted); font-size: 0.75rem;">Candidate Contact</dt><dd style="margin: 0; font-weight: 600;">${escapeHtml(assignment.candidateMobile || 'Shared closer to exam')}</dd></div>
        <div><dt style="color: var(--color-text-muted); font-size: 0.75rem;">Location</dt><dd style="margin: 0; font-weight: 600;">${escapeHtml(assignment.examination?.locations?.[0]?.city || 'TBD')}</dd></div>
      </dl>
      ${sessions ? `<h4 style="margin: 0.75rem 0 0.25rem 0; font-size: 0.85rem;">Sessions</h4><ul class="sessions-list">${sessions}</ul>` : ''}
    </div>
    <div class="commitment-item__status">
      ${renderStatusBadge(assignment.status)}
    </div>
  </li>`;
}

function goToPage(p) {
  _page = p;
  setQueryParam('page', p);
  loadCommitments();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
