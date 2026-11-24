'use strict';

const { HttpError } = require('../../utils/httpError');

/**
 * Email Verification Adapter
 * Supports 'mock' for local development & testing, and 'smtp' / 'sendgrid' for production.
 */
class MockEmailAdapter {
  constructor() {
    this.name = 'mock';
    this._lastDispatched = null; // In-memory reference for automated test suite only
  }

  async sendVerificationCode({ destination, code, expiresInSeconds }) {
    this._lastDispatched = {
      destination,
      code,
      sentAt: new Date(),
      expiresInSeconds,
    };

    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n[EMAIL VERIFY OTP] ============================`);
      console.log(`[EMAIL VERIFY OTP] Destination : ${destination}`);
      console.log(`[EMAIL VERIFY OTP] Code        : ${code}`);
      console.log(`[EMAIL VERIFY OTP] ============================\n`);
    }

    return {
      success: true,
      provider: 'mock',
      destination,
      messageId: `mock-email-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
  }

  // Seam for automated testing only
  getLastDispatched(destination) {
    if (this._lastDispatched && (!destination || this._lastDispatched.destination === destination)) {
      return this._lastDispatched;
    }
    return null;
  }
}

class SendGridEmailAdapter {
  constructor({ apiKey, fromEmail }) {
    this.name = 'sendgrid';
    this.apiKey = apiKey;
    this.fromEmail = fromEmail || 'no-reply@penzo.org';
  }

  async sendVerificationCode({ destination, code }) {
    if (!this.apiKey) {
      throw HttpError.serviceUnavailable('Email delivery service is not configured. Missing API key.');
    }

    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: destination }] }],
          from: { email: this.fromEmail, name: 'PENZO Verification' },
          subject: 'Your PENZO Email Verification Code',
          content: [
            {
              type: 'text/plain',
              value: `Your PENZO verification code is: ${code}. It expires in 10 minutes.`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`SendGrid API error: ${errText}`);
      }

      return {
        success: true,
        provider: 'sendgrid',
        destination,
        messageId: response.headers.get('x-message-id') || 'sendgrid-dispatched',
      };
    } catch (err) {
      console.error('[SendGrid Dispatch Error]', err.message);
      throw HttpError.serviceUnavailable('Failed to send verification email. Please try again later.');
    }
  }
}

let activeEmailAdapter = null;

function getEmailAdapter() {
  if (activeEmailAdapter) return activeEmailAdapter;

  const provider = (process.env.EMAIL_PROVIDER || 'mock').toLowerCase();
  if (provider === 'sendgrid') {
    activeEmailAdapter = new SendGridEmailAdapter({
      apiKey: process.env.SENDGRID_API_KEY,
      fromEmail: process.env.EMAIL_FROM,
    });
  } else {
    activeEmailAdapter = new MockEmailAdapter();
  }

  return activeEmailAdapter;
}

module.exports = {
  getEmailAdapter,
  MockEmailAdapter,
  SendGridEmailAdapter,
};
