'use strict';

import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { formatDateTime, escapeHtml, setLoading } from '../utils.js';

let _user = null;

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  _user = await requireAuth('/login.html');
  if (!_user) return;

  if (_user.role !== 'VOLUNTEER') {
    window.location.href = '/candidate/dashboard.html';
    return;
  }

  initNavigation();
  updateUnreadCount();

  setupForm();
  loadAvailability();
});

function setupForm() {
  const form = document.getElementById('availability-form');
  const startInput = document.getElementById('slot-start');
  const endInput = document.getElementById('slot-end');
  const submitBtn = document.getElementById('add-slot-btn');

  // Pre-fill default start = tomorrow 09:00, end = tomorrow 17:00
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);
  if (startInput) startInput.value = `${dateStr}T09:00`;
  if (endInput) endInput.value = `${dateStr}T17:00`;

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const startsAtVal = startInput?.value;
    const endsAtVal = endInput?.value;

    if (!startsAtVal || !endsAtVal) {
      showError('Please select both start and end dates/times.');
      return;
    }

    const start = new Date(startsAtVal);
    const end = new Date(endsAtVal);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      showError('End time must be after start time.');
      return;
    }

    setLoading(submitBtn, true, 'Adding Slot...');

    try {
      await api.post('/availability', {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      });

      showSuccess('Availability slot added successfully!');
      loadAvailability();
    } catch (err) {
      showError(err.message || 'Failed to add availability slot. Check for overlapping slots.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

async function loadAvailability() {
  const listEl = document.getElementById('availability-list');
  const loadingEl = document.getElementById('loading-slots');
  const emptyEl = document.getElementById('availability-empty');

  if (loadingEl) loadingEl.style.display = 'block';
  if (listEl) listEl.innerHTML = '';
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const { data } = await api.get('/availability');
    const slots = Array.isArray(data) ? data : (data?.items || []);

    if (loadingEl) loadingEl.style.display = 'none';

    if (!slots.length) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (listEl) {
      listEl.innerHTML = slots.map(s => renderSlotItem(s)).join('');
      attachRemoveHandlers();
    }
  } catch (err) {
    if (loadingEl) loadingEl.style.display = 'none';
    showError(err.message || 'Failed to load availability schedule.');
  }
}

function renderSlotItem(slot) {
  const isCommitted = slot.status === 'COMMITTED';
  const badgeClass = isCommitted ? 'badge--amber' : 'badge--green';
  const badgeLabel = isCommitted ? 'Committed to Assignment' : 'Open Slot';

  return `
    <li class="card" style="padding: 1rem; border: 1px solid var(--color-border); background: var(--color-surface); display: flex; justify-content: space-between; align-items: center; border-radius: 6px;">
      <div>
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
          <span class="badge ${badgeClass}" style="font-size: 0.75rem;">${badgeLabel}</span>
          <strong style="font-size: 0.95rem;">${formatDateTime(slot.startsAt)}</strong>
          <span style="color: var(--color-text-muted);">to</span>
          <strong style="font-size: 0.95rem;">${formatDateTime(slot.endsAt)}</strong>
        </div>
        <small style="color: var(--color-text-muted);">Created on ${formatDateTime(slot.createdAt)}</small>
      </div>
      <div>
        ${!isCommitted ? `
          <button type="button" class="btn btn--outline btn--sm remove-slot-btn" data-slot-id="${slot.id}" style="color: var(--color-error, #dc2626); border-color: var(--color-error, #dc2626);">
            Remove Slot
          </button>
        ` : `
          <span style="font-size: 0.8rem; color: var(--color-text-muted);">Locked by Assignment</span>
        `}
      </div>
    </li>
  `;
}

function attachRemoveHandlers() {
  document.querySelectorAll('.remove-slot-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const slotId = btn.dataset.slotId;
      if (!confirm('Are you sure you want to remove this availability slot?')) return;

      setLoading(btn, true, 'Removing...');

      try {
        await api.delete(`/availability/${slotId}`);
        showSuccess('Availability slot removed.');
        loadAvailability();
      } catch (err) {
        showError(err.message || 'Failed to remove availability slot.');
        setLoading(btn, false);
      }
    });
  });
}
