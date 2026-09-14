/**
 * Explicit cache error. Distinguishable from a cache miss (undefined).
 */
export class CacheError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'CacheError';
    this.code = code;
  }
}
