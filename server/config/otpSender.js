'use strict';

const env = require('./env');
const { HttpError } = require('../utils/httpError');

class DevOtpSender {
  constructor() {
    this.name = 'development';
  }
  async send(mobileE164, code) {
    console.log(`\n[DEV OTP] code for ${mobileE164} is ${code}  (development adapter, nothing was sent)\n`);
  }
}

class SmsOtpSender {
  constructor() {
    this.name = 'sms';
  }
  async send(mobileE164, code) {
    if (!env.SMS_API_KEY) {
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'SMS delivery is not configured on this server.');
    }
    // Live SMS delivery placeholder/adapter
    console.log(`[SMS OTP] Sending code to ${mobileE164} using configured gateway`);
  }
}

let senderInstance = null;

function getOtpSender() {
  if (!senderInstance) {
    senderInstance = env.OTP_PROVIDER === 'sms' ? new SmsOtpSender() : new DevOtpSender();
  }
  return senderInstance;
}

function setOtpSender(custom) {
  senderInstance = custom;
}

module.exports = { getOtpSender, setOtpSender };
