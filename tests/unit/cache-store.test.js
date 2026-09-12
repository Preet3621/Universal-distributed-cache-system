import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CacheStore } from '../../packages/cache-core/index.js';

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
});
