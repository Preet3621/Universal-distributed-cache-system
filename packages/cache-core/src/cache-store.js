import { assertValidKey, assertValidValue, assertValidEx } from './limits.js';
import { CacheError } from './errors.js';

/** TTL response when the key does not exist (or was lazily expired). */
export const TTL_KEY_MISSING = -2;

/** TTL response when the key exists but has no associated expiry. */
export const TTL_NO_EXPIRY = -1;

/** Default keys examined per background sweep tick. */
export const DEFAULT_SWEEP_MAX_EXAMINED = 20;

/** Default background sweep interval (ms). */
export const DEFAULT_SWEEP_INTERVAL_MS = 1000;

/**
 * @typedef {{ value: string, expiresAt: number | null }} CacheEntry
 * @typedef {{ setInterval: typeof setInterval, clearInterval: typeof clearInterval }} Scheduler
 */

/**
 * In-process key-value cache store.
 * Values are opaque UTF-8 strings.
 * Expiration: lazy on access + optional active background sweeper (no per-key timers).
 */
export class CacheStore {
  /**
   * @param {{
   *   now?: () => number,
   *   scheduler?: Scheduler,
   *   sweeper?: { intervalMs?: number, maxExamined?: number },
   * }} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, CacheEntry>} */
    this.store = new Map();

    /** Keys removed by lazy or active expiration (observability). */
    this.expirations = 0;

    if (options.now !== undefined && typeof options.now !== 'function') {
      throw new CacheError('INVALID_OPTIONS', 'now must be a function');
    }

    /** @type {() => number} */
    this.now = options.now ?? Date.now;

    /** @type {Scheduler} */
    this.#scheduler = options.scheduler ?? {
      setInterval,
      clearInterval,
    };

    /** @type {ReturnType<typeof setInterval> | null} */
    this.#sweeperId = null;

    /** Round-robin index into a key snapshot for active sweeps. */
    this.#sweepCursor = 0;

    if (options.sweeper !== undefined) {
      if (
        options.sweeper === null ||
        typeof options.sweeper !== 'object' ||
        Array.isArray(options.sweeper)
      ) {
        throw new CacheError('INVALID_OPTIONS', 'sweeper must be a plain object');
      }
      this.startSweeper(options.sweeper);
    }
  }

  /** @type {Scheduler} */
  #scheduler;

  /** @type {ReturnType<typeof setInterval> | null} */
  #sweeperId;

  /** @type {number} */
  #sweepCursor;

  /**
   * Store or overwrite a key. Optional EX sets TTL in whole seconds.
   * Overwrite replaces value and TTL metadata (no KEEPTTL).
   *
   * @param {string} key
   * @param {string} value
   * @param {{ ex?: number }} [options]
   */
  set(key, value, options = {}) {
    assertValidKey(key);
    assertValidValue(value);

    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new CacheError('INVALID_OPTIONS', 'options must be a plain object');
    }

    let expiresAt = null;
    if (options.ex !== undefined) {
      assertValidEx(options.ex);
      expiresAt = this.now() + options.ex * 1000;
    }

    this.store.set(key, { value, expiresAt });
  }

  /**
   * @param {string} key
   * @returns {string | undefined} value, or undefined on miss / expired
   */
  get(key) {
    assertValidKey(key);
    const entry = this.#getLiveEntry(key);
    return entry === undefined ? undefined : entry.value;
  }

  /**
   * @param {string} key
   * @returns {boolean} true if a live key was removed
   */
  delete(key) {
    assertValidKey(key);
    // Expire first so deleting an already-expired key returns false.
    if (this.#getLiveEntry(key) === undefined) {
      return false;
    }
    return this.store.delete(key);
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  exists(key) {
    assertValidKey(key);
    return this.#getLiveEntry(key) !== undefined;
  }

  /**
   * Remaining TTL in whole seconds.
   * @param {string} key
   * @returns {number} -2 missing/expired, -1 no expiry, else >= 0 seconds left
   */
  ttl(key) {
    assertValidKey(key);
    const entry = this.#getLiveEntry(key);
    if (entry === undefined) {
      return TTL_KEY_MISSING;
    }
    if (entry.expiresAt === null) {
      return TTL_NO_EXPIRY;
    }
    const remainingMs = entry.expiresAt - this.now();
    return Math.max(0, Math.floor(remainingMs / 1000));
  }

  /**
   * Actively purge expired keys (best-effort). Examines up to `maxExamined`
   * entries in round-robin order — not one timer per key.
   *
   * @param {{ maxExamined?: number }} [options]
   * @returns {number} number of keys removed
   */
  purgeExpired(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new CacheError('INVALID_OPTIONS', 'options must be a plain object');
    }

    const maxExamined = options.maxExamined ?? Number.POSITIVE_INFINITY;
    if (maxExamined !== Number.POSITIVE_INFINITY) {
      if (typeof maxExamined !== 'number' || !Number.isInteger(maxExamined) || maxExamined <= 0) {
        throw new CacheError(
          'INVALID_OPTIONS',
          'maxExamined must be a positive integer',
        );
      }
    }

    const size = this.store.size;
    if (size === 0) {
      this.#sweepCursor = 0;
      return 0;
    }

    const keys = [...this.store.keys()];
    const toExamine =
      maxExamined === Number.POSITIVE_INFINITY
        ? keys.length
        : Math.min(maxExamined, keys.length);

    const now = this.now();
    let purged = 0;

    for (let i = 0; i < toExamine; i++) {
      const idx = (this.#sweepCursor + i) % keys.length;
      const key = keys[idx];
      const entry = this.store.get(key);
      if (entry === undefined) {
        continue;
      }
      if (entry.expiresAt !== null && now >= entry.expiresAt) {
        this.store.delete(key);
        this.expirations += 1;
        purged += 1;
      }
    }

    this.#sweepCursor = (this.#sweepCursor + toExamine) % keys.length;
    if (this.store.size === 0) {
      this.#sweepCursor = 0;
    }
    return purged;
  }

  /**
   * Start a single shared interval that samples keys and purges expired ones.
   * Replaces any existing sweeper. Best-effort — not exact-millisecond.
   *
   * @param {{ intervalMs?: number, maxExamined?: number }} [options]
   */
  startSweeper(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new CacheError('INVALID_OPTIONS', 'options must be a plain object');
    }

    const intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    const maxExamined = options.maxExamined ?? DEFAULT_SWEEP_MAX_EXAMINED;

    if (typeof intervalMs !== 'number' || !Number.isInteger(intervalMs) || intervalMs <= 0) {
      throw new CacheError('INVALID_OPTIONS', 'intervalMs must be a positive integer');
    }
    if (typeof maxExamined !== 'number' || !Number.isInteger(maxExamined) || maxExamined <= 0) {
      throw new CacheError('INVALID_OPTIONS', 'maxExamined must be a positive integer');
    }

    this.stopSweeper();
    this.#sweeperId = this.#scheduler.setInterval(() => {
      this.purgeExpired({ maxExamined });
    }, intervalMs);
  }

  /**
   * Stop the background sweeper if running.
   */
  stopSweeper() {
    if (this.#sweeperId !== null) {
      this.#scheduler.clearInterval(this.#sweeperId);
      this.#sweeperId = null;
    }
  }

  /**
   * @returns {boolean}
   */
  isSweeperRunning() {
    return this.#sweeperId !== null;
  }

  /**
   * Return the live entry, or undefined after lazy purge.
   * @param {string} key
   * @returns {CacheEntry | undefined}
   */
  #getLiveEntry(key) {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt !== null && this.now() >= entry.expiresAt) {
      this.store.delete(key);
      this.expirations += 1;
      return undefined;
    }
    return entry;
  }
}
