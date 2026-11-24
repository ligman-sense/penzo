'use strict';

const { HttpError } = require('../utils/httpError');

function notFound(req, res, next) {
  next(HttpError.notFound(`Endpoint not found: ${req.method} ${req.path}`));
}

module.exports = { notFound };
