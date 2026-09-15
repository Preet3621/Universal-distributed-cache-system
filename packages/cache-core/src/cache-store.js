import { assertValidKey, assertValidValue, assertValidEx } from './limits.js';
import { CacheError } from './errors.js';
import { LruList } from './lru-list.js';

/** TTL response when the key does not exist (or was lazily expired). */
export const TTL_KEY_MISSING = -2;

/** TTL response when the key exists but has no associated expiry. */
export const TTL_NO_EXPIRY = -1;

/** Default keys examined per background sweep tick. */
export const DEFAULT_SWEEP_MAX_EXAMINED = 20;

/** Default background sweep interval (ms). */
export const DEFAULT_SWEEP_INTERVAL_MS = 1000;

/**
 * Approximate payload size: UTF-8 bytes of key + value (no object overhead).
 * @param {string} key
 * @param {string} value
 * @returns {number}
 */
export function entrySizeBytes(key, value) {
  return Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
}

/**
 * @typedef {{ value: string, expiresAt: number | null, sizeBytes: number }} CacheEntry
 * @typedef {{ setInterval: typeof setInterval, clearInterval: typeof clearInterval }} Scheduler
 */

/**
 * In-process key-value cache store.
 * Values are opaque UTF-8 strings.
 * Expiration: lazy on access + optional active sweeper (no per-key timers).
 * Eviction: optional maxEntries / maxMemoryBytes with O(1) LRU.
 */
export class CacheStore {
  /**
   * @param {{
   *   now?: () => number,
   *   scheduler?: Scheduler,
   *   sweeper?: { intervalMs?: number, maxExamined?: number },
   *   maxEntries?: number,
   *   maxMemoryBytes?: number,
   * }} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, CacheEntry>} */
    this.store = new Map();

    /** @type {LruList} */
    this.#lru = new LruList();

    /** Keys removed by lazy or active expiration (observability). */
    this.expirations = 0;

    /** Keys removed by LRU eviction when at capacity (observability). */
    this.evictions = 0;

    /** Successful get hits (live key). */
    this.hits = 0;

    /** get misses (missing or expired). */
    this.misses = 0;

    /** Approximate UTF-8 key+value bytes currently stored. */
    this.#memoryBytes = 0;

    if (options.now !== undefined && typeof options.now !== 'function') {
      throw new CacheError('INVALID_OPTIONS', 'now must be a function');
    }

    /** @type {() => number} */
    this.now = options.now ?? Date.now;

    /** @type {number | null} null = unlimited */
    this.#maxEntries = null;
    if (options.maxEntries !== undefined) {
      if (
        typeof options.maxEntries !== 'number' ||
        !Number.isInteger(options.maxEntries) ||
        options.maxEntries <= 0
      ) {
        throw new CacheError(
          'INVALID_OPTIONS',
          'maxEntries must be a positive integer',
        );
      }
      this.#maxEntries = options.maxEntries;
    }

    /** @type {number | null} null = unlimited */
    this.#maxMemoryBytes = null;
    if (options.maxMemoryBytes !== undefined) {
      if (
        typeof options.maxMemoryBytes !== 'number' ||
        !Number.isInteger(options.maxMemoryBytes) ||
        options.maxMemoryBytes <= 0
      ) {
        throw new CacheError(
          'INVALID_OPTIONS',
          'maxMemoryBytes must be a positive integer',
        );
      }
      this.#maxMemoryBytes = options.maxMemoryBytes;
    }

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

  /** @type {LruList} */
  #lru;

  /** @type {number | null} */
  #maxEntries;

  /** @type {number | null} */
  #maxMemoryBytes;

  /** @type {number} */
  #memoryBytes;

  /** @type {Scheduler} */
  #scheduler;

  /** @type {ReturnType<typeof setInterval> | null} */
  #sweeperId;

  /** @type {number} */
  #sweepCursor;

  /**
   * @returns {number | null}
   */
  get maxEntries() {
    return this.#maxEntries;
  }

  /**
   * @returns {number | null}
   */
  get maxMemoryBytes() {
    return this.#maxMemoryBytes;
  }

  /**
   * Approximate UTF-8 key+value bytes in the store (not V8 heap RSS).
   * @returns {number}
   */
  get memoryBytes() {
    return this.#memoryBytes;
  }

  /**
   * hits / (hits + misses), or 0 when no gets yet.
   * @returns {number}
   */
  get hitRatio() {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  /**
   * Store or overwrite a key. Optional EX sets TTL in whole seconds.
   * Overwrite replaces value and TTL metadata (no KEEPTTL).
   * New keys / larger values may trigger LRU eviction when limits are set.
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

    const sizeBytes = entrySizeBytes(key, value);
    if (this.#maxMemoryBytes !== null && sizeBytes > this.#maxMemoryBytes) {
      throw new CacheError(
        'ENTRY_TOO_LARGE',
        `key+value size ${sizeBytes} exceeds maxMemoryBytes ${this.#maxMemoryBytes}`,
      );
    }

    // Drop a stale same-key so capacity / isNew stay accurate.
    this.#getLiveEntry(key);
    const existing = this.store.get(key);
    const isNew = existing === undefined;
    const oldSizeBytes = existing === undefined ? 0 : existing.sizeBytes;

    this.#ensureCapacity({ key, isNew, sizeBytes, oldSizeBytes });

    if (existing !== undefined) {
      this.#memoryBytes -= oldSizeBytes;
    }

    this.store.set(key, { value, expiresAt, sizeBytes });
    this.#memoryBytes += sizeBytes;
    this.#lru.add(key);
  }

  /**
   * @param {string} key
   * @returns {string | undefined} value, or undefined on miss / expired
   */
  get(key) {
    assertValidKey(key);
    const entry = this.#getLiveEntry(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.#lru.touch(key);
    this.hits += 1;
    return entry.value;
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
    return this.#removeStoredKey(key, 'delete');
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
        this.#removeStoredKey(key, 'expire');
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
   * @param {{ key: string, isNew: boolean, sizeBytes: number, oldSizeBytes: number }} args
   */
  #ensureCapacity({ key, isNew, sizeBytes, oldSizeBytes }) {
    if (isNew && this.#maxEntries !== null) {
      while (this.store.size >= this.#maxEntries) {
        if (!this.#evictOne(key)) {
          break;
        }
      }
    }

    if (this.#maxMemoryBytes !== null) {
      // Prefer evicting other keys when resizing an existing entry.
      if (!isNew) {
        this.#lru.touch(key);
      }

      while (this.#memoryBytes - oldSizeBytes + sizeBytes > this.#maxMemoryBytes) {
        if (!this.#evictOne(key)) {
          break;
        }
      }

      if (this.#memoryBytes - oldSizeBytes + sizeBytes > this.#maxMemoryBytes) {
        throw new CacheError(
          'ENTRY_TOO_LARGE',
          `cannot free enough memory for key+value size ${sizeBytes}`,
        );
      }
    }
  }

  /**
   * Evict or expire one LRU victim. Skips `protectKey` (key being written).
   * @param {string} protectKey
   * @returns {boolean} true if a key was removed
   */
  #evictOne(protectKey) {
    const victim = this.#lru.peekLru();
    if (victim === undefined || victim === protectKey) {
      return false;
    }

    const victimEntry = this.store.get(victim);
    const expired =
      victimEntry !== undefined &&
      victimEntry.expiresAt !== null &&
      this.now() >= victimEntry.expiresAt;

    this.#removeStoredKey(victim, expired ? 'expire' : 'evict');
    return true;
  }

  /**
   * @param {string} key
   * @param {'delete' | 'expire' | 'evict'} reason
   * @returns {boolean}
   */
  #removeStoredKey(key, reason) {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return false;
    }
    this.store.delete(key);
    this.#lru.remove(key);
    this.#memoryBytes -= entry.sizeBytes;
    if (reason === 'expire') {
      this.expirations += 1;
    } else if (reason === 'evict') {
      this.evictions += 1;
    }
    return true;
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
      this.#removeStoredKey(key, 'expire');
      return undefined;
    }
    return entry;
  }
}
