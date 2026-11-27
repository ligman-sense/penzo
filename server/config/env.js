'use strict';

require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// In production, ensure critical secrets are not using default development fallbacks
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) {
    console.error('\n================================================================================');
    console.error('[FATAL CONFIG ERROR] SESSION_SECRET environment variable is required in production.');
    console.error('Please generate a secure 32+ character random string and set SESSION_SECRET in your hosting provider dashboard.');
    console.error('Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    console.error('================================================================================\n');
    process.exit(1);
  } else {
    sessionSecret = 'dev-secret-not-for-production-use-replace-me';
  }
} else if (isProd && sessionSecret.includes('dev-secret')) {
  console.error('\n================================================================================');
  console.error('[FATAL CONFIG ERROR] Default development SESSION_SECRET detected in production.');
  console.error('Please replace SESSION_SECRET with a strong, random production secret.');
  console.error('================================================================================\n');
  process.exit(1);
}

// In production, MONGODB_URI must not default to local without clear warning
const rawMongoUri = process.env.MONGODB_URI;
let mongoUri = rawMongoUri;
if (!mongoUri) {
  if (isProd) {
    mongoUri = ''; // Handled by validateMongoUri with comprehensive instructions
  } else {
    mongoUri = 'mongodb://127.0.0.1:27017/penzo';
  }
}

const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');

const env = {
  NODE_ENV: nodeEnv,
  PORT: parseInt(process.env.PORT || '3000', 10),
  APP_URL: appUrl,
  MONGODB_URI: mongoUri,
  SESSION_SECRET: sessionSecret,
  SESSION_TTL_HOURS: parseInt(process.env.SESSION_TTL_HOURS || '12', 10),
  ADMIN_SESSION_TTL_HOURS: parseInt(process.env.ADMIN_SESSION_TTL_HOURS || '8', 10),
  TRUST_PROXY: process.env.TRUST_PROXY || (isProd ? '1' : '0'),
  ENABLE_BACKGROUND_SCHEDULER: process.env.ENABLE_BACKGROUND_SCHEDULER !== 'false',
  OTP_PROVIDER: process.env.OTP_PROVIDER || 'development',
  OTP_TTL_SECONDS: parseInt(process.env.OTP_TTL_SECONDS || '300', 10),
  OTP_MAX_VERIFY_ATTEMPTS: parseInt(process.env.OTP_MAX_VERIFY_ATTEMPTS || '5', 10),
  OTP_RESEND_COOLDOWN_SECONDS: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '30', 10),
  SMS_API_KEY: process.env.SMS_API_KEY || '',
  SMS_API_SECRET: process.env.SMS_API_SECRET || '',
  FAST2SMS_API_KEY: process.env.FAST2SMS_API_KEY || '',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',
  TWILIO_VERIFY_SERVICE_SID: process.env.TWILIO_VERIFY_SERVICE_SID || '',
  ADMIN_BOOTSTRAP_EMAIL: process.env.ADMIN_BOOTSTRAP_EMAIL || '',
  ADMIN_BOOTSTRAP_PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD || '',
  ADMIN_BOOTSTRAP_NAME: process.env.ADMIN_BOOTSTRAP_NAME || 'Super Administrator',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || (appUrl ? `${appUrl}/api/auth/google/callback` : 'http://localhost:3000/api/auth/google/callback'),
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'PENZO <onboarding@resend.dev>',
  PASSWORD_RESET_OTP_EXPIRY: parseInt(process.env.PASSWORD_RESET_OTP_EXPIRY || '300', 10),
  PASSWORD_RESET_MAX_ATTEMPTS: parseInt(process.env.PASSWORD_RESET_MAX_ATTEMPTS || '5', 10),
  PASSWORD_RESET_RESEND_COOLDOWN: parseInt(process.env.PASSWORD_RESET_RESEND_COOLDOWN || '60', 10),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
};

module.exports = env;
