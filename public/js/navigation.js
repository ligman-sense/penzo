'use strict';
import { logout, adminLogout } from './auth.js';

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

  // Mark current nav link as active
  const current = window.location.pathname;
  document.querySelectorAll('.sidebar__link, .nav__link').forEach(link => {
    if (link.getAttribute('href') === current || link.href === window.location.href) {
      link.setAttribute('aria-current', 'page');
      link.classList.add('active');
    }
  });
}
