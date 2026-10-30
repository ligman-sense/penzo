'use strict';

const API_BASE = '/api';

// Store CSRF token in memory (never localStorage)
let _csrfToken = null;

export function setCsrfToken(token) { _csrfToken = token; }
export function getCsrfToken() { return _csrfToken; }

async function request(method, path, body, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (_csrfToken && !['GET', 'HEAD'].includes(method.toUpperCase())) {
    headers['X-CSRF-Token'] = _csrfToken;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body != null ? JSON.stringify(body) : undefined,
    ...options,
  });
  const data = await res.json().catch(() => ({ success: false, error: { message: 'Invalid server response' } }));
  if (!res.ok) {
    const err = new Error(data.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.error?.code;
    err.details = data.error?.details;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
