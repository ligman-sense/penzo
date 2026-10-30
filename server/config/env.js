require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing required env var: ${name}`); process.exit(1); }
  return v;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/penzo',
  SESSION_SECRET: process.env.SESSION_SECRET || (
    process.env.NODE_ENV === 'production'
      ? (() => { console.error('SESSION_SECRET required in production'); process.exit(1); })()
      : 'dev-secret-not-for-production-use-replace-me'
  ),
  SESSION_TTL_HOURS: parseInt(process.env.SESSION_TTL_HOURS || '12', 10),
  ADMIN_SESSION_TTL_HOURS: parseInt(process.env.ADMIN_SESSION_TTL_HOURS || '8', 10),
  OTP_PROVIDER: process.env.OTP_PROVIDER || 'development',
  OTP_TTL_SECONDS: parseInt(process.env.OTP_TTL_SECONDS || '300', 10),
  OTP_MAX_VERIFY_ATTEMPTS: parseInt(process.env.OTP_MAX_VERIFY_ATTEMPTS || '5', 10),
  OTP_RESEND_COOLDOWN_SECONDS: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '30', 10),
  SMS_API_KEY: process.env.SMS_API_KEY || '',
  SMS_API_SECRET: process.env.SMS_API_SECRET || '',
  ADMIN_BOOTSTRAP_EMAIL: process.env.ADMIN_BOOTSTRAP_EMAIL || '',
  ADMIN_BOOTSTRAP_PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD || '',
};

if (env.NODE_ENV === 'production' && env.OTP_PROVIDER === 'development') {
  console.error('OTP_PROVIDER=development is not allowed in production');
  process.exit(1);
}

module.exports = env;
