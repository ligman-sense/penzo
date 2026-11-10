'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const isDev = env.NODE_ENV !== 'production';

const otpSendLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: isDev ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many OTP requests from this network. Please wait a few minutes.',
    },
  },
});

const otpVerifyLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: isDev ? 1000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many verification attempts from this network. Please wait a few minutes.',
    },
  },
});

const adminLoginLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: isDev ? 500 : 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many sign-in attempts. Please wait a few minutes.',
    },
  },
});

module.exports = {
  otpSendLimiter,
  otpVerifyLimiter,
  adminLoginLimiter,
};
