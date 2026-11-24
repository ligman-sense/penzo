const env = require('../config/env');

const USER_COOKIE = 'penzo_session';
const ADMIN_COOKIE = 'penzo_admin_session';

function setSessionCookie(res, name, token, expiresAt) {
  res.cookie(name, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

function clearSessionCookie(res, name) {
  res.clearCookie(name, { httpOnly: true, sameSite: 'lax', path: '/' });
}

module.exports = { USER_COOKIE, ADMIN_COOKIE, setSessionCookie, clearSessionCookie };
