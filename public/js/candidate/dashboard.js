'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError } from '../notifications.js';
import { formatDate, renderStatusBadge, renderExamCard, escapeHtml, timeAgo } from '../utils.js';

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  const user = await requireAuth('/login.html');
  if (!user) return;

  initNavigation();

  // Populate user name
  const nameEl = document.querySelector('.user-name, #user-name');
  if (nameEl) nameEl.textContent = user.name || user.mobile || 'Candidate';

  await Promise.all([
    loadDashboardStats(),
    loadUpcomingExams(),
    loadRecentRequests(),
    updateUnreadCount(),
  ]);
})();

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
async function loadDashboardStats() {
  const container = document.getElementById('stats-container');
  if (!container) return;

  try {
    const { data } = await api.get('/dashboard');
    renderStats(container, data);
  } catch (err) {
    container.innerHTML = `<p class="text-error">Failed to load statistics.</p>`;
    showError(err.message || 'Could not load dashboard stats.');
  }
}

function renderStats(container, data) {
  const stats = [
    { label: 'Total Requests',  value: data.totalRequests  ?? 0, icon: '📋' },
    { label: 'Active Requests', value: data.activeRequests ?? 0, icon: '🔄' },
    { label: 'Confirmed',       value: data.confirmed      ?? 0, icon: '✅' },
    { label: 'Completed',       value: data.completed      ?? 0, icon: '🎓' },
  ];

  container.innerHTML = stats.map(s => `
    <div class="stat-card">
      <span class="stat-card__icon" aria-hidden="true">${s.icon}</span>
      <p class="stat-card__value">${s.value}</p>
      <p class="stat-card__label">${escapeHtml(s.label)}</p>
    </div>`).join('');
}

// ─── Upcoming Exams ───────────────────────────────────────────────────────────
async function loadUpcomingExams() {
  const container = document.getElementById('upcoming-exams');
  if (!container) return;

  try {
    const { data } = await api.get('/public/examinations?page=1&pageSize=3&sort=startsOn');
    const exams = Array.isArray(data) ? data : (data.examinations || data.items || []);

    if (!exams.length) {
      container.innerHTML = '<p class="empty-state">No upcoming exams at the moment.</p>';
      return;
    }
    container.innerHTML = exams.map(e => renderExamCard(e, 'CANDIDATE')).join('');
  } catch (err) {
    container.innerHTML = '<p class="text-error">Failed to load upcoming exams.</p>';
  }
}

// ─── Recent Requests ──────────────────────────────────────────────────────────
async function loadRecentRequests() {
  const container = document.getElementById('recent-requests');
  if (!container) return;

  try {
    const { data } = await api.get('/requests?scope=active');
    const requests = Array.isArray(data) ? data : (data.requests || data.items || []);

    if (!requests.length) {
      container.innerHTML = `
        <p class="empty-state">No active requests. 
          <a href="/candidate/examinations.html" class="link">Browse exams</a> to get started.
        </p>`;
      return;
    }

    container.innerHTML = `
      <ul class="request-list" aria-label="Recent requests">
        ${requests.slice(0, 5).map(r => `
          <li class="request-list__item">
            <a href="/candidate/request-details.html?id=${r.id}" class="request-list__link">
              <span class="request-list__exam">${escapeHtml(r.examination?.name || 'Unknown Exam')}</span>
              <span class="request-list__date">${formatDate(r.createdAt)}</span>
            </a>
            ${renderStatusBadge(r.status)}
          </li>`).join('')}
      </ul>
      ${requests.length > 5 ? '<a href="/candidate/requests.html" class="btn btn--ghost btn--sm">View All Requests</a>' : ''}`;
  } catch (err) {
    container.innerHTML = '<p class="text-error">Failed to load recent requests.</p>';
  }
}
