'use strict';
import { getUser, logout, adminLogout } from './auth.js';

export function renderHeaderUser(user) {
  const currentUser = user || getUser();
  if (!currentUser || !['CANDIDATE', 'VOLUNTEER'].includes(currentUser.role)) return;

  const roleLabel = currentUser.role === 'VOLUNTEER' ? 'Volunteer' : 'Candidate';
  const badgeClass = currentUser.role === 'VOLUNTEER' ? 'badge--teal' : 'badge--blue';
  const rawName = typeof currentUser.name === 'string' ? currentUser.name.trim() : '';
  const fallbackContact = typeof currentUser.mobileMasked === 'string' && currentUser.mobileMasked.trim()
    ? currentUser.mobileMasked.trim()
    : (typeof currentUser.mobile === 'string' ? currentUser.mobile.trim() : '');
  const displayName = rawName || fallbackContact;

  // Keep sidebar footer user label in sync when present
  const sidebarNameEl = document.querySelector('.sidebar-footer #user-name, .sidebar-footer .user-name');
  if (sidebarNameEl) {
    sidebarNameEl.textContent = displayName || roleLabel;
  }

  // Update logged-in candidate/volunteer top header without touching admin header
  const headerActions = document.querySelector('.site-header .header-actions');
  if (!headerActions) return;

  let userBox = headerActions.querySelector('.header-user');
  const existingBadge = headerActions.querySelector(':scope > .badge');

  if (!userBox) {
    userBox = document.createElement('div');
    userBox.className = 'header-user';
    if (existingBadge) {
      existingBadge.replaceWith(userBox);
    } else {
      headerActions.prepend(userBox);
    }
  }

  userBox.textContent = '';

  if (displayName) {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'header-user__name';
    nameSpan.textContent = displayName;
    nameSpan.title = `${displayName} · ${roleLabel}`;
    userBox.appendChild(nameSpan);

    const sepSpan = document.createElement('span');
    sepSpan.className = 'header-user__sep';
    sepSpan.setAttribute('aria-hidden', 'true');
    sepSpan.textContent = '·';
    userBox.appendChild(sepSpan);
  }

  const roleSpan = document.createElement('span');
  roleSpan.className = `badge ${badgeClass} header-user__role`;
  roleSpan.textContent = roleLabel;
  userBox.appendChild(roleSpan);
}

export function initNavigation() {
  // Mobile hamburger menu
  const hamburger = document.querySelector('.hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const open = hamburger.getAttribute('aria-expanded') === 'true';
      hamburger.setAttribute('aria-expanded', String(!open));
      mobileMenu.hidden = open;
    });
  }

  // Logout buttons
  document.querySelectorAll('#logout-btn, .logout-btn').forEach(btn => {
    btn.addEventListener('click', () => logout());
  });
  document.querySelectorAll('#admin-logout-btn, .admin-logout-btn').forEach(btn => {
    btn.addEventListener('click', () => adminLogout());
  });

  // Render authenticated candidate/volunteer name & role in header
  renderHeaderUser();

  // Mark current nav link as active
  const current = window.location.pathname;
  document.querySelectorAll('.sidebar__link, .nav__link').forEach(link => {
    if (link.getAttribute('href') === current || link.href === window.location.href) {
      link.setAttribute('aria-current', 'page');
      link.classList.add('active');
    }
  });
}
