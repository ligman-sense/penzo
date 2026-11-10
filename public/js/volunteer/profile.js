'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { validateEmail, validateRequired, showFieldError, clearAllErrors } from '../validation.js';
import { escapeHtml, setLoading } from '../utils.js';
import { computeVolunteerCompletion, renderCompletionWidget } from '../profileCompletion.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const form                = document.getElementById('profile-form');
const completionContainer = document.getElementById('profile-completion-container');
const verifyBadge         = document.getElementById('verify-badge');

let _hasUnsavedChanges = false;

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  const user = await requireAuth('/login.html');
  if (!user) return;

  if (user.role !== 'VOLUNTEER') {
    window.location.href = '/candidate/dashboard.html';
    return;
  }

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

    const completion = data.completion || computeVolunteerCompletion(collectFormData());
    _hasUnsavedChanges = false;
    renderCompletionWidget(completionContainer, completion, {
      hasUnsavedChanges: false,
      roleColor: 'var(--color-secondary, #0d9488)',
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

  // Common fields
  set('first-name',    profile.firstName || (profile.fullName ? profile.fullName.split(' ')[0] : ''));
  set('last-name',     profile.lastName || (profile.fullName ? profile.fullName.split(' ').slice(1).join(' ') : ''));
  set('email',         profile.email);
  set('date-of-birth', profile.dateOfBirth?.substring(0, 10));
  set('gender',        profile.gender);
  set('mobile-display', profile.mobile);

  // Address fields
  set('city',          profile.city || profile.address?.city);
  set('available-regions', profile.availableRegions?.join(', ') || (Array.isArray(profile.serviceLocations) ? profile.serviceLocations.join(', ') : ''));

  // Volunteer-specific fields
  set('preferred-languages', profile.preferredLanguages?.join(', ') || (Array.isArray(profile.languages) ? profile.languages.join(', ') : ''));
  set('subjects', Array.isArray(profile.subjects) ? profile.subjects.join(', ') : (profile.subjects || ''));

  // Checkboxes for experience
  const expEl = form.querySelector('#has-experience');
  if (expEl) expEl.checked = !!(profile.hasPreviousExperience || profile.hasPriorExperience || profile.hasScribeExperience);

  setupLiveProgress();
  setupFormSubmit();
}

// ─── Live Progress ────────────────────────────────────────────────────────────
function setupLiveProgress() {
  if (!form) return;

  const onFieldChange = () => {
    _hasUnsavedChanges = true;
    const currentData = collectFormData();
    const liveCompletion = computeVolunteerCompletion(currentData);
    renderCompletionWidget(completionContainer, liveCompletion, {
      hasUnsavedChanges: true,
      roleColor: 'var(--color-secondary, #0d9488)',
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

      const completion = updated.completion || computeVolunteerCompletion(updated.profile || data);
      renderCompletionWidget(completionContainer, completion, {
        hasUnsavedChanges: false,
        roleColor: 'var(--color-secondary, #0d9488)',
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
  const langStr   = g('preferred-languages');
  const subjStr   = g('subjects');
  const regionStr = g('available-regions');

  return {
    firstName:          g('first-name'),
    lastName:           g('last-name'),
    fullName:           `${g('first-name')} ${g('last-name')}`.trim(),
    email:              g('email'),
    dateOfBirth:        g('date-of-birth'),
    gender:             g('gender'),
    hasPreviousExperience: form.querySelector('#has-experience')?.checked || false,
    hasPriorExperience:    form.querySelector('#has-experience')?.checked || false,
    languages:          langStr ? langStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
    preferredLanguages: langStr ? langStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
    subjects:           subjStr ? subjStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
    serviceLocations:   regionStr ? regionStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
    availableRegions:   regionStr ? regionStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
    city:               g('city'),
    address: {
      city: g('city'),
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
