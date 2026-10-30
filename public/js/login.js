'use strict';
import { api, setCsrfToken } from './api.js';
import { redirectIfAuthenticated } from './auth.js';
import { initTheme } from './theme.js';
import { validateMobile, validateOtp, normalizeMobile, showFieldError, clearFieldError, clearAllErrors } from './validation.js';
import { showError, showSuccess } from './notifications.js';
import { setLoading, hideElement, showElement } from './utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _mobile = '';
let _resendCooldown = null;
const RESEND_COOLDOWN_SECS = 60;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const stepPhone = document.getElementById('step-phone');
const stepOtp   = document.getElementById('step-otp');
const stepRole  = document.getElementById('step-role');

const phoneForm      = document.getElementById('phone-form');
const otpForm        = document.getElementById('otp-form');
const roleForm       = document.getElementById('role-form');

const countryCodeSel = document.getElementById('country-code');
const phoneInput     = document.getElementById('phone-number');
const otpInput       = document.getElementById('otp-code');
const mobileDisplay  = document.getElementById('mobile-display');
const resendBtn      = document.getElementById('resend-otp');
const countdownEl    = document.getElementById('resend-countdown');
const editPhoneBtn   = document.getElementById('edit-phone');

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  initTheme();
  await redirectIfAuthenticated();
  showStep('phone');
  setupPhoneForm();
  setupOtpForm();
  setupRoleForm();
  setupDemoButtons();
  if (editPhoneBtn) editPhoneBtn.addEventListener('click', () => showStep('phone'));
  if (resendBtn) resendBtn.addEventListener('click', handleResend);
})();

// ─── Steps ────────────────────────────────────────────────────────────────────
function showStep(step) {
  [stepPhone, stepOtp, stepRole].forEach(el => { if (el) el.hidden = true; });
  if (step === 'phone' && stepPhone) stepPhone.hidden = false;
  if (step === 'otp'   && stepOtp)   stepOtp.hidden   = false;
  if (step === 'role'  && stepRole)  stepRole.hidden   = false;
}

// ─── Step 1: Phone ────────────────────────────────────────────────────────────
function setupPhoneForm() {
  if (!phoneForm) return;
  phoneForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors(phoneForm);

    const countryCode = countryCodeSel?.value || '91';
    const rawNumber   = phoneInput?.value.trim() || '';

    if (!rawNumber) {
      showFieldError(phoneInput, 'Phone number is required.');
      return;
    }

    const mobile = normalizeMobile(countryCode, rawNumber);
    if (!validateMobile(mobile)) {
      showFieldError(phoneInput, 'Enter a valid phone number.');
      return;
    }

    const submitBtn = phoneForm.querySelector('[type="submit"]');
    setLoading(submitBtn, true, 'Sending OTP…');

    try {
      const { data } = await api.post('/auth/otp/send', { mobile });
      if (data.csrfToken) setCsrfToken(data.csrfToken);
      _mobile = mobile;
      if (mobileDisplay) mobileDisplay.textContent = mobile;
      showStep('otp');
      startResendCooldown();
      if (data.devCode) {
        if (otpInput) otpInput.value = data.devCode;
        showSuccess(`Development OTP received: ${data.devCode}`);
      }
      otpInput?.focus();
    } catch (err) {
      showError(err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

// ─── Step 2: OTP ─────────────────────────────────────────────────────────────
function setupOtpForm() {
  if (!otpForm) return;
  otpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors(otpForm);

    const otp = otpInput?.value.trim() || '';
    if (!validateOtp(otp)) {
      showFieldError(otpInput, 'Enter the 6-digit OTP sent to your phone.');
      return;
    }

    const submitBtn = otpForm.querySelector('[type="submit"]');
    setLoading(submitBtn, true, 'Verifying…');

    try {
      const { data } = await api.post('/auth/otp/verify', { mobile: _mobile, otp });
      if (data.csrfToken) setCsrfToken(data.csrfToken);

      if (data.isNewUser) {
        // New user — ask for role selection
        showStep('role');
      } else {
        // Existing user — redirect based on role
        redirectByRole(data.user?.role);
      }
    } catch (err) {
      if (err.code === 'OTP_INVALID' || err.code === 'OTP_EXPIRED') {
        showFieldError(otpInput, err.message || 'Invalid or expired OTP. Please try again.');
      } else {
        showError(err.message || 'Verification failed. Please try again.');
      }
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

// ─── Step 3: Role Selection ───────────────────────────────────────────────────
function setupRoleForm() {
  if (!roleForm) return;
  roleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors(roleForm);

    const roleInput = roleForm.querySelector('input[name="role"]:checked');
    if (!roleInput) {
      showError('Please select a role to continue.');
      return;
    }

    const submitBtn = roleForm.querySelector('[type="submit"]');
    setLoading(submitBtn, true, 'Setting up account…');

    try {
      const { data } = await api.post('/auth/register', { mobile: _mobile, role: roleInput.value });
      if (data.csrfToken) setCsrfToken(data.csrfToken);
      showSuccess('Account created! Redirecting…');
      setTimeout(() => redirectByRole(roleInput.value), 1000);
    } catch (err) {
      showError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

// ─── Resend OTP ───────────────────────────────────────────────────────────────
async function handleResend() {
  if (!_mobile) return;
  if (resendBtn) resendBtn.disabled = true;

  try {
    const { data } = await api.post('/auth/otp/send', { mobile: _mobile });
    if (data.csrfToken) setCsrfToken(data.csrfToken);
    if (data.devCode) {
      if (otpInput) otpInput.value = data.devCode;
      showSuccess(`Development OTP received: ${data.devCode}`);
    } else {
      showSuccess('OTP resent!');
    }
    startResendCooldown();
  } catch (err) {
    showError(err.message || 'Failed to resend OTP.');
    if (resendBtn) resendBtn.disabled = false;
  }
}

function setupDemoButtons() {
  const candidateBtn = document.getElementById('demo-candidate-btn');
  const volunteerBtn = document.getElementById('demo-volunteer-btn');

  async function loginAsDemo(mobile, role) {
    try {
      if (candidateBtn) candidateBtn.disabled = true;
      if (volunteerBtn) volunteerBtn.disabled = true;

      const { data: sendData } = await api.post('/auth/otp/send', { mobile });
      if (sendData.csrfToken) setCsrfToken(sendData.csrfToken);

      const code = sendData.devCode;
      if (!code) {
        _mobile = mobile;
        if (mobileDisplay) mobileDisplay.textContent = mobile;
        showStep('otp');
        startResendCooldown();
        return;
      }

      const { data: verifyData } = await api.post('/auth/otp/verify', {
        mobile,
        otp: code,
        role,
      });
      if (verifyData.csrfToken) setCsrfToken(verifyData.csrfToken);

      showSuccess(`Logged in as ${role}! Redirecting…`);
      setTimeout(() => redirectByRole(verifyData.user?.role || role), 600);
    } catch (err) {
      showError(err.message || 'Demo login failed');
    } finally {
      if (candidateBtn) candidateBtn.disabled = false;
      if (volunteerBtn) volunteerBtn.disabled = false;
    }
  }

  if (candidateBtn) {
    candidateBtn.addEventListener('click', () => loginAsDemo('+00012345001', 'CANDIDATE'));
  }
  if (volunteerBtn) {
    volunteerBtn.addEventListener('click', () => loginAsDemo('+00012345002', 'VOLUNTEER'));
  }
}

function startResendCooldown() {
  if (_resendCooldown) clearInterval(_resendCooldown);
  let secs = RESEND_COOLDOWN_SECS;
  if (resendBtn) resendBtn.disabled = true;
  if (countdownEl) { countdownEl.textContent = `Resend in ${secs}s`; countdownEl.hidden = false; }

  _resendCooldown = setInterval(() => {
    secs -= 1;
    if (countdownEl) countdownEl.textContent = `Resend in ${secs}s`;
    if (secs <= 0) {
      clearInterval(_resendCooldown);
      _resendCooldown = null;
      if (resendBtn) resendBtn.disabled = false;
      if (countdownEl) countdownEl.hidden = true;
    }
  }, 1000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function redirectByRole(role) {
  if (role === 'CANDIDATE') window.location.href = '/candidate/dashboard.html';
  else if (role === 'VOLUNTEER') window.location.href = '/volunteer/dashboard.html';
  else window.location.href = '/';
}
