import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashKey,
  pickNodeIndex,
  remappingFraction,
  ROUTING_FIXTURE_KEYS,
  assertPositiveNodeCount,
} from '../../packages/client/src/modulo-router.js';

describe('modulo-router hashKey', () => {
  it('returns the same value for the same key', () => {
    assert.equal(hashKey('user:1'), hashKey('user:1'));
  });

  it('returns different values for different keys', () => {
    assert.notEqual(hashKey('a'), hashKey('b'));
  });
});

describe('modulo-router pickNodeIndex', () => {
  it('is stable for the same key and N', () => {
    const idx = pickNodeIndex('user:1', 3);
    assert.equal(pickNodeIndex('user:1', 3), idx);
  });

  it('distributes fixture keys across N=3', () => {
    const seen = new Set();
    for (const key of ROUTING_FIXTURE_KEYS) {
      seen.add(pickNodeIndex(key, 3));
    }
    assert.equal(seen.size, 3);
  });

  it('uses injectable hash function', () => {
    const alwaysZero = () => 0;
    assert.equal(pickNodeIndex('any', 5, alwaysZero), 0);
    assert.equal(pickNodeIndex('other', 5, alwaysZero), 0);
  });

  it('rejects invalid nodeCount', () => {
    assert.throws(() => pickNodeIndex('k', 0), RangeError);
    assert.throws(() => assertPositiveNodeCount(0), RangeError);
  });
});

describe('modulo-router remapping', () => {
  it('remaps most keys when N changes from 3 to 4', () => {
    const fraction = remappingFraction(ROUTING_FIXTURE_KEYS, 3, 4);
    assert.ok(
      fraction >= 0.5,
      `expected >= 50% remapping, got ${fraction * 100}%`,
    );
  });
});
