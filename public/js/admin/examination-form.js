'use strict';

import { api } from '../api.js';
import { requireAdmin } from '../auth.js';
import { showError, showSuccess } from '../notifications.js';
import { getQueryParam, setLoading } from '../utils.js';

let examId = null;
let _locations = [];
let _sessions = [];
let _rules = [];

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  examId = getQueryParam('id');
  const pageTitle = document.getElementById('form-page-title');
  const form = document.getElementById('examination-form');
  const submitBtn = document.getElementById('submit-btn');

  setupDynamicSubdocuments();

  if (examId) {
    if (pageTitle) pageTitle.textContent = 'Edit Examination';
    loadExamination(examId);
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading(submitBtn, true, 'Saving...');

    const payload = {
      name: document.getElementById('name')?.value.trim(),
      authority: document.getElementById('authority')?.value.trim(),
      description: document.getElementById('description')?.value.trim(),
      officialUrl: document.getElementById('officialUrl')?.value.trim(),
      notificationUrl: document.getElementById('notificationUrl')?.value.trim(),
      registrationOpensAt: document.getElementById('registrationOpensAt')?.value || null,
      registrationDeadline: document.getElementById('registrationDeadline')?.value || null,
      startsOn: document.getElementById('startsOn')?.value || null,
      endsOn: document.getElementById('endsOn')?.value || null,
      isFeatured: document.getElementById('isFeatured')?.checked || false,
      scribeEligibilityInfo: document.getElementById('scribeEligibilityInfo')?.value.trim() || null,
      accommodationInfo: document.getElementById('accommodationInfo')?.value.trim() || null,
      adminNotes: document.getElementById('adminNotes')?.value.trim(),
      locations: collectLocations(),
      sessions: collectSessions(),
      rules: collectRules(),
    };

    try {
      if (examId) {
        await api.put(`/admin/examinations/${examId}`, payload);
        showSuccess('Examination updated successfully.');
      } else {
        await api.post('/admin/examinations', payload);
        showSuccess('Examination created successfully.');
      }
      setTimeout(() => {
        window.location.href = '/admin/examinations.html';
      }, 1000);
    } catch (err) {
      showError(err.message || 'Failed to save examination.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
});

async function loadExamination(id) {
  try {
    const { data } = await api.get(`/admin/examinations/${id}`);
    if (!data) return;

    const fields = [
      'name', 'authority', 'description', 'officialUrl', 'notificationUrl', 'adminNotes',
      'scribeEligibilityInfo', 'accommodationInfo',
    ];

    fields.forEach((f) => {
      const el = document.getElementById(f);
      if (el && data[f]) el.value = data[f];
    });

    if (data.isFeatured) {
      const el = document.getElementById('isFeatured');
      if (el) el.checked = true;
    }

    if (data.startsOn) {
      const el = document.getElementById('startsOn');
      if (el) el.value = data.startsOn.slice(0, 10);
    }
    if (data.endsOn) {
      const el = document.getElementById('endsOn');
      if (el) el.value = data.endsOn.slice(0, 10);
    }
    if (data.registrationOpensAt) {
      const el = document.getElementById('registrationOpensAt');
      if (el) el.value = data.registrationOpensAt.slice(0, 10);
    }
    if (data.registrationDeadline) {
      const el = document.getElementById('registrationDeadline');
      if (el) el.value = data.registrationDeadline.slice(0, 10);
    }

    // Populate locations, sessions, rules
    if (Array.isArray(data.locations) && data.locations.length > 0) {
      data.locations.forEach(loc => addLocationRow(loc));
    }
    if (Array.isArray(data.sessions) && data.sessions.length > 0) {
      data.sessions.forEach(sess => addSessionRow(sess));
    }
    if (Array.isArray(data.rules) && data.rules.length > 0) {
      data.rules.forEach(rule => addRuleRow(rule));
    }
  } catch (err) {
    showError(err.message || 'Failed to load examination.');
  }
}

// ─── Subdocument Management ───────────────────────────────────────────────────
function setupDynamicSubdocuments() {
  document.getElementById('add-location-btn')?.addEventListener('click', () => addLocationRow());
  document.getElementById('add-session-btn')?.addEventListener('click', () => addSessionRow());
  document.getElementById('add-rule-btn')?.addEventListener('click', () => addRuleRow());
}

function addLocationRow(loc = {}) {
  const container = document.getElementById('locations-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'location-row card';
  row.style.padding = '1rem';
  row.style.background = 'var(--color-surface-2, rgba(0,0,0,0.02))';
  row.style.border = '1px solid var(--color-border)';
  row.style.borderRadius = '6px';

  row.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
      <strong style="font-size: 0.9rem;">Venue / Location Entry</strong>
      <button type="button" class="btn btn--ghost btn--sm remove-row-btn" style="color: var(--color-error, #dc2626);">&times; Remove</button>
    </div>
    <div class="grid grid-cols-2" style="gap: 0.75rem;">
      <div class="form-group">
        <label class="form-label" style="font-size: 0.8rem;">City *</label>
        <input type="text" class="form-input loc-city" placeholder="e.g. Chennai" value="${escapeHtml(loc.city || '')}" required>
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size: 0.8rem;">State</label>
        <input type="text" class="form-input loc-state" placeholder="e.g. Tamil Nadu" value="${escapeHtml(loc.state || '')}">
      </div>
    </div>
    <div class="grid grid-cols-2" style="gap: 0.75rem;">
      <div class="form-group">
        <label class="form-label" style="font-size: 0.8rem;">Exact Centre / Address</label>
        <input type="text" class="form-input loc-address" placeholder="e.g. Govt Girls Higher Sec School, Hall 3" value="${escapeHtml(loc.address || loc.centre || '')}">
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size: 0.8rem;">Pincode</label>
        <input type="text" class="form-input loc-pincode" placeholder="e.g. 600001" value="${escapeHtml(loc.pincode || '')}">
      </div>
    </div>
  `;

  row.querySelector('.remove-row-btn').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function addSessionRow(sess = {}) {
  const container = document.getElementById('sessions-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'session-row card';
  row.style.padding = '1rem';
  row.style.background = 'var(--color-surface-2, rgba(0,0,0,0.02))';
  row.style.border = '1px solid var(--color-border)';
  row.style.borderRadius = '6px';

  const startsAt = sess.startsAt ? new Date(sess.startsAt).toISOString().slice(0, 16) : '';
  const endsAt = sess.endsAt ? new Date(sess.endsAt).toISOString().slice(0, 16) : '';

  row.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
      <strong style="font-size: 0.9rem;">Session / Shift Entry</strong>
      <button type="button" class="btn btn--ghost btn--sm remove-row-btn" style="color: var(--color-error, #dc2626);">&times; Remove</button>
    </div>
    <div class="grid grid-cols-3" style="gap: 0.75rem;">
      <div class="form-group">
        <label class="form-label" style="font-size: 0.8rem;">Session Label / Shift Name *</label>
        <input type="text" class="form-input sess-name" placeholder="e.g. Shift 1 (Forenoon)" value="${escapeHtml(sess.name || sess.label || '')}" required>
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size: 0.8rem;">Start Date &amp; Time *</label>
        <input type="datetime-local" class="form-input sess-start" value="${startsAt}" required>
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size: 0.8rem;">End Date &amp; Time *</label>
        <input type="datetime-local" class="form-input sess-end" value="${endsAt}" required>
      </div>
    </div>
  `;

  row.querySelector('.remove-row-btn').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function addRuleRow(rule = {}) {
  const container = document.getElementById('rules-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'rule-row';
  row.style.display = 'flex';
  row.style.gap = '0.5rem';
  row.style.alignItems = 'center';

  const ruleText = typeof rule === 'string' ? rule : (rule.rule || rule.body || rule.title || '');

  row.innerHTML = `
    <input type="text" class="form-input rule-input" placeholder="e.g. Scribe must carry valid Photo ID and admit card declaration" value="${escapeHtml(ruleText)}" style="flex: 1;" required>
    <button type="button" class="btn btn--ghost btn--sm remove-row-btn" style="color: var(--color-error, #dc2626);">&times;</button>
  `;

  row.querySelector('.remove-row-btn').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function collectLocations() {
  const rows = document.querySelectorAll('.location-row');
  const result = [];
  rows.forEach(r => {
    const city = r.querySelector('.loc-city')?.value.trim();
    if (!city) return;
    result.push({
      city,
      state: r.querySelector('.loc-state')?.value.trim() || null,
      address: r.querySelector('.loc-address')?.value.trim() || null,
      pincode: r.querySelector('.loc-pincode')?.value.trim() || null,
    });
  });
  return result;
}

function collectSessions() {
  const rows = document.querySelectorAll('.session-row');
  const result = [];
  rows.forEach(r => {
    const name = r.querySelector('.sess-name')?.value.trim();
    const startVal = r.querySelector('.sess-start')?.value;
    const endVal = r.querySelector('.sess-end')?.value;
    if (!name || !startVal || !endVal) return;
    result.push({
      name,
      label: name,
      startsAt: new Date(startVal),
      endsAt: new Date(endVal),
    });
  });
  return result;
}

function collectRules() {
  const rows = document.querySelectorAll('.rule-row');
  const result = [];
  rows.forEach(r => {
    const text = r.querySelector('.rule-input')?.value.trim();
    if (!text) return;
    result.push({
      rule: text,
      title: text,
      body: text,
    });
  });
  return result;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
