'use strict';

import { api } from '../api.js';
import { requireAdmin, adminLogout } from '../auth.js';
import { showError } from '../notifications.js';

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  document.querySelectorAll('#admin-logout-btn, .admin-logout-btn').forEach((btn) => {
    btn.addEventListener('click', () => adminLogout());
  });

  try {
    const { data } = await api.get('/admin/reports');

    renderMetricsList('requests-report', data.requestsByStatus);
    renderMetricsList('exams-report', data.examsByStatus);
    renderMetricsList('users-report', data.usersByRole);
    renderMetricsList('verifications-report', data.verificationsByStatus);
  } catch (err) {
    showError(err.message || 'Failed to load reports.');
  }
});

function renderMetricsList(elementId, obj) {
  const el = document.getElementById(elementId);
  if (!el || !obj) return;

  const entries = Object.entries(obj);
  if (entries.length === 0) {
    el.innerHTML = '<p class="text-muted">No data available.</p>';
    return;
  }

  el.innerHTML = `
    <ul style="list-style:none;display:flex;flex-direction:column;gap:0.75rem;">
      ${entries
        .map(
          ([k, v]) => `
        <li style="display:flex;justify-content:space-between;border-bottom:1px solid var(--color-border);padding-bottom:0.4rem;">
          <span style="font-weight:600;color:var(--color-text);">${k}</span>
          <span style="font-weight:800;color:var(--color-primary);">${v}</span>
        </li>`
        )
        .join('')}
    </ul>
  `;
}
