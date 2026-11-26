'use strict';

import { requireAdmin, adminLogout } from '../auth.js';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  updateUnreadCount,
  showSuccess,
  showError,
} from '../notifications.js';
import { formatDate } from '../utils.js';

let currentPage = 1;
const pageSize = 15;
let currentFilterUnread = false;

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  const adminNameEl = document.getElementById('admin-name');
  if (adminNameEl) {
    adminNameEl.textContent = admin.name || admin.email || 'Administrator';
  }

  const logoutBtns = document.querySelectorAll('#admin-logout-btn, .admin-logout-btn');
  logoutBtns.forEach((btn) => btn.addEventListener('click', () => adminLogout()));

  const filterAllBtn = document.getElementById('filter-all-btn');
  const filterUnreadBtn = document.getElementById('filter-unread-btn');
  const markAllBtn = document.getElementById('mark-all-read-btn');
  const prevBtn = document.getElementById('prev-page-btn');
  const nextBtn = document.getElementById('next-page-btn');

  if (filterAllBtn) {
    filterAllBtn.addEventListener('click', () => {
      if (!currentFilterUnread) return;
      currentFilterUnread = false;
      filterAllBtn.className = 'btn btn--sm btn--primary';
      filterUnreadBtn.className = 'btn btn--sm btn--outline';
      currentPage = 1;
      loadAlerts();
    });
  }

  if (filterUnreadBtn) {
    filterUnreadBtn.addEventListener('click', () => {
      if (currentFilterUnread) return;
      currentFilterUnread = true;
      filterUnreadBtn.className = 'btn btn--sm btn--primary';
      filterAllBtn.className = 'btn btn--sm btn--outline';
      currentPage = 1;
      loadAlerts();
    });
  }

  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      try {
        await markAllNotificationsRead('/admin/notifications');
        showSuccess('All administrative alerts marked as read.');
        await updateUnreadCount('/admin/notifications');
        loadAlerts();
      } catch (err) {
        showError(err.message || 'Failed to mark all as read.');
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadAlerts();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentPage++;
      loadAlerts();
    });
  }

  await updateUnreadCount('/admin/notifications');
  loadAlerts();
});

async function loadAlerts() {
  const container = document.getElementById('notifications-container');
  const paginationContainer = document.getElementById('pagination-container');
  const prevBtn = document.getElementById('prev-page-btn');
  const nextBtn = document.getElementById('next-page-btn');
  const pageIndicator = document.getElementById('page-indicator');

  if (!container) return;
  container.innerHTML = '<tr><td colspan="4" class="text-center" style="padding: 2.5rem;"><p>Loading administrative alerts...</p></td></tr>';

  try {
    const res = await fetchNotifications({
      apiPrefix: '/admin/notifications',
      page: currentPage,
      pageSize,
      unreadOnly: currentFilterUnread,
    });

    const items = res.data?.items || [];
    const total = res.pagination?.total || 0;
    const totalPages = Math.ceil(total / pageSize) || 1;

    if (items.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="4" class="text-center" style="padding: 3rem;">
            <p style="font-size: 1.05rem; font-weight: 600; color: var(--color-text);">No administrative alerts found.</p>
            <p style="color: var(--color-text-muted); margin-top: 0.5rem; font-size: 0.9rem;">
              ${currentFilterUnread ? 'You have caught up with all unread alerts!' : 'No administrative alerts have been recorded.'}
            </p>
          </td>
        </tr>`;
      if (paginationContainer) paginationContainer.hidden = true;
      return;
    }

    container.innerHTML = items
      .map((n) => {
        const isUnread = !n.readAt;
        const isUrgent = n.type?.includes('EMERGENCY') || n.type?.includes('UNRESOLVED') || n.type?.includes('URGENT');
        const badgeClass = isUrgent ? 'badge--red' : 'badge--purple';
        const typeLabel = formatTypeLabel(n.type);

        return `
          <tr class="${isUrgent ? 'table-row--urgent' : (isUnread ? 'table-row--unread' : '')}">
            <td data-label="Type" style="vertical-align: top;">
              <span class="badge ${badgeClass}">${escapeHtml(typeLabel)}</span>
              ${isUnread ? '<div style="margin-top: 0.35rem;"><span class="badge badge--yellow" style="font-size: 0.65rem;">NEW</span></div>' : ''}
            </td>
            <td data-label="Notification Details" style="vertical-align: top;">
              <strong style="display: block; font-size: 0.98rem; color: var(--color-text); margin-bottom: 0.35rem;">${escapeHtml(n.title)}</strong>
              <p style="color: var(--color-text-secondary); font-size: 0.88rem; line-height: 1.5; margin: 0;">${escapeHtml(n.body || '')}</p>
            </td>
            <td data-label="Received" style="vertical-align: top; white-space: nowrap; font-size: 0.82rem; color: var(--color-text-muted);">
              ${formatDate(n.createdAt)}
            </td>
            <td data-label="Action" style="vertical-align: top; text-align: right; white-space: nowrap;">
              <div style="display: inline-flex; flex-direction: column; align-items: flex-end; gap: 0.4rem;">
                ${n.linkPath ? `<a href="${escapeHtml(n.linkPath)}" class="btn btn--sm btn--primary">View Action Item</a>` : ''}
                ${isUnread ? `<button type="button" class="btn btn--sm btn--outline mark-read-btn" data-id="${n._id}">Mark as Read</button>` : `<span style="font-size: 0.8rem; color: var(--color-text-muted); display: inline-flex; align-items: center; gap: 0.25rem;">${'<svg class="icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'} Read</span>`}
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    // Attach mark-read handlers
    container.querySelectorAll('.mark-read-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const notifId = e.target.getAttribute('data-id');
        try {
          await markNotificationRead(notifId, '/admin/notifications');
          await updateUnreadCount('/admin/notifications');
          loadAlerts();
        } catch (err) {
          showError(err.message || 'Failed to mark alert as read.');
        }
      });
    });

    if (paginationContainer) {
      paginationContainer.hidden = totalPages <= 1;
      if (pageIndicator) pageIndicator.textContent = `Page ${currentPage} of ${totalPages} (${total} total)`;
      if (prevBtn) prevBtn.disabled = currentPage <= 1;
      if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    }
  } catch (err) {
    container.innerHTML = `<div class="card text-center" style="padding: 2.5rem; color: var(--color-error);"><p>Error loading alerts: ${escapeHtml(err.message)}</p></div>`;
  }
}

function formatTypeLabel(type) {
  if (!type) return 'Alert';
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
