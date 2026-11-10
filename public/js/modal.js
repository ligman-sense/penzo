'use strict';

/**
 * PENZO Shared Modal Management System
 * Provides reliable, accessible modal state management.
 * Guarantees that:
 *  1. No modal is ever displayed automatically on initial page load or tab navigation.
 *  2. Modals open ONLY upon explicit user interaction (e.g. clicking an action button).
 *  3. Only ONE modal is displayed at any given time (no stacked/cluttered dialogs).
 *  4. Focus is managed properly and restored upon closing.
 *  5. Background scrolling is properly locked/unlocked.
 *  6. Stale modal data is reset on close.
 */

let _activeModalId = null;
let _lastFocusedElement = null;
const _registeredModals = new Map();

/**
 * Register a modal element with its configuration.
 * Ensures the modal starts in a closed, hidden state.
 *
 * @param {string} modalId - Element ID of the modal container (.modal-backdrop)
 * @param {Object} [options]
 * @param {Function} [options.onOpen] - Called after modal opens
 * @param {Function} [options.onClose] - Called after modal closes
 * @param {Function} [options.onReset] - Called to reset modal form/data
 * @returns {HTMLElement|null}
 */
export function registerModal(modalId, options = {}) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.warn(`[modal.js] Modal "#${modalId}" not found in DOM.`);
    return null;
  }

  // Ensure modal starts strictly closed and hidden
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('is-open');
  modal.style.display = 'none';

  _registeredModals.set(modalId, options);

  // Attach event handlers once per modal element
  if (!modal._modalInitialized) {
    modal._modalInitialized = true;

    // Backdrop click: close if clicking the backdrop directly
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modalId);
      }
    });

    // Close buttons: elements with data-modal-close or common close classes/IDs
    modal.querySelectorAll('[data-modal-close], .modal-close-btn, .modal-close, #modal-close-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal(modalId);
      });
    });
  }

  return modal;
}

/**
 * Open a specific modal by ID.
 * Automatically closes any other open modal first.
 *
 * @param {string} modalId - Element ID of the modal container
 * @param {HTMLElement} [triggerEl] - Button or link that triggered opening
 * @param {Object} [runtimeOptions] - Per-open options
 * @returns {HTMLElement|null}
 */
export function openModal(modalId, triggerEl = null, runtimeOptions = {}) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.warn(`[modal.js] Cannot open: modal "#${modalId}" does not exist.`);
    return null;
  }

  // Close any currently active modal first (no multiple popups)
  if (_activeModalId && _activeModalId !== modalId) {
    closeModal(_activeModalId, { restoreFocus: false });
  }

  _lastFocusedElement = triggerEl || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  _activeModalId = modalId;

  // Make visible
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('is-open');
  modal.style.display = 'flex';

  // Lock body scroll
  document.body.style.overflow = 'hidden';

  // Focus management: focus first sensible focusable element
  requestAnimationFrame(() => {
    const focusable = modal.querySelector('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (focusable) {
      focusable.focus();
    } else {
      modal.setAttribute('tabindex', '-1');
      modal.focus();
    }
  });

  const config = _registeredModals.get(modalId) || {};
  const onOpen = runtimeOptions.onOpen || config.onOpen;
  if (typeof onOpen === 'function') {
    onOpen(modal);
  }

  return modal;
}

/**
 * Close a specific modal by ID.
 *
 * @param {string} modalId - Element ID of the modal container
 * @param {Object} [options]
 * @param {boolean} [options.restoreFocus=true] - Whether to return focus to the trigger
 */
export function closeModal(modalId, options = {}) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  // Hide modal
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('is-open');
  modal.style.display = 'none';

  if (_activeModalId === modalId) {
    _activeModalId = null;
  }

  // Check if any other modal is still visible
  const anyVisible = document.querySelector('.modal-backdrop.is-open:not([hidden])');
  if (!anyVisible) {
    document.body.style.overflow = '';
  }

  // Reset stale data if reset callback is configured
  const config = _registeredModals.get(modalId) || {};
  if (typeof config.onReset === 'function') {
    try {
      config.onReset(modal);
    } catch (err) {
      console.error(`[modal.js] Error in onReset for #${modalId}:`, err);
    }
  }

  // Optional onClose callback
  if (typeof config.onClose === 'function') {
    try {
      config.onClose(modal);
    } catch (err) {
      console.error(`[modal.js] Error in onClose for #${modalId}:`, err);
    }
  }

  // Restore focus to trigger button
  if (options.restoreFocus !== false && _lastFocusedElement && typeof _lastFocusedElement.focus === 'function') {
    try {
      _lastFocusedElement.focus();
    } catch (e) {
      // ignore
    }
    _lastFocusedElement = null;
  }
}

/**
 * Close all modals currently open in the document.
 * Restores body scrolling and clears active modal state.
 */
export function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach((modal) => {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('is-open');
    modal.style.display = 'none';

    const modalId = modal.id;
    if (modalId && _registeredModals.has(modalId)) {
      const config = _registeredModals.get(modalId);
      if (typeof config.onReset === 'function') {
        try { config.onReset(modal); } catch (e) {}
      }
      if (typeof config.onClose === 'function') {
        try { config.onClose(modal); } catch (e) {}
      }
    }
  });

  _activeModalId = null;
  _lastFocusedElement = null;
  document.body.style.overflow = '';
}

/**
 * Get the ID of the currently active modal, or null.
 * @returns {string|null}
 */
export function getActiveModalId() {
  return _activeModalId;
}

// Global Escape Key Listener (closes whichever modal is active)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _activeModalId) {
    closeModal(_activeModalId);
  }
});
