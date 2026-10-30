'use strict';
import { api, setCsrfToken } from './api.js';

let _currentUser = null;
let _sessionChecked = false;

export async function checkSession() {
  if (_sessionChecked) return _currentUser;
  try {
    const { data } = await api.get('/auth/session');
    if (data.authenticated) {
      _currentUser = data.user;
      setCsrfToken(data.csrfToken);
    }
    _sessionChecked = true;
    return _currentUser;
  } catch {
    _sessionChecked = true;
    return null;
  }
}

export function getUser() { return _currentUser; }

export async function logout() {
  try { await api.post('/auth/logout'); } catch {}
  _currentUser = null;
  _sessionChecked = false;
  setCsrfToken(null);
  window.location.href = '/login.html';
}

// Guard: redirect to login if not authenticated
export async function requireAuth(redirectTo = '/login.html') {
  const user = await checkSession();
  if (!user) { window.location.href = redirectTo; return null; }
  return user;
}

// Guard: redirect to correct dashboard if already logged in
export async function redirectIfAuthenticated() {
  const user = await checkSession();
  if (user) {
    if (user.role === 'CANDIDATE') window.location.href = '/candidate/dashboard.html';
    else if (user.role === 'VOLUNTEER') window.location.href = '/volunteer/dashboard.html';
  }
}

// Admin session check
export async function checkAdminSession() {
  try {
    const { data } = await api.get('/admin/auth/session');
    if (data.authenticated) {
      setCsrfToken(data.csrfToken);
      return data.admin;
    }
    return null;
  } catch { return null; }
}

export async function requireAdmin(redirectTo = '/admin/login.html') {
  const admin = await checkAdminSession();
  if (!admin) { window.location.href = redirectTo; return null; }
  return admin;
}

export async function adminLogout() {
  try { await api.post('/admin/auth/logout'); } catch {}
  window.location.href = '/admin/login.html';
}
