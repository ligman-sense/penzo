'use strict';

import { api } from '../api.js';
import { requireAdmin, adminLogout } from '../auth.js';
import { showError, showSuccess } from '../notifications.js';
import { formatDate } from '../utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  const adminNameEl = document.getElementById('admin-name');
  if (adminNameEl) adminNameEl.textContent = admin.name || admin.email;

  document.querySelectorAll('#admin-logout-btn, .admin-logout-btn').forEach((btn) => {
    btn.addEventListener('click', () => adminLogout());
  });

  try {
    const { data } = await api.get('/admin/dashboard');

    // Stats
    document.getElementById('stat-candidates').textContent = data.users.candidates || 0;
    document.getElementById('stat-volunteers').textContent = data.users.volunteers || 0;
    document.getElementById('stat-exams').textContent = data.examinations.published || 0;
    document.getElementById('stat-requests').textContent = data.requests.total || 0;
    document.getElementById('stat-verifications').textContent = data.verifications.pending || 0;
    document.getElementById('stat-commitments').textContent = data.assignments.confirmed || 0;

    // Recent Audit Logs
    const auditBody = document.getElementById('audit-table-body');
    if (auditBody && data.recentAudit) {
      if (data.recentAudit.length === 0) {
        auditBody.innerHTML = '<tr><td colspan="4" class="text-center">No recent audit logs.</td></tr>';
      } else {
        auditBody.innerHTML = data.recentAudit
          .map(
            (a) => `
            <tr>
              <td><strong>${escape(a.admin)}</strong></td>
              <td><code>${escape(a.action)}</code></td>
              <td>${escape(a.entityType)}</td>
              <td>${formatDate(a.createdAt)}</td>
            </tr>`
          )
          .join('');
      }
    }
  } catch (err) {
    showError(err.message || 'Failed to load dashboard metrics.');
  }
});

function escape(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
