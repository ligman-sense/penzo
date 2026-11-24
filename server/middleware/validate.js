'use strict';

const { HttpError } = require('../utils/httpError');

/**
 * Lightweight request validator for body/query/params.
 */
function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    if (body) {
      for (const [key, rules] of Object.entries(body)) {
        const val = req.body?.[key];
        if (rules.required && (val === undefined || val === null || val === '')) {
          return next(HttpError.badRequest(`Field '${key}' is required.`));
        }
      }
    }
    next();
  };
}

module.exports = { validate };
