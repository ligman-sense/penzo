'use strict';
import { api } from './api.js';

// Toast notification system — create container lazily after DOM is ready
let toastContainer = null;

function getContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-atomic', 'false');
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showToast(message, type = 'info', duration = 4000) {
  const container = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `<span class="toast__message">${escapeHtml(message)}</span>
    <button class="toast__close" aria-label="Dismiss notification">&times;</button>`;
  container.appendChild(toast);
  toast.querySelector('.toast__close').addEventListener('click', () => removeToast(toast));
  const timer = setTimeout(() => removeToast(toast), duration);
  toast._timer = timer;
  return toast;
}

function removeToast(toast) {
  if (toast._timer) clearTimeout(toast._timer);
  toast.classList.add('toast--removing');
  setTimeout(() => toast.remove(), 300);
}

export function showSuccess(msg) { return showToast(msg, 'success'); }
export function showError(msg) { return showToast(msg, 'error', 6000); }
export function showWarning(msg) { return showToast(msg, 'warning', 5000); }
export function showInfo(msg) { return showToast(msg, 'info'); }

// Notification bell badge
export async function updateUnreadCount() {
  try {
    const { data } = await api.get('/notifications/unread-count');
    const badge = document.querySelector('.notification-badge');
    if (badge) {
      if (data.unread > 0) {
        badge.textContent = data.unread > 99 ? '99+' : data.unread;
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
  } catch {
    // Silently ignore — badge update is non-critical
  }
}
