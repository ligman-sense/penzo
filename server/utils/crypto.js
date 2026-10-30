const crypto = require('crypto');
const env = require('../config/env');

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');

function safeEqual(a, b) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

const generateOtp = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

const hashOtp = (mobileE164, code) =>
  crypto.createHmac('sha256', env.SESSION_SECRET).update(`otp:${mobileE164}:${code}`).digest('hex');

module.exports = { randomToken, sha256Hex, safeEqual, generateOtp, hashOtp };
