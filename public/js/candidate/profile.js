'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { validateEmail, validateRequired, showFieldError, clearAllErrors } from '../validation.js';
import { escapeHtml, setLoading } from '../utils.js';
import { computeCandidateCompletion, renderCompletionWidget } from '../profileCompletion.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const form                = document.getElementById('profile-form');
const completionContainer = document.getElementById('profile-completion-container');
const verifyBadge         = document.getElementById('verify-badge');

let _hasUnsavedChanges = false;
let _initialData = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  const user = await requireAuth('/login.html');
  if (!user) return;

  initNavigation();
  updateUnreadCount();
  await loadProfile();

  window.addEventListener('beforeunload', (e) => {
    if (_hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();

// ─── Load Profile ─────────────────────────────────────────────────────────────
async function loadProfile() {
  try {
    const { data } = await api.get('/profile');
    const profile = data.profile || data;
    fillForm(profile);

    const completion = data.completion || computeCandidateCompletion(collectFormData());
    _hasUnsavedChanges = false;
    renderCompletionWidget(completionContainer, completion, {
      hasUnsavedChanges: false,
      roleColor: 'var(--color-primary, #2563eb)',
    });

    renderVerificationStatus(profile.verificationStatus || data.verifications?.[0]?.status);
  } catch (err) {
    showError(err.message || 'Failed to load profile.');
  }
}

// ─── Fill Form ────────────────────────────────────────────────────────────────
function fillForm(profile) {
  if (!form) return;

  const set = (id, val) => {
    const el = form.querySelector(`#${id}`);
    if (el) el.value = val ?? '';
  };

  set('first-name',      profile.firstName || (profile.fullName ? profile.fullName.split(' ')[0] : ''));
  set('last-name',       profile.lastName || (profile.fullName ? profile.fullName.split(' ').slice(1).join(' ') : ''));
  set('email',           profile.email);
  set('date-of-birth',   profile.dateOfBirth ? String(profile.dateOfBirth).substring(0, 10) : '');
  set('gender',          profile.gender);
  set('education',       profile.education);
  set('languages',       Array.isArray(profile.languages) ? profile.languages.join(', ') : (profile.languages || ''));
  set('disability-type', profile.disabilityType || profile.assistanceNeeds || '');
  set('mobile-display',  profile.mobile);

  // Address fields
  set('city',            profile.city || profile.address?.city);
  set('state',           profile.state || profile.address?.state);
  set('pincode',         profile.pincode || profile.address?.pincode);

  setupLiveProgress();
  setupFormSubmit();
}

// ─── Live Progress ────────────────────────────────────────────────────────────
function setupLiveProgress() {
  if (!form) return;

  const onFieldChange = () => {
    _hasUnsavedChanges = true;
    const currentData = collectFormData();
    const liveCompletion = computeCandidateCompletion(currentData);
    renderCompletionWidget(completionContainer, liveCompletion, {
      hasUnsavedChanges: true,
      roleColor: 'var(--color-primary, #2563eb)',
    });
  };

  form.addEventListener('input', onFieldChange);
  form.addEventListener('change', onFieldChange);
}

// ─── Form Submit ──────────────────────────────────────────────────────────────
function setupFormSubmit() {
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors(form);

    const data = collectFormData();
    if (!validateFormData(data)) return;

    const submitBtn = form.querySelector('[type="submit"]');
    setLoading(submitBtn, true, 'Saving…');

    try {
      const { data: updated } = await api.put('/profile', data);
      showSuccess('Profile updated successfully.');
      _hasUnsavedChanges = false;

      const completion = updated.completion || computeCandidateCompletion(updated.profile || data);
      renderCompletionWidget(completionContainer, completion, {
        hasUnsavedChanges: false,
        roleColor: 'var(--color-primary, #2563eb)',
      });

      renderVerificationStatus(updated.profile?.verificationStatus || updated.verifications?.[0]?.status);
    } catch (err) {
      if (err.details) {
        err.details.forEach((d) => {
          const fieldEl = form.querySelector(`[name="${d.field}"], #${d.field}`);
          if (fieldEl) showFieldError(fieldEl, d.message);
        });
      }
      showError(err.message || 'Failed to save profile. Please check the form.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

function collectFormData() {
  const g = (id) => form.querySelector(`#${id}`)?.value.trim() || '';
  const langStr = g('languages');
  return {
    firstName:       g('first-name'),
    lastName:        g('last-name'),
    fullName:        `${g('first-name')} ${g('last-name')}`.trim(),
    email:           g('email'),
    dateOfBirth:     g('date-of-birth'),
    gender:          g('gender'),
    education:       g('education'),
    languages:       langStr ? langStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
    disabilityType:  g('disability-type'),
    assistanceNeeds: g('disability-type'),
    city:            g('city'),
    state:           g('state'),
    pincode:         g('pincode'),
    address: {
      city:    g('city'),
      state:   g('state'),
      pincode: g('pincode'),
    },
  };
}

function validateFormData(data) {
  let valid = true;
  const firstNameEl = form.querySelector('#first-name');
  const lastNameEl  = form.querySelector('#last-name');
  const emailEl     = form.querySelector('#email');

  if (!validateRequired(data.firstName) && firstNameEl) {
    showFieldError(firstNameEl, 'First name is required.');
    valid = false;
  }
  if (!validateRequired(data.lastName) && lastNameEl) {
    showFieldError(lastNameEl, 'Last name is required.');
    valid = false;
  }
  if (data.email && !validateEmail(data.email) && emailEl) {
    showFieldError(emailEl, 'Enter a valid email address.');
    valid = false;
  }
  return valid;
}

// ─── Verification Status ──────────────────────────────────────────────────────
function renderVerificationStatus(status) {
  if (!verifyBadge) return;
  const statusMap = {
    UNVERIFIED:       { label: 'Not Verified',          cls: 'badge--gray' },
    PENDING:          { label: 'Verification Pending',   cls: 'badge--yellow' },
    VERIFIED:         { label: 'Verified',               cls: 'badge--green' },
    REJECTED:         { label: 'Verification Rejected',  cls: 'badge--red' },
    NEEDS_CORRECTION: { label: 'Correction Required',    cls: 'badge--orange' },
  };
  const s = statusMap[status] || { label: status || 'Unverified', cls: 'badge--gray' };
  verifyBadge.className = `badge ${s.cls}`;
  verifyBadge.textContent = s.label;
}
