'use strict';

import { api } from '../api.js';
import { requireAdmin, adminLogout } from '../auth.js';
import { showError, showSuccess } from '../notifications.js';
import { formatDate, renderPagination } from '../utils.js';

let currentPage = 1;
let currentRole = '';
let currentStatus = '';

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  document.querySelectorAll('#admin-logout-btn, .admin-logout-btn').forEach((btn) => {
    btn.addEventListener('click', () => adminLogout());
  });

  document.getElementById('role-filter')?.addEventListener('change', (e) => {
    currentRole = e.target.value;
    currentPage = 1;
    loadUsers();
  });

  document.getElementById('status-filter')?.addEventListener('change', (e) => {
    currentStatus = e.target.value;
    currentPage = 1;
    loadUsers();
  });

  loadUsers();
});

async function loadUsers() {
  const tableBody = document.getElementById('users-table-body');
  const paginationContainer = document.getElementById('pagination-container');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading users...</td></tr>';

  try {
    let url = `/admin/users?page=${currentPage}&pageSize=15`;
    if (currentRole) url += `&role=${currentRole}`;
    if (currentStatus) url += `&status=${currentStatus}`;

    const { data, meta } = await api.get(url);

    if (!data || data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center">No users found.</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    tableBody.innerHTML = data
      .map((u) => {
        const isSuspended = u.status === 'SUSPENDED';
        return `
        <tr>
          <td><strong>${escape(u.name)}</strong></td>
          <td><span class="badge ${u.role === 'CANDIDATE' ? 'badge--blue' : 'badge--teal'}">${u.role}</span></td>
          <td>${escape(u.mobile)}</td>
          <td>${escape(u.email || '—')}</td>
          <td><span class="badge ${isSuspended ? 'badge--red' : 'badge--green'}">${u.status}</span></td>
          <td>
            <button class="btn btn--sm ${isSuspended ? 'btn--secondary' : 'btn--danger'} toggle-status-btn"
              data-id="${u.id}" data-action="${isSuspended ? 'ACTIVE' : 'SUSPENDED'}">
              ${isSuspended ? 'Reactivate' : 'Suspend'}
            </button>
          </td>
        </tr>`;
      })
      .join('');

    document.querySelectorAll('.toggle-status-btn').forEach((btn) => {
      btn.addEventListener('click', () => toggleUserStatus(btn.dataset.id, btn.dataset.action));
    });

    if (paginationContainer && meta) {
      renderPagination(paginationContainer, meta, (newPage) => {
        currentPage = newPage;
        loadUsers();
      });
    }
  } catch (err) {
    showError(err.message || 'Failed to load users.');
  }
}

async function toggleUserStatus(userId, targetStatus) {
  const reason = prompt(`Reason for ${targetStatus === 'SUSPENDED' ? 'suspending' : 'reactivating'} this account:`);
  if (reason === null) return;

  try {
    await api.patch(`/admin/users/${userId}/status`, { status: targetStatus, reason });
    showSuccess(`User account is now ${targetStatus}.`);
    loadUsers();
  } catch (err) {
    showError(err.message || 'Failed to update user status.');
  }
}

function escape(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
