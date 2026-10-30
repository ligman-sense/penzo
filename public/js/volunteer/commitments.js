'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError } from '../notifications.js';
import { formatDate, formatDateTime, renderStatusBadge, escapeHtml, renderPagination, getQueryParam, setQueryParam } from '../utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _page       = 1;
let _totalPages = 1;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const listEl  = document.getElementById('commitments-list');
const emptyEl = document.getElementById('commitments-empty');
const paginEl = document.getElementById('pagination');
const filterEl = document.getElementById('status-filter');

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

  await loadCommitments();
})();

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

  return `<li class="commitment-item">
    <div class="commitment-item__info">
      <h3 class="commitment-item__exam">${escapeHtml(assignment.examination?.name || 'Unknown Exam')}</h3>
      <p class="commitment-item__authority">${escapeHtml(assignment.examination?.authority || '')}</p>
      <dl class="commitment-item__meta">
        <div><dt>Exam Date</dt><dd>${formatDate(assignment.examination?.startsOn)}</dd></div>
        <div><dt>Candidate</dt><dd>${escapeHtml(assignment.candidateName || 'TBD')}</dd></div>
        <div><dt>Location</dt><dd>${escapeHtml(assignment.location || assignment.examination?.locations?.[0]?.city || 'TBD')}</dd></div>
        ${assignment.confirmationDeadline ? `<div><dt>Confirm By</dt><dd>${formatDate(assignment.confirmationDeadline)}</dd></div>` : ''}
      </dl>
      ${sessions ? `<h4>Sessions</h4><ul class="sessions-list">${sessions}</ul>` : ''}
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
