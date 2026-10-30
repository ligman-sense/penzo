'use strict';

import { api } from '../api.js';
import { requireAdmin, adminLogout } from '../auth.js';
import { showError, showSuccess } from '../notifications.js';
import { formatDate, renderPagination } from '../utils.js';

let currentPage = 1;
let currentStatus = 'PENDING';

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  document.querySelectorAll('#admin-logout-btn, .admin-logout-btn').forEach((btn) => {
    btn.addEventListener('click', () => adminLogout());
  });

  document.getElementById('status-filter')?.addEventListener('change', (e) => {
    currentStatus = e.target.value;
    currentPage = 1;
    loadVerifications();
  });

  loadVerifications();
});

async function loadVerifications() {
  const tableBody = document.getElementById('verifications-table-body');
  const paginationContainer = document.getElementById('pagination-container');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading verification queue...</td></tr>';

  try {
    let url = `/admin/verifications?page=${currentPage}&pageSize=15&status=${currentStatus}`;
    const { data, meta } = await api.get(url);

    if (!data || data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center">No verification records in this queue.</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    tableBody.innerHTML = data
      .map(
        (v) => `
      <tr>
        <td><strong>${escape(v.user?.name || 'Unknown')}</strong></td>
        <td><span class="badge ${v.user?.role === 'CANDIDATE' ? 'badge--blue' : 'badge--teal'}">${v.user?.role || ''}</span></td>
        <td>${escape(v.kind)}</td>
        <td>${formatDate(v.createdAt)}</td>
        <td><span class="badge ${v.status === 'VERIFIED' ? 'badge--green' : v.status === 'REJECTED' ? 'badge--red' : 'badge--yellow'}">${v.status}</span></td>
        <td>
          <div style="display:flex;gap:0.4rem;">
            <button class="btn btn--secondary btn--sm decide-btn" data-id="${v.id}" data-decision="VERIFIED">Approve</button>
            <button class="btn btn--outline btn--sm decide-btn" data-id="${v.id}" data-decision="REQUIRES_CORRECTION">Correction</button>
            <button class="btn btn--danger btn--sm decide-btn" data-id="${v.id}" data-decision="REJECTED">Reject</button>
          </div>
        </td>
      </tr>`
      )
      .join('');

    document.querySelectorAll('.decide-btn').forEach((btn) => {
      btn.addEventListener('click', () => decide(btn.dataset.id, btn.dataset.decision));
    });

    if (paginationContainer && meta) {
      renderPagination(paginationContainer, meta, (newPage) => {
        currentPage = newPage;
        loadVerifications();
      });
    }
  } catch (err) {
    showError(err.message || 'Failed to load verifications.');
  }
}

async function decide(id, decision) {
  let reason = '';
  if (decision !== 'VERIFIED') {
    reason = prompt(`Enter reason for ${decision}:`) || '';
    if (!reason.trim()) {
      showError('A reason is required when rejecting or requesting correction.');
      return;
    }
  }

  try {
    await api.post(`/admin/verifications/${id}/decide`, { status: decision, reason });
    showSuccess(`Verification marked as ${decision}.`);
    loadVerifications();
  } catch (err) {
    showError(err.message || 'Failed to update verification record.');
  }
}

function escape(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
