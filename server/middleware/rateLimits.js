'use strict';

const rateLimit = require('express-rate-limit');

const FIFTEEN_MINUTES = 15 * 60 * 1000;

const otpSendLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
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
  limit: 30,
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
  limit: 15,
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
