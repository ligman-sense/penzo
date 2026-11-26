'use strict';

/**
 * PENZO Accessible Cookie Consent Management
 * Compliant with privacy regulations:
 * - Uses localStorage without setting unnecessary cookies
 * - Essential authentication & security cookies are always preserved
 * - Re-openable via Cookie Settings trigger
 */

const STORAGE_KEY = 'penzo_cookie_consent';
const CONSENT_VERSION = 1;

export function getCookieConsent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === CONSENT_VERSION) {
      return parsed;
    }
  } catch {
    // Fall back if localStorage is disabled or corrupted
  }
  return null;
}

export function saveCookieConsent(choice) {
  try {
    const record = {
      choice, // 'all' | 'essential_only'
      version: CONSENT_VERSION,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  } catch (err) {
    console.warn('[Cookie Consent] Failed to persist consent in localStorage:', err);
    return null;
  }
}

export function initCookieConsent() {
  const banner = document.getElementById('cookie-consent-banner');
  if (!banner) return;

  const acceptBtn = document.getElementById('cookie-accept-all-btn');
  const rejectBtn = document.getElementById('cookie-reject-btn');
  const settingsBtn = document.getElementById('cookie-settings-btn');

  function showBanner(focusTarget = null) {
    banner.removeAttribute('hidden');
    banner.classList.add('cookie-banner--visible');
    if (focusTarget) {
      focusTarget.focus();
    } else if (acceptBtn) {
      acceptBtn.focus();
    }
  }

  function hideBanner() {
    banner.classList.remove('cookie-banner--visible');
    banner.setAttribute('hidden', '');
  }

  // Check existing preference
  const existingConsent = getCookieConsent();
  if (!existingConsent) {
    // Show banner after brief delay so it does not interfere with page load
    setTimeout(() => {
      showBanner();
    }, 400);
  } else {
    hideBanner();
  }

  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      saveCookieConsent('all');
      hideBanner();
      if (settingsBtn) settingsBtn.focus();
    });
  }

  if (rejectBtn) {
    rejectBtn.addEventListener('click', () => {
      // Rejecting optional cookies stores 'essential_only'.
      // Essential session and CSRF security tokens remain fully active and untouched.
      saveCookieConsent('essential_only');
      hideBanner();
      if (settingsBtn) settingsBtn.focus();
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showBanner(acceptBtn);
    });
  }

  // Keyboard accessibility: Escape closes banner if consent was previously recorded
  banner.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const current = getCookieConsent();
      if (current) {
        hideBanner();
        if (settingsBtn) settingsBtn.focus();
      }
    }
  });
}

// Auto-initialize when loaded as a module in the browser
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCookieConsent);
  } else {
    initCookieConsent();
  }
}
