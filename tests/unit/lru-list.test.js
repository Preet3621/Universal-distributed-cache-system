import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LruList } from '../../packages/cache-core/index.js';

describe('LruList', () => {
  it('add makes key MRU and evictLru removes oldest', () => {
    const lru = new LruList();
    lru.add('a');
    lru.add('b');
    lru.add('c');
    assert.equal(lru.peekMru(), 'c');
    assert.equal(lru.peekLru(), 'a');
    assert.equal(lru.evictLru(), 'a');
    assert.equal(lru.evictLru(), 'b');
    assert.equal(lru.evictLru(), 'c');
    assert.equal(lru.evictLru(), undefined);
    assert.equal(lru.size, 0);
  });

  it('touch moves key to MRU', () => {
    const lru = new LruList();
    lru.add('a');
    lru.add('b');
    lru.add('c');
    lru.touch('a');
    assert.equal(lru.peekMru(), 'a');
    assert.equal(lru.peekLru(), 'b');
    assert.equal(lru.evictLru(), 'b');
    assert.equal(lru.evictLru(), 'c');
    assert.equal(lru.evictLru(), 'a');
  });

  it('add on existing key acts like touch', () => {
    const lru = new LruList();
    lru.add('a');
    lru.add('b');
    lru.add('a');
    assert.equal(lru.size, 2);
    assert.equal(lru.peekMru(), 'a');
    assert.equal(lru.peekLru(), 'b');
  });

  it('remove unlinks from middle', () => {
    const lru = new LruList();
    lru.add('a');
    lru.add('b');
    lru.add('c');
    assert.equal(lru.remove('b'), true);
    assert.equal(lru.has('b'), false);
    assert.equal(lru.size, 2);
    assert.equal(lru.evictLru(), 'a');
    assert.equal(lru.evictLru(), 'c');
  });

  it('remove missing returns false', () => {
    const lru = new LruList();
    assert.equal(lru.remove('nope'), false);
  });

  it('touch on missing is a no-op', () => {
    const lru = new LruList();
    lru.add('a');
    lru.touch('missing');
    assert.equal(lru.peekMru(), 'a');
    assert.equal(lru.size, 1);
  });
});
