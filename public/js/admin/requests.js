'use strict';

import { api } from '../api.js';
import { requireAdmin, adminLogout } from '../auth.js';
import { showError, showSuccess } from '../notifications.js';
import { formatDate, renderPagination, renderStatusBadge, escapeHtml, debounce, setLoading } from '../utils.js';

let currentTab = 'requests';
let currentPage = 1;
let currentStatus = '';
let currentSearch = '';

let activeRequestId = null;
let activeMatchesData = null;
let selectedVolunteer = null;

document.addEventListener('DOMContentLoaded', async () => {
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

  document.getElementById('refresh-requests-btn')?.addEventListener('click', loadRequests);
  document.getElementById('refresh-interests-btn')?.addEventListener('click', loadInterests);
  document.getElementById('refresh-matches-btn')?.addEventListener('click', loadMatches);
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
                ${canFindVolunteers ? `<button class="btn btn--secondary btn--sm find-vol-btn" data-id="${r.id}">Find Volunteers</button>` : ''}
                ${r.status === 'SUBMITTED' ? `<button class="btn btn--outline btn--sm status-btn" data-id="${r.id}" data-to="PENDING_REVIEW">Review</button>` : ''}
                ${['SUBMITTED', 'PENDING_REVIEW', 'AWAITING_VOLUNTEER'].includes(r.status) ? `<button class="btn btn--danger btn--sm status-btn" data-id="${r.id}" data-to="REJECTED">Reject</button>` : ''}
              </div>
            </td>
          </tr>`;
      })
      .join('');

    tableBody.querySelectorAll('.find-vol-btn').forEach((btn) => {
      btn.addEventListener('click', () => openMatchingModal(btn.dataset.id));
    });

    tableBody.querySelectorAll('.status-btn').forEach((btn) => {
      btn.addEventListener('click', () => updateRequestStatus(btn.dataset.id, btn.dataset.to));
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

  tableBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading volunteer interests...</td></tr>';

  try {
    const { data, meta } = await api.get(`/admin/volunteer-interests?page=${currentPage}&pageSize=20`);

    if (!data || data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 2rem;">No volunteer expressions of interest found.</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    tableBody.innerHTML = data
      .map((i) => `
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
        </tr>`)
      .join('');

    if (paginationContainer && meta) {
      renderPagination(paginationContainer, meta, (newPage) => {
        currentPage = newPage;
        loadInterests();
      });
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="6" class="text-error text-center">Failed to load volunteer interests.</td></tr>`;
  }
}

// ─── TAB 3: Proposed & Confirmed Matches ──────────────────────────────────────
async function loadMatches() {
  const tableBody = document.getElementById('matches-table-body');
  const paginationContainer = document.getElementById('pagination-container');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="7" class="text-center">Loading matches...</td></tr>';

  try {
    const { data, meta } = await api.get(`/admin/matches?page=${currentPage}&pageSize=20`);

    if (!data || data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 2rem;">No match records or assignments found.</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    tableBody.innerHTML = data
      .map((m) => {
        let statusBadge = 'badge--yellow';
        if (m.status === 'CONFIRMED' || m.status === 'CANDIDATE_CONFIRMED') statusBadge = 'badge--green';
        if (m.status === 'ACCEPTED') statusBadge = 'badge--teal';
        if (m.status === 'DECLINED' || m.status === 'CANDIDATE_REJECTED') statusBadge = 'badge--red';

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
          </tr>`;
      })
      .join('');

    if (paginationContainer && meta) {
      renderPagination(paginationContainer, meta, (newPage) => {
        currentPage = newPage;
        loadMatches();
      });
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="7" class="text-error text-center">Failed to load matches.</td></tr>`;
  }
}

// ─── MATCHING MODAL ───────────────────────────────────────────────────────────
function setupModals() {
  const matchingModal = document.getElementById('matching-modal');
  const matchingClose = document.getElementById('matching-modal-close');
  const matchingCancel = document.getElementById('matching-modal-cancel');

  const closeMatching = () => {
    if (matchingModal) matchingModal.hidden = true;
    activeRequestId = null;
    activeMatchesData = null;
    document.body.style.overflow = '';
  };

  matchingClose?.addEventListener('click', closeMatching);
  matchingCancel?.addEventListener('click', closeMatching);
  matchingModal?.addEventListener('click', (e) => {
    if (e.target === matchingModal) closeMatching();
  });

  // Propose confirm modal
  const propModal = document.getElementById('propose-confirm-modal');
  const propCancel = document.getElementById('propose-cancel-btn');
  const propSubmit = document.getElementById('propose-submit-btn');

  propCancel?.addEventListener('click', () => {
    if (propModal) propModal.hidden = true;
    selectedVolunteer = null;
  });

  propSubmit?.addEventListener('click', submitProposeMatch);
}

async function openMatchingModal(requestId) {
  const modal = document.getElementById('matching-modal');
  const reqSummary = document.getElementById('matching-req-summary');
  const eligibleContainer = document.getElementById('eligible-volunteers-container');
  const reviewContainer = document.getElementById('review-volunteers-container');
  const reviewSection = document.getElementById('review-volunteers-section');
  const countBadge = document.getElementById('eligible-count-badge');
  const refHeader = document.getElementById('modal-req-ref');

  if (!modal) return;
  activeRequestId = requestId;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  if (reqSummary) reqSummary.innerHTML = '<p class="loading-text">Loading request details...</p>';
  if (eligibleContainer) eligibleContainer.innerHTML = '<p class="loading-text">Finding volunteers interested in the SAME examination...</p>';
  if (reviewSection) reviewSection.style.display = 'none';

  try {
    const { data } = await api.get(`/admin/requests/${requestId}/matches`);
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
          btn.addEventListener('click', () => confirmPropose(btn.dataset.volId));
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
        btn.addEventListener('click', () => confirmPropose(btn.dataset.volId));
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
        <button class="btn btn--primary btn--sm propose-btn" data-vol-id="${v.volunteerId}">
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
          <button class="btn btn--outline btn--sm propose-btn" data-vol-id="${v.volunteerId}" ${v.hasBlockingFailure ? 'disabled title="Overlapping assignment exists"' : ''}>
            Propose Anyway
          </button>
        </div>
      </div>
    </div>`;
}

// ─── PROPOSE MATCH CONFIRMATION ───────────────────────────────────────────────
function confirmPropose(volunteerId) {
  if (!activeMatchesData) return;
  const allVolunteers = [...(activeMatchesData.eligible || []), ...(activeMatchesData.requiresReview || [])];
  selectedVolunteer = allVolunteers.find((v) => v.volunteerId === volunteerId);
  if (!selectedVolunteer) return;

  const propModal = document.getElementById('propose-confirm-modal');
  const confirmBody = document.getElementById('propose-confirm-body');
  if (!propModal || !confirmBody) return;

  const r = activeMatchesData.request;
  confirmBody.innerHTML = `
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
        </div>
        <div style="text-align: right;">
          <span class="badge badge--green">Score: ${selectedVolunteer.score}%</span>
        </div>
      </div>
    </div>

    <p style="font-size: 0.85rem; color: var(--color-text-muted);">
      Upon confirmation, an invitation will be immediately delivered to the volunteer's portal. The candidate will be notified once the volunteer accepts.
    </p>
  `;

  propModal.hidden = false;
}

async function submitProposeMatch() {
  if (!activeRequestId || !selectedVolunteer) return;

  const submitBtn = document.getElementById('propose-submit-btn');
  const noteEl = document.getElementById('propose-note');
  const note = noteEl?.value.trim() || '';

  setLoading(submitBtn, true, 'Proposing Match…');

  try {
    await api.post(`/admin/requests/${activeRequestId}/propose-match`, {
      volunteerId: selectedVolunteer.volunteerId,
      note,
    });

    showSuccess(`Match proposed successfully! Invitation sent to ${selectedVolunteer.volunteerName}.`);

    // Close modals
    const propModal = document.getElementById('propose-confirm-modal');
    if (propModal) propModal.hidden = true;

    const matchingModal = document.getElementById('matching-modal');
    if (matchingModal) matchingModal.hidden = true;
    document.body.style.overflow = '';

    activeRequestId = null;
    selectedVolunteer = null;

    loadRequests();
  } catch (err) {
    showError(err.message || 'Failed to propose match.');
  } finally {
    setLoading(submitBtn, false);
  }
}
