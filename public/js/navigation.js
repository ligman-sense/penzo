'use strict';
import { logout, adminLogout } from './auth.js';

export function initNavigation(currentUser = null) {
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

  // Safe display fallback and responsive truncation for user name in shared navigation
  const nameEls = document.querySelectorAll('.user-name, #user-name');
  nameEls.forEach(el => {
    el.style.maxWidth = '160px';
    el.style.overflow = 'hidden';
    el.style.textOverflow = 'ellipsis';
    el.style.whiteSpace = 'nowrap';
    el.style.display = 'inline-block';
    el.style.verticalAlign = 'middle';

    const currentText = el.textContent ? el.textContent.trim() : '';
    if (!currentText || currentText === 'undefined' || currentText === 'null') {
      const isVolunteerPath = window.location.pathname.includes('/volunteer/');
      const fallback = currentUser?.name || currentUser?.fullName || currentUser?.mobileMasked || (isVolunteerPath ? 'Volunteer' : 'Candidate');
      el.textContent = fallback;
    }
  });
}
