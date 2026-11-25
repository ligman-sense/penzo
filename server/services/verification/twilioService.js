'use strict';

const env = require('../../config/env');
const { HttpError } = require('../../utils/httpError');

/**
 * Dispatches an SMS via Twilio using native fetch.
 * Supports:
 * 1. Twilio Messages API (when TWILIO_PHONE_NUMBER is configured)
 * 2. Twilio Verify Service (when TWILIO_VERIFY_SERVICE_SID is configured)
 */
async function sendTwilioSms({ destination, code, messageBody }) {
  const accountSid = (env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = (env.TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || '').trim();
  const fromNumber = (env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || '').trim();
  const verifyServiceSid = (env.TWILIO_VERIFY_SERVICE_SID || process.env.TWILIO_VERIFY_SERVICE_SID || '').trim();

  if (!accountSid || !authToken) {
    throw HttpError.serviceUnavailable(
      'Twilio credentials are not fully configured. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your .env file.'
    );
  }

  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const headers = {
    Authorization: `Basic ${basicAuth}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const bodyText = messageBody || `Your PENZO verification code is: ${code}. Valid for 5 minutes. Do not share this code.`;

  try {
    if (verifyServiceSid) {
      // Method A: Twilio Verify Service API
      const url = `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`;
      const params = new URLSearchParams({ To: destination, Channel: 'sms' });

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: params.toString(),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('[Twilio Verify API Error]', data);
        throw new Error(data.message || `Twilio error code ${data.code}`);
      }

      return {
        success: true,
        provider: 'twilio_verify',
        sid: data.sid,
        status: data.status,
      };
    } else if (fromNumber) {
      // Method B: Twilio Standard Messages API
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const params = new URLSearchParams({
        To: destination,
        From: fromNumber,
        Body: bodyText,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: params.toString(),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('[Twilio Messages API Error]', data);
        throw new Error(data.message || `Twilio error code ${data.code}`);
      }

      return {
        success: true,
        provider: 'twilio_sms',
        sid: data.sid,
        status: data.status,
      };
    } else {
      throw HttpError.serviceUnavailable(
        'Neither TWILIO_PHONE_NUMBER nor TWILIO_VERIFY_SERVICE_SID is configured in .env. Please provide at least one.'
      );
    }
  } catch (err) {
    console.error('[Twilio Dispatch Error]', err.message);
    throw HttpError.serviceUnavailable(
      `Failed to deliver SMS via Twilio: ${err.message}`
    );
  }
}

module.exports = {
  sendTwilioSms,
};
