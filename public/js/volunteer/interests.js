'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { formatDate, renderStatusBadge, escapeHtml, renderPagination, setLoading, getQueryParam, setQueryParam } from '../utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _page       = 1;
let _totalPages = 1;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const tableWrap = document.getElementById('interests-table-wrap');
const listEl    = document.getElementById('interests-list');
const emptyEl   = document.getElementById('interests-empty');
const errorEl   = document.getElementById('interests-error');
const errorMsgEl = document.getElementById('interests-error-msg');
const retryBtn  = document.getElementById('interests-retry-btn');
const paginEl   = document.getElementById('pagination');

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

  if (retryBtn) {
    retryBtn.addEventListener('click', () => loadInterests());
  }

  _page = parseInt(getQueryParam('page') || '1', 10);
  await loadInterests();
})();

// ─── Load Interests ───────────────────────────────────────────────────────────
async function loadInterests() {
  if (tableWrap) tableWrap.hidden = false;
  if (listEl) {
    listEl.innerHTML = '<tr><td colspan="6" class="loading-cell text-center" style="padding: 2.5rem;">Loading your interests…</td></tr>';
  }
  if (emptyEl) emptyEl.hidden = true;
  if (errorEl) errorEl.hidden = true;

  try {
    const res = await api.get(`/interests?page=${_page}&pageSize=15`);
    const interests = Array.isArray(res.data) ? res.data : (res.data?.interests || res.data?.items || []);
    _totalPages     = res.meta?.totalPages || res.data?.totalPages || 1;

    if (!interests.length) {
      if (tableWrap) tableWrap.hidden = true;
      if (emptyEl)   emptyEl.hidden   = false;
      if (errorEl)   errorEl.hidden   = true;
      if (paginEl)   paginEl.innerHTML = '';
      return;
    }

    if (tableWrap) tableWrap.hidden = false;
    if (emptyEl)   emptyEl.hidden   = true;
    if (errorEl)   errorEl.hidden   = true;

    if (listEl) {
      listEl.innerHTML = interests.map(i => renderInterestItem(i)).join('');
      attachWithdrawHandlers();
    }

    if (paginEl) renderPagination(paginEl, { page: _page, totalPages: _totalPages }, goToPage);

  } catch (err) {
    if (tableWrap) tableWrap.hidden = true;
    if (emptyEl)   emptyEl.hidden   = true;
    if (errorEl) {
      errorEl.hidden = false;
      if (errorMsgEl) errorMsgEl.textContent = err.message || 'Could not fetch interests.';
    }
    showError(err.message || 'Could not fetch interests.');
  }
}

// ─── Render Interest Item (Aligned Table Rows) ────────────────────────────────
function renderInterestItem(interest) {
  const examId = interest.examinationId || interest.examination?.id || interest.examination?._id;
  const canWithdraw = !['CONFIRMED', 'COMPLETED', 'WITHDRAWN'].includes(interest.status);

  return `<tr data-interest-id="${escapeHtml(examId || '')}">
    <td data-label="Examination">
      <strong style="color: var(--color-text); font-size: 0.95rem;">${escapeHtml(interest.examination?.name || 'Unknown Exam')}</strong>
    </td>
    <td data-label="Authority" style="color: var(--color-text-secondary); font-size: 0.88rem;">
      ${escapeHtml(interest.examination?.authority || '—')}
    </td>
    <td data-label="Exam Date" style="white-space: nowrap; font-size: 0.88rem;">
      ${formatDate(interest.examination?.startsOn)}
    </td>
    <td data-label="Registered On" style="white-space: nowrap; color: var(--color-text-muted); font-size: 0.85rem;">
      ${formatDate(interest.registeredAt || interest.createdAt)}
    </td>
    <td data-label="Status">
      ${renderStatusBadge(interest.status)}
    </td>
    <td data-label="Action" style="text-align: right; white-space: nowrap;">
      ${canWithdraw ? `
        <button type="button" class="btn btn--danger btn--sm withdraw-btn" 
                data-exam-id="${escapeHtml(examId || '')}"
                aria-label="Withdraw interest for ${escapeHtml(interest.examination?.name || '')}">
          Withdraw
        </button>` : '<span style="font-size: 0.85rem; color: var(--color-text-muted);">—</span>'}
    </td>
  </tr>`;
}

// ─── Withdraw Handlers ────────────────────────────────────────────────────────
function attachWithdrawHandlers() {
  listEl?.querySelectorAll('.withdraw-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const examId = btn.dataset.examId;
      if (!confirm('Are you sure you want to withdraw your interest for this exam?')) return;

      setLoading(btn, true, 'Withdrawing…');

      try {
        await api.delete(`/interests/${examId}`);
        showSuccess('Interest withdrawn successfully.');
        await loadInterests(); // Refresh list
      } catch (err) {
        showError(err.message || 'Failed to withdraw interest.');
        setLoading(btn, false);
      }
    });
  });
}

function goToPage(p) {
  _page = p;
  setQueryParam('page', p);
  loadInterests();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
