'use strict';

const { HttpError } = require('../../utils/httpError');

/**
 * SMS Verification Adapter
 * Supports 'mock' for local dev & testing, and 'twilio' / external gateway integration.
 */
class MockSmsAdapter {
  constructor() {
    this.name = 'mock';
    this._lastDispatched = null; // In-memory reference for automated test suites only
  }

  async sendOtp({ destination, code, expiresInSeconds }) {
    // In-memory record for testing harness without leaking to logs or production responses
    this._lastDispatched = {
      destination,
      code,
      sentAt: new Date(),
      expiresInSeconds,
    };

    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n[SMS VERIFY OTP] ============================`);
      console.log(`[SMS VERIFY OTP] Destination : ${destination}`);
      console.log(`[SMS VERIFY OTP] Code        : ${code}`);
      console.log(`[SMS VERIFY OTP] ============================\n`);
    }

    return {
      success: true,
      provider: 'mock',
      destination,
      messageId: `mock-sms-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
  }

  // Seam for automated testing only (not accessible via public HTTP API)
  getLastDispatched(destination) {
    if (this._lastDispatched && (!destination || this._lastDispatched.destination === destination)) {
      return this._lastDispatched;
    }
    return null;
  }
}

class TwilioVerifySmsAdapter {
  constructor({ accountSid, authToken, serviceSid }) {
    this.name = 'twilio';
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.serviceSid = serviceSid;
  }

  async sendOtp({ destination }) {
    if (!this.accountSid || !this.authToken || !this.serviceSid) {
      throw HttpError.serviceUnavailable(
        'SMS verification service is not fully configured. Missing Twilio credentials.'
      );
    }

    try {
      // Twilio Verify API call template
      const url = `https://verify.twilio.com/v2/Services/${this.serviceSid}/Verifications`;
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
      const body = new URLSearchParams({ To: destination, Channel: 'sms' });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Twilio verification dispatch failed');
      }

      return {
        success: true,
        provider: 'twilio',
        destination,
        messageId: data.sid,
      };
    } catch (err) {
      console.error('[Twilio Verify Error]', err.message);
      throw HttpError.serviceUnavailable('Failed to dispatch SMS verification. Please try again later.');
    }
  }
}

let activeSmsAdapter = null;

function getSmsAdapter() {
  if (activeSmsAdapter) return activeSmsAdapter;

  const provider = (process.env.SMS_PROVIDER || 'mock').toLowerCase();
  if (provider === 'twilio') {
    activeSmsAdapter = new TwilioVerifySmsAdapter({
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      serviceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
    });
  } else {
    activeSmsAdapter = new MockSmsAdapter();
  }

  return activeSmsAdapter;
}

module.exports = {
  getSmsAdapter,
  MockSmsAdapter,
  TwilioVerifySmsAdapter,
};
