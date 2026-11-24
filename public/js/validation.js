'use strict';

export function validateMobile(mobile) {
  // Support India (+91) only: +91 followed by 10 digits starting with 6, 7, 8, or 9
  const cleaned = String(mobile || '').replace(/[\s\-\(\)]/g, '');
  return /^\+91[6-9]\d{9}$/.test(cleaned);
}

export function normalizeMobile(countryCode, number) {
  const trimmed = String(number || '').trim().replace(/[\s\-\(\)]/g, '');
  if (trimmed.startsWith('+91')) {
    return trimmed;
  }
  if (trimmed.startsWith('+')) {
    return trimmed; // Kept intact so server-side can explicitly reject non-Indian country codes
  }
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.startsWith('91') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return `+91${digits.slice(1)}`;
  }
  return `+91${digits}`;
}

export function validateOtp(otp) {
  return /^\d{6}$/.test(otp);
}

export function validateEmail(email) {
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateRequired(value) {
  return value != null && String(value).trim() !== '';
}

export function checkPasswordRules(password) {
  const pwd = String(password || '');
  const minLength = pwd.length >= 8;
  const hasUppercase = /[A-Z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pwd);
  return {
    minLength,
    hasUppercase,
    hasNumber,
    hasSpecial,
    isValid: minLength && hasUppercase && hasNumber && hasSpecial,
  };
}

export function showFieldError(field, message) {
  const formGroup = field.closest('.form-group') || field.parentElement;
  field.setAttribute('aria-invalid', 'true');
  let errorEl = formGroup.querySelector('.field-error');
  if (!errorEl) {
    errorEl = document.createElement('p');
    errorEl.className = 'field-error';
    errorEl.setAttribute('role', 'alert');
    errorEl.id = `${field.id || field.name}-error`;
    field.setAttribute('aria-describedby', errorEl.id);
    formGroup.appendChild(errorEl);
  }
  errorEl.textContent = message;
  field.classList.add('input--error');
}

export function clearFieldError(field) {
  const formGroup = field.closest('.form-group') || field.parentElement;
  field.removeAttribute('aria-invalid');
  field.classList.remove('input--error');
  const errorEl = formGroup.querySelector('.field-error');
  if (errorEl) errorEl.textContent = '';
}

export function clearAllErrors(form) {
  form.querySelectorAll('.input--error').forEach(el => el.classList.remove('input--error'));
  form.querySelectorAll('.field-error').forEach(el => el.textContent = '');
}
