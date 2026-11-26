'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { formatDate, formatDateTime, renderStatusBadge, escapeHtml, renderPagination, getQueryParam, setQueryParam, setLoading } from '../utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _page              = 1;
let _totalPages        = 1;
let _declineProposalId = null;
let _acceptProposalId  = null;
let _cancelAssignmentId = null;
let _cancelIsLocked    = false;
let _currentInvitations = [];

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const invitationsSection    = document.getElementById('invitations-section');
const invitationsContainer  = document.getElementById('invitations-container');
const invitationsCountBadge = document.getElementById('invitations-count-badge');

const listEl  = document.getElementById('commitments-list');
const emptyEl = document.getElementById('commitments-empty');
const loadingEl = document.getElementById('commitments-loading');
const errorEl   = document.getElementById('commitments-error');
const errorMsgEl = document.getElementById('commitments-error-msg');
const retryBtn  = document.getElementById('commitments-retry-btn');
const paginEl = document.getElementById('pagination');
const filterEl = document.getElementById('status-filter');

// Decline Modal refs
const declineModal       = document.getElementById('decline-modal');
const declineForm        = document.getElementById('decline-form');
const declineReasonInput = document.getElementById('decline-reason');
const declineModalClose  = document.getElementById('decline-modal-close');
const declineModalCancel = document.getElementById('decline-modal-cancel');
const declineModalSubmit = document.getElementById('decline-modal-submit');

// Agreement Modal refs
const agreementModal      = document.getElementById('commitment-agreement-modal');
const agreementCloseBtn   = document.getElementById('agreement-modal-close');
const agreementCancelBtn  = document.getElementById('agreement-modal-cancel');
const agreementAcceptBtn  = document.getElementById('agreement-modal-accept');
const agreementVenuePrev  = document.getElementById('agreement-venue-preview');
const agreementCheckboxes = document.querySelectorAll('.agreement-checkbox');

// Cancel Assignment Modal refs
const cancelModal        = document.getElementById('cancel-assignment-modal');
const cancelModalClose   = document.getElementById('cancel-assignment-close');
const cancelModalDismiss = document.getElementById('cancel-assignment-dismiss');
const cancelForm         = document.getElementById('cancel-assignment-form');
const cancelLockBanner   = document.getElementById('cancel-lock-banner');
const emergencyGroup     = document.getElementById('emergency-reason-group');
const cancelReasonSelect = document.getElementById('cancel-emergency-reason');
const cancelExplanation  = document.getElementById('cancel-explanation');
const cancelModalTitle   = document.getElementById('cancel-assignment-title');
const cancelModalSubmit  = document.getElementById('cancel-assignment-submit');

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

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      loadCommitments();
    });
  }

  setupModals();

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
    _currentInvitations = invitations;

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
      btn.addEventListener('click', () => openAgreementModal(btn.dataset.id));
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
  const venue = req.venue || {};

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

        ${venue.centreName ? `
          <div style="margin-top: 0.75rem; padding: 0.75rem; background: var(--color-surface-2); border-radius: 4px; font-size: 0.85rem;">
            <strong style="display: block; margin-bottom: 0.2rem; color: var(--color-primary);"><svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> Exact Examination Centre Venue:</strong>
            <div style="font-weight: 600;">${escapeHtml(venue.centreName)}</div>
            <div style="color: var(--color-text-secondary); margin-top: 0.15rem;">
              ${escapeHtml([venue.address, venue.area, venue.city, venue.state, venue.pincode].filter(Boolean).join(', '))}
            </div>
            ${venue.landmark ? `<div style="color: var(--color-text-muted); font-size: 0.8rem; margin-top: 0.15rem;">Landmark: ${escapeHtml(venue.landmark)}</div>` : ''}
            ${venue.mapLink ? `<div style="margin-top: 0.25rem;"><a href="${escapeHtml(venue.mapLink)}" target="_blank" rel="noopener noreferrer" style="color: var(--color-primary); text-decoration: underline;">Open Google Maps Location ↗</a></div>` : ''}
          </div>
        ` : ''}

        ${inv.adminNote ? `
          <div style="margin-top: 0.75rem; padding: 0.6rem 0.85rem; background: var(--color-bg-secondary, rgba(0,0,0,0.03)); border-radius: 4px; font-size: 0.85rem;">
            <strong style="color: var(--color-text-muted);">Admin Note:</strong> ${escapeHtml(inv.adminNote)}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ─── Agreement Modal Setup ────────────────────────────────────────────────────
function openAgreementModal(proposalId) {
  _acceptProposalId = proposalId;
  const inv = _currentInvitations.find((item) => item.id === proposalId);

  if (agreementVenuePrev && inv) {
    const exam = inv.examination || {};
    const req = inv.request || {};
    const venue = req.venue || {};

    agreementVenuePrev.innerHTML = `
      <div style="font-size: 0.875rem;">
        <h4 style="margin: 0 0 0.25rem; color: var(--color-primary); font-size: 1rem;">${escapeHtml(exam.name || 'Examination')}</h4>
        <div style="color: var(--color-text-muted); margin-bottom: 0.5rem;">Date: <strong>${formatDate(exam.startsOn)}</strong> | Language: <strong>${escapeHtml(req.language || 'Any')}</strong></div>
        <div style="padding: 0.5rem; background: var(--color-surface); border-radius: 4px; border: 1px solid var(--color-border);">
          <strong style="display: block; font-size: 0.85rem;"><svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> Examination Centre:</strong>
          <div style="font-weight: 600;">${escapeHtml(venue.centreName || 'Centre Name Pending')}</div>
          <div style="font-size: 0.8rem; color: var(--color-text-secondary);">${escapeHtml([venue.address, venue.area, venue.city, venue.state, venue.pincode].filter(Boolean).join(', '))}</div>
        </div>
      </div>
    `;
  }

  // Reset checkboxes
  if (agreementCheckboxes) {
    agreementCheckboxes.forEach((cb) => { cb.checked = false; });
  }
  if (agreementAcceptBtn) agreementAcceptBtn.disabled = true;

  if (agreementModal) {
    agreementModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
}

function closeAgreementModal() {
  if (agreementModal) {
    agreementModal.hidden = true;
    document.body.style.overflow = '';
  }
  _acceptProposalId = null;
}

// ─── Setup Modals ─────────────────────────────────────────────────────────────
function setupModals() {
  // Agreement Checkbox toggle
  agreementCheckboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      const allChecked = Array.from(agreementCheckboxes).every((c) => c.checked);
      if (agreementAcceptBtn) agreementAcceptBtn.disabled = !allChecked;
    });
  });

  if (agreementCloseBtn) agreementCloseBtn.addEventListener('click', closeAgreementModal);
  if (agreementCancelBtn) agreementCancelBtn.addEventListener('click', closeAgreementModal);

  if (agreementAcceptBtn) {
    agreementAcceptBtn.addEventListener('click', async () => {
      if (!_acceptProposalId) return;

      setLoading(agreementAcceptBtn, true, 'Accepting…');
      try {
        await api.post(`/interests/invitations/${_acceptProposalId}/accept`, {
          termsAccepted: true,
          termsVersion: '1.0',
        });

        showSuccess('Volunteer Commitment Agreement confirmed! Candidate has been notified.');
        closeAgreementModal();
        await loadInvitations();
        await loadCommitments();
      } catch (err) {
        showError(err.message || 'Failed to accept commitment agreement.');
      } finally {
        setLoading(agreementAcceptBtn, false);
      }
    });
  }

  // Decline Modal
  function closeDeclineModal() {
    if (declineModal) {
      declineModal.hidden = true;
      document.body.style.overflow = '';
    }
    _declineProposalId = null;
    if (declineReasonInput) declineReasonInput.value = '';
  }

  if (declineModalClose) declineModalClose.addEventListener('click', closeDeclineModal);
  if (declineModalCancel) declineModalCancel.addEventListener('click', closeDeclineModal);

  if (declineForm) {
    declineForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!_declineProposalId) return;

      const reason = declineReasonInput ? declineReasonInput.value.trim() : '';
      setLoading(declineModalSubmit, true, 'Declining…');

      try {
        await api.post(`/interests/invitations/${_declineProposalId}/decline`, { reason });
        showSuccess('Invitation declined.');
        closeDeclineModal();
        await loadInvitations();
      } catch (err) {
        showError(err.message || 'Failed to decline invitation.');
      } finally {
        setLoading(declineModalSubmit, false);
      }
    });
  }

  // Cancel Assignment Modal
  function closeCancelModal() {
    if (cancelModal) {
      cancelModal.hidden = true;
      document.body.style.overflow = '';
    }
    _cancelAssignmentId = null;
    _cancelIsLocked = false;
    if (cancelReasonSelect) cancelReasonSelect.value = '';
    if (cancelExplanation) cancelExplanation.value = '';
  }

  if (cancelModalClose) cancelModalClose.addEventListener('click', closeCancelModal);
  if (cancelModalDismiss) cancelModalDismiss.addEventListener('click', closeCancelModal);

  if (cancelForm) {
    cancelForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!_cancelAssignmentId) return;

      const reason = _cancelIsLocked ? cancelReasonSelect?.value : (cancelExplanation?.value.trim() || 'Volunteer cancelled');
      const explanation = cancelExplanation?.value.trim() || '';

      if (_cancelIsLocked && !reason) {
        showError('Please select a mandatory emergency reason.');
        cancelReasonSelect?.focus();
        return;
      }
      if (_cancelIsLocked && !explanation) {
        showError('A detailed explanation is required for emergency cancellation.');
        cancelExplanation?.focus();
        return;
      }

      setLoading(cancelModalSubmit, true, 'Submitting…');
      try {
        await api.post(`/assignments/${_cancelAssignmentId}/cancel`, {
          isEmergency: _cancelIsLocked,
          reason,
          explanation,
        });

        showSuccess(_cancelIsLocked ? 'Emergency cancellation submitted. Administrators and candidate alerted.' : 'Commitment cancelled.');
        closeCancelModal();
        await loadCommitments();
      } catch (err) {
        showError(err.message || 'Failed to cancel commitment.');
      } finally {
        setLoading(cancelModalSubmit, false);
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

function openCancelModal(assignmentId, isLocked) {
  _cancelAssignmentId = assignmentId;
  _cancelIsLocked = Boolean(isLocked);

  if (cancelLockBanner) cancelLockBanner.style.display = _cancelIsLocked ? 'block' : 'none';
  if (emergencyGroup) emergencyGroup.style.display = _cancelIsLocked ? 'block' : 'none';
  if (cancelReasonSelect) cancelReasonSelect.required = _cancelIsLocked;

  if (cancelModalTitle) {
    cancelModalTitle.textContent = _cancelIsLocked ? 'Emergency Scribe Cancellation' : 'Cancel Scribe Commitment';
  }
  if (cancelModalSubmit) {
    cancelModalSubmit.textContent = _cancelIsLocked ? 'Submit Emergency Cancellation' : 'Confirm Cancellation';
  }

  if (cancelModal) {
    cancelModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (cancelExplanation) cancelExplanation.value = '';
  }
}

function setCommitmentsState(state, message = '') {
  if (loadingEl) loadingEl.hidden = (state !== 'loading');
  if (listEl)    listEl.hidden    = (state !== 'success');
  if (emptyEl)   emptyEl.hidden   = (state !== 'empty');
  if (errorEl)   errorEl.hidden   = (state !== 'error');
  if (state === 'error' && errorMsgEl) {
    errorMsgEl.textContent = message || 'Failed to load commitments.';
  }
}

// ─── Load Commitments ─────────────────────────────────────────────────────────
async function loadCommitments() {
  setCommitmentsState('loading');

  const params = new URLSearchParams({ page: _page, pageSize: 15 });
  const status = filterEl?.value;
  if (status) params.set('status', status);

  try {
    const res = await api.get(`/assignments?${params.toString()}`);
    const assignments = Array.isArray(res.data) ? res.data : (res.data?.assignments || res.data?.items || []);
    _totalPages       = res.meta?.totalPages || res.data?.totalPages || 1;

    if (!assignments.length) {
      setCommitmentsState('empty');
      if (paginEl) paginEl.innerHTML = '';
      return;
    }

    setCommitmentsState('success');
    if (listEl) {
      listEl.innerHTML = assignments.map(a => renderCommitmentItem(a)).join('');

      // Wire cancel buttons
      listEl.querySelectorAll('.btn-cancel-commitment').forEach((btn) => {
        btn.addEventListener('click', () => {
          openCancelModal(btn.dataset.id, btn.dataset.locked === 'true');
        });
      });

      // Wire copy allocation ID buttons
      listEl.querySelectorAll('.copy-volunteer-alloc-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const text = btn.dataset.copy;
          if (text) {
            try {
              await navigator.clipboard.writeText(text);
              btn.textContent = 'Copied!';
              setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
            } catch (err) {
              showSuccess(`Allocation ID: ${text}`);
            }
          }
        });
      });
    }

    if (paginEl) renderPagination(paginEl, { page: _page, totalPages: _totalPages }, goToPage);

  } catch (err) {
    setCommitmentsState('error', err.message || 'Failed to load commitments.');
    showError(err.message || 'Could not fetch commitments.');
  } finally {
    if (loadingEl) loadingEl.hidden = true;
  }
}

// ─── Render Commitment Item ───────────────────────────────────────────────────
function renderCommitmentItem(assignment) {
  const sessions = assignment.examination?.sessions?.map(s =>
    `<li>${escapeHtml(s.name || s.type || s.label)}: ${formatDateTime(s.startsAt || s.date)}</li>`
  ).join('') || '';

  const venue = assignment.venue || {};
  const isConfirmed = assignment.status === 'CONFIRMED';
  const examDate = formatDate(assignment.startsAt || assignment.examination?.startsOn);

  if (isConfirmed) {
    const allocId = assignment.allocationId || 'PNZ20260001';
    const examName = assignment.examination?.name || assignment.examination?.title || 'Examination Session';
    const examAuthority = assignment.examination?.authority || '';
    const examTime = assignment.examination?.session?.label || (assignment.startsAt ? formatDateTime(assignment.startsAt) : '10:00 AM');
    const reportingTime = assignment.reportingTime || 'To be communicated by coordinator';
    const meetingPoint = assignment.meetingPoint || 'Main Examination Centre Entrance';
    const reportingInstructions = assignment.reportingInstructions || '';
    const venueName = venue.centreName || 'Examination Centre';
    const venueAddress = [venue.address, venue.area, venue.city, venue.state, venue.pincode].filter(Boolean).join(', ') || 'Address details pending';
    const mapLink = venue.mapLink || '';

    return `
      <li class="commitment-item confirmation-card" style="border-left: 5px solid var(--color-success, #16a34a); border-radius: var(--radius-md); padding: 1.5rem 1.75rem; background: var(--color-surface); box-shadow: var(--shadow-sm); margin-bottom: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
              <span class="badge badge--success" style="font-weight: 700; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem;">
                <svg class="icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                Allocation Confirmed
              </span>
              ${assignment.isLocked ? '<span class="badge badge--red" style="font-size: 0.75rem;"><svg class="icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> Locked (5-Day Rule)</span>' : ''}
            </div>
            <h3 style="margin: 0; font-size: 1.35rem; font-family: var(--font-display); font-weight: 800; color: var(--color-espresso);">
              Allocation Confirmed
            </h3>
          </div>

          <div style="display: flex; align-items: center; gap: 0.5rem; background: var(--color-surface-2); padding: 0.5rem 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
            <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Allocation ID:</span>
            <code style="font-size: 1.1rem; font-weight: 800; color: var(--color-primary); letter-spacing: 0.06em;">${escapeHtml(allocId)}</code>
            <button type="button" class="btn btn--ghost btn--sm copy-volunteer-alloc-btn" data-copy="${escapeHtml(allocId)}" title="Copy Allocation ID" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; font-weight: 600;">
              Copy
            </button>
          </div>
        </div>

        <!-- Official Volunteer Guidance Message -->
        <div class="alert alert--info" style="margin: 0.5rem 0 1.25rem 0; font-size: 0.925rem; line-height: 1.55; border-radius: var(--radius-sm); background: rgba(30, 64, 175, 0.06); border-left: 3px solid var(--color-primary); color: var(--color-text);">
          <p style="margin: 0;">Your scribe commitment has been confirmed. Please report to the designated meeting point at the specified reporting time. Use your Allocation ID to identify your assigned candidate or seek assistance from an authorized examination coordinator, where available.</p>
        </div>

        <!-- Coordination Details Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.25rem;">
          <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
            <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Examination</span>
            <strong style="font-size: 1rem; color: var(--color-text);">${escapeHtml(examName)}</strong>
            ${examAuthority ? `<div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.15rem;">${escapeHtml(examAuthority)}</div>` : ''}
          </div>

          <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
            <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Examination Date</span>
            <strong style="font-size: 1rem; color: var(--color-text);">${examDate}</strong>
          </div>

          <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
            <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Examination Time</span>
            <strong style="font-size: 1rem; color: var(--color-text);">${escapeHtml(examTime)}</strong>
          </div>

          <!-- Reporting Time (HIGHLIGHTED) -->
          <div style="padding: 0.85rem 1.15rem; background: rgba(22, 163, 74, 0.08); border-radius: var(--radius-sm); border: 1.5px solid var(--color-success, #16a34a);">
            <span style="display: block; font-size: 0.72rem; color: var(--color-success, #16a34a); text-transform: uppercase; font-weight: 800; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Reporting Time</span>
            <strong style="font-size: 1.15rem; color: var(--color-success, #16a34a);">${escapeHtml(reportingTime)}</strong>
            <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">Please report on or before this time</div>
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

          <!-- Venue -->
          <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border); grid-column: 1 / -1;">
            <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Venue</span>
            <strong style="font-size: 1rem; color: var(--color-text);">${escapeHtml(venueName)}</strong>
            <div style="font-size: 0.85rem; color: var(--color-text-secondary); margin-top: 0.2rem;">${escapeHtml(venueAddress)}</div>
            ${mapLink ? `<div style="margin-top: 0.35rem;"><a href="${escapeHtml(mapLink)}" target="_blank" rel="noopener noreferrer" style="color: var(--color-primary); font-size: 0.825rem; text-decoration: underline;">View on Google Maps ↗</a></div>` : ''}
          </div>

          ${reportingInstructions ? `
            <div style="padding: 0.85rem 1.15rem; background: var(--color-surface-2); border-radius: var(--radius-sm); border: 1px solid var(--color-border); grid-column: 1 / -1;">
              <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em;">Additional Reporting Instructions</span>
              <div style="font-size: 0.9rem; color: var(--color-text); line-height: 1.5;">${escapeHtml(reportingInstructions)}</div>
            </div>
          ` : ''}
        </div>

        <div style="display: flex; justify-content: flex-end; align-items: center; border-top: 1px solid var(--color-border); padding-top: 1rem;">
          <button class="btn btn--sm ${assignment.isLocked ? 'btn--danger' : 'btn--outline'} btn-cancel-commitment" data-id="${assignment.id}" data-locked="${assignment.isLocked ? 'true' : 'false'}">
            ${assignment.isLocked ? 'Emergency Cancellation' : 'Cancel Commitment'}
          </button>
        </div>
      </li>
    `;
  }

  return `<li class="commitment-item" style="border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; background: var(--color-surface); flex-wrap: wrap;">
    <div class="commitment-item__info" style="flex: 1; min-width: 280px;">
      <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem; flex-wrap: wrap;">
        <h3 class="commitment-item__exam" style="margin: 0; font-size: 1.15rem;">
          ${escapeHtml(assignment.examination?.name || 'Examination Session')}
        </h3>
        ${assignment.isLocked ? '<span class="badge badge--red" style="font-size: 0.75rem;"><svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> Commitment Locked (5-Day Rule)</span>' : ''}
      </div>
      <p class="commitment-item__authority" style="margin: 0 0 0.75rem 0; font-size: 0.85rem; color: var(--color-text-muted);">
        ${escapeHtml(assignment.examination?.authority || '')}
      </p>
      <dl class="commitment-item__meta" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; margin: 0; font-size: 0.875rem;">
        <div><dt style="color: var(--color-text-muted); font-size: 0.75rem;">Exam Date</dt><dd style="margin: 0; font-weight: 600;">${examDate}</dd></div>
        <div><dt style="color: var(--color-text-muted); font-size: 0.75rem;">Commitment Status</dt><dd style="margin: 0; font-weight: 600; color: var(--color-success, #16a34a);">${isConfirmed ? 'Confirmed Scribe' : assignment.status}</dd></div>
        <div><dt style="color: var(--color-text-muted); font-size: 0.75rem;">City</dt><dd style="margin: 0; font-weight: 600;">${escapeHtml(venue.city || assignment.examination?.locations?.[0]?.city || 'TBD')}</dd></div>
      </dl>

      ${venue.centreName ? `
        <div style="margin-top: 0.75rem; padding: 0.65rem 0.85rem; background: var(--color-surface-2); border-radius: 4px; font-size: 0.85rem;">
          <strong style="color: var(--color-primary); display: block; margin-bottom: 0.2rem;"><svg class="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> Exact Examination Centre Venue:</strong>
          <div style="font-weight: 600;">${escapeHtml(venue.centreName)}</div>
          <div style="color: var(--color-text-secondary); font-size: 0.8rem;">
            ${escapeHtml([venue.address, venue.area, venue.city, venue.state, venue.pincode].filter(Boolean).join(', '))}
          </div>
          ${venue.landmark ? `<div style="color: var(--color-text-muted); font-size: 0.8rem; margin-top: 0.15rem;">Landmark: ${escapeHtml(venue.landmark)}</div>` : ''}
          ${venue.mapLink ? `<div style="margin-top: 0.2rem;"><a href="${escapeHtml(venue.mapLink)}" target="_blank" rel="noopener noreferrer" style="color: var(--color-primary); text-decoration: underline;">View on Google Maps ↗</a></div>` : ''}
        </div>
      ` : ''}

      ${assignment.cancellationReason ? `
        <div style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--color-error);">
          <strong>Cancellation Reason:</strong> ${escapeHtml(assignment.cancellationReason)}
          ${assignment.cancellationExplanation ? `<div style="font-size: 0.8rem; color: var(--color-text-muted);">${escapeHtml(assignment.cancellationExplanation)}</div>` : ''}
        </div>
      ` : ''}

      ${sessions ? `<h4 style="margin: 0.75rem 0 0.25rem 0; font-size: 0.85rem;">Sessions</h4><ul class="sessions-list">${sessions}</ul>` : ''}
    </div>

    <div class="commitment-item__status" style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.75rem;">
      ${renderStatusBadge(assignment.status)}
      ${isConfirmed ? `
        <button class="btn btn--sm ${assignment.isLocked ? 'btn--danger' : 'btn--outline'} btn-cancel-commitment" data-id="${assignment.id}" data-locked="${assignment.isLocked ? 'true' : 'false'}">
          ${assignment.isLocked ? 'Emergency Cancellation' : 'Cancel Commitment'}
        </button>
      ` : ''}
    </div>
  </li>`;
}

function goToPage(p) {
  _page = p;
  setQueryParam('page', p);
  loadCommitments();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
