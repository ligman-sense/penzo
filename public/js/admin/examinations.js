'use strict';

import { api } from '../api.js';
import { requireAdmin, adminLogout } from '../auth.js';
import { showError, showSuccess } from '../notifications.js';
import { formatDate, renderPagination } from '../utils.js';

let currentPage = 1;
let currentStatus = '';

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  document.querySelectorAll('#admin-logout-btn, .admin-logout-btn').forEach((btn) => {
    btn.addEventListener('click', () => adminLogout());
  });

  const statusFilter = document.getElementById('status-filter');
  const searchInput = document.getElementById('search-input');

  statusFilter?.addEventListener('change', () => {
    currentStatus = statusFilter.value;
    currentPage = 1;
    loadExaminations();
  });

  searchInput?.addEventListener('input', () => {
    currentPage = 1;
    loadExaminations();
  });

  loadExaminations();
});

async function loadExaminations() {
  const tableBody = document.getElementById('exams-table-body');
  const paginationContainer = document.getElementById('pagination-container');
  const search = document.getElementById('search-input')?.value || '';

  if (!tableBody) return;
  tableBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading examinations...</td></tr>';

  try {
    let url = `/admin/examinations?page=${currentPage}&pageSize=15`;
    if (currentStatus) url += `&status=${encodeURIComponent(currentStatus)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const { data, meta } = await api.get(url);

    if (!data || data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center">No examinations found.</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    tableBody.innerHTML = data
      .map((e) => {
        const badgeCls =
          e.status === 'PUBLISHED' ? 'badge--green' : e.status === 'DRAFT' ? 'badge--gray' : 'badge--yellow';
        return `
        <tr>
          <td><strong>${escape(e.name)}</strong></td>
          <td>${escape(e.authority)}</td>
          <td><span class="badge ${badgeCls}">${e.status}</span></td>
          <td>${formatDate(e.startsOn)}</td>
          <td>${e.sessionsCount || 0}</td>
          <td>
            <div style="display:flex;gap:0.5rem;">
              <a href="/admin/examination-form.html?id=${e.id}" class="btn btn--outline btn--sm">Edit</a>
              ${
                e.status !== 'PUBLISHED'
                  ? `<button class="btn btn--secondary btn--sm publish-btn" data-id="${e.id}">Publish</button>`
                  : `<button class="btn btn--ghost btn--sm unpublish-btn" data-id="${e.id}">Unpublish</button>`
              }
            </div>
          </td>
        </tr>`;
      })
      .join('');

    // Attach actions
    document.querySelectorAll('.publish-btn').forEach((btn) => {
      btn.addEventListener('click', () => publishExam(btn.dataset.id));
    });
    document.querySelectorAll('.unpublish-btn').forEach((btn) => {
      btn.addEventListener('click', () => unpublishExam(btn.dataset.id));
    });

    if (paginationContainer && meta) {
      renderPagination(paginationContainer, meta, (newPage) => {
        currentPage = newPage;
        loadExaminations();
      });
    }
  } catch (err) {
    showError(err.message || 'Failed to load examinations.');
  }
}

async function publishExam(id) {
  try {
    await api.post(`/admin/examinations/${id}/publish`);
    showSuccess('Examination published.');
    loadExaminations();
  } catch (err) {
    showError(err.message || 'Failed to publish examination.');
  }
}

async function unpublishExam(id) {
  try {
    await api.post(`/admin/examinations/${id}/unpublish`);
    showSuccess('Examination unpublished.');
    loadExaminations();
  } catch (err) {
    showError(err.message || 'Failed to unpublish examination.');
  }
}

function escape(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
