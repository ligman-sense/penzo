'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError } from '../notifications.js';
import { formatDate, escapeHtml, renderStatusBadge, timeAgo } from '../utils.js';

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  const user = await requireAuth('/login.html');
  if (!user) return;

  // Enforce volunteer role
  if (user.role !== 'VOLUNTEER') {
    window.location.href = '/candidate/dashboard.html';
    return;
  }

  initNavigation();

  const nameEl = document.querySelector('.user-name, #user-name');
  if (nameEl) nameEl.textContent = user.name || user.mobile || 'Volunteer';

  await Promise.all([
    loadStats(),
    loadInterests(),
    loadUpcomingCommitments(),
    updateUnreadCount(),
  ]);
})();

// ─── Stats ────────────────────────────────────────────────────────────────────
async function loadStats() {
  const container = document.getElementById('stats-container');
  if (!container) return;

  try {
    const { data } = await api.get('/dashboard');
    const stats = [
      { label: 'Total Interests',    value: data.totalInterests    ?? 0, icon: '⭐' },
      { label: 'Pending Matches',    value: data.pendingMatches    ?? 0, icon: '⏳' },
      { label: 'Confirmed Sessions', value: data.confirmedSessions ?? 0, icon: '✅' },
      { label: 'Completed',          value: data.completedSessions ?? 0, icon: '🎓' },
    ];

    container.innerHTML = stats.map(s => `
      <div class="stat-card">
        <span class="stat-card__icon" aria-hidden="true">${s.icon}</span>
        <p class="stat-card__value">${s.value}</p>
        <p class="stat-card__label">${escapeHtml(s.label)}</p>
      </div>`).join('');
  } catch (err) {
    container.innerHTML = '<p class="text-error">Failed to load statistics.</p>';
    showError(err.message || 'Could not load dashboard stats.');
  }
}

// ─── Interests ────────────────────────────────────────────────────────────────
async function loadInterests() {
  const container = document.getElementById('interests-container');
  if (!container) return;

  try {
    const { data } = await api.get('/interests');
    const interests = Array.isArray(data) ? data : (data.interests || data.items || []);

    if (!interests.length) {
      container.innerHTML = `
        <p class="empty-state">No interests registered yet.
          <a href="/volunteer/examinations.html" class="link">Browse exams</a> to express interest.
        </p>`;
      return;
    }

    container.innerHTML = `
      <ul class="interest-list" aria-label="Registered interests">
        ${interests.slice(0, 4).map(i => `
          <li class="interest-list__item">
            <span class="interest-list__exam">${escapeHtml(i.examination?.name || 'Unknown Exam')}</span>
            <span class="interest-list__date">${formatDate(i.examination?.startsOn)}</span>
            ${renderStatusBadge(i.status)}
          </li>`).join('')}
      </ul>
      ${interests.length > 4 ? '<a href="/volunteer/interests.html" class="btn btn--ghost btn--sm">View All</a>' : ''}`;
  } catch (err) {
    container.innerHTML = '<p class="text-error">Failed to load interests.</p>';
  }
}

// ─── Upcoming Commitments ─────────────────────────────────────────────────────
async function loadUpcomingCommitments() {
  const container = document.getElementById('commitments-container');
  if (!container) return;

  try {
    const { data } = await api.get('/assignments');
    const assignments = Array.isArray(data) ? data : (data.assignments || data.items || []);

    const upcoming = assignments.filter(a => ['CONFIRMED', 'VOLUNTEER_ACCEPTED'].includes(a.status));

    if (!upcoming.length) {
      container.innerHTML = '<p class="empty-state">No upcoming commitments.</p>';
      return;
    }

    container.innerHTML = `
      <ul class="commitment-list" aria-label="Upcoming commitments">
        ${upcoming.slice(0, 4).map(a => `
          <li class="commitment-list__item">
            <div class="commitment-list__info">
              <strong>${escapeHtml(a.examination?.name || 'Unknown Exam')}</strong>
              <span>${formatDate(a.examination?.startsOn)}</span>
              <span>${escapeHtml(a.candidateName || 'Candidate TBD')}</span>
            </div>
            ${renderStatusBadge(a.status)}
          </li>`).join('')}
      </ul>
      <a href="/volunteer/commitments.html" class="btn btn--ghost btn--sm">View All Commitments</a>`;
  } catch (err) {
    container.innerHTML = '<p class="text-error">Failed to load commitments.</p>';
  }
}
