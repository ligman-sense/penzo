'use strict';

import { api } from '../api.js';
import { requireAdmin, adminLogout } from '../auth.js';
import { showError, showSuccess } from '../notifications.js';
import { formatDate, renderPagination, renderStatusBadge } from '../utils.js';

let currentPage = 1;
let currentStatus = '';

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  document.querySelectorAll('#admin-logout-btn, .admin-logout-btn').forEach((btn) => {
    btn.addEventListener('click', () => adminLogout());
  });

  document.getElementById('status-filter')?.addEventListener('change', (e) => {
    currentStatus = e.target.value;
    currentPage = 1;
    loadRequests();
  });

  loadRequests();
});

async function loadRequests() {
  const tableBody = document.getElementById('requests-table-body');
  const paginationContainer = document.getElementById('pagination-container');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading requests...</td></tr>';

  try {
    let url = `/admin/requests?page=${currentPage}&pageSize=15`;
    if (currentStatus) url += `&status=${currentStatus}`;

    const { data, meta } = await api.get(url);

    if (!data || data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center">No scribe requests found.</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    tableBody.innerHTML = data
      .map(
        (r) => `
      <tr>
        <td><code>${escape(r.reference)}</code></td>
        <td><strong>${escape(r.candidate?.name || 'Candidate')}</strong></td>
        <td>${escape(r.examination?.name || 'Exam')}</td>
        <td>${escape(r.city || '—')}</td>
        <td>${renderStatusBadge(r.status)}</td>
        <td>
          <div style="display:flex;gap:0.4rem;">
            ${
              r.status === 'SUBMITTED'
                ? `<button class="btn btn--outline btn--sm status-btn" data-id="${r.id}" data-to="PENDING_REVIEW">Review</button>`
                : ''
            }
            ${
              ['SUBMITTED', 'PENDING_REVIEW'].includes(r.status)
                ? `<button class="btn btn--secondary btn--sm status-btn" data-id="${r.id}" data-to="AWAITING_VOLUNTEER">Find Volunteers</button>`
                : ''
            }
            ${
              ['SUBMITTED', 'PENDING_REVIEW', 'AWAITING_VOLUNTEER'].includes(r.status)
                ? `<button class="btn btn--danger btn--sm status-btn" data-id="${r.id}" data-to="REJECTED">Reject</button>`
                : ''
            }
          </div>
        </td>
      </tr>`
      )
      .join('');

    document.querySelectorAll('.status-btn').forEach((btn) => {
      btn.addEventListener('click', () => updateStatus(btn.dataset.id, btn.dataset.to));
    });

    if (paginationContainer && meta) {
      renderPagination(paginationContainer, meta, (newPage) => {
        currentPage = newPage;
        loadRequests();
      });
    }
  } catch (err) {
    showError(err.message || 'Failed to load requests.');
  }
}

async function updateStatus(id, toStatus) {
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

function escape(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
