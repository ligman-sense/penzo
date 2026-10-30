'use strict';

export function validateMobile(mobile) {
  // Support standard E.164 and demo +000 numbers: + followed by 7-15 digits
  return /^\+\d{7,15}$/.test(String(mobile || '').replace(/\s/g, ''));
}

export function normalizeMobile(countryCode, number) {
  const trimmed = String(number || '').trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/[^0-9]/g, '');
  }
  const cleanCC = String(countryCode || '').replace(/[^0-9]/g, '');
  const cleanNum = trimmed.replace(/[^0-9]/g, '');
  if (cleanCC && cleanNum.startsWith(cleanCC) && cleanNum.length > cleanCC.length + 5) {
    return `+${cleanNum}`;
  }
  return `+${cleanCC}${cleanNum}`;
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
