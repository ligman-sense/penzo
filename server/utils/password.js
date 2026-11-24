const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64, MAXMEM = 128 * N * R * 2;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  if (!n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: +n, r: +r, p: +p, maxmem: MAXMEM,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

let _dummy;
const dummyHash = () => (_dummy ??= hashPassword(crypto.randomBytes(12).toString('hex')));

module.exports = { hashPassword, verifyPassword, dummyHash };
