'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError } from '../notifications.js';
import { formatDate, escapeHtml, renderStatusBadge, timeAgo } from '../utils.js';
import { renderCompletionWidget, computeVolunteerCompletion } from '../profileCompletion.js';

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
    checkProfileCompletion(),
    loadStats(),
    loadInterests(),
    loadUpcomingCommitments(),
    updateUnreadCount(),
  ]);
})();

async function checkProfileCompletion() {
  const container = document.getElementById('dashboard-profile-completion');
  if (!container) return;
  try {
    const { data } = await api.get('/profile');
    const completion = data.completion || computeVolunteerCompletion(data.profile);
    if (!completion.isComplete) {
      container.hidden = false;
      container.className = 'card';
      container.style.padding = '1.25rem';
      container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 0.75rem;">
          <div>
            <h3 style="margin: 0; font-size: 1.05rem;">Complete Your Volunteer Profile</h3>
            <p style="margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--color-text-muted);">
              A complete profile helps match you with candidates seeking scribes in your area.
            </p>
          </div>
          <a href="/volunteer/profile.html" class="btn btn--secondary btn--sm" style="white-space: nowrap;">Complete Profile</a>
        </div>
        <div id="dashboard-progress-widget"></div>
      `;
      const widgetBox = container.querySelector('#dashboard-progress-widget');
      renderCompletionWidget(widgetBox, completion, { roleColor: 'var(--color-secondary, #0d9488)' });
    }
  } catch (e) {
    // ignore
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function loadStats() {
  const container = document.getElementById('stats-container');
  const banner = document.getElementById('dashboard-invitations-banner');
  if (!container) return;

  try {
    const { data } = await api.get('/dashboard');

    if (banner && data.invitations && data.invitations.length > 0) {
      banner.hidden = false;
      const count = data.invitations.length;
      banner.className = 'card';
      banner.style.padding = '1.25rem';
      banner.style.borderLeft = '4px solid var(--color-primary)';
      banner.style.backgroundColor = 'var(--color-surface)';
      banner.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
              <span class="badge badge--amber">${count} New Scribe Invitation${count > 1 ? 's' : ''}</span>
            </div>
            <h3 style="margin: 0; font-size: 1.1rem;">You have pending examination scribe invitations!</h3>
            <p style="margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--color-text-muted);">
              An administrator matched your examination interest with a candidate scribe request.
            </p>
          </div>
          <a href="/volunteer/commitments.html" class="btn btn--primary btn--sm">Review & Respond &rarr;</a>
        </div>
      `;
    }

    const stats = [
      { label: 'Active Interests',   value: data.stats?.activeInterests ?? data.totalInterests ?? 0, icon: '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>' },
      { label: 'Pending Invitations',value: data.invitations?.length ?? 0, icon: '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' },
      { label: 'Confirmed Sessions', value: data.stats?.confirmedCommitments ?? data.confirmedSessions ?? 0, icon: '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>' },
      { label: 'Completed',          value: data.completedSessions ?? 0, icon: '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>' },
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
        <div class="empty-state text-center" style="padding: 2.25rem 1rem;">
          <p style="font-weight: 700; color: var(--color-text); margin-bottom: 0.35rem; font-size: 1rem;">No Expressed Interests</p>
          <p style="font-size: 0.875rem; color: var(--color-text-muted); margin-bottom: 1.25rem;">You haven't offered assistance for any examinations yet.</p>
          <a href="/volunteer/examinations.html" class="btn btn--outline btn--sm">Browse Examinations</a>
        </div>`;
      return;
    }

    container.innerHTML = `
      <ul class="dashboard-activity-list interest-list" aria-label="Registered interests">
        ${interests.slice(0, 4).map(i => {
          const examName = i.examination?.name || i.examination?.title || 'Unknown Exam';
          const authority = i.examination?.authority || '';
          const examDate = formatDate(i.examination?.startsOn);
          const registeredDate = formatDate(i.registeredAt || i.createdAt);

          return `
            <li class="dashboard-activity-item interest-list__item">
              <div class="dashboard-activity-item__main">
                <div class="dashboard-activity-item__header">
                  <span class="dashboard-activity-item__title">
                    ${escapeHtml(examName)}
                  </span>
                  ${authority ? `<span class="dashboard-activity-item__authority">${escapeHtml(authority)}</span>` : ''}
                </div>
                <div class="dashboard-activity-item__meta-row">
                  <span class="dashboard-activity-item__meta" title="Examination Date">
                    <svg class="icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    Exam: ${examDate}
                  </span>
                  <span class="dashboard-activity-item__meta" title="Registered On">
                    Offered ${registeredDate}
                  </span>
                </div>
              </div>
              <div class="dashboard-activity-item__aside">
                ${renderStatusBadge(i.status)}
                <a href="/volunteer/interests.html" class="btn btn--ghost btn--sm dashboard-activity-item__action">
                  Manage →
                </a>
              </div>
            </li>
          `;
        }).join('')}
      </ul>
      ${interests.length > 4 ? `
        <div style="margin-top: 1rem; text-align: center;">
          <a href="/volunteer/interests.html" class="btn btn--ghost btn--sm">View All ${interests.length} Interests →</a>
        </div>
      ` : ''}
    `;
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
      container.innerHTML = `
        <div class="empty-state text-center" style="padding: 2.25rem 1rem;">
          <p style="font-weight: 700; color: var(--color-text); margin-bottom: 0.35rem; font-size: 1rem;">No Upcoming Commitments</p>
          <p style="font-size: 0.875rem; color: var(--color-text-muted);">Confirmed examination scribe assignments will appear here.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <ul class="dashboard-activity-list commitment-list" aria-label="Upcoming commitments">
        ${upcoming.slice(0, 4).map(a => {
          const examName = a.examination?.name || a.examination?.title || 'Unknown Exam';
          const authority = a.examination?.authority || '';
          const examDate = formatDate(a.startsAt || a.examination?.startsOn);
          const allocId = a.allocationId;
          const meetingPoint = a.meetingPoint;

          return `
            <li class="dashboard-activity-item commitment-list__item">
              <div class="dashboard-activity-item__main">
                <div class="dashboard-activity-item__header">
                  <span class="dashboard-activity-item__title">
                    ${escapeHtml(examName)}
                  </span>
                  ${authority ? `<span class="dashboard-activity-item__authority">${escapeHtml(authority)}</span>` : ''}
                </div>
                <div class="dashboard-activity-item__meta-row">
                  <span class="dashboard-activity-item__meta" title="Examination Date">
                    <svg class="icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    Exam: ${examDate}
                  </span>
                  ${allocId ? `<span class="badge badge--success badge--sm" style="font-family: var(--font-mono, monospace); font-size: 0.72rem; padding: 2px 7px;">ID: ${escapeHtml(allocId)}</span>` : ''}
                  ${meetingPoint ? `
                    <span class="dashboard-activity-item__meta" style="color: var(--color-ochre); font-weight: 600;" title="Meeting Point">
                      <svg class="icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                      ${escapeHtml(meetingPoint)}
                    </span>
                  ` : ''}
                </div>
              </div>
              <div class="dashboard-activity-item__aside">
                ${renderStatusBadge(a.status)}
                <a href="/volunteer/commitments.html" class="btn btn--outline btn--sm dashboard-activity-item__action">
                  View Details
                </a>
              </div>
            </li>
          `;
        }).join('')}
      </ul>
      ${upcoming.length > 4 ? `
        <div style="margin-top: 1rem; text-align: center;">
          <a href="/volunteer/commitments.html" class="btn btn--ghost btn--sm">View All ${upcoming.length} Commitments →</a>
        </div>
      ` : ''}
    `;
  } catch (err) {
    container.innerHTML = '<p class="text-error">Failed to load commitments.</p>';
  }
}
