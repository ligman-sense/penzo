'use strict';
import { api, setCsrfToken } from './api.js';
import { redirectIfAuthenticated } from './auth.js';
import { initTheme } from './theme.js';
import {
  validateMobile,
  normalizeMobile,
  validateEmail,
  checkPasswordRules,
  showFieldError,
  clearFieldError,
  clearAllErrors,
} from './validation.js';
import { showError, showSuccess } from './notifications.js';
import { setLoading } from './utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let _mode = 'signin'; // 'signin' | 'register'
let _identifierType = 'EMAIL'; // 'EMAIL' | 'MOBILE'

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const stepAuth = document.getElementById('step-auth');
const stepRole = document.getElementById('step-role');

const tabSignIn = document.getElementById('tab-signin');
const tabRegister = document.getElementById('tab-register');

const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authSubmitBtn = document.getElementById('auth-submit-btn');

const typeEmailBtn = document.getElementById('type-email-btn');
const typeMobileBtn = document.getElementById('type-mobile-btn');

const emailFieldGroup = document.getElementById('email-field-group');
const mobileFieldGroup = document.getElementById('mobile-field-group');
const registerRoleSection = document.getElementById('register-role-section');
const registerNameSection = document.getElementById('register-name-section');

const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authMobile = document.getElementById('auth-mobile');
const authPassword = document.getElementById('auth-password');
const authName = document.getElementById('auth-name');

const togglePasswordBtn = document.getElementById('toggle-password-btn');
const eyeIcon = document.getElementById('eye-icon');

const passwordRequirements = document.getElementById('password-requirements');
const ruleLength = document.getElementById('rule-length');
const ruleUpper = document.getElementById('rule-upper');
const ruleNumber = document.getElementById('rule-number');
const ruleSpecial = document.getElementById('rule-special');

const roleForm = document.getElementById('role-form');

const forgotPasswordLink = document.getElementById('forgot-password-link');
const stepForgot = document.getElementById('step-forgot');
const forgotTitle = document.getElementById('forgot-title');
const forgotSubtitle = document.getElementById('forgot-subtitle');

const forgotEmailForm = document.getElementById('forgot-email-form');
const forgotEmail = document.getElementById('forgot-email');
const forgotSendBtn = document.getElementById('forgot-send-btn');

const forgotOtpForm = document.getElementById('forgot-otp-form');
const forgotOtp = document.getElementById('forgot-otp');
const forgotVerifyBtn = document.getElementById('forgot-verify-btn');
const forgotResendBtn = document.getElementById('forgot-resend-btn');
const resendCountdown = document.getElementById('resend-countdown');

const forgotPasswordForm = document.getElementById('forgot-password-form');
const forgotNewPassword = document.getElementById('forgot-new-password');
const toggleForgotPasswordBtn = document.getElementById('toggle-forgot-password-btn');
const forgotConfirmPassword = document.getElementById('forgot-confirm-password');
const forgotResetBtn = document.getElementById('forgot-reset-btn');

const forgotRuleLength = document.getElementById('forgot-rule-length');
const forgotRuleUpper = document.getElementById('forgot-rule-upper');
const forgotRuleNumber = document.getElementById('forgot-rule-number');
const forgotRuleSpecial = document.getElementById('forgot-rule-special');

const backToSigninBtn = document.getElementById('back-to-signin-btn');

let _resetEmail = '';
let _resetToken = '';
let _resendTimer = null;
let _resendSecondsRemaining = 60;

// ─── Initialization ───────────────────────────────────────────────────────────
(async () => {
  initTheme();

  // Handle URL query parameters (OAuth callback / errors)
  const urlParams = new URLSearchParams(window.location.search);
  const errorParam = urlParams.get('error');
  const oauthParam = urlParams.get('oauth');

  if (errorParam) {
    showError(decodeURIComponent(errorParam));
  }

  if (oauthParam === 'new_user') {
    // New Google OAuth user needs to select role
    if (stepAuth) stepAuth.hidden = true;
    if (stepRole) stepRole.hidden = false;
    setupRoleForm();
    showSuccess('Welcome! Please select your role to complete setting up your account.');
    return;
  }

  await redirectIfAuthenticated();

  setupTabs();
  setupIdentifierToggle();
  setupPasswordToggle();
  setupLivePasswordCheck();
  setupAuthForm();
  setupRoleForm();
  setupForgotPassword();
})();

// ─── Tab Switching (Sign In / Register) ────────────────────────────────────────
function setupTabs() {
  if (!tabSignIn || !tabRegister) return;

  tabSignIn.addEventListener('click', () => setMode('signin'));
  tabRegister.addEventListener('click', () => setMode('register'));
}

function setMode(mode) {
  _mode = mode;
  clearAllErrors(authForm);

  if (mode === 'signin') {
    tabSignIn.className = 'btn btn--sm btn--primary';
    tabSignIn.setAttribute('aria-selected', 'true');
    tabRegister.className = 'btn btn--sm btn--ghost';
    tabRegister.setAttribute('aria-selected', 'false');

    authTitle.textContent = 'Sign In to PENZO';
    authSubtitle.textContent = 'Enter your email or mobile number with your password.';
    authSubmitBtn.textContent = 'Sign In';

    registerRoleSection.style.display = 'none';
    registerNameSection.style.display = 'none';
    passwordRequirements.style.display = 'none';
    if (forgotPasswordLink) forgotPasswordLink.style.display = 'inline';
  } else {
    tabRegister.className = 'btn btn--sm btn--primary';
    tabRegister.setAttribute('aria-selected', 'true');
    tabSignIn.className = 'btn btn--sm btn--ghost';
    tabSignIn.setAttribute('aria-selected', 'false');

    authTitle.textContent = 'Create Your PENZO Account';
    authSubtitle.textContent = 'Choose your role, identifier, and set a secure password.';
    authSubmitBtn.textContent = 'Create Account';

    registerRoleSection.style.display = 'block';
    registerNameSection.style.display = 'block';
    passwordRequirements.style.display = 'block';
    if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';

    updateLivePasswordCheck(authPassword.value);
  }
}

// ─── Identifier Switching (Email / Mobile) ────────────────────────────────────
function setupIdentifierToggle() {
  if (!typeEmailBtn || !typeMobileBtn) return;

  typeEmailBtn.addEventListener('click', () => setIdentifierType('EMAIL'));
  typeMobileBtn.addEventListener('click', () => setIdentifierType('MOBILE'));
}

function setIdentifierType(type) {
  _identifierType = type;
  clearAllErrors(authForm);

  if (type === 'EMAIL') {
    typeEmailBtn.className = 'btn btn--sm btn--secondary';
    typeEmailBtn.setAttribute('aria-pressed', 'true');
    typeMobileBtn.className = 'btn btn--sm btn--ghost';
    typeMobileBtn.setAttribute('aria-pressed', 'false');

    emailFieldGroup.style.display = 'block';
    mobileFieldGroup.style.display = 'none';
    authEmail.focus();
  } else {
    typeMobileBtn.className = 'btn btn--sm btn--secondary';
    typeMobileBtn.setAttribute('aria-pressed', 'true');
    typeEmailBtn.className = 'btn btn--sm btn--ghost';
    typeEmailBtn.setAttribute('aria-pressed', 'false');

    mobileFieldGroup.style.display = 'block';
    emailFieldGroup.style.display = 'none';
    authMobile.focus();
  }
}

// ─── Password Show/Hide Toggle ────────────────────────────────────────────────
function setupPasswordToggle() {
  if (!togglePasswordBtn || !authPassword) return;

  togglePasswordBtn.addEventListener('click', () => {
    const isPassword = authPassword.type === 'password';
    authPassword.type = isPassword ? 'text' : 'password';
    if (eyeIcon) eyeIcon.textContent = isPassword ? '🙈' : '👁️';
    togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  });
}

// ─── Live Password Rule Checking ──────────────────────────────────────────────
function setupLivePasswordCheck() {
  if (!authPassword) return;

  authPassword.addEventListener('input', () => {
    if (_mode === 'register') {
      updateLivePasswordCheck(authPassword.value);
    }
  });
}

function updateLivePasswordCheck(password) {
  const rules = checkPasswordRules(password);

  updateRuleElement(ruleLength, rules.minLength, 'At least 8 characters');
  updateRuleElement(ruleUpper, rules.hasUppercase, 'At least 1 uppercase letter (A-Z)');
  updateRuleElement(ruleNumber, rules.hasNumber, 'At least 1 number (0-9)');
  updateRuleElement(ruleSpecial, rules.hasSpecial, 'At least 1 special character (!@#$%^&*...)');
}

function updateRuleElement(el, passed, text) {
  if (!el) return;
  if (passed) {
    el.style.color = 'var(--color-success, #16a34a)';
    el.innerHTML = `<span class="rule-icon" style="font-weight: bold;">✓</span> ${text}`;
  } else {
    el.style.color = 'var(--color-text-muted, #64748b)';
    el.innerHTML = `<span class="rule-icon">○</span> ${text}`;
  }
}

// ─── Main Auth Form Handling ──────────────────────────────────────────────────
function setupAuthForm() {
  if (!authForm) return;

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors(authForm);

    let identifier = '';
    if (_identifierType === 'EMAIL') {
      const email = authEmail?.value.trim() || '';
      if (!email) {
        showFieldError(authEmail, 'Email address is required.');
        authEmail?.focus();
        return;
      }
      if (!validateEmail(email)) {
        showFieldError(authEmail, 'Please enter a valid email address.');
        authEmail?.focus();
        return;
      }
      identifier = email;
    } else {
      const rawMobile = authMobile?.value.trim() || '';
      if (!rawMobile) {
        showFieldError(authMobile, 'Mobile number is required.');
        authMobile?.focus();
        return;
      }
      const canonical = normalizeMobile('91', rawMobile);
      if (!validateMobile(canonical)) {
        showFieldError(authMobile, 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
        authMobile?.focus();
        return;
      }
      identifier = canonical;
    }

    const password = authPassword?.value || '';
    if (!password) {
      showFieldError(authPassword, 'Password is required.');
      authPassword?.focus();
      return;
    }

    if (_mode === 'register') {
      const rules = checkPasswordRules(password);
      if (!rules.isValid) {
        showFieldError(authPassword, 'Password does not meet the security requirements.');
        authPassword?.focus();
        return;
      }

      const roleInput = authForm.querySelector('input[name="auth-role"]:checked');
      const role = roleInput?.value || 'CANDIDATE';
      const name = authName?.value.trim() || undefined;

      setLoading(authSubmitBtn, true, 'Creating account…');
      try {
        const { data } = await api.post('/auth/register', {
          role,
          identifierType: _identifierType,
          identifier,
          password,
          name,
        });

        if (data.csrfToken) setCsrfToken(data.csrfToken);
        showSuccess('Account created successfully! Redirecting…');
        setTimeout(() => redirectByRole(data.user?.role || role), 800);
      } catch (err) {
        showError(err.message || 'Registration failed. Please try again.');
        authPassword.value = '';
        updateLivePasswordCheck('');
      } finally {
        setLoading(authSubmitBtn, false);
      }
    } else {
      // Sign In mode
      setLoading(authSubmitBtn, true, 'Signing in…');
      try {
        const { data } = await api.post('/auth/login', {
          identifier,
          password,
        });

        if (data.csrfToken) setCsrfToken(data.csrfToken);
        showSuccess('Signed in successfully! Redirecting…');
        setTimeout(() => redirectByRole(data.user?.role), 800);
      } catch (err) {
        showError(err.message || 'Invalid identifier or password.');
        authPassword.value = '';
        authPassword.focus();
      } finally {
        setLoading(authSubmitBtn, false);
      }
    }
  });
}

// ─── Role Selection Form for Google OAuth ─────────────────────────────────────
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
      const { data } = await api.post('/auth/register', { role: roleInput.value });
      if (data.csrfToken) setCsrfToken(data.csrfToken);
      showSuccess('Account setup completed! Redirecting…');
      setTimeout(() => redirectByRole(roleInput.value), 800);
    } catch (err) {
      showError(err.message || 'Failed to set up account. Please try again.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

// ─── Redirect Helper ──────────────────────────────────────────────────────────
function redirectByRole(role) {
  if (role === 'CANDIDATE') window.location.replace('/candidate/dashboard.html');
  else if (role === 'VOLUNTEER') window.location.replace('/volunteer/dashboard.html');
  else window.location.replace('/');
}

// ─── Forgot Password / Reset Flow ─────────────────────────────────────────────
function setupForgotPassword() {
  if (!forgotPasswordLink || !stepForgot) return;

  forgotPasswordLink.addEventListener('click', () => {
    stepAuth.hidden = true;
    stepForgot.hidden = false;
    resetForgotFlow();
  });

  if (backToSigninBtn) {
    backToSigninBtn.addEventListener('click', () => {
      stepForgot.hidden = true;
      stepAuth.hidden = false;
      setMode('signin');
    });
  }

  // Toggle new password visibility in forgot password form
  if (toggleForgotPasswordBtn && forgotNewPassword) {
    toggleForgotPasswordBtn.addEventListener('click', () => {
      const isPass = forgotNewPassword.type === 'password';
      forgotNewPassword.type = isPass ? 'text' : 'password';
      toggleForgotPasswordBtn.textContent = isPass ? '🙈' : '👁️';
    });
  }

  // Live password requirements checking for forgot password
  if (forgotNewPassword) {
    forgotNewPassword.addEventListener('input', () => {
      const rules = checkPasswordRules(forgotNewPassword.value);
      updateRuleElement(forgotRuleLength, rules.minLength, 'At least 8 characters');
      updateRuleElement(forgotRuleUpper, rules.hasUppercase, 'At least 1 uppercase letter (A-Z)');
      updateRuleElement(forgotRuleNumber, rules.hasNumber, 'At least 1 number (0-9)');
      updateRuleElement(forgotRuleSpecial, rules.hasSpecial, 'At least 1 special character (!@#$%^&*...)');
    });
  }

  // Step 1: Send OTP
  if (forgotEmailForm) {
    forgotEmailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAllErrors(forgotEmailForm);

      const email = forgotEmail?.value.trim() || '';
      if (!email) {
        showFieldError(forgotEmail, 'Email address is required.');
        forgotEmail?.focus();
        return;
      }
      if (!validateEmail(email)) {
        showFieldError(forgotEmail, 'Please enter a valid email address.');
        forgotEmail?.focus();
        return;
      }

      setLoading(forgotSendBtn, true, 'Sending code…');
      try {
        const { data } = await api.post('/auth/forgot-password', { email });
        _resetEmail = email;
        showSuccess(data.message || 'Verification code sent if the email is registered.');

        forgotEmailForm.style.display = 'none';
        forgotOtpForm.style.display = 'block';
        forgotTitle.textContent = 'Enter Verification Code';
        forgotSubtitle.textContent = `A 6-digit recovery code was sent to ${email}`;
        startResendTimer(60);
        forgotOtp.value = '';
        forgotOtp.focus();
      } catch (err) {
        showError(err.message || 'Failed to request reset code. Please try again.');
      } finally {
        setLoading(forgotSendBtn, false);
      }
    });
  }

  // Resend OTP button
  if (forgotResendBtn) {
    forgotResendBtn.addEventListener('click', async () => {
      if (_resendSecondsRemaining > 0 || !_resetEmail) return;

      setLoading(forgotResendBtn, true, 'Resending…');
      try {
        const { data } = await api.post('/auth/forgot-password', { email: _resetEmail });
        showSuccess(data.message || 'New verification code sent.');
        startResendTimer(60);
      } catch (err) {
        showError(err.message || 'Failed to resend verification code.');
      } finally {
        setLoading(forgotResendBtn, false);
      }
    });
  }

  // Step 2: Verify OTP
  if (forgotOtpForm) {
    forgotOtpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAllErrors(forgotOtpForm);

      const otp = forgotOtp?.value.trim() || '';
      if (!otp) {
        showFieldError(forgotOtp, 'Verification code is required.');
        forgotOtp?.focus();
        return;
      }
      if (!/^\d{6}$/.test(otp)) {
        showFieldError(forgotOtp, 'Please enter the 6-digit numeric verification code.');
        forgotOtp?.focus();
        return;
      }

      setLoading(forgotVerifyBtn, true, 'Verifying code…');
      try {
        const { data } = await api.post('/auth/verify-reset-otp', {
          email: _resetEmail,
          otp,
        });

        _resetToken = data.resetToken;
        if (_resendTimer) clearInterval(_resendTimer);

        showSuccess('Verification code confirmed! Please set your new password.');
        forgotOtpForm.style.display = 'none';
        forgotPasswordForm.style.display = 'block';
        forgotTitle.textContent = 'Set New Password';
        forgotSubtitle.textContent = 'Create a secure new password for your account.';
        forgotNewPassword.value = '';
        forgotConfirmPassword.value = '';
        forgotNewPassword.focus();
      } catch (err) {
        showError(err.message || 'Invalid or expired verification code.');
        forgotOtp.value = '';
        forgotOtp.focus();
      } finally {
        setLoading(forgotVerifyBtn, false);
      }
    });
  }

  // Step 3: Complete Password Reset
  if (forgotPasswordForm) {
    forgotPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAllErrors(forgotPasswordForm);

      const newPassword = forgotNewPassword?.value || '';
      const confirmPassword = forgotConfirmPassword?.value || '';

      if (!newPassword) {
        showFieldError(forgotNewPassword, 'New password is required.');
        forgotNewPassword?.focus();
        return;
      }

      const rules = checkPasswordRules(newPassword);
      if (!rules.isValid) {
        showFieldError(forgotNewPassword, 'Password does not meet the security requirements.');
        forgotNewPassword?.focus();
        return;
      }

      if (newPassword !== confirmPassword) {
        showFieldError(forgotConfirmPassword, 'Passwords do not match.');
        forgotConfirmPassword?.focus();
        return;
      }

      setLoading(forgotResetBtn, true, 'Resetting password…');
      try {
        const { data } = await api.post('/auth/reset-password', {
          email: _resetEmail,
          resetToken: _resetToken,
          newPassword,
        });

        showSuccess(data.message || 'Password reset successfully! Please sign in.');
        resetForgotFlow();
        stepForgot.hidden = true;
        stepAuth.hidden = false;
        setMode('signin');
        setIdentifierType('EMAIL');
        authEmail.value = _resetEmail;
        authPassword.value = '';
        authPassword.focus();
      } catch (err) {
        showError(err.message || 'Failed to reset password. Please try again.');
      } finally {
        setLoading(forgotResetBtn, false);
      }
    });
  }
}

function resetForgotFlow() {
  if (_resendTimer) clearInterval(_resendTimer);
  _resetEmail = '';
  _resetToken = '';
  _resendSecondsRemaining = 60;

  if (forgotEmailForm) {
    forgotEmailForm.style.display = 'block';
    clearAllErrors(forgotEmailForm);
    forgotEmail.value = '';
    forgotEmail.focus();
  }
  if (forgotOtpForm) {
    forgotOtpForm.style.display = 'none';
    clearAllErrors(forgotOtpForm);
    forgotOtp.value = '';
  }
  if (forgotPasswordForm) {
    forgotPasswordForm.style.display = 'none';
    clearAllErrors(forgotPasswordForm);
    forgotNewPassword.value = '';
    forgotConfirmPassword.value = '';
  }

  if (forgotTitle) forgotTitle.textContent = 'Reset Your Password';
  if (forgotSubtitle) forgotSubtitle.textContent = 'Enter your registered email address to receive a 6-digit verification code.';
}

function startResendTimer(seconds = 60) {
  if (_resendTimer) clearInterval(_resendTimer);
  _resendSecondsRemaining = seconds;

  if (forgotResendBtn && resendCountdown) {
    forgotResendBtn.disabled = true;
    resendCountdown.textContent = _resendSecondsRemaining;

    _resendTimer = setInterval(() => {
      _resendSecondsRemaining -= 1;
      if (_resendSecondsRemaining <= 0) {
        clearInterval(_resendTimer);
        _resendTimer = null;
        forgotResendBtn.disabled = false;
        forgotResendBtn.textContent = 'Resend Code';
      } else {
        resendCountdown.textContent = _resendSecondsRemaining;
        forgotResendBtn.innerHTML = `Resend Code (<span id="resend-countdown">${_resendSecondsRemaining}</span>s)`;
      }
    }, 1000);
  }
}