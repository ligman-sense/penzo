'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError } from '../notifications.js';
import { formatDate, renderStatusBadge, renderExamCard, escapeHtml, timeAgo } from '../utils.js';
import { renderCompletionWidget, computeCandidateCompletion } from '../profileCompletion.js';

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
    checkProfileCompletion(),
    loadDashboardStats(),
    loadUpcomingExams(),
    loadRecentRequests(),
    updateUnreadCount(),
  ]);
})();

async function checkProfileCompletion() {
  const container = document.getElementById('dashboard-profile-completion');
  if (!container) return;
  try {
    const { data } = await api.get('/profile');
    const completion = data.completion || computeCandidateCompletion(data.profile);
    if (!completion.isComplete) {
      container.hidden = false;
      container.className = 'card';
      container.style.padding = '1.25rem';
      container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 0.75rem;">
          <div>
            <h3 style="margin: 0; font-size: 1.05rem;">Complete Your Candidate Profile</h3>
            <p style="margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--color-text-muted);">
              A complete profile is required to request examination scribes.
            </p>
          </div>
          <a href="/candidate/profile.html" class="btn btn--primary btn--sm" style="white-space: nowrap;">Complete Profile</a>
        </div>
        <div id="dashboard-progress-widget"></div>
      `;
      const widgetBox = container.querySelector('#dashboard-progress-widget');
      renderCompletionWidget(widgetBox, completion, { roleColor: 'var(--color-primary)' });
    }
  } catch (e) {
    // ignore
  }
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
async function loadDashboardStats() {
  const container = document.getElementById('stats-container');
  const banner = document.getElementById('dashboard-matches-banner');
  if (!container) return;

  try {
    const { data } = await api.get('/dashboard');

    if (banner) {
      banner.hidden = true;
    }

    renderStats(container, data);
  } catch (err) {
    container.innerHTML = `<p class="text-error">Failed to load statistics.</p>`;
    showError(err.message || 'Could not load dashboard stats.');
  }
}

function renderStats(container, data) {
  const stats = [
    { label: 'Total Requests',  value: data.totalRequests  ?? 0, icon: '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>' },
    { label: 'Active Requests', value: data.activeRequests ?? 0, icon: '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>' },
    { label: 'Confirmed',       value: data.confirmed      ?? 0, icon: '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>' },
    { label: 'Completed',       value: data.completed      ?? 0, icon: '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>' },
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
