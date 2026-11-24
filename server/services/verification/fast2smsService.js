'use strict';

const { HttpError } = require('../../utils/httpError');

/**
 * Dispatches a real SMS OTP via Fast2SMS Quick OTP route.
 * Expects a 10-digit Indian mobile number.
 */
async function sendFast2Sms({ destination, code }) {
  const apiKey = (process.env.FAST2SMS_API_KEY || '').trim();

  if (!apiKey) {
    throw HttpError.serviceUnavailable(
      'Fast2SMS API key is not configured. Please set FAST2SMS_API_KEY in your .env file.'
    );
  }

  // Fast2SMS expects a 10-digit Indian number without country code (+91)
  const nationalNumber = destination.replace(/^\+91/, '').replace(/[^0-9]/g, '').slice(-10);

  if (!/^[6-9]\d{9}$/.test(nationalNumber)) {
    throw HttpError.badRequest('Invalid 10-digit Indian mobile number for Fast2SMS dispatch.');
  }

  try {
    const url = 'https://www.fast2sms.com/dev/bulkV2';
    const payload = {
      variables_values: String(code).trim(),
      route: 'otp',
      numbers: nationalNumber,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || data.return !== true) {
      console.error('[Fast2SMS API Error]', data);
      const errMsg = Array.isArray(data.message) ? data.message.join(', ') : (data.message || 'Fast2SMS rejected request');
      throw new Error(errMsg);
    }

    return {
      success: true,
      provider: 'fast2sms',
      destination,
      requestId: data.request_id || `fast2sms-${Date.now()}`,
    };
  } catch (err) {
    console.error('[Fast2SMS Dispatch Exception]', err.message);
    throw HttpError.serviceUnavailable(`Failed to deliver SMS via Fast2SMS: ${err.message}`);
  }
}

module.exports = {
  sendFast2Sms,
};
