'use strict';

import { api, setCsrfToken } from '../api.js';
import { showError } from '../notifications.js';
import { setLoading } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('admin-login-form');
  const submitBtn = document.getElementById('submit-btn');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email')?.value.trim();
      const password = document.getElementById('password')?.value;

      if (!email || !password) {
        showError('Please enter both email and password.');
        return;
      }

      setLoading(submitBtn, true, 'Signing in...');

      try {
        const res = await api.post('/admin/auth/login', { email, password });
        if (res.data?.csrfToken) setCsrfToken(res.data.csrfToken);
        window.location.href = '/admin/dashboard.html';
      } catch (err) {
        showError(err.message || 'Incorrect email or password.');
      } finally {
        setLoading(submitBtn, false);
      }
    });
  }
});
