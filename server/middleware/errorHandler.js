'use strict';

const { HttpError } = require('../utils/httpError');
const env = require('../config/env');

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status = err.status || (err instanceof HttpError ? err.status : 500);
  const code = err.code || (err instanceof HttpError ? err.code : 'INTERNAL_ERROR');

  // In production, mask unhandled 500 errors to prevent system details leakage
  let message = err.message || 'An unexpected error occurred. Please try again.';
  if (status >= 500 && env.NODE_ENV === 'production' && !(err instanceof HttpError)) {
    message = 'An unexpected internal server error occurred. Please try again later.';
  }

  const details = (status < 500 || env.NODE_ENV !== 'production') ? (err.details || null) : null;

  if (status >= 500) {
    console.error('[SERVER ERROR]', err.message || err);
  }

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

module.exports = { errorHandler };
