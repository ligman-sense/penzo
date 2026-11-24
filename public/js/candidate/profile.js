'use strict';
import { getUser, requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation, renderHeaderUser } from '../navigation.js';
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
    fillForm(profile, data);

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
function fillForm(profile, responseData = {}) {
  if (!form) return;

  const set = (id, val) => {
    const el = form.querySelector(`#${id}`);
    if (el) el.value = val ?? '';
  };

  set('first-name',      profile.firstName || (profile.fullName ? profile.fullName.split(' ')[0] : ''));
  set('last-name',       profile.lastName || (profile.fullName ? profile.fullName.split(' ').slice(1).join(' ') : ''));
  set('email',           responseData.email ?? profile.email ?? '');
  set('date-of-birth',   profile.dateOfBirth ? String(profile.dateOfBirth).substring(0, 10) : '');
  set('gender',          profile.gender);

  // Qualification and Currently Pursuing population
  const qual = profile.qualification || profile.education || '';
  const qualSelect = form.querySelector('#qualification');
  const qualOtherGroup = form.querySelector('#qualification-other-group');
  const qualOtherInput = form.querySelector('#qualification-other');

  if (qualSelect) {
    const knownQuals = Array.from(qualSelect.options).map(o => o.value);
    if (knownQuals.includes(qual)) {
      qualSelect.value = qual;
      if (qualOtherGroup) qualOtherGroup.style.display = 'none';
    } else if (qual) {
      qualSelect.value = 'Other';
      if (qualOtherGroup) qualOtherGroup.style.display = 'block';
      if (qualOtherInput) qualOtherInput.value = qual;
    }
  }

  const pursuing = profile.currentlyPursuing || '';
  const pursuingSelect = form.querySelector('#currently-pursuing');
  const pursuingOtherGroup = form.querySelector('#currently-pursuing-other-group');
  const pursuingOtherInput = form.querySelector('#currently-pursuing-other');

  if (pursuingSelect) {
    const knownPursuing = Array.from(pursuingSelect.options).map(o => o.value);
    if (knownPursuing.includes(pursuing)) {
      pursuingSelect.value = pursuing;
      if (pursuingOtherGroup) pursuingOtherGroup.style.display = 'none';
    } else if (pursuing) {
      pursuingSelect.value = 'Other';
      if (pursuingOtherGroup) pursuingOtherGroup.style.display = 'block';
      if (pursuingOtherInput) pursuingOtherInput.value = pursuing;
    }
  }

  updateQualificationRequirement();

  set('languages',       Array.isArray(profile.languages) ? profile.languages.join(', ') : (profile.languages || ''));
  set('disability-type', profile.disabilityType || profile.assistanceNeeds || '');
  set('mobile-display',  responseData.mobile ?? profile.mobile ?? '');

  // Address fields
  set('city',            profile.city || profile.address?.city);
  set('state',           profile.state || profile.address?.state);
  set('pincode',         profile.pincode || profile.address?.pincode);

  // Contact fields & Login Identifier rendering
  const contactInfo = responseData.contactInfo || {};
  const emailInput = form.querySelector('#email');
  const mobileInput = form.querySelector('#mobile-display');
  const emailBadge = document.getElementById('email-status-badge');
  const mobileBadge = document.getElementById('mobile-status-badge');
  const emailHint = document.getElementById('email-hint');
  const mobileHint = document.getElementById('mobile-hint');

  const primary = contactInfo.primaryIdentifier || (contactInfo.authProvider === 'GOOGLE' ? 'GOOGLE' : (responseData.email ? 'EMAIL' : 'MOBILE'));
  const isEmailLogin = primary === 'EMAIL' || contactInfo.authProvider === 'GOOGLE';
  const isMobileLogin = primary === 'MOBILE';

  if (emailInput) {
    emailInput.value = responseData.email || profile.email || '';
    if (isEmailLogin) {
      emailInput.readOnly = true;
      emailInput.setAttribute('aria-readonly', 'true');
      emailInput.style.backgroundColor = 'var(--color-surface-2)';
      if (emailBadge) {
        emailBadge.className = 'badge badge--primary';
        emailBadge.textContent = contactInfo.authProvider === 'GOOGLE' ? 'Google Login (Required)' : 'Login Identifier (Required)';
      }
      if (emailHint) {
        emailHint.textContent = contactInfo.authProvider === 'GOOGLE'
          ? 'Managed by your Google account.'
          : 'Your registered account login identifier (cannot be removed).';
      }
    } else {
      emailInput.readOnly = false;
      emailInput.removeAttribute('aria-readonly');
      emailInput.style.backgroundColor = '';
      if (emailBadge) {
        emailBadge.className = 'badge badge--gray';
        emailBadge.textContent = 'Optional';
      }
      if (emailHint) {
        emailHint.textContent = 'Optional email for exam notifications and updates.';
      }
    }
  }

  if (mobileInput) {
    const rawMobile = (responseData.mobile || profile.mobile || '').replace(/^\+91/, '');
    mobileInput.value = rawMobile;
    if (isMobileLogin) {
      mobileInput.readOnly = true;
      mobileInput.setAttribute('aria-readonly', 'true');
      mobileInput.style.backgroundColor = 'var(--color-surface-2)';
      if (mobileBadge) {
        mobileBadge.className = 'badge badge--primary';
        mobileBadge.textContent = 'Login Identifier (Required)';
      }
      if (mobileHint) {
        mobileHint.textContent = 'Your registered mobile login identifier (cannot be removed).';
      }
    } else {
      mobileInput.readOnly = false;
      mobileInput.removeAttribute('aria-readonly');
      mobileInput.style.backgroundColor = '';
      if (mobileBadge) {
        mobileBadge.className = 'badge badge--gray';
        mobileBadge.textContent = 'Optional';
      }
      if (mobileHint) {
        mobileHint.textContent = 'Optional 10-digit Indian mobile number (+91).';
      }
    }
  }

  setupLiveProgress();
  setupFormSubmit();
}

function updateQualificationRequirement() {
  const pursuingVal = getEffectiveCurrentlyPursuing();
  const indicator = document.getElementById('qualification-required-indicator');
  const helpText = document.getElementById('qualification-help-text');
  const hasPursuing = Boolean(pursuingVal && pursuingVal !== 'Not Currently Pursuing Any Course');

  if (indicator) {
    indicator.style.display = hasPursuing ? 'none' : 'inline';
  }
  if (helpText) {
    helpText.textContent = hasPursuing
      ? 'Currently pursuing is specified; completed qualification is optional.'
      : 'Mandatory if not currently pursuing any course.';
  }
}

function getEffectiveQualification() {
  const qualSelect = form.querySelector('#qualification');
  const qualOther = form.querySelector('#qualification-other')?.value.trim() || '';
  if (qualSelect?.value === 'Other') return qualOther;
  return qualSelect?.value || '';
}

function getEffectiveCurrentlyPursuing() {
  const pursuingSelect = form.querySelector('#currently-pursuing');
  const pursuingOther = form.querySelector('#currently-pursuing-other')?.value.trim() || '';
  if (pursuingSelect?.value === 'Other') return pursuingOther;
  return pursuingSelect?.value || '';
}

// ─── Live Progress ────────────────────────────────────────────────────────────
function setupLiveProgress() {
  if (!form) return;

  const qualSelect = form.querySelector('#qualification');
  const qualOtherGroup = form.querySelector('#qualification-other-group');
  const pursuingSelect = form.querySelector('#currently-pursuing');
  const pursuingOtherGroup = form.querySelector('#currently-pursuing-other-group');

  qualSelect?.addEventListener('change', () => {
    if (qualOtherGroup) {
      qualOtherGroup.style.display = qualSelect.value === 'Other' ? 'block' : 'none';
      if (qualSelect.value === 'Other') form.querySelector('#qualification-other')?.focus();
    }
    updateQualificationRequirement();
  });

  pursuingSelect?.addEventListener('change', () => {
    if (pursuingOtherGroup) {
      pursuingOtherGroup.style.display = pursuingSelect.value === 'Other' ? 'block' : 'none';
      if (pursuingSelect.value === 'Other') form.querySelector('#currently-pursuing-other')?.focus();
    }
    updateQualificationRequirement();
  });

  const onFieldChange = () => {
    _hasUnsavedChanges = true;
    updateQualificationRequirement();
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

      renderHeaderUser({
        ...(getUser() || { role: 'CANDIDATE' }),
        name: updated.profile?.fullName || data.fullName || null,
      });

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
  const qual = getEffectiveQualification();
  const pursuing = getEffectiveCurrentlyPursuing();

  const mobileVal = g('mobile-display');
  const canonicalMobile = mobileVal ? (mobileVal.startsWith('+') ? mobileVal : `+91${mobileVal.replace(/[^0-9]/g, '').slice(-10)}`) : undefined;

  return {
    firstName:         g('first-name'),
    lastName:          g('last-name'),
    fullName:          `${g('first-name')} ${g('last-name')}`.trim(),
    email:             g('email'),
    mobile:            canonicalMobile,
    dateOfBirth:       g('date-of-birth'),
    gender:            g('gender'),
    qualification:     qual,
    currentlyPursuing: pursuing,
    education:         qual || (pursuing !== 'Not Currently Pursuing Any Course' ? pursuing : ''),
    languages:         langStr ? langStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
    disabilityType:    g('disability-type'),
    assistanceNeeds:   g('disability-type'),
    city:              g('city'),
    state:             g('state'),
    pincode:           g('pincode'),
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
  const qualEl      = form.querySelector('#qualification');
  const qualOtherEl = form.querySelector('#qualification-other');

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

  // Conditional Qualification / Currently Pursuing validation
  const hasPursuing = Boolean(data.currentlyPursuing && data.currentlyPursuing !== 'Not Currently Pursuing Any Course');
  const hasQual = Boolean(data.qualification);

  if (!hasPursuing && !hasQual) {
    const targetEl = (qualEl?.value === 'Other' && qualOtherEl) ? qualOtherEl : qualEl;
    if (targetEl) {
      showFieldError(targetEl, 'Please provide your completed Qualification or specify what course you are Currently Pursuing.');
    }
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
