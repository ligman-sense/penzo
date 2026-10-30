'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError } from '../notifications.js';
import {
  formatDate, renderStatusBadge, escapeHtml,
  getQueryParam, setQueryParam, renderPagination
} from '../utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _page       = 1;
let _totalPages = 1;
let _scope      = 'all'; // 'active' | 'past' | 'all'
let _user       = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const tableBody   = document.getElementById('requests-tbody');
const tableEl     = document.getElementById('requests-table');
const emptyState  = document.getElementById('requests-empty');
const paginEl     = document.getElementById('pagination');
const tabsEl      = document.getElementById('scope-tabs');

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  _user = await requireAuth('/login.html');
  if (!_user) return;

  initNavigation();
  updateUnreadCount();

  _scope = getQueryParam('scope') || 'all';
  _page  = parseInt(getQueryParam('page') || '1', 10);

  setupTabs();
  await loadRequests();
})();

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function setupTabs() {
  if (!tabsEl) return;
  tabsEl.querySelectorAll('[data-scope]').forEach(tab => {
    if (tab.dataset.scope === _scope) {
      tab.setAttribute('aria-selected', 'true');
      tab.classList.add('tab--active');
    }
    tab.addEventListener('click', () => {
      tabsEl.querySelectorAll('[data-scope]').forEach(t => {
        t.setAttribute('aria-selected', 'false');
        t.classList.remove('tab--active');
      });
      tab.setAttribute('aria-selected', 'true');
      tab.classList.add('tab--active');
      _scope = tab.dataset.scope;
      _page  = 1;
      setQueryParam('scope', _scope);
      setQueryParam('page',  '1');
      loadRequests();
    });
  });
}

// ─── Load Requests ────────────────────────────────────────────────────────────
async function loadRequests() {
  if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" class="loading-cell">Loading…</td></tr>';

  const params = new URLSearchParams({ scope: _scope, page: _page, pageSize: 15 });

  try {
    const res = await api.get(`/requests?${params.toString()}`);
    const requests  = Array.isArray(res.data) ? res.data : (res.data?.requests || res.data?.items || []);
    _totalPages     = res.meta?.totalPages || res.data?.totalPages || 1;

    if (!requests.length) {
      if (tableEl)   tableEl.hidden   = true;
      if (emptyState) emptyState.hidden = false;
      if (paginEl)   paginEl.innerHTML = '';
      return;
    }

    if (tableEl)    tableEl.hidden    = false;
    if (emptyState) emptyState.hidden = true;

    if (tableBody) {
      tableBody.innerHTML = requests.map(r => `
        <tr>
          <td data-label="Examination">
            <a href="/candidate/request-details.html?id=${r.id}" class="link">
              ${escapeHtml(r.examination?.name || 'Unknown Exam')}
            </a>
          </td>
          <td data-label="Applied On">${formatDate(r.createdAt)}</td>
          <td data-label="Exam Date">${formatDate(r.examination?.startsOn)}</td>
          <td data-label="Status">${renderStatusBadge(r.status)}</td>
          <td data-label="Action">
            <a href="/candidate/request-details.html?id=${r.id}" class="btn btn--ghost btn--sm">View</a>
          </td>
        </tr>`).join('');
    }

    if (paginEl) renderPagination(paginEl, { page: _page, totalPages: _totalPages }, goToPage);

  } catch (err) {
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" class="text-error">Failed to load requests.</td></tr>';
    showError(err.message || 'Could not fetch requests.');
  }
}

function goToPage(p) {
  _page = p;
  setQueryParam('page', p);
  loadRequests();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
