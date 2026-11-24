'use strict';

import { api } from '../api.js';
import { requireAdmin, adminLogout } from '../auth.js';
import { updateUnreadCount, showError } from '../notifications.js';
import { formatDate } from '../utils.js';

let currentPage = 1;
const pageSize = 25;
let currentSearch = '';
let currentEntityType = '';

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  const adminNameEl = document.getElementById('admin-name');
  if (adminNameEl) {
    adminNameEl.textContent = admin.name || admin.email || 'Administrator';
  }

  const logoutBtns = document.querySelectorAll('#admin-logout-btn, .admin-logout-btn');
  logoutBtns.forEach((btn) => btn.addEventListener('click', () => adminLogout()));

  const filterForm = document.getElementById('audit-filter-form');
  const resetBtn = document.getElementById('reset-filter-btn');
  const exportBtn = document.getElementById('export-csv-btn');
  const prevBtn = document.getElementById('prev-page-btn');
  const nextBtn = document.getElementById('next-page-btn');
  const modal = document.getElementById('details-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');

  if (filterForm) {
    filterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      currentSearch = document.getElementById('search-input')?.value.trim() || '';
      currentEntityType = document.getElementById('entity-filter')?.value || '';
      currentPage = 1;
      loadAuditLogs();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (document.getElementById('search-input')) document.getElementById('search-input').value = '';
      if (document.getElementById('entity-filter')) document.getElementById('entity-filter').value = '';
      currentSearch = '';
      currentEntityType = '';
      currentPage = 1;
      loadAuditLogs();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const params = new URLSearchParams();
      if (currentSearch) params.append('search', currentSearch);
      if (currentEntityType) params.append('entityType', currentEntityType);
      window.location.href = `/api/admin/audit/export?${params.toString()}`;
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadAuditLogs();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentPage++;
      loadAuditLogs();
    });
  }

  if (closeModalBtn && modal) {
    closeModalBtn.addEventListener('click', () => modal.close());
  }

  await updateUnreadCount('/admin/notifications');
  loadAuditLogs();
});

async function loadAuditLogs() {
  const tbody = document.getElementById('audit-table-body');
  const paginationContainer = document.getElementById('pagination-container');
  const prevBtn = document.getElementById('prev-page-btn');
  const nextBtn = document.getElementById('next-page-btn');
  const pageIndicator = document.getElementById('page-indicator');
  const modal = document.getElementById('details-modal');
  const modalJson = document.getElementById('modal-json');
  const modalTitle = document.getElementById('modal-title');

  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 2.5rem;">Loading audit trail...</td></tr>';

  try {
    const params = new URLSearchParams({
      page: String(currentPage),
      pageSize: String(pageSize),
    });
    if (currentSearch) params.append('search', currentSearch);
    if (currentEntityType) params.append('entityType', currentEntityType);

    const res = await api.get(`/admin/audit?${params.toString()}`);
    const items = res.data || [];
    const total = res.pagination?.total || 0;
    const totalPages = Math.ceil(total / pageSize) || 1;

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 2.5rem; color: var(--color-text-muted);">No audit entries match the current filter.</td></tr>';
      if (paginationContainer) paginationContainer.hidden = true;
      return;
    }

    tbody.innerHTML = items
      .map((a, idx) => {
        const hasDetails = a.details !== null && a.details !== undefined && Object.keys(a.details || {}).length > 0;
        return `
          <tr>
            <td>
              <strong>${escapeHtml(a.adminName)}</strong>
              ${a.adminEmail ? `<br><small style="color: var(--color-text-muted);">${escapeHtml(a.adminEmail)}</small>` : ''}
            </td>
            <td><code>${escapeHtml(a.action)}</code></td>
            <td><span class="badge badge--gray">${escapeHtml(a.entityType || '—')}</span></td>
            <td><code style="font-size: 0.8rem;">${escapeHtml(a.entityId || '—')}</code></td>
            <td><small style="color: var(--color-text-muted);">${escapeHtml(a.ipAddress || '—')}</small></td>
            <td><small>${formatDate(a.createdAt)}</small></td>
            <td>
              ${hasDetails ? `<button class="btn btn--outline btn--sm view-details-btn" data-index="${idx}" style="padding: 2px 8px; font-size: 0.75rem;">View</button>` : '<span style="color: var(--color-text-muted); font-size: 0.8rem;">—</span>'}
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('.view-details-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-index'), 10);
        const item = items[index];
        if (item && modal && modalJson) {
          if (modalTitle) modalTitle.textContent = `${item.action} (${item.entityType || 'Record'})`;
          modalJson.textContent = JSON.stringify(item.details, null, 2);
          modal.showModal();
        }
      });
    });

    if (paginationContainer) {
      paginationContainer.hidden = totalPages <= 1;
      if (pageIndicator) pageIndicator.textContent = `Page ${currentPage} of ${totalPages} (${total} total records)`;
      if (prevBtn) prevBtn.disabled = currentPage <= 1;
      if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 2.5rem; color: var(--color-error);">Error loading audit logs: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
