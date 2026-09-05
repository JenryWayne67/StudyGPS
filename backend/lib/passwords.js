// backend/lib/passwords.js
//
// Password hashing using Node's built-in `crypto` module only - no new
// npm dependency (no bcrypt/argon2 install needed on any machine running
// this). scrypt is a real, standard, memory-hard KDF - this is not a toy.
//
// Stored format: "scrypt:<saltHex>:<hashHex>" so the salt travels with
// the hash and verify() never needs a second lookup.

const crypto = require('crypto');

const KEY_LENGTH = 64;

function hashPassword(plainPassword) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(plainPassword, salt, KEY_LENGTH);
    return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(plainPassword, storedHash) {
    if (!storedHash || typeof storedHash !== 'string') return false;

    const parts = storedHash.split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

    const [, salt, hashHex] = parts;

    let derivedKey;
    try {
        derivedKey = crypto.scryptSync(plainPassword, salt, KEY_LENGTH);
    } catch (err) {
        return false;
    }

    const storedBuffer = Buffer.from(hashHex, 'hex');

    // Guard against timingSafeEqual throwing on a length mismatch (a
    // corrupted/foreign hash) - that's just "doesn't match", not a crash.
    if (storedBuffer.length !== derivedKey.length) return false;

    return crypto.timingSafeEqual(derivedKey, storedBuffer);
}

module.exports = { hashPassword, verifyPassword };
