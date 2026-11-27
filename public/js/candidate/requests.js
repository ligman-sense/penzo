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
            <a href="/candidate/request-details.html?id=${r.id}" class="link" style="font-weight: 700; color: var(--color-text); text-decoration: none;">
              ${escapeHtml(r.examination?.name || 'Unknown Exam')}
            </a>
            ${r.examination?.authority ? `<div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.15rem;">${escapeHtml(r.examination.authority)}</div>` : ''}
            ${r.allocationId ? `<div style="display: inline-block; font-size: 0.72rem; color: var(--color-primary); font-family: var(--font-mono, monospace); font-weight: 700; margin-top: 0.25rem; background: var(--color-surface-2); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--color-border);">ID: ${escapeHtml(r.allocationId)}</div>` : ''}
          </td>
          <td data-label="Applied On" style="white-space: nowrap; font-size: 0.88rem; color: var(--color-text-muted);">${formatDate(r.createdAt)}</td>
          <td data-label="Exam Date" style="white-space: nowrap; font-size: 0.88rem;">${formatDate(r.session?.startsAt || r.examination?.startsOn)}</td>
          <td data-label="Status">
            ${renderStatusBadge(r.status)}
            ${r.allocationId ? `<div style="font-size: 0.72rem; color: var(--color-success); font-weight: 700; margin-top: 0.15rem;">Confirmed</div>` : ''}
          </td>
          <td data-label="Action" style="text-align: right; white-space: nowrap;">
            <a href="/candidate/request-details.html?id=${r.id}" class="btn btn--outline btn--sm">View Details</a>
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
