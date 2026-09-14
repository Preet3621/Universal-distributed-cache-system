import { CacheError } from './errors.js';

/** Max key length in UTF-8 bytes (Phase 0 contract). */
export const MAX_KEY_BYTES = 256;

/** Max value size in UTF-8 bytes (Phase 0 contract). */
export const MAX_VALUE_BYTES = 1_048_576; // 1 MiB

/**
 * @param {unknown} key
 * @returns {asserts key is string}
 */
export function assertValidKey(key) {
  if (typeof key !== 'string') {
    throw new CacheError('INVALID_KEY_TYPE', 'key must be a string');
  }
  if (key.length === 0) {
    throw new CacheError('EMPTY_KEY', 'key must not be empty');
  }
  const bytes = Buffer.byteLength(key, 'utf8');
  if (bytes > MAX_KEY_BYTES) {
    throw new CacheError(
      'KEY_TOO_LARGE',
      `key exceeds ${MAX_KEY_BYTES} UTF-8 bytes (got ${bytes})`,
    );
  }
}

/**
 * @param {unknown} value
 * @returns {asserts value is string}
 */
export function assertValidValue(value) {
  if (typeof value !== 'string') {
    throw new CacheError('INVALID_VALUE_TYPE', 'value must be a string');
  }
  // Empty string is allowed.
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_VALUE_BYTES) {
    throw new CacheError(
      'VALUE_TOO_LARGE',
      `value exceeds ${MAX_VALUE_BYTES} UTF-8 bytes (got ${bytes})`,
    );
  }
}

/**
 * Validate optional EX seconds for SET.
 * @param {unknown} ex
 * @returns {asserts ex is number}
 */
export function assertValidEx(ex) {
  if (typeof ex !== 'number' || !Number.isFinite(ex)) {
    throw new CacheError('INVALID_EX', 'EX must be a finite number of seconds');
  }
  if (!Number.isInteger(ex) || ex <= 0) {
    throw new CacheError('INVALID_EX', 'EX must be a positive integer (seconds)');
  }
}
