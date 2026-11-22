'use strict';

import { requireAuth, logout } from '../auth.js';
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
  const user = await requireAuth('CANDIDATE');
  if (!user) return;

  const userNameEl = document.getElementById('user-name');
  if (userNameEl) {
    userNameEl.textContent = user.name || user.email || 'Candidate';
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => logout());

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
      loadNotifications();
    });
  }

  if (filterUnreadBtn) {
    filterUnreadBtn.addEventListener('click', () => {
      if (currentFilterUnread) return;
      currentFilterUnread = true;
      filterUnreadBtn.className = 'btn btn--sm btn--primary';
      filterAllBtn.className = 'btn btn--sm btn--outline';
      currentPage = 1;
      loadNotifications();
    });
  }

  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      try {
        await markAllNotificationsRead('/notifications');
        showSuccess('All notifications marked as read.');
        await updateUnreadCount('/notifications');
        loadNotifications();
      } catch (err) {
        showError(err.message || 'Failed to mark all as read.');
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadNotifications();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentPage++;
      loadNotifications();
    });
  }

  await updateUnreadCount('/notifications');
  loadNotifications();
});

async function loadNotifications() {
  const container = document.getElementById('notifications-container');
  const paginationContainer = document.getElementById('pagination-container');
  const prevBtn = document.getElementById('prev-page-btn');
  const nextBtn = document.getElementById('next-page-btn');
  const pageIndicator = document.getElementById('page-indicator');

  if (!container) return;
  container.innerHTML = '<div class="card text-center" style="padding: 2.5rem;"><p>Loading notifications...</p></div>';

  try {
    const res = await fetchNotifications({
      apiPrefix: '/notifications',
      page: currentPage,
      pageSize,
      unreadOnly: currentFilterUnread,
    });

    const items = res.data?.items || [];
    const total = res.pagination?.total || 0;
    const totalPages = Math.ceil(total / pageSize) || 1;

    if (items.length === 0) {
      container.innerHTML = `
        <div class="card text-center" style="padding: 3rem;">
          <p style="font-size: 1.1rem; font-weight: 600; color: var(--color-text);">No notifications found.</p>
          <p style="color: var(--color-text-muted); margin-top: 0.5rem;">
            ${currentFilterUnread ? 'You have caught up with all your unread notifications!' : 'You do not have any notifications at this time.'}
          </p>
        </div>`;
      if (paginationContainer) paginationContainer.hidden = true;
      return;
    }

    container.innerHTML = items
      .map((n) => {
        const isUnread = !n.readAt;
        const badgeClass = getBadgeClassForType(n.type);
        const typeLabel = formatTypeLabel(n.type);

        return `
          <div class="card" style="border-left: 4px solid ${isUnread ? 'var(--color-primary)' : 'var(--color-border)'}; ${isUnread ? 'background-color: var(--color-surface-hover, rgba(59, 130, 246, 0.03));' : ''}">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 250px;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                  <span class="badge ${badgeClass}">${escapeHtml(typeLabel)}</span>
                  ${isUnread ? '<span class="badge badge--yellow" style="font-size: 0.65rem;">NEW</span>' : ''}
                  <span style="font-size: 0.8rem; color: var(--color-text-muted);">${formatDate(n.createdAt)}</span>
                </div>
                <h3 style="font-size: 1.05rem; margin-bottom: 0.4rem; color: var(--color-text);">${escapeHtml(n.title)}</h3>
                <p style="color: var(--color-text-muted); font-size: 0.9rem; line-height: 1.5; margin-bottom: 0.75rem;">${escapeHtml(n.body || '')}</p>
                <div style="display: flex; gap: 0.75rem; align-items: center;">
                  ${n.linkPath ? `<a href="${escapeHtml(n.linkPath)}" class="btn btn--sm btn--primary">View Details</a>` : ''}
                  ${isUnread ? `<button class="btn btn--sm btn--outline mark-read-btn" data-id="${n._id}">Mark as Read</button>` : '<span style="font-size: 0.8rem; color: var(--color-text-muted);">✓ Read</span>'}
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    // Attach mark-read handlers
    container.querySelectorAll('.mark-read-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const notifId = e.target.getAttribute('data-id');
        try {
          await markNotificationRead(notifId, '/notifications');
          await updateUnreadCount('/notifications');
          loadNotifications();
        } catch (err) {
          showError(err.message || 'Failed to mark notification as read.');
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
    container.innerHTML = `<div class="card text-center" style="padding: 2.5rem; color: var(--color-error);"><p>Error loading notifications: ${escapeHtml(err.message)}</p></div>`;
  }
}

function getBadgeClassForType(type) {
  if (!type) return 'badge--gray';
  if (type.includes('EMERGENCY') || type.includes('URGENT') || type.includes('UNRESOLVED')) return 'badge--red';
  if (type.includes('CONFIRMED') || type.includes('ACCEPTED') || type.includes('SUCCESS')) return 'badge--green';
  if (type.includes('PROPOSED') || type.includes('WAITING') || type.includes('REVIEW')) return 'badge--yellow';
  return 'badge--blue';
}

function formatTypeLabel(type) {
  if (!type) return 'Notification';
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
