'use strict';

const { HttpError } = require('./httpError');

/**
 * Validates and normalizes an Indian mobile number.
 * Supports India (+91) only.
 * Accepts formats: "+919876543210", "9876543210", "09876543210"
 * Returns canonical E.164 string: "+91XXXXXXXXXX"
 */
function normalizeAndValidateIndianMobile(input) {
  if (!input || typeof input !== 'string') {
    throw HttpError.badRequest('Mobile number is required.');
  }

  // Remove whitespace, dashes, parens
  const cleaned = input.trim().replace(/[\s\-\(\)]/g, '');

  // Detect non-Indian country code prefixes
  if (cleaned.startsWith('+') && !cleaned.startsWith('+91')) {
    throw HttpError.badRequest('Only Indian mobile numbers (+91) are supported.');
  }

  let nationalNumber = cleaned;
  if (cleaned.startsWith('+91')) {
    nationalNumber = cleaned.slice(3);
  } else if (cleaned.startsWith('0')) {
    nationalNumber = cleaned.slice(1);
  }

  // Indian mobile numbers must be exactly 10 digits and start with 6, 7, 8, or 9
  const indianMobileRegex = /^[6-9]\d{9}$/;
  if (!indianMobileRegex.test(nationalNumber)) {
    throw HttpError.badRequest(
      'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.'
    );
  }

  return `+91${nationalNumber}`;
}

module.exports = {
  normalizeAndValidateIndianMobile,
};
