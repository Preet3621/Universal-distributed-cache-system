/**
 * In-process key-value cache store (Phase 1).
 * Values are opaque UTF-8 strings. No TTL, eviction, or networking yet.
 */
export class CacheStore {
  constructor() {
    /** @type {Map<string, string>} */
    this.store = new Map();
  }

  /**
   * Store or overwrite a key.
   * @param {string} key
   * @param {string} value
   */
  set(key, value) {
    this.store.set(key, value);
  }

  /**
   * @param {string} key
   * @returns {string | undefined} value, or undefined on miss
   */
  get(key) {
    return this.store.get(key);
  }

  /**
   * @param {string} key
   * @returns {boolean} true if a key was removed
   */
  delete(key) {
    return this.store.delete(key);
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  exists(key) {
    return this.store.has(key);
  }
}
