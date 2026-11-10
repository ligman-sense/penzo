'use strict';

import { api } from '../api.js';
import { requireAdmin, adminLogout } from '../auth.js';
import { showError, showSuccess } from '../notifications.js';
import { formatDate, formatDateTime, renderPagination, renderStatusBadge, escapeHtml, debounce, setLoading } from '../utils.js';
import { registerModal, openModal, closeModal, closeAllModals } from '../modal.js';

let currentTab = 'requests';
let currentPage = 1;
let currentStatus = '';
let currentSearch = '';

let activeRequestId = null;
let activeMatchesData = null;
let selectedVolunteer = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Ensure all modals start closed immediately on page load
  closeAllModals();

  const admin = await requireAdmin();
  if (!admin) return;

  const adminNameEl = document.getElementById('admin-name');
  if (adminNameEl && admin.name) adminNameEl.textContent = admin.name;

  document.querySelectorAll('#admin-logout-btn, .admin-logout-btn').forEach((btn) => {
    btn.addEventListener('click', () => adminLogout());
  });

  setupTabs();
  setupFilters();
  setupModals();
  loadCurrentTab();
});

function setupTabs() {
  const tabReq = document.getElementById('tab-requests');
  const tabInt = document.getElementById('tab-interests');
  const tabMat = document.getElementById('tab-matches');

  const secReq = document.getElementById('section-requests');
  const secInt = document.getElementById('section-interests');
  const secMat = document.getElementById('section-matches');

  const switchTab = (tab) => {
    // When navigating between tabs, any open modal must be closed immediately
    closeAllModals();

    currentTab = tab;
    currentPage = 1;

    tabReq?.classList.toggle('tab--active', tab === 'requests');
    tabInt?.classList.toggle('tab--active', tab === 'interests');
    tabMat?.classList.toggle('tab--active', tab === 'matches');

    if (secReq) secReq.hidden = tab !== 'requests';
    if (secInt) secInt.hidden = tab !== 'interests';
    if (secMat) secMat.hidden = tab !== 'matches';

    loadCurrentTab();
  };

  tabReq?.addEventListener('click', () => switchTab('requests'));
  tabInt?.addEventListener('click', () => switchTab('interests'));
  tabMat?.addEventListener('click', () => switchTab('matches'));

  document.getElementById('refresh-requests-btn')?.addEventListener('click', () => {
    closeAllModals();
    loadRequests();
  });
  document.getElementById('refresh-interests-btn')?.addEventListener('click', () => {
    closeAllModals();
    loadInterests();
  });
  document.getElementById('refresh-matches-btn')?.addEventListener('click', () => {
    closeAllModals();
    loadMatches();
  });
}

function setupFilters() {
  document.getElementById('status-filter')?.addEventListener('change', (e) => {
    currentStatus = e.target.value;
    currentPage = 1;
    loadRequests();
  });

  const searchInput = document.getElementById('request-search');
  if (searchInput) {
    const onSearch = debounce(() => {
      currentSearch = searchInput.value.trim();
      currentPage = 1;
      loadRequests();
    }, 400);
    searchInput.addEventListener('input', onSearch);
  }
}

function loadCurrentTab() {
  if (currentTab === 'requests') loadRequests();
  else if (currentTab === 'interests') loadInterests();
  else if (currentTab === 'matches') loadMatches();
}

// ─── TAB 1: Candidate Scribe Requests ─────────────────────────────────────────
async function loadRequests() {
  const tableBody = document.getElementById('requests-table-body');
  const paginationContainer = document.getElementById('pagination-container');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="7" class="text-center">Loading candidate requests...</td></tr>';

  try {
    const params = new URLSearchParams({
      page: currentPage,
      pageSize: 15,
    });
    if (currentStatus) params.set('status', currentStatus);
    if (currentSearch) params.set('search', currentSearch);

    const { data, meta } = await api.get(`/admin/requests?${params.toString()}`);

    if (!data || data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 2rem;">No scribe requests found.</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    tableBody.innerHTML = data
      .map((r) => {
        const canFindVolunteers = ['SUBMITTED', 'PENDING_REVIEW', 'AWAITING_VOLUNTEER', 'MATCH_PROPOSED', 'REPLACEMENT_REQUIRED'].includes(r.status);

        return `
          <tr>
            <td><code>${escapeHtml(r.reference)}</code></td>
            <td><strong>${escapeHtml(r.candidate?.name || 'Candidate')}</strong></td>
            <td>
              <div><strong>${escapeHtml(r.examination?.name || 'Exam')}</strong></div>
              <small style="color: var(--color-text-muted);">${escapeHtml(r.examination?.authority || '')}</small>
            </td>
            <td>${r.examination?.startsOn ? formatDate(r.examination.startsOn) : '—'}</td>
            <td>
              <div>${escapeHtml(r.city || '—')}</div>
              <small style="color: var(--color-text-muted);">${escapeHtml(r.language || 'Any')}</small>
            </td>
            <td>${renderStatusBadge(r.status)}</td>
            <td>
              <div style="display:flex; gap:0.4rem; flex-wrap: wrap;">
                <button type="button" class="btn btn--outline btn--sm view-req-btn" data-id="${r.id}">View Request</button>
                ${canFindVolunteers ? `<button type="button" class="btn btn--secondary btn--sm find-vol-btn" data-id="${r.id}">Find Volunteers</button>` : ''}
                ${r.status === 'SUBMITTED' ? `<button type="button" class="btn btn--outline btn--sm status-btn" data-id="${r.id}" data-to="PENDING_REVIEW">Review</button>` : ''}
                ${['SUBMITTED', 'PENDING_REVIEW', 'AWAITING_VOLUNTEER'].includes(r.status) ? `<button type="button" class="btn btn--danger btn--sm status-btn" data-id="${r.id}" data-to="REJECTED">Reject</button>` : ''}
              </div>
            </td>
          </tr>`;
      })
      .join('');

    // Attach explicit click handlers
    tableBody.querySelectorAll('.view-req-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openRequestDetailModal(btn.dataset.id, btn);
      });
    });

    tableBody.querySelectorAll('.find-vol-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openMatchingModal(btn.dataset.id, btn);
      });
    });

    tableBody.querySelectorAll('.status-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        updateRequestStatus(btn.dataset.id, btn.dataset.to);
      });
    });

    if (paginationContainer && meta) {
      renderPagination(paginationContainer, meta, (newPage) => {
        currentPage = newPage;
        loadRequests();
      });
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="7" class="text-error text-center">Failed to load requests: ${escapeHtml(err.message)}</td></tr>`;
    showError(err.message || 'Failed to load requests.');
  }
}

async function updateRequestStatus(id, toStatus) {
  let reason = '';
  if (toStatus === 'REJECTED') {
    reason = prompt('Enter rejection reason:') || '';
    if (!reason.trim()) {
      showError('A reason is required when rejecting a request.');
      return;
    }
  }

  try {
    await api.patch(`/admin/requests/${id}/status`, { status: toStatus, reason });
    showSuccess(`Request status updated to ${toStatus}.`);
    loadRequests();
  } catch (err) {
    showError(err.message || 'Failed to update request status.');
  }
}

// ─── TAB 2: Volunteer Examination Interests ───────────────────────────────────
async function loadInterests() {
  const tableBody = document.getElementById('interests-table-body');
  const paginationContainer = document.getElementById('pagination-container');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="7" class="text-center">Loading volunteer interests...</td></tr>';

  try {
    const { data, meta } = await api.get(`/admin/volunteer-interests?page=${currentPage}&pageSize=20`);

    if (!data || data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 2rem;">No volunteer expressions of interest found.</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    tableBody.innerHTML = data
      .map((i) => {
        const volId = i.volunteer?.id || i.volunteerId || (i.volunteer && i.volunteer._id);
        return `
        <tr>
          <td>
            <strong>${escapeHtml(i.volunteer?.name || 'Volunteer')}</strong>
            <div style="font-size: 0.8rem; color: var(--color-text-muted);">${escapeHtml(i.volunteer?.mobile || '')}</div>
          </td>
          <td>
            <span class="badge ${i.volunteer?.verificationStatus === 'VERIFIED' ? 'badge--green' : 'badge--yellow'}">
              ${escapeHtml(i.volunteer?.verificationStatus || 'UNVERIFIED')}
            </span>
          </td>
          <td>
            <strong>${escapeHtml(i.examination?.name || 'Examination')}</strong>
            <div style="font-size: 0.8rem; color: var(--color-primary);">${escapeHtml(i.examination?.authority || '')}</div>
            <code style="font-size: 0.75rem; color: var(--color-text-muted);">ID: ${escapeHtml(i.examination?.id || '')}</code>
          </td>
          <td>${i.examination?.startsOn ? formatDate(i.examination.startsOn) : 'Date TBD'}</td>
          <td>
            <div><strong>Langs:</strong> ${escapeHtml((i.volunteer?.languages || []).join(', ') || '—')}</div>
            <div><strong>Subjects:</strong> ${escapeHtml((i.volunteer?.subjects || []).join(', ') || 'General')}</div>
          </td>
          <td><span class="badge ${i.status === 'ACTIVE' ? 'badge--green' : 'badge--gray'}">${escapeHtml(i.status)}</span></td>
          <td>
            ${volId ? `<button type="button" class="btn btn--outline btn--sm view-vol-btn" data-vol-id="${escapeHtml(volId)}">View Volunteer</button>` : '—'}
          </td>
        </tr>`;
      })
      .join('');

    tableBody.querySelectorAll('.view-vol-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openVolunteerDetailModal(btn.dataset.volId, btn);
      });
    });

    if (paginationContainer && meta) {
      renderPagination(paginationContainer, meta, (newPage) => {
        currentPage = newPage;
        loadInterests();
      });
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="7" class="text-error text-center">Failed to load volunteer interests.</td></tr>`;
  }
}

// ─── TAB 3: Proposed & Confirmed Matches ──────────────────────────────────────
async function loadMatches() {
  const tableBody = document.getElementById('matches-table-body');
  const paginationContainer = document.getElementById('pagination-container');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="8" class="text-center">Loading matches...</td></tr>';

  try {
    const { data, meta } = await api.get(`/admin/matches?page=${currentPage}&pageSize=20`);

    if (!data || data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 2rem;">No match records or assignments found.</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    tableBody.innerHTML = data
      .map((m) => {
        let statusBadge = 'badge--yellow';
        if (m.status === 'CONFIRMED' || m.status === 'CANDIDATE_CONFIRMED') statusBadge = 'badge--green';
        if (m.status === 'ACCEPTED') statusBadge = 'badge--teal';
        if (m.status === 'DECLINED' || m.status === 'CANDIDATE_REJECTED') statusBadge = 'badge--red';

        const reqId = m.requestId || m.request?.id;
        const volId = m.volunteerId || m.volunteer?.id;

        return `
          <tr>
            <td><code>${escapeHtml(m.reference || '—')}</code></td>
            <td>
              <strong>${escapeHtml(m.candidate?.name || 'Candidate')}</strong>
              <div style="font-size: 0.8rem; color: var(--color-text-muted);">${escapeHtml(m.candidate?.mobile || '')}</div>
            </td>
            <td>
              <strong>${escapeHtml(m.volunteer?.name || 'Volunteer')}</strong>
              <div style="font-size: 0.8rem; color: var(--color-text-muted);">${escapeHtml(m.volunteer?.city || '')}</div>
            </td>
            <td>
              <strong>${escapeHtml(m.examination?.name || 'Exam')}</strong>
              <div style="font-size: 0.8rem; color: var(--color-text-muted);">${m.examination?.startsOn ? formatDate(m.examination.startsOn) : ''}</div>
            </td>
            <td><strong>${m.score ?? 0}%</strong></td>
            <td><span class="badge ${statusBadge}">${escapeHtml(m.status)}</span></td>
            <td><small>${escapeHtml(m.reviewedBy || 'Admin')}</small></td>
            <td>
              <div style="display:flex; gap:0.3rem;">
                ${reqId ? `<button type="button" class="btn btn--ghost btn--sm view-req-btn" data-id="${escapeHtml(reqId)}">Req</button>` : ''}
                ${volId ? `<button type="button" class="btn btn--ghost btn--sm view-vol-btn" data-vol-id="${escapeHtml(volId)}">Vol</button>` : ''}
              </div>
            </td>
          </tr>`;
      })
      .join('');

    tableBody.querySelectorAll('.view-req-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openRequestDetailModal(btn.dataset.id, btn);
      });
    });

    tableBody.querySelectorAll('.view-vol-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openVolunteerDetailModal(btn.dataset.volId, btn);
      });
    });

    if (paginationContainer && meta) {
      renderPagination(paginationContainer, meta, (newPage) => {
        currentPage = newPage;
        loadMatches();
      });
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="8" class="text-error text-center">Failed to load matches.</td></tr>`;
  }
}

// ─── MODAL SETUP & MANAGEMENT ─────────────────────────────────────────────────
function setupModals() {
  // Register all 4 modals to ensure they start closed and wire their close triggers
  registerModal('matching-modal', {
    onClose: () => {
      // Only clear if not transitioning to propose modal
      const proposeModal = document.getElementById('propose-confirm-modal');
      const isProposeOpen = proposeModal && !proposeModal.hidden && proposeModal.classList.contains('is-open');
      if (!isProposeOpen) {
        activeRequestId = null;
        activeMatchesData = null;
      }
    },
    onReset: () => {
      const refHeader = document.getElementById('modal-req-ref');
      if (refHeader) refHeader.textContent = '';
      const summary = document.getElementById('matching-req-summary');
      if (summary) summary.innerHTML = '<p class="loading-text">Loading request details...</p>';
      const eligible = document.getElementById('eligible-volunteers-container');
      if (eligible) eligible.innerHTML = '';
      const reviewSection = document.getElementById('review-volunteers-section');
      if (reviewSection) reviewSection.style.display = 'none';
    },
  });

  registerModal('propose-confirm-modal', {
    onClose: () => {
      selectedVolunteer = null;
      const proposeModal = document.getElementById('propose-confirm-modal');
      if (proposeModal) {
        proposeModal.dataset.volunteerId = '';
        proposeModal.dataset.isOverride = 'false';
      }
    },
    onReset: () => {
      const body = document.getElementById('propose-confirm-body');
      if (body) body.innerHTML = '<p class="loading-text">Preparing match details...</p>';
      const note = document.getElementById('propose-note');
      if (note) note.value = '';
      const overrideInput = document.getElementById('propose-override-justification');
      if (overrideInput) overrideInput.value = '';
      const overrideGroup = document.getElementById('propose-override-group');
      if (overrideGroup) overrideGroup.style.display = 'none';
    },
  });

  registerModal('request-detail-modal', {
    onReset: () => {
      const refEl = document.getElementById('req-modal-ref');
      if (refEl) refEl.textContent = '';
      const body = document.getElementById('request-detail-modal-body');
      if (body) body.innerHTML = '<p class="loading-text">Loading request details...</p>';
    },
  });

  registerModal('volunteer-detail-modal', {
    onReset: () => {
      const nameEl = document.getElementById('vol-modal-name');
      if (nameEl) nameEl.textContent = 'Volunteer Profile';
      const body = document.getElementById('volunteer-detail-modal-body');
      if (body) body.innerHTML = '<p class="loading-text">Loading volunteer details...</p>';
    },
  });

  // Explicit close / cancel button bindings
  document.getElementById('matching-modal-close')?.addEventListener('click', () => closeModal('matching-modal'));
  document.getElementById('matching-modal-cancel')?.addEventListener('click', () => closeModal('matching-modal'));

  document.getElementById('propose-confirm-close')?.addEventListener('click', () => {
    closeModal('propose-confirm-modal');
  });

  document.getElementById('propose-cancel-btn')?.addEventListener('click', () => {
    // If admin cancels proposal confirmation, close proposal modal and return to matching modal
    const proposeModal = document.getElementById('propose-confirm-modal');
    const reqId = activeRequestId || proposeModal?.dataset?.requestId;
    closeModal('propose-confirm-modal', { restoreFocus: false });
    if (reqId) {
      openMatchingModal(reqId);
    }
  });

  document.getElementById('propose-submit-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    submitProposeMatch();
  });

  document.getElementById('request-detail-modal-close')?.addEventListener('click', () => closeModal('request-detail-modal'));
  document.getElementById('request-detail-modal-cancel')?.addEventListener('click', () => closeModal('request-detail-modal'));

  document.getElementById('volunteer-detail-modal-close')?.addEventListener('click', () => closeModal('volunteer-detail-modal'));
  document.getElementById('volunteer-detail-modal-cancel')?.addEventListener('click', () => closeModal('volunteer-detail-modal'));
}

// ─── ACTION 1: Find Suitable Volunteers Modal ─────────────────────────────────
async function openMatchingModal(requestId, triggerBtn = null) {
  if (!requestId) return;

  activeRequestId = requestId;
  activeMatchesData = null;
  selectedVolunteer = null;

  const matchingModal = document.getElementById('matching-modal');
  if (matchingModal) matchingModal.dataset.requestId = requestId;
  const proposeModal = document.getElementById('propose-confirm-modal');
  if (proposeModal) proposeModal.dataset.requestId = requestId;

  // Open modal strictly upon explicit user interaction
  openModal('matching-modal', triggerBtn);

  const reqSummary = document.getElementById('matching-req-summary');
  const eligibleContainer = document.getElementById('eligible-volunteers-container');
  const reviewContainer = document.getElementById('review-volunteers-container');
  const reviewSection = document.getElementById('review-volunteers-section');
  const countBadge = document.getElementById('eligible-count-badge');
  const refHeader = document.getElementById('modal-req-ref');

  if (refHeader) refHeader.textContent = '';
  if (reqSummary) reqSummary.innerHTML = '<p class="loading-text">Loading request details...</p>';
  if (eligibleContainer) eligibleContainer.innerHTML = '<p class="loading-text">Finding volunteers interested in the SAME examination...</p>';
  if (reviewSection) reviewSection.style.display = 'none';

  try {
    const { data } = await api.get(`/admin/requests/${requestId}/matches`);
    if (activeRequestId !== requestId && matchingModal?.dataset?.requestId !== requestId) return; // Stale request guard
    activeMatchesData = data;

    const r = data.request;
    if (refHeader) refHeader.textContent = `Request Reference: ${r.reference}`;

    if (reqSummary) {
      reqSummary.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 0.5rem;">
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; color: var(--color-primary);">${escapeHtml(r.examination.name)}</h3>
            <p style="margin: 0.2rem 0; font-size: 0.85rem; color: var(--color-text-muted);">
              Authority: <strong>${escapeHtml(r.examination.authority)}</strong> | Exam ID: <code>${escapeHtml(r.examination.id)}</code>
            </p>
          </div>
          ${renderStatusBadge(r.status)}
        </div>
        <div class="grid grid-cols-4" style="gap: 0.75rem; font-size: 0.85rem; margin-top: 0.75rem;">
          <div><strong>Exam Date:</strong> ${r.examination.startsOn ? formatDate(r.examination.startsOn) : 'TBD'}</div>
          <div><strong>Session:</strong> ${escapeHtml(r.session?.name || 'Main Session')}</div>
          <div><strong>Required City:</strong> ${escapeHtml(r.city || 'Any')}</div>
          <div><strong>Required Language:</strong> ${escapeHtml(r.language || 'Any')}</div>
        </div>
        ${r.requirements ? `
          <div style="margin-top: 0.5rem; font-size: 0.85rem;">
            <strong>Assistance Needs:</strong> <span style="color: var(--color-text-muted);">${escapeHtml(r.requirements)}</span>
          </div>
        ` : ''}
      `;
    }

    const eligible = data.eligible || [];
    if (countBadge) countBadge.textContent = `${eligible.length} eligible`;

    if (eligible.length === 0) {
      if (eligibleContainer) {
        eligibleContainer.innerHTML = `
          <div class="empty-state" style="padding: 1.5rem; background: var(--color-surface); border: 1px dashed var(--color-border); border-radius: 6px;">
            <p>No verified volunteers have expressed interest in this examination yet.</p>
            <small style="color: var(--color-text-muted);">
              Volunteers must express interest for this specific examination (${escapeHtml(r.examination.name)}) and hold Verified status to be proposed.
            </small>
          </div>`;
      }
    } else {
      if (eligibleContainer) {
        eligibleContainer.innerHTML = eligible
          .map((v) => renderVolunteerMatchCard(v, r))
          .join('');

        eligibleContainer.querySelectorAll('.propose-btn').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            confirmPropose(btn.dataset.volId, false, btn);
          });
        });
      }
    }

    const review = data.requiresReview || [];
    if (review.length > 0 && reviewSection && reviewContainer) {
      reviewSection.style.display = 'block';
      reviewContainer.innerHTML = review
        .map((v) => renderVolunteerReviewCard(v, r))
        .join('');

      reviewContainer.querySelectorAll('.propose-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          confirmPropose(btn.dataset.volId, true, btn);
        });
      });
    }
  } catch (err) {
    if (reqSummary) reqSummary.innerHTML = `<p class="text-error">Failed to load matching: ${escapeHtml(err.message)}</p>`;
    showError(err.message || 'Failed to find matches.');
  }
}

function renderVolunteerMatchCard(v, req) {
  const m = v.compatibility?.matrix || {};
  return `
    <div class="card" style="border: 1px solid var(--color-border); padding: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 0.75rem;">
        <div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <h4 style="margin: 0; font-size: 1.1rem;">${escapeHtml(v.volunteerName)}</h4>
            <span class="badge badge--green">Verified</span>
            <span class="badge badge--teal" style="font-size: 0.75rem;">Expressed Interest in Same Exam ✓</span>
          </div>
          <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem;">
            ${escapeHtml(v.volunteerMobile)} | Location: ${escapeHtml(v.volunteerCity)}
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 1.4rem; font-weight: 700; color: var(--color-primary);">${v.score}%</div>
          <small style="color: var(--color-text-muted);">Compatibility Score</small>
        </div>
      </div>

      <!-- Compatibility Comparison Matrix -->
      <div style="background-color: var(--color-surface-2); padding: 0.75rem; border-radius: 4px; font-size: 0.85rem; margin-bottom: 0.75rem;">
        <div class="grid grid-cols-4" style="gap: 0.5rem;">
          <div><strong>Exam Match:</strong> <span style="color: var(--color-success);">✓ Same Exam</span></div>
          <div><strong>Schedule:</strong> <span style="${m.timeMatch ? 'color: var(--color-success);' : ''}">${m.timeMatch ? '✓ Compatible' : '⚠️ General'}</span></div>
          <div><strong>Location:</strong> <span style="${m.locationMatch ? 'color: var(--color-success);' : ''}">${m.locationMatch ? '✓ Same City' : '⚠️ Travel'}</span></div>
          <div><strong>Language:</strong> <span style="${m.languageMatch ? 'color: var(--color-success);' : ''}">${m.languageMatch ? '✓ Match' : '⚠️ Other'}</span></div>
        </div>
      </div>

      <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.75rem;">
        <div><strong>Languages:</strong> ${escapeHtml(v.languages.join(', ') || '—')} | <strong>Subjects:</strong> ${escapeHtml(v.subjects.join(', ') || 'General')}</div>
        ${v.hasExperience ? '<div style="color: var(--color-success); margin-top: 0.25rem;">✓ Has prior examination scribe experience</div>' : ''}
      </div>

      <div style="display: flex; justify-content: flex-end;">
        <button type="button" class="btn btn--primary btn--sm propose-btn" data-vol-id="${v.volunteerId}" data-is-override="false">
          Propose Match
        </button>
      </div>
    </div>`;
}

function renderVolunteerReviewCard(v, req) {
  return `
    <div class="card" style="border: 1px solid var(--color-border); padding: 1rem; opacity: 0.9;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <strong>${escapeHtml(v.volunteerName)}</strong>
            <span class="badge ${v.isVerified ? 'badge--green' : 'badge--yellow'}">${escapeHtml(v.verificationStatus)}</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.25rem;">
            ${escapeHtml(v.volunteerCity)} | Langs: ${escapeHtml(v.languages.join(', '))}
            ${v.blockingReason ? `<div style="color: var(--color-error); font-weight: 500;">⚠️ ${escapeHtml(v.blockingReason)}</div>` : ''}
            ${v.needsReview ? `<div style="color: #f97316;">⚠️ Verification Pending Review</div>` : ''}
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-weight: 700; color: var(--color-text); margin-right: 1rem;">${v.score}%</span>
          <button type="button" class="btn btn--outline btn--sm propose-btn" data-vol-id="${v.volunteerId}" data-is-override="true" ${v.hasBlockingFailure ? 'disabled title="Overlapping assignment exists"' : ''}>
            Propose Anyway
          </button>
        </div>
      </div>
    </div>`;
}

// ─── ACTION 2: Propose Match Confirmation Modal ───────────────────────────────
function confirmPropose(volunteerId, isOverride = false, triggerBtn = null) {
  if (!activeMatchesData) return;
  const allVolunteers = [...(activeMatchesData.eligible || []), ...(activeMatchesData.requiresReview || [])];
  selectedVolunteer = allVolunteers.find((v) => v.volunteerId === volunteerId);
  if (!selectedVolunteer) return;

  const proposeModal = document.getElementById('propose-confirm-modal');
  if (proposeModal) {
    proposeModal.dataset.requestId = activeRequestId || '';
    proposeModal.dataset.volunteerId = volunteerId;
    proposeModal.dataset.isOverride = isOverride ? 'true' : 'false';
  }

  const confirmBody = document.getElementById('propose-confirm-body');
  if (!confirmBody) return;

  const r = activeMatchesData.request;
  const overrideAlertHtml = isOverride
    ? `<div style="background-color: rgba(239, 68, 68, 0.08); border: 1px solid var(--color-error, #ef4444); padding: 0.75rem 1rem; border-radius: 6px; font-size: 0.85rem; margin-bottom: 1rem; color: var(--color-error, #b91c1c);">
        <strong>⚠️ Administrative Override Required:</strong> This volunteer requires review (${escapeHtml(selectedVolunteer.blockingReason || selectedVolunteer.verificationStatus || 'Pending verification')}). An administrative justification is mandatory below to send this proposal.
      </div>`
    : '';

  confirmBody.innerHTML = `
    ${overrideAlertHtml}
    <div style="background-color: var(--color-surface-2); padding: 1rem; border-radius: 6px; font-size: 0.9rem; margin-bottom: 1rem;">
      <h4 style="margin: 0 0 0.5rem; color: var(--color-primary);">${escapeHtml(r.examination.name)}</h4>
      <div class="grid grid-cols-2" style="gap: 0.5rem; font-size: 0.85rem;">
        <div><strong>Candidate Request:</strong> ${escapeHtml(r.reference)}</div>
        <div><strong>Exam Date:</strong> ${r.examination.startsOn ? formatDate(r.examination.startsOn) : 'TBD'}</div>
        <div><strong>Location:</strong> ${escapeHtml(r.city || 'Any')}</div>
        <div><strong>Language:</strong> ${escapeHtml(r.language || 'Any')}</div>
      </div>
    </div>

    <div style="border: 1px solid var(--color-border); padding: 1rem; border-radius: 6px; font-size: 0.9rem; margin-bottom: 1rem;">
      <h4 style="margin: 0 0 0.5rem;">Selected Volunteer</h4>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${escapeHtml(selectedVolunteer.volunteerName)}</strong>
          <div style="font-size: 0.85rem; color: var(--color-text-muted);">${escapeHtml(selectedVolunteer.volunteerCity)} | ${escapeHtml(selectedVolunteer.languages.join(', '))}</div>
          ${selectedVolunteer.blockingReason ? `<div style="color: var(--color-error); font-size: 0.8rem; margin-top: 0.2rem;">⚠️ ${escapeHtml(selectedVolunteer.blockingReason)}</div>` : ''}
        </div>
        <div style="text-align: right;">
          <span class="badge ${isOverride ? 'badge--yellow' : 'badge--green'}">Score: ${selectedVolunteer.score}%</span>
        </div>
      </div>
    </div>

    <p style="font-size: 0.85rem; color: var(--color-text-muted);">
      Upon confirmation, an invitation will be immediately delivered to the volunteer's portal. The candidate will be notified once the volunteer accepts.
    </p>
  `;

  const overrideGroup = document.getElementById('propose-override-group');
  const overrideInput = document.getElementById('propose-override-justification');
  if (overrideGroup) overrideGroup.style.display = isOverride ? 'block' : 'none';
  if (overrideInput) overrideInput.value = '';

  // Close matching modal and open confirmation modal (NO dual popups)
  closeModal('matching-modal', { restoreFocus: false });
  openModal('propose-confirm-modal', triggerBtn);
}

async function submitProposeMatch() {
  const proposeModal = document.getElementById('propose-confirm-modal');
  const reqId = activeRequestId || proposeModal?.dataset?.requestId;
  const volId = selectedVolunteer?.volunteerId || proposeModal?.dataset?.volunteerId;
  const isOverride = proposeModal?.dataset?.isOverride === 'true';

  if (!reqId || !volId) {
    showError('Missing request or volunteer information to propose match.');
    return;
  }

  const submitBtn = document.getElementById('propose-submit-btn');
  const cancelBtn = document.getElementById('propose-cancel-btn');
  const noteEl = document.getElementById('propose-note');
  const note = noteEl?.value.trim() || '';

  const overrideEl = document.getElementById('propose-override-justification');
  const overrideJustification = overrideEl?.value.trim() || '';

  if (isOverride && !overrideJustification) {
    showError('An override justification is required when proposing a volunteer requiring review.');
    overrideEl?.focus();
    return;
  }

  [submitBtn, cancelBtn].forEach((b) => { if (b) b.disabled = true; });
  setLoading(submitBtn, true, 'Proposing Match…');

  try {
    await api.post(`/admin/requests/${reqId}/propose-match`, {
      volunteerId: volId,
      note,
      isOverride,
      overrideJustification,
    });

    const volName = selectedVolunteer?.volunteerName || 'Volunteer';
    showSuccess(`Match proposed successfully! Invitation sent to ${volName}.`);

    // Cleanly close all modals and clear selection state
    closeAllModals();
    activeRequestId = null;
    selectedVolunteer = null;

    loadRequests();
  } catch (err) {
    showError(err.message || 'Failed to propose match.');
  } finally {
    setLoading(submitBtn, false);
    [submitBtn, cancelBtn].forEach((b) => { if (b) b.disabled = false; });
  }
}

// ─── ACTION 3: View Request Details Modal ─────────────────────────────────────
async function openRequestDetailModal(requestId, triggerBtn = null) {
  if (!requestId) return;

  const refEl = document.getElementById('req-modal-ref');
  const body = document.getElementById('request-detail-modal-body');
  if (refEl) refEl.textContent = '';
  if (body) body.innerHTML = '<p class="loading-text">Loading request details...</p>';

  // Open single modal
  openModal('request-detail-modal', triggerBtn);

  try {
    const { data } = await api.get(`/admin/requests/${requestId}`);
    const req = data;
    if (refEl) refEl.textContent = req.reference || req.id;

    if (body) {
      const exam = req.examination || {};
      const cand = req.candidate || {};
      const history = req.history || [];

      body.innerHTML = `
        <div style="margin-bottom: 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 0.5rem;">
            <div>
              <h3 style="margin: 0; font-size: 1.2rem; color: var(--color-primary);">${escapeHtml(exam.name || 'Examination')}</h3>
              <p style="margin: 0.2rem 0; font-size: 0.85rem; color: var(--color-text-muted);">${escapeHtml(exam.authority || '')}</p>
            </div>
            ${renderStatusBadge(req.status)}
          </div>
        </div>

        <div class="card" style="background: var(--color-surface-2); padding: 1rem; margin-bottom: 1.25rem;">
          <h4 style="margin: 0 0 0.5rem; font-size: 0.95rem;">Request Specification</h4>
          <div class="grid grid-cols-2" style="gap: 0.6rem; font-size: 0.85rem;">
            <div><strong>Candidate:</strong> ${escapeHtml(cand.name || 'Candidate')} (${escapeHtml(cand.mobile || '—')})</div>
            <div><strong>Exam Date:</strong> ${exam.startsOn ? formatDate(exam.startsOn) : 'TBD'}</div>
            <div><strong>Exam Centre City:</strong> ${escapeHtml(req.city || '—')}</div>
            <div><strong>Preferred Language:</strong> ${escapeHtml(req.language || 'Any')}</div>
            <div><strong>Submitted On:</strong> ${formatDate(req.createdAt)}</div>
            <div><strong>Session:</strong> ${escapeHtml(req.session?.name || req.session?.label || 'General Session')}</div>
          </div>
          ${req.requirements ? `
            <div style="margin-top: 0.6rem; font-size: 0.85rem;">
              <strong>Assistance Needs:</strong> <span style="color: var(--color-text-muted);">${escapeHtml(req.requirements)}</span>
            </div>
          ` : ''}
        </div>

        ${history.length > 0 ? `
          <div style="margin-top: 1rem;">
            <h4 style="margin: 0 0 0.5rem; font-size: 0.95rem;">Status History</h4>
            <ul style="font-size: 0.85rem; padding-left: 1.25rem; color: var(--color-text-muted);">
              ${history.map(h => `
                <li style="margin-bottom: 0.25rem;">
                  <strong>${escapeHtml(h.toStatus || h.status)}</strong> (${formatDate(h.createdAt || h.changedAt)})
                  ${h.reason ? `— <em>${escapeHtml(h.reason)}</em>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
      `;
    }
  } catch (err) {
    if (body) {
      body.innerHTML = `<p class="text-error">Failed to load request: ${escapeHtml(err.message)}</p>`;
    }
  }
}

// ─── ACTION 4: View Volunteer Profile Modal ───────────────────────────────────
async function openVolunteerDetailModal(volunteerUserId, triggerBtn = null) {
  if (!volunteerUserId) return;

  const nameEl = document.getElementById('vol-modal-name');
  const badgeEl = document.getElementById('vol-modal-badge');
  const body = document.getElementById('volunteer-detail-modal-body');

  if (nameEl) nameEl.textContent = 'Volunteer Profile';
  if (body) body.innerHTML = '<p class="loading-text">Loading volunteer details...</p>';

  openModal('volunteer-detail-modal', triggerBtn);

  try {
    const { data } = await api.get(`/admin/users/${volunteerUserId}`);
    const u = data;
    const vp = u.profile || {};

    if (nameEl) nameEl.textContent = vp.fullName || (vp.firstName ? `${vp.firstName} ${vp.lastName || ''}`.trim() : u.name || 'Volunteer');
    if (badgeEl) {
      badgeEl.textContent = u.verificationStatus || 'UNVERIFIED';
      badgeEl.className = `badge ${u.verificationStatus === 'VERIFIED' ? 'badge--green' : 'badge--yellow'}`;
    }

    if (body) {
      body.innerHTML = `
        <div class="card" style="background: var(--color-surface-2); padding: 1rem; margin-bottom: 1.25rem;">
          <h4 style="margin: 0 0 0.5rem; font-size: 0.95rem;">Personal &amp; Contact</h4>
          <div class="grid grid-cols-2" style="gap: 0.6rem; font-size: 0.85rem;">
            <div><strong>Mobile:</strong> ${escapeHtml(u.mobile || u.mobileE164 || '—')}</div>
            <div><strong>Email:</strong> ${escapeHtml(u.email || '—')}</div>
            <div><strong>City / Location:</strong> ${escapeHtml([vp.city, vp.state, vp.pincode].filter(Boolean).join(', ') || '—')}</div>
            <div><strong>Profile Complete:</strong> ${u.profileComplete ? '✓ Yes (100%)' : 'Incomplete'}</div>
          </div>
        </div>

        <div class="card" style="border: 1px solid var(--color-border); padding: 1rem; margin-bottom: 1rem;">
          <h4 style="margin: 0 0 0.5rem; font-size: 0.95rem;">Scribe Capabilities</h4>
          <div style="font-size: 0.85rem; display: flex; flex-direction: column; gap: 0.4rem;">
            <div><strong>Languages Known:</strong> ${escapeHtml(Array.isArray(vp.languages) ? vp.languages.join(', ') : vp.languages || '—')}</div>
            <div><strong>Subject Areas:</strong> ${escapeHtml(Array.isArray(vp.subjects) ? vp.subjects.join(', ') : vp.subjects || 'General')}</div>
            <div><strong>Prior Experience:</strong> ${vp.hasPriorExperience || vp.hasScribeExperience ? '✓ Yes, experienced scribe' : 'New volunteer'}</div>
            ${vp.scribeExperienceDetails ? `<div><strong style="color: var(--color-text-muted);">Experience Note:</strong> ${escapeHtml(vp.scribeExperienceDetails)}</div>` : ''}
          </div>
        </div>
      `;
    }
  } catch (err) {
    if (body) {
      body.innerHTML = `<p class="text-error">Failed to load volunteer: ${escapeHtml(err.message)}</p>`;
    }
  }
}
