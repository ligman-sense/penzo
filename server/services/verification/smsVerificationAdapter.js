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
  constructor() {
    this.name = 'twilio';
  }

  async sendOtp({ destination, code }) {
    const { sendTwilioSms } = require('./twilioService');
    const result = await sendTwilioSms({ destination, code });
    return {
      success: true,
      provider: result.provider,
      destination,
      messageId: result.sid,
    };
  }
}

let activeSmsAdapter = null;

function getSmsAdapter() {
  if (activeSmsAdapter) return activeSmsAdapter;

  const provider = (process.env.SMS_PROVIDER || (process.env.OTP_PROVIDER === 'sms' ? 'twilio' : 'mock')).toLowerCase();
  if (provider === 'twilio') {
    activeSmsAdapter = new TwilioVerifySmsAdapter();
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
