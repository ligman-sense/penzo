'use strict';

import { api } from '../api.js';
import { requireAdmin, adminLogout } from '../auth.js';
import { showError, showSuccess } from '../notifications.js';
import { formatDate, renderPagination, debounce, escapeHtml, setLoading } from '../utils.js';
import { registerModal, openModal, closeModal, closeAllModals } from '../modal.js';

let currentPage = 1;
let currentStatus = 'PENDING';
let currentRole = 'ALL';
let currentSearch = '';
let activeRecordId = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Ensure all modals start closed immediately
  closeAllModals();

  const admin = await requireAdmin();
  if (!admin) return;

  const adminNameEl = document.getElementById('admin-name');
  if (adminNameEl && admin.name) adminNameEl.textContent = admin.name;

  document.querySelectorAll('#admin-logout-btn, .admin-logout-btn').forEach((btn) => {
    btn.addEventListener('click', () => adminLogout());
  });

  setupFilters();
  setupVerificationModal();
  await Promise.all([loadMetrics(), loadVerifications()]);
});

async function loadMetrics() {
  try {
    const { data } = await api.get('/admin/verifications/metrics');
    if (!data) return;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val ?? 0;
    };

    set('metric-pending', data.totalPending);
    set('metric-verified-candidates', data.verifiedCandidates);
    set('metric-verified-volunteers', data.verifiedVolunteers);
    set('metric-rejected', data.rejected);
    set('metric-correction', data.requiresCorrection);
  } catch (err) {
    // Non-fatal
  }
}

function setupFilters() {
  document.getElementById('status-filter')?.addEventListener('change', (e) => {
    currentStatus = e.target.value;
    currentPage = 1;
    loadVerifications();
  });

  document.getElementById('role-filter')?.addEventListener('change', (e) => {
    currentRole = e.target.value;
    currentPage = 1;
    loadVerifications();
  });

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    const onSearch = debounce(() => {
      currentSearch = searchInput.value.trim();
      currentPage = 1;
      loadVerifications();
    }, 400);
    searchInput.addEventListener('input', onSearch);
  }

  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    loadMetrics();
    loadVerifications();
  });
}

async function loadVerifications() {
  const tableBody = document.getElementById('verifications-table-body');
  const paginationContainer = document.getElementById('pagination-container');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading verification queue...</td></tr>';

  try {
    const params = new URLSearchParams({
      page: currentPage,
      pageSize: 15,
    });
    if (currentStatus) params.set('status', currentStatus);
    if (currentRole && currentRole !== 'ALL') params.set('role', currentRole);
    if (currentSearch) params.set('search', currentSearch);

    const { data, meta } = await api.get(`/admin/verifications?${params.toString()}`);

    if (!data || data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 2rem;">No verification records found in this queue.</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    tableBody.innerHTML = data
      .map((v) => {
        const role = v.user?.role || 'USER';
        const roleBadge = role === 'CANDIDATE' ? 'badge--blue' : 'badge--teal';
        const kindLabel = v.kind === 'ASSISTANCE_NEED' ? 'Assistance & Disability' : 'Identity Verification';

        let statusClass = 'badge--yellow';
        if (v.status === 'VERIFIED') statusClass = 'badge--green';
        if (v.status === 'REJECTED') statusClass = 'badge--red';
        if (v.status === 'REQUIRES_CORRECTION') statusClass = 'badge--orange';

        return `
          <tr>
            <td>
              <strong>${escapeHtml(v.user?.name || 'Unknown')}</strong>
              <div style="font-size: 0.8rem; color: var(--color-text-muted);">${escapeHtml(v.user?.mobile || '')}</div>
            </td>
            <td><span class="badge ${roleBadge}">${role}</span></td>
            <td><strong>${escapeHtml(kindLabel)}</strong></td>
            <td>${formatDate(v.createdAt)}</td>
            <td><span class="badge ${statusClass}">${escapeHtml(v.status)}</span></td>
            <td>
              <div style="display:flex; gap:0.4rem;">
                <button type="button" class="btn btn--outline btn--sm review-btn" data-id="${v.id}">Review Profile</button>
                ${v.status !== 'VERIFIED' ? `<button type="button" class="btn btn--secondary btn--sm quick-approve-btn" data-id="${v.id}">Approve</button>` : ''}
              </div>
            </td>
          </tr>`;
      })
      .join('');

    // Attach explicit click handlers to Review Profile buttons
    tableBody.querySelectorAll('.review-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openReviewModal(btn.dataset.id, btn);
      });
    });

    tableBody.querySelectorAll('.quick-approve-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        quickApprove(btn.dataset.id);
      });
    });

    if (paginationContainer && meta) {
      renderPagination(paginationContainer, meta, (newPage) => {
        currentPage = newPage;
        loadVerifications();
      });
    }
  } catch (err) {
    tableBody.innerHTML = `<tr class="text-error"><td colspan="6" class="text-center">Error loading queue: ${escapeHtml(err.message || 'Network error')}</td></tr>`;
    showError(err.message || 'Failed to load verification queue.');
  }
}

// ─── Modal Management ─────────────────────────────────────────────────────────
function setupVerificationModal() {
  registerModal('verification-modal', {
    onClose: () => resetModalContent(true),
    onReset: () => resetModalContent(false),
  });

  const closeBtn = document.getElementById('modal-close-btn');
  const cancelBtn = document.getElementById('btn-modal-cancel');

  closeBtn?.addEventListener('click', () => closeModal('verification-modal'));
  cancelBtn?.addEventListener('click', () => closeModal('verification-modal'));

  document.getElementById('btn-approve')?.addEventListener('click', (e) => {
    e.preventDefault();
    submitDecision('VERIFIED');
  });
  document.getElementById('btn-correction')?.addEventListener('click', (e) => {
    e.preventDefault();
    submitDecision('REQUIRES_CORRECTION');
  });
  document.getElementById('btn-reject')?.addEventListener('click', (e) => {
    e.preventDefault();
    submitDecision('REJECTED');
  });
}

function resetModalContent(clearRecord = false) {
  if (clearRecord) {
    activeRecordId = null;
    const modal = document.getElementById('verification-modal');
    if (modal) modal.dataset.recordId = '';
  }

  const nameEl = document.getElementById('modal-user-name');
  if (nameEl) nameEl.textContent = 'Review Profile';

  const roleBadge = document.getElementById('modal-role-badge');
  if (roleBadge) {
    roleBadge.textContent = '...';
    roleBadge.className = 'badge badge--gray';
  }

  const statusBadge = document.getElementById('modal-status-badge');
  if (statusBadge) {
    statusBadge.textContent = '...';
    statusBadge.className = 'badge badge--gray';
  }

  const bodyContent = document.getElementById('modal-body-content');
  if (bodyContent) {
    bodyContent.innerHTML = '<p class="loading-text">Loading profile details...</p>';
  }

  const reasonEl = document.getElementById('decision-reason');
  if (reasonEl) reasonEl.value = '';
}

async function openReviewModal(recordId, triggerBtn = null) {
  if (!recordId) return;

  resetModalContent(false);
  activeRecordId = recordId;
  const modal = document.getElementById('verification-modal');
  if (modal) modal.dataset.recordId = recordId;

  // Explicitly open modal via modal management system
  openModal('verification-modal', triggerBtn);

  try {
    const { data } = await api.get(`/admin/verifications/${recordId}`);
    if (activeRecordId === recordId || modal?.dataset?.recordId === recordId) {
      renderModalContent(data);
    }
  } catch (err) {
    const bodyContent = document.getElementById('modal-body-content');
    if (bodyContent && (activeRecordId === recordId || modal?.dataset?.recordId === recordId)) {
      bodyContent.innerHTML = `<p class="text-error">Failed to load profile details: ${escapeHtml(err.message)}</p>`;
    }
  }
}

function renderModalContent(record) {
  const user = record.user || {};
  const profile = user.profile || {};
  const isCandidate = user.role === 'CANDIDATE';

  const nameEl = document.getElementById('modal-user-name');
  if (nameEl) nameEl.textContent = profile.fullName || (profile.firstName ? `${profile.firstName} ${profile.lastName || ''}`.trim() : 'User Profile');

  const roleBadge = document.getElementById('modal-role-badge');
  if (roleBadge) {
    roleBadge.textContent = user.role;
    roleBadge.className = `badge ${isCandidate ? 'badge--blue' : 'badge--teal'}`;
  }

  const statusBadge = document.getElementById('modal-status-badge');
  if (statusBadge) {
    statusBadge.textContent = record.status;
    statusBadge.className = `badge ${record.status === 'VERIFIED' ? 'badge--green' : record.status === 'REJECTED' ? 'badge--red' : 'badge--yellow'}`;
  }

  const completionPct = profile.completionPercentage || (user.profileComplete ? 100 : 0);

  const bodyContent = document.getElementById('modal-body-content');
  if (!bodyContent) return;

  const historyHtml = record.history && record.history.length > 0
    ? `<div style="margin-top: 1.5rem;">
        <h4 style="margin-bottom: 0.5rem; font-size: 0.95rem;">Verification History</h4>
        <ul style="font-size: 0.85rem; color: var(--color-text-muted); padding-left: 1.25rem;">
          ${record.history.map(h => `
            <li>
              <strong>${escapeHtml(h.toStatus)}</strong> on ${formatDate(h.timestamp)}
              ${h.reason ? `— <em>${escapeHtml(h.reason)}</em>` : ''}
            </li>
          `).join('')}
        </ul>
      </div>`
    : '';

  bodyContent.innerHTML = `
    <!-- Profile Completion Status -->
    <div style="background-color: var(--color-surface-2); padding: 1rem; border-radius: 6px; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <span style="font-weight: 600; font-size: 0.9rem;">Profile Completion Status: <strong>${completionPct}%</strong></span>
        <div style="font-size: 0.8rem; color: var(--color-text-muted);">
          ${user.profileComplete ? '✓ All mandatory profile details completed' : '⚠️ Profile is incomplete'}
        </div>
      </div>
      <span class="badge ${user.profileComplete ? 'badge--green' : 'badge--yellow'}">${user.profileComplete ? 'Ready for Verification' : 'Incomplete Profile'}</span>
    </div>

    <!-- Personal & Contact Details -->
    <h4 style="margin-bottom: 0.5rem; font-size: 0.95rem; color: var(--color-text);">Contact &amp; Personal Info</h4>
    <div class="grid grid-cols-2" style="gap: 0.75rem; font-size: 0.9rem; margin-bottom: 1.25rem;">
      <div><strong>Full Name:</strong> ${escapeHtml(profile.fullName || '(Not provided)')}</div>
      <div><strong>Verified Mobile:</strong> ${escapeHtml(user.mobile || '(None)')}</div>
      <div><strong>Email:</strong> ${escapeHtml(user.email || '(None)')}</div>
      <div><strong>Date of Birth:</strong> ${profile.dateOfBirth ? formatDate(profile.dateOfBirth) : '—'}</div>
      <div><strong>Gender:</strong> ${escapeHtml(profile.gender || '—')}</div>
      <div><strong>Location:</strong> ${escapeHtml([profile.city, profile.state, profile.pincode].filter(Boolean).join(', ') || '—')}</div>
    </div>

    <!-- Role-Specific Details -->
    <h4 style="margin-bottom: 0.5rem; font-size: 0.95rem; color: var(--color-text);">${isCandidate ? 'Candidate Assistance &amp; Education' : 'Volunteer Scribe Qualifications'}</h4>
    <div class="grid grid-cols-2" style="gap: 0.75rem; font-size: 0.9rem; margin-bottom: 1.25rem;">
      <div><strong>Languages:</strong> ${escapeHtml(Array.isArray(profile.languages) ? profile.languages.join(', ') : profile.languages || '—')}</div>
      ${isCandidate ? `
        <div><strong>Education / Level:</strong> ${escapeHtml(profile.education || '—')}</div>
        <div><strong>Preferred Exam City:</strong> ${escapeHtml(profile.preferredExamCity || profile.city || '—')}</div>
        <div style="grid-column: span 2;">
          <strong>Disability &amp; Assistance Requirements:</strong>
          <p style="background: var(--color-surface-2); padding: 0.5rem; border-radius: 4px; margin-top: 0.25rem; font-size: 0.85rem;">
            ${escapeHtml(profile.assistanceNeeds || profile.disabilityType || 'None recorded')}
          </p>
        </div>
      ` : `
        <div><strong>Subjects Comfortable Scribing:</strong> ${escapeHtml(Array.isArray(profile.subjects) ? profile.subjects.join(', ') : profile.subjects || '—')}</div>
        <div><strong>Service Radius:</strong> ${escapeHtml(String(profile.serviceRadiusKm || 25))} km</div>
        <div><strong>Service Regions:</strong> ${escapeHtml(Array.isArray(profile.serviceLocations) ? profile.serviceLocations.join(', ') : profile.serviceLocations || profile.city || '—')}</div>
        <div><strong>Prior Scribe Experience:</strong> ${profile.hasPriorExperience || profile.hasScribeExperience ? '✓ Yes, has prior experience' : 'New volunteer'}</div>
      `}
    </div>

    ${historyHtml}
  `;
}

async function quickApprove(recordId) {
  if (!confirm('Are you sure you want to approve this verification check?')) return;
  try {
    await api.post(`/admin/verifications/${recordId}/decide`, { status: 'VERIFIED' });
    showSuccess('Verification approved successfully.');
    loadMetrics();
    loadVerifications();
  } catch (err) {
    showError(err.message || 'Failed to approve verification.');
  }
}

async function submitDecision(decision) {
  const modal = document.getElementById('verification-modal');
  const recordId = activeRecordId || modal?.dataset?.recordId;
  if (!recordId) {
    showError('No active verification record selected.');
    return;
  }

  const reasonEl = document.getElementById('decision-reason');
  const reason = reasonEl?.value.trim() || '';

  if (['REJECTED', 'REQUIRES_CORRECTION'].includes(decision) && !reason) {
    showError('A mandatory reason is required when rejecting or requesting corrections.');
    reasonEl?.focus();
    return;
  }

  const approveBtn = document.getElementById('btn-approve');
  const correctionBtn = document.getElementById('btn-correction');
  const rejectBtn = document.getElementById('btn-reject');
  const cancelBtn = document.getElementById('btn-modal-cancel');

  let activeBtn = approveBtn;
  let loadingText = 'Approving...';
  if (decision === 'REQUIRES_CORRECTION') {
    activeBtn = correctionBtn;
    loadingText = 'Requesting...';
  } else if (decision === 'REJECTED') {
    activeBtn = rejectBtn;
    loadingText = 'Rejecting...';
  }

  // Disable all decision buttons during submit
  [approveBtn, correctionBtn, rejectBtn, cancelBtn].forEach((b) => {
    if (b) b.disabled = true;
  });
  setLoading(activeBtn, true, loadingText);

  try {
    await api.post(`/admin/verifications/${recordId}/decide`, { status: decision, reason });
    showSuccess(`Verification marked as ${decision}. Candidate/Volunteer notified.`);

    // Close modal via shared system
    closeModal('verification-modal');

    loadMetrics();
    loadVerifications();
  } catch (err) {
    showError(err.message || 'Failed to submit verification decision.');
  } finally {
    setLoading(activeBtn, false);
    [approveBtn, correctionBtn, rejectBtn, cancelBtn].forEach((b) => {
      if (b) b.disabled = false;
    });
  }
}
