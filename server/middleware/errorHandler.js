'use strict';

const { HttpError } = require('../utils/httpError');

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status = err.status || (err instanceof HttpError ? err.status : 500);
  const code = err.code || (err instanceof HttpError ? err.code : 'INTERNAL_ERROR');
  const message = err.message || 'An unexpected error occurred. Please try again.';
  const details = err.details || null;

  if (status >= 500) {
    console.error('[SERVER ERROR]', err);
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
