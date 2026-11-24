'use strict';

import { api } from './api.js';
import { showError, showSuccess } from './notifications.js';
import { setLoading } from './utils.js';

/**
 * Initializes contact verification UI behavior for Candidate and Volunteer profiles.
 */
export function initContactVerification({ form, contactInfo, onVerified }) {
  if (!form || !contactInfo) return;

  const emailInput = form.querySelector('#email');
  const emailBadge = document.getElementById('email-status-badge');
  const emailHint = document.getElementById('email-hint');
  const emailVerifyBox = document.getElementById('email-verify-box');
  const sendEmailCodeBtn = document.getElementById('send-email-code-btn');
  const emailOtpPanel = document.getElementById('email-otp-panel');
  const emailOtpInput = document.getElementById('email-otp-input');
  const confirmEmailOtpBtn = document.getElementById('confirm-email-otp-btn');
  const resendEmailOtpBtn = document.getElementById('resend-email-otp-btn');
  const emailOtpCountdown = document.getElementById('email-otp-countdown');

  const mobileInput = form.querySelector('#mobile-display') || form.querySelector('#mobile');
  const mobileBadge = document.getElementById('mobile-status-badge');
  const mobileHint = document.getElementById('mobile-hint');
  const mobileVerifySection = document.getElementById('mobile-verify-section');
  const startMobileVerifyBtn = document.getElementById('start-mobile-verify-btn');
  const mobileOtpPanel = document.getElementById('mobile-otp-panel');
  const mobileOtpInput = document.getElementById('mobile-otp-input');
  const confirmMobileOtpBtn = document.getElementById('confirm-mobile-otp-btn');
  const resendMobileOtpBtn = document.getElementById('resend-mobile-otp-btn');
  const mobileOtpCountdown = document.getElementById('mobile-otp-countdown');

  let _mobileCooldown = null;
  let _emailCooldown = null;

  // ─── 1. Configure based on Auth Provider ─────────────────────────────────────
  if (contactInfo.authProvider === 'GOOGLE') {
    // A. OAuth User: Email is read-only Google identity
    if (emailInput) {
      emailInput.value = contactInfo.email || '';
      emailInput.disabled = true;
      emailInput.readOnly = true;
      emailInput.title = 'OAuth email managed by Google';
    }
    if (emailBadge) {
      if (contactInfo.isEmailVerified) {
        emailBadge.className = 'badge badge--green';
        emailBadge.textContent = '✓ Verified (Google)';
      } else {
        emailBadge.className = 'badge badge--amber';
        emailBadge.textContent = 'Google Account';
      }
    }
    if (emailHint) {
      emailHint.textContent = 'Email address is managed by your Google account and is read-only.';
    }
    if (emailVerifyBox) emailVerifyBox.style.display = 'none';

    // Mobile is editable and must be verified
    const rawMobile = (contactInfo.mobile || contactInfo.pendingMobile || '').replace(/^\+91/, '');
    if (mobileInput) {
      mobileInput.value = rawMobile;
      mobileInput.disabled = false;
      mobileInput.readOnly = false;
    }

    updateMobileBadge(contactInfo.isMobileVerified, contactInfo.pendingMobile);

    if (mobileInput) {
      mobileInput.addEventListener('input', () => {
        const currentVal = mobileInput.value.trim().replace(/[\s\-]/g, '');
        const savedVal = (contactInfo.mobile || '').replace(/^\+91/, '');
        if (currentVal !== savedVal) {
          updateMobileBadge(false, currentVal);
          if (mobileVerifySection) mobileVerifySection.style.display = 'block';
        } else {
          updateMobileBadge(contactInfo.isMobileVerified, null);
        }
      });
    }
  } else {
    // B. Mobile-login User: Mobile is read-only login identity
    if (mobileInput) {
      mobileInput.value = (contactInfo.mobile || '').replace(/^\+91/, '');
      mobileInput.disabled = true;
      mobileInput.readOnly = true;
      mobileInput.title = 'Mobile login identity cannot be changed';
    }
    if (mobileBadge) {
      mobileBadge.className = 'badge badge--green';
      mobileBadge.textContent = '✓ Verified (Login)';
    }
    if (mobileHint) {
      mobileHint.textContent = 'Mobile number is your login identity and cannot be changed.';
    }
    if (mobileVerifySection) mobileVerifySection.style.display = 'none';

    // Email is editable and can be verified
    if (emailInput) {
      emailInput.value = contactInfo.pendingEmail || contactInfo.email || '';
      emailInput.disabled = false;
      emailInput.readOnly = false;

      updateEmailBadge(contactInfo.isEmailVerified, contactInfo.pendingEmail);

      emailInput.addEventListener('input', () => {
        const currentVal = emailInput.value.trim().toLowerCase();
        const savedVal = (contactInfo.email || '').toLowerCase();
        if (currentVal && currentVal !== savedVal) {
          updateEmailBadge(false, currentVal);
          if (emailVerifyBox) emailVerifyBox.style.display = 'block';
        } else {
          updateEmailBadge(contactInfo.isEmailVerified, null);
          if (emailVerifyBox) emailVerifyBox.style.display = contactInfo.isEmailVerified ? 'none' : 'block';
        }
      });
    }
  }

  function updateMobileBadge(isVerified, pendingVal) {
    if (!mobileBadge) return;
    if (isVerified) {
      mobileBadge.className = 'badge badge--green';
      mobileBadge.textContent = '✓ Verified';
      if (mobileHint) mobileHint.textContent = 'Mobile number is verified.';
      if (mobileVerifySection) mobileVerifySection.style.display = 'none';
    } else {
      mobileBadge.className = 'badge badge--amber';
      mobileBadge.textContent = pendingVal ? 'Pending Verification' : 'Unverified';
      if (mobileHint) mobileHint.textContent = 'Enter your 10-digit Indian mobile number (+91). Verification required.';
      if (mobileVerifySection) mobileVerifySection.style.display = 'block';
    }
  }

  function updateEmailBadge(isVerified, pendingVal) {
    if (!emailBadge) return;
    if (isVerified) {
      emailBadge.className = 'badge badge--green';
      emailBadge.textContent = '✓ Verified';
      if (emailHint) emailHint.textContent = 'Email address is verified.';
      if (emailVerifyBox) emailVerifyBox.style.display = 'none';
    } else {
      emailBadge.className = 'badge badge--amber';
      emailBadge.textContent = pendingVal ? 'Pending Verification' : 'Unverified';
      if (emailHint) {
        emailHint.textContent = pendingVal
          ? `Pending verification for ${pendingVal}`
          : 'Email address requires verification.';
      }
      if (emailVerifyBox && emailInput && emailInput.value.trim()) {
        emailVerifyBox.style.display = 'block';
      }
    }
  }

  // ─── 2. Mobile Verification Flow ─────────────────────────────────────────────
  async function triggerSendMobileOtp() {
    const rawVal = mobileInput ? mobileInput.value.trim().replace(/[\s\-]/g, '') : '';
    if (!/^[6-9]\d{9}$/.test(rawVal)) {
      showError('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
      mobileInput?.focus();
      return;
    }

    const canonicalMobile = `+91${rawVal}`;
    setLoading(startMobileVerifyBtn, true, 'Sending code…');
    if (resendMobileOtpBtn) resendMobileOtpBtn.disabled = true;

    try {
      const { data } = await api.post('/profile/contact/mobile/send-otp', { mobile: canonicalMobile });
      if (data.devCode && mobileOtpInput) {
        mobileOtpInput.value = data.devCode;
        showSuccess(`Verification code sent! (Dev OTP: ${data.devCode})`);
      } else {
        showSuccess(data.message || 'Verification code sent to your mobile number.');
      }
      if (mobileOtpPanel) mobileOtpPanel.style.display = 'block';
      mobileOtpInput?.focus();
      startCooldown('mobile', data.resendCooldownSeconds || 60);
    } catch (err) {
      showError(err.message || 'Failed to send mobile verification code.');
    } finally {
      setLoading(startMobileVerifyBtn, false);
    }
  }

  if (startMobileVerifyBtn) {
    startMobileVerifyBtn.addEventListener('click', triggerSendMobileOtp);
  }
  if (resendMobileOtpBtn) {
    resendMobileOtpBtn.addEventListener('click', triggerSendMobileOtp);
  }

  if (confirmMobileOtpBtn) {
    confirmMobileOtpBtn.addEventListener('click', async () => {
      const code = mobileOtpInput ? mobileOtpInput.value.trim() : '';
      if (!code || code.length !== 6) {
        showError('Please enter the 6-digit verification code.');
        mobileOtpInput?.focus();
        return;
      }

      setLoading(confirmMobileOtpBtn, true, 'Verifying…');
      try {
        const { data } = await api.post('/profile/contact/mobile/verify-otp', { code });
        showSuccess('Mobile number verified successfully!');
        contactInfo.isMobileVerified = true;
        contactInfo.mobile = data.mobile;
        contactInfo.pendingMobile = null;

        updateMobileBadge(true, null);
        if (mobileOtpPanel) mobileOtpPanel.style.display = 'none';
        if (mobileVerifySection) mobileVerifySection.style.display = 'none';

        if (typeof onVerified === 'function') onVerified('mobile', data);
      } catch (err) {
        showError(err.message || 'Incorrect verification code. Please try again.');
      } finally {
        setLoading(confirmMobileOtpBtn, false);
      }
    });
  }

  // ─── 3. Email Verification Flow ──────────────────────────────────────────────
  async function triggerSendEmailCode() {
    const rawEmail = emailInput ? emailInput.value.trim().toLowerCase() : '';
    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      showError('Please enter a valid email address.');
      emailInput?.focus();
      return;
    }

    setLoading(sendEmailCodeBtn, true, 'Sending code…');
    if (resendEmailOtpBtn) resendEmailOtpBtn.disabled = true;

    try {
      const { data } = await api.post('/profile/contact/email/send-code', { email: rawEmail });
      if (data.devCode && emailOtpInput) {
        emailOtpInput.value = data.devCode;
        showSuccess(`Verification code sent! (Dev Code: ${data.devCode})`);
      } else {
        showSuccess(data.message || 'Verification code sent to your email address.');
      }
      if (emailOtpPanel) emailOtpPanel.style.display = 'block';
      emailOtpInput?.focus();
      startCooldown('email', data.resendCooldownSeconds || 60);
    } catch (err) {
      showError(err.message || 'Failed to send email verification code.');
    } finally {
      setLoading(sendEmailCodeBtn, false);
    }
  }

  if (sendEmailCodeBtn) {
    sendEmailCodeBtn.addEventListener('click', triggerSendEmailCode);
  }
  if (resendEmailOtpBtn) {
    resendEmailOtpBtn.addEventListener('click', triggerSendEmailCode);
  }

  if (confirmEmailOtpBtn) {
    confirmEmailOtpBtn.addEventListener('click', async () => {
      const code = emailOtpInput ? emailOtpInput.value.trim() : '';
      if (!code || code.length !== 6) {
        showError('Please enter the 6-digit email verification code.');
        emailOtpInput?.focus();
        return;
      }

      setLoading(confirmEmailOtpBtn, true, 'Verifying…');
      try {
        const { data } = await api.post('/profile/contact/email/verify-code', { code });
        showSuccess('Email address verified successfully!');
        contactInfo.isEmailVerified = true;
        contactInfo.email = data.email;
        contactInfo.pendingEmail = null;

        updateEmailBadge(true, null);
        if (emailOtpPanel) emailOtpPanel.style.display = 'none';
        if (emailVerifyBox) emailVerifyBox.style.display = 'none';

        if (typeof onVerified === 'function') onVerified('email', data);
      } catch (err) {
        showError(err.message || 'Incorrect verification code. Please try again.');
      } finally {
        setLoading(confirmEmailOtpBtn, false);
      }
    });
  }

  function startCooldown(type, seconds) {
    let remaining = seconds;
    const btn = type === 'mobile' ? resendMobileOtpBtn : resendEmailOtpBtn;
    const label = type === 'mobile' ? mobileOtpCountdown : emailOtpCountdown;

    if (btn) btn.disabled = true;
    if (label) {
      label.textContent = `Resend in ${remaining}s`;
      label.style.display = 'inline';
    }

    const timer = setInterval(() => {
      remaining -= 1;
      if (label) label.textContent = `Resend in ${remaining}s`;
      if (remaining <= 0) {
        clearInterval(timer);
        if (btn) btn.disabled = false;
        if (label) label.style.display = 'none';
      }
    }, 1000);

    if (type === 'mobile') _mobileCooldown = timer;
    else _emailCooldown = timer;
  }
}
