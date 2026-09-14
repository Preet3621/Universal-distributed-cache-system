import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CacheStore,
  CacheError,
  MAX_KEY_BYTES,
  MAX_VALUE_BYTES,
  TTL_KEY_MISSING,
  TTL_NO_EXPIRY,
} from '../../packages/cache-core/index.js';

function createClock(startMs = 1_000_000) {
  let now = startMs;
  return {
    now: () => now,
    /** @param {number} ms */
    advance(ms) {
      now += ms;
    },
    /** @param {number} ms */
    set(ms) {
      now = ms;
    },
  };
}

describe('CacheStore', () => {
  it('sets and gets a value', () => {
    const cache = new CacheStore();
    cache.set('user:1', 'Prit');
    assert.equal(cache.get('user:1'), 'Prit');
  });

  it('returns undefined on miss', () => {
    const cache = new CacheStore();
    assert.equal(cache.get('missing'), undefined);
  });

  it('deletes an existing key', () => {
    const cache = new CacheStore();
    cache.set('a', '1');
    assert.equal(cache.delete('a'), true);
    assert.equal(cache.get('a'), undefined);
  });

  it('delete on missing key returns false', () => {
    const cache = new CacheStore();
    assert.equal(cache.delete('missing'), false);
  });

  it('exists reports presence', () => {
    const cache = new CacheStore();
    cache.set('k', 'v');
    assert.equal(cache.exists('k'), true);
    assert.equal(cache.exists('other'), false);
  });

  it('set overwrites an existing key', () => {
    const cache = new CacheStore();
    cache.set('k', 'one');
    cache.set('k', 'two');
    assert.equal(cache.get('k'), 'two');
  });

  it('allows empty string values', () => {
    const cache = new CacheStore();
    cache.set('empty', '');
    assert.equal(cache.get('empty'), '');
    assert.equal(cache.exists('empty'), true);
  });

  it('ttl is -1 when key has no expiry', () => {
    const cache = new CacheStore();
    cache.set('k', 'v');
    assert.equal(cache.ttl('k'), TTL_NO_EXPIRY);
  });

  it('ttl is -2 for missing key', () => {
    const cache = new CacheStore();
    assert.equal(cache.ttl('missing'), TTL_KEY_MISSING);
  });
});

describe('CacheStore validation', () => {
  it('rejects empty key on set', () => {
    const cache = new CacheStore();
    assert.throws(
      () => cache.set('', 'v'),
      (err) => err instanceof CacheError && err.code === 'EMPTY_KEY',
    );
  });

  it('rejects empty key on get/delete/exists/ttl', () => {
    const cache = new CacheStore();
    for (const op of [
      () => cache.get(''),
      () => cache.delete(''),
      () => cache.exists(''),
      () => cache.ttl(''),
    ]) {
      assert.throws(
        op,
        (err) => err instanceof CacheError && err.code === 'EMPTY_KEY',
      );
    }
  });

  it('rejects non-string key', () => {
    const cache = new CacheStore();
    assert.throws(
      () => cache.set(/** @type {any} */ (1), 'v'),
      (err) => err instanceof CacheError && err.code === 'INVALID_KEY_TYPE',
    );
  });

  it('rejects non-string value', () => {
    const cache = new CacheStore();
    assert.throws(
      () => cache.set('k', /** @type {any} */ (42)),
      (err) => err instanceof CacheError && err.code === 'INVALID_VALUE_TYPE',
    );
  });

  it('rejects key longer than max UTF-8 bytes', () => {
    const cache = new CacheStore();
    const key = 'a'.repeat(MAX_KEY_BYTES + 1);
    assert.throws(
      () => cache.set(key, 'v'),
      (err) => err instanceof CacheError && err.code === 'KEY_TOO_LARGE',
    );
    assert.equal(cache.store.size, 0);
  });

  it('accepts key at exactly max UTF-8 bytes', () => {
    const cache = new CacheStore();
    const key = 'a'.repeat(MAX_KEY_BYTES);
    cache.set(key, 'ok');
    assert.equal(cache.get(key), 'ok');
  });

  it('counts multi-byte UTF-8 characters toward key limit', () => {
    const cache = new CacheStore();
    // 'é' is 2 bytes in UTF-8; 129 of them => 258 bytes > 256
    const key = 'é'.repeat(129);
    assert.ok(Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES);
    assert.throws(
      () => cache.set(key, 'v'),
      (err) => err instanceof CacheError && err.code === 'KEY_TOO_LARGE',
    );
  });

  it('rejects value larger than max UTF-8 bytes', () => {
    const cache = new CacheStore();
    const value = 'x'.repeat(MAX_VALUE_BYTES + 1);
    assert.throws(
      () => cache.set('k', value),
      (err) => err instanceof CacheError && err.code === 'VALUE_TOO_LARGE',
    );
    assert.equal(cache.exists('k'), false);
  });

  it('does not mutate store when validation fails', () => {
    const cache = new CacheStore();
    cache.set('keep', 'me');
    assert.throws(() => cache.set('', 'nope'));
    assert.throws(() => cache.set('k', /** @type {any} */ (null)));
    assert.equal(cache.get('keep'), 'me');
    assert.equal(cache.store.size, 1);
  });

  it('rejects invalid EX values', () => {
    const cache = new CacheStore();
    const cases = [0, -1, 1.5, NaN, Infinity, '5', null];
    for (const ex of cases) {
      assert.throws(
        () => cache.set('k', 'v', { ex: /** @type {any} */ (ex) }),
        (err) => err instanceof CacheError && err.code === 'INVALID_EX',
      );
    }
    assert.equal(cache.store.size, 0);
  });

  it('rejects non-object set options', () => {
    const cache = new CacheStore();
    assert.throws(
      () => cache.set('k', 'v', /** @type {any} */ (null)),
      (err) => err instanceof CacheError && err.code === 'INVALID_OPTIONS',
    );
  });
});

describe('CacheStore lazy TTL', () => {
  it('returns value before expiry and miss after', () => {
    const clock = createClock();
    const cache = new CacheStore({ now: clock.now });

    cache.set('k', 'v', { ex: 10 });
    assert.equal(cache.get('k'), 'v');
    assert.equal(cache.exists('k'), true);
    assert.equal(cache.ttl('k'), 10);

    clock.advance(9_999);
    assert.equal(cache.get('k'), 'v');
    assert.equal(cache.ttl('k'), 0);

    clock.advance(1);
    assert.equal(cache.get('k'), undefined);
    assert.equal(cache.exists('k'), false);
    assert.equal(cache.ttl('k'), TTL_KEY_MISSING);
    assert.equal(cache.store.has('k'), false);
  });

  it('delete on expired key returns false and purges', () => {
    const clock = createClock();
    const cache = new CacheStore({ now: clock.now });

    cache.set('k', 'v', { ex: 1 });
    clock.advance(1000);
    assert.equal(cache.delete('k'), false);
    assert.equal(cache.store.has('k'), false);
  });

  it('overwrite without EX clears previous TTL', () => {
    const clock = createClock();
    const cache = new CacheStore({ now: clock.now });

    cache.set('k', 'v', { ex: 5 });
    cache.set('k', 'v2');
    assert.equal(cache.ttl('k'), TTL_NO_EXPIRY);

    clock.advance(10_000);
    assert.equal(cache.get('k'), 'v2');
  });

  it('overwrite with EX replaces TTL from now', () => {
    const clock = createClock();
    const cache = new CacheStore({ now: clock.now });

    cache.set('k', 'v', { ex: 5 });
    clock.advance(3000);
    cache.set('k', 'v2', { ex: 10 });
    assert.equal(cache.ttl('k'), 10);

    clock.advance(9999);
    assert.equal(cache.get('k'), 'v2');
    clock.advance(1);
    assert.equal(cache.get('k'), undefined);
  });

  it('allows empty value with EX', () => {
    const clock = createClock();
    const cache = new CacheStore({ now: clock.now });

    cache.set('empty', '', { ex: 2 });
    assert.equal(cache.get('empty'), '');
    assert.equal(cache.ttl('empty'), 2);

    clock.advance(2000);
    assert.equal(cache.get('empty'), undefined);
  });

  it('expires exactly at expiresAt boundary (now >= expiresAt)', () => {
    const clock = createClock(5_000);
    const cache = new CacheStore({ now: clock.now });

    cache.set('k', 'v', { ex: 1 }); // expiresAt = 6000
    clock.set(5999);
    assert.equal(cache.exists('k'), true);
    clock.set(6000);
    assert.equal(cache.exists('k'), false);
  });

  it('does not use per-key timers (lazy only)', () => {
    const clock = createClock();
    const cache = new CacheStore({ now: clock.now });

    cache.set('stale', 'x', { ex: 1 });
    clock.advance(5000);
    // Still physically present until touched.
    assert.equal(cache.store.has('stale'), true);
    assert.equal(cache.get('stale'), undefined);
    assert.equal(cache.store.has('stale'), false);
    assert.equal(cache.expirations, 1);
  });
});

describe('CacheStore active expiration', () => {
  it('purgeExpired removes expired keys without a read', () => {
    const clock = createClock();
    const cache = new CacheStore({ now: clock.now });

    cache.set('a', '1', { ex: 1 });
    cache.set('b', '2'); // no TTL
    cache.set('c', '3', { ex: 5 });

    clock.advance(1000);
    assert.equal(cache.store.has('a'), true);

    const purged = cache.purgeExpired();
    assert.equal(purged, 1);
    assert.equal(cache.store.has('a'), false);
    assert.equal(cache.store.has('b'), true);
    assert.equal(cache.store.has('c'), true);
    assert.equal(cache.expirations, 1);
  });

  it('purgeExpired respects maxExamined and round-robins', () => {
    const clock = createClock();
    const cache = new CacheStore({ now: clock.now });

    cache.set('k0', 'v', { ex: 1 });
    cache.set('k1', 'v', { ex: 1 });
    cache.set('k2', 'v', { ex: 1 });
    clock.advance(1000);

    assert.equal(cache.purgeExpired({ maxExamined: 2 }), 2);
    assert.equal(cache.store.size, 1);

    assert.equal(cache.purgeExpired({ maxExamined: 2 }), 1);
    assert.equal(cache.store.size, 0);
    assert.equal(cache.expirations, 3);
  });

  it('purgeExpired skips live keys and returns 0 when nothing expired', () => {
    const clock = createClock();
    const cache = new CacheStore({ now: clock.now });

    cache.set('live', 'v', { ex: 10 });
    cache.set('forever', 'v');
    assert.equal(cache.purgeExpired(), 0);
    assert.equal(cache.store.size, 2);
  });

  it('rejects invalid maxExamined', () => {
    const cache = new CacheStore();
    assert.throws(
      () => cache.purgeExpired({ maxExamined: 0 }),
      (err) => err instanceof CacheError && err.code === 'INVALID_OPTIONS',
    );
  });

  it('startSweeper invokes purge via injected scheduler', () => {
    const clock = createClock();
    /** @type {Array<() => void>} */
    const ticks = [];
    /** @type {{ id: number, cleared: boolean } | null} */
    let handle = null;
    let nextId = 1;

    const scheduler = {
      setInterval(fn, _ms) {
        handle = { id: nextId++, cleared: false };
        ticks.push(fn);
        return /** @type {any} */ (handle.id);
      },
      clearInterval(id) {
        if (handle && handle.id === id) {
          handle.cleared = true;
        }
      },
    };

    const cache = new CacheStore({ now: clock.now, scheduler });
    cache.set('stale', 'x', { ex: 1 });
    cache.set('live', 'y', { ex: 10 });

    cache.startSweeper({ intervalMs: 100, maxExamined: 10 });
    assert.equal(cache.isSweeperRunning(), true);
    assert.equal(ticks.length, 1);

    clock.advance(1000);
    ticks[0]();
    assert.equal(cache.store.has('stale'), false);
    assert.equal(cache.store.has('live'), true);

    cache.stopSweeper();
    assert.equal(cache.isSweeperRunning(), false);
    assert.equal(handle?.cleared, true);
  });

  it('constructor sweeper option auto-starts', () => {
    /** @type {Array<() => void>} */
    const ticks = [];
    const scheduler = {
      setInterval(fn) {
        ticks.push(fn);
        return 1;
      },
      clearInterval() {},
    };

    const cache = new CacheStore({
      scheduler,
      sweeper: { intervalMs: 50, maxExamined: 5 },
    });
    assert.equal(cache.isSweeperRunning(), true);
    assert.equal(ticks.length, 1);
    cache.stopSweeper();
  });

  it('startSweeper replaces previous interval', () => {
    const cleared = [];
    let id = 0;
    const scheduler = {
      setInterval(_fn) {
        return ++id;
      },
      clearInterval(timerId) {
        cleared.push(timerId);
      },
    };

    const cache = new CacheStore({ scheduler });
    cache.startSweeper({ intervalMs: 10 });
    cache.startSweeper({ intervalMs: 20 });
    assert.deepEqual(cleared, [1]);
    cache.stopSweeper();
    assert.deepEqual(cleared, [1, 2]);
  });
});
