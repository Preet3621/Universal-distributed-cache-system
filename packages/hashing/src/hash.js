import { createHash } from 'node:crypto';

/**
 * Deterministic non-negative hash of a cache key (SHA-256, first 4 bytes as uint32).
 * @param {string} key
 * @returns {number}
 */
export function hashKey(key) {
  const digest = createHash('sha256').update(key, 'utf8').digest();
  return digest.readUInt32BE(0);
}
