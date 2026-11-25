'use strict';
import { getUser, requireAuth } from '../auth.js';
import { api } from '../api.js';
import { initTheme } from '../theme.js';
import { initNavigation, renderHeaderUser } from '../navigation.js';
import { updateUnreadCount, showError, showSuccess } from '../notifications.js';
import { validateEmail, validateRequired, showFieldError, clearAllErrors } from '../validation.js';
import { escapeHtml, setLoading } from '../utils.js';
import { computeVolunteerCompletion, renderCompletionWidget } from '../profileCompletion.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const form                = document.getElementById('profile-form');
const completionContainer = document.getElementById('profile-completion-container');
const verifyBadge         = document.getElementById('verify-badge');
const editProfileBtn      = document.getElementById('edit-profile-btn');
const saveStatusIndicator = document.getElementById('save-status-indicator');
const changePasswordBtn   = document.getElementById('change-password-btn');

// Change Password Modal refs
const changePasswordModal = document.getElementById('change-password-modal');
const changePasswordForm  = document.getElementById('change-password-form');
const changePasswordAlert = document.getElementById('change-password-alert');
const changePasswordClose = document.getElementById('change-password-close');
const changePasswordCancel = document.getElementById('change-password-cancel');
const changePasswordSubmit = document.getElementById('change-password-submit');

let _isEditing = false;
let _hasUnsavedChanges = false;
let _autoSaveTimer = null;
let _isSaving = false;
let _pendingSave = false;
let _contactInfo = {};

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

  setupEditToggle();
  setupChangePasswordModal();
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
    _contactInfo = data.contactInfo || {};
    fillForm(profile, data);

    const completion = data.completion || computeVolunteerCompletion(collectFormData());
    _hasUnsavedChanges = false;
    renderCompletionWidget(completionContainer, completion, {
      hasUnsavedChanges: false,
      roleColor: 'var(--color-secondary, #0d9488)',
    });

    renderVerificationStatus(profile.verificationStatus || data.verifications?.[0]?.status);

    // Default view: Read-only mode
    setFormReadOnly(true);
  } catch (err) {
    showError(err.message || 'Failed to load profile.');
  }
}

// ─── Read-only / Edit Mode Toggle ─────────────────────────────────────────────
function setFormReadOnly(readOnly) {
  _isEditing = !readOnly;
  if (!form) return;

  const elements = form.querySelectorAll('input, select, textarea');
  elements.forEach((el) => {
    if (readOnly) {
      el.disabled = true;
      el.style.backgroundColor = 'var(--color-surface-2)';
      el.style.cursor = 'default';
    } else {
      // Check if this is an immutable login identifier
      const primary = _contactInfo.primaryIdentifier;
      const isEmailLogin = primary === 'EMAIL' || _contactInfo.authProvider === 'GOOGLE';
      const isMobileLogin = primary === 'MOBILE';

      if (el.id === 'email' && isEmailLogin) {
        el.disabled = true;
        el.style.backgroundColor = 'var(--color-surface-2)';
      } else if (el.id === 'mobile-display' && isMobileLogin) {
        el.disabled = true;
        el.style.backgroundColor = 'var(--color-surface-2)';
      } else {
        el.disabled = false;
        el.style.backgroundColor = '';
        el.style.cursor = '';
      }
    }
  });
}

function setupEditToggle() {
  if (!editProfileBtn) return;

  editProfileBtn.addEventListener('click', async () => {
    if (!_isEditing) {
      // Switch to editing mode
      setFormReadOnly(false);
      editProfileBtn.textContent = 'Done';
      editProfileBtn.className = 'btn btn--success btn--sm';
      showSaveStatus(null);
    } else {
      // Finalize and switch to read-only mode
      clearAllErrors(form);
      const data = collectFormData();
      if (!validateFormData(data)) {
        showError('Please correct the validation errors before finishing.');
        return;
      }

      // Complete any pending save
      if (_autoSaveTimer) {
        clearTimeout(_autoSaveTimer);
        _autoSaveTimer = null;
      }

      setLoading(editProfileBtn, true, 'Saving…');
      try {
        await executeSave(data);
        setFormReadOnly(true);
        editProfileBtn.textContent = 'Edit Profile';
        editProfileBtn.className = 'btn btn--primary btn--sm';
        showSuccess('Profile changes finalized successfully.');
      } catch (err) {
        showError(err.message || 'Failed to save profile changes. Please retry.');
      } finally {
        setLoading(editProfileBtn, false);
      }
    }
  });
}

// ─── Save Status Indicator ────────────────────────────────────────────────────
function showSaveStatus(status) {
  if (!saveStatusIndicator) return;
  if (!status) {
    saveStatusIndicator.style.display = 'none';
    return;
  }

  saveStatusIndicator.style.display = 'inline-flex';
  if (status === 'saving') {
    saveStatusIndicator.className = 'badge badge--yellow';
    saveStatusIndicator.textContent = 'Saving…';
  } else if (status === 'saved') {
    saveStatusIndicator.className = 'badge badge--green';
    saveStatusIndicator.textContent = 'All changes saved';
    setTimeout(() => {
      if (saveStatusIndicator.textContent === 'All changes saved') {
        saveStatusIndicator.style.display = 'none';
      }
    }, 3000);
  } else if (status === 'error') {
    saveStatusIndicator.className = 'badge badge--red';
    saveStatusIndicator.textContent = 'Unable to save changes. Retry.';
  }
}

// ─── Dynamic Auto-saving ──────────────────────────────────────────────────────
async function triggerAutoSave() {
  if (!_isEditing) return;

  showSaveStatus('saving');
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer);

  _autoSaveTimer = setTimeout(async () => {
    const data = collectFormData();
    // Only auto-save if basic requirements are present
    if (!data.firstName || !data.lastName) {
      showSaveStatus(null);
      return;
    }

    try {
      await executeSave(data);
      showSaveStatus('saved');
    } catch (err) {
      console.error('Auto-save error:', err);
      showSaveStatus('error');
    }
  }, 750);
}

async function executeSave(data) {
  if (_isSaving) {
    _pendingSave = true;
    return;
  }
  _isSaving = true;

  try {
    const { data: updated } = await api.put('/profile', data);
    _hasUnsavedChanges = false;

    renderHeaderUser({
      ...(getUser() || { role: 'VOLUNTEER' }),
      name: updated.profile?.fullName || data.fullName || null,
    });

    const completion = updated.completion || computeVolunteerCompletion(updated.profile || data);
    renderCompletionWidget(completionContainer, completion, {
      hasUnsavedChanges: false,
      roleColor: 'var(--color-secondary, #0d9488)',
    });

    renderVerificationStatus(updated.profile?.verificationStatus || updated.verifications?.[0]?.status);
  } finally {
    _isSaving = false;
    if (_pendingSave) {
      _pendingSave = false;
      await executeSave(collectFormData());
    }
  }
}

// ─── Fill Form ────────────────────────────────────────────────────────────────
function fillForm(profile, responseData = {}) {
  if (!form) return;

  const set = (id, val) => {
    const el = form.querySelector(`#${id}`);
    if (el) el.value = val ?? '';
  };

  // Common fields
  set('first-name',    profile.firstName || (profile.fullName ? profile.fullName.split(' ')[0] : ''));
  set('last-name',     profile.lastName || (profile.fullName ? profile.fullName.split(' ').slice(1).join(' ') : ''));
  set('email',         responseData.email ?? profile.email ?? '');
  set('date-of-birth', profile.dateOfBirth?.substring(0, 10));
  set('gender',        profile.gender);
  set('mobile-display', responseData.mobile ?? profile.mobile ?? '');

  // Address fields
  set('city',          profile.city || profile.address?.city);
  set('available-regions', profile.availableRegions?.join(', ') || (Array.isArray(profile.serviceLocations) ? profile.serviceLocations.join(', ') : ''));

  // Volunteer-specific fields
  set('preferred-languages', profile.preferredLanguages?.join(', ') || (Array.isArray(profile.languages) ? profile.languages.join(', ') : ''));
  set('subjects', Array.isArray(profile.subjects) ? profile.subjects.join(', ') : (profile.subjects || ''));

  // Checkboxes for experience
  const expEl = form.querySelector('#has-experience');
  if (expEl) expEl.checked = !!(profile.hasPreviousExperience || profile.hasPriorExperience || profile.hasScribeExperience);

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
        emailHint.textContent = 'Optional email for volunteer notifications and updates.';
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
        mobileBadge.className = 'badge badge--primary';
        mobileBadge.textContent = 'Required';
      }
      if (mobileHint) {
        mobileHint.textContent = 'Mandatory 10-digit Indian mobile number (+91) for examination commitments.';
      }
    }
  }

  setupLiveProgress();
  setupFormSubmit();
}

// ─── Live Progress ────────────────────────────────────────────────────────────
function setupLiveProgress() {
  if (!form) return;

  const onFieldChange = () => {
    if (!_isEditing) return;
    _hasUnsavedChanges = true;
    const currentData = collectFormData();
    const liveCompletion = computeVolunteerCompletion(currentData);
    renderCompletionWidget(completionContainer, liveCompletion, {
      hasUnsavedChanges: true,
      roleColor: 'var(--color-secondary, #0d9488)',
    });
    triggerAutoSave();
  };

  form.addEventListener('input', onFieldChange);
  form.addEventListener('change', onFieldChange);
}

// ─── Change Password Modal ────────────────────────────────────────────────────
function setupChangePasswordModal() {
  if (!changePasswordModal) return;

  function closeModal() {
    changePasswordModal.hidden = true;
    document.body.style.overflow = '';
    if (changePasswordForm) changePasswordForm.reset();
    if (changePasswordAlert) changePasswordAlert.style.display = 'none';
  }

  if (changePasswordBtn) {
    changePasswordBtn.addEventListener('click', () => {
      changePasswordModal.hidden = false;
      document.body.style.overflow = 'hidden';
      if (changePasswordForm) changePasswordForm.reset();
      if (changePasswordAlert) changePasswordAlert.style.display = 'none';
      const curInput = document.getElementById('current-password');
      if (curInput) curInput.focus();
    });
  }

  if (changePasswordClose) changePasswordClose.addEventListener('click', closeModal);
  if (changePasswordCancel) changePasswordCancel.addEventListener('click', closeModal);

  changePasswordModal.addEventListener('click', (e) => {
    if (e.target === changePasswordModal) closeModal();
  });

  if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (changePasswordAlert) changePasswordAlert.style.display = 'none';

      const currentPassword = document.getElementById('current-password')?.value || '';
      const newPassword = document.getElementById('new-password')?.value || '';
      const confirmPassword = document.getElementById('confirm-new-password')?.value || '';

      if (newPassword !== confirmPassword) {
        if (changePasswordAlert) {
          changePasswordAlert.textContent = 'New password and confirmation password do not match.';
          changePasswordAlert.style.display = 'block';
        }
        return;
      }

      if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
        if (changePasswordAlert) {
          changePasswordAlert.textContent = 'Password must be at least 8 characters long and contain at least one uppercase letter, one number, and one special character.';
          changePasswordAlert.style.display = 'block';
        }
        return;
      }

      setLoading(changePasswordSubmit, true, 'Updating…');
      try {
        await api.post('/auth/set-password', { currentPassword, newPassword });
        showSuccess('Password updated successfully.');
        closeModal();
      } catch (err) {
        if (changePasswordAlert) {
          changePasswordAlert.textContent = err.message || 'Failed to update password. Please check your current password.';
          changePasswordAlert.style.display = 'block';
        }
      } finally {
        setLoading(changePasswordSubmit, false);
      }
    });
  }
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
        ...(getUser() || { role: 'VOLUNTEER' }),
        name: updated.profile?.fullName || data.fullName || null,
      });

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

  const mobileVal = g('mobile-display');
  const canonicalMobile = mobileVal ? (mobileVal.startsWith('+') ? mobileVal : `+91${mobileVal.replace(/[^0-9]/g, '').slice(-10)}`) : undefined;

  return {
    firstName:          g('first-name'),
    lastName:           g('last-name'),
    fullName:           `${g('first-name')} ${g('last-name')}`.trim(),
    email:              g('email'),
    mobile:             canonicalMobile,
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
