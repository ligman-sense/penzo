'use strict';
import { requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { validateEmail, validateRequired, showFieldError, clearAllErrors } from '../validation.js';
import { escapeHtml, setLoading } from '../utils.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const form            = document.getElementById('profile-form');
const completionBar   = document.getElementById('profile-completion-bar');
const completionLabel = document.getElementById('profile-completion-label');
const verifyBadge     = document.getElementById('verify-badge');

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
})();

// ─── Load Profile ─────────────────────────────────────────────────────────────
async function loadProfile() {
  try {
    const { data } = await api.get('/profile');
    const profile = data.profile || data;
    fillForm(profile);
    renderCompletion(profile.completionPct || 0);
    renderVerificationStatus(profile.verificationStatus);
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
  set('first-name',    profile.firstName);
  set('last-name',     profile.lastName);
  set('email',         profile.email);
  set('date-of-birth', profile.dateOfBirth?.substring(0, 10));
  set('gender',        profile.gender);
  set('mobile-display', profile.mobile);

  // Address fields
  set('address-line1', profile.address?.line1);
  set('address-line2', profile.address?.line2);
  set('city',          profile.address?.city);
  set('state',         profile.address?.state);
  set('pincode',       profile.address?.pincode);

  // ID proof
  set('id-type',       profile.idProof?.type);
  set('id-number',     profile.idProof?.number);

  // Volunteer-specific fields
  set('qualification',       profile.qualification);
  set('institution',         profile.institution);
  set('year-of-study',       profile.yearOfStudy);
  set('preferred-languages', profile.preferredLanguages?.join(', ') || '');
  set('available-regions',   profile.availableRegions?.join(', ') || '');

  // Checkboxes for experience
  const expEl = form.querySelector('#has-experience');
  if (expEl) expEl.checked = !!profile.hasPreviousExperience;

  setupFormSubmit();
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
      renderCompletion(updated.profile?.completionPct || updated.completionPct || 0);
      renderVerificationStatus(updated.profile?.verificationStatus || updated.verificationStatus);
    } catch (err) {
      if (err.details) {
        err.details.forEach(d => {
          const fieldEl = form.querySelector(`[name="${d.field}"], #${d.field}`);
          if (fieldEl) showFieldError(fieldEl, d.message);
        });
      }
      showError(err.message || 'Failed to save profile.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

function collectFormData() {
  const g = (id) => form.querySelector(`#${id}`)?.value.trim() || '';
  const langStr   = g('preferred-languages');
  const regionStr = g('available-regions');

  return {
    firstName:      g('first-name'),
    lastName:       g('last-name'),
    email:          g('email'),
    dateOfBirth:    g('date-of-birth'),
    gender:         g('gender'),
    qualification:  g('qualification'),
    institution:    g('institution'),
    yearOfStudy:    g('year-of-study'),
    hasPreviousExperience: form.querySelector('#has-experience')?.checked || false,
    preferredLanguages: langStr ? langStr.split(',').map(s => s.trim()).filter(Boolean) : [],
    availableRegions:   regionStr ? regionStr.split(',').map(s => s.trim()).filter(Boolean) : [],
    address: {
      line1:   g('address-line1'),
      line2:   g('address-line2'),
      city:    g('city'),
      state:   g('state'),
      pincode: g('pincode'),
    },
    idProof: {
      type:   g('id-type'),
      number: g('id-number'),
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
  if (!validateEmail(data.email) && emailEl) {
    showFieldError(emailEl, 'Enter a valid email address.');
    valid = false;
  }
  return valid;
}

// ─── Completion & Verification ────────────────────────────────────────────────
function renderCompletion(pct) {
  if (completionBar) {
    completionBar.style.width = `${pct}%`;
    completionBar.setAttribute('aria-valuenow', pct);
  }
  if (completionLabel) {
    completionLabel.textContent = `Profile ${pct}% complete`;
  }
}

function renderVerificationStatus(status) {
  if (!verifyBadge) return;
  const statusMap = {
    UNVERIFIED:       { label: 'Not Verified',          cls: 'badge--gray' },
    PENDING:          { label: 'Verification Pending',   cls: 'badge--yellow' },
    VERIFIED:         { label: 'Verified',               cls: 'badge--green' },
    REJECTED:         { label: 'Verification Rejected',  cls: 'badge--red' },
    NEEDS_CORRECTION: { label: 'Correction Required',    cls: 'badge--orange' },
  };
  const s = statusMap[status] || { label: status || 'Unknown', cls: 'badge--gray' };
  verifyBadge.className = `badge ${s.cls}`;
  verifyBadge.textContent = s.label;
}
