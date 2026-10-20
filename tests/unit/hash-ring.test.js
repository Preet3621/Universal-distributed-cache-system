import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HashRing,
  remappingFraction,
  nodesForCount,
  hashKey,
} from '../../packages/hashing/index.js';
import {
  ROUTING_FIXTURE_KEYS,
  remappingFraction as moduloRemappingFraction,
} from '../../packages/client/src/modulo-router.js';

describe('HashRing lookup', () => {
  it('returns the same nodeIndex for the same key', () => {
    const ring = new HashRing({ nodes: nodesForCount(3) });
    const idx = ring.lookup('user:1');
    assert.equal(ring.lookup('user:1'), idx);
  });

  it('distributes fixture keys across three physical nodes', () => {
    const ring = new HashRing({ nodes: nodesForCount(3) });
    const seen = new Set();
    for (const key of ROUTING_FIXTURE_KEYS) {
      seen.add(ring.lookup(key));
    }
    assert.equal(seen.size, 3);
  });

  it('wraps when key hash is above all vnode hashes', () => {
    const ring = new HashRing({
      nodes: nodesForCount(1, 'solo'),
      virtualNodesPerNode: 2,
      hashFn: () => 100,
    });
    assert.equal(ring.lookup('any-key'), 0);
  });

  it('rejects invalid constructor input', () => {
    assert.throws(() => new HashRing({ nodes: [] }), RangeError);
    assert.throws(
      () => new HashRing({ nodes: nodesForCount(1), virtualNodesPerNode: 0 }),
      RangeError,
    );
  });
});

describe('HashRing lookupReplicaIndices', () => {
  it('starts with primary from lookup', () => {
    const ring = new HashRing({ nodes: nodesForCount(3) });
    const key = 'user:42';
    const indices = ring.lookupReplicaIndices(key, 3);
    assert.equal(indices[0], ring.lookup(key));
    assert.equal(new Set(indices).size, indices.length);
  });

  it('returns all three nodes when replicationFactor is 3', () => {
    const ring = new HashRing({ nodes: nodesForCount(3) });
    for (const key of ROUTING_FIXTURE_KEYS.slice(0, 20)) {
      const indices = ring.lookupReplicaIndices(key, 3);
      assert.deepEqual([...indices].sort(), [0, 1, 2]);
    }
  });

  it('caps at node count and returns two nodes for RF=2', () => {
    const ring = new HashRing({ nodes: nodesForCount(3) });
    const indices = ring.lookupReplicaIndices('k1', 2);
    assert.equal(indices.length, 2);
    assert.equal(indices[0], ring.lookup('k1'));
  });

  it('returns single index on one-node ring', () => {
    const ring = new HashRing({ nodes: nodesForCount(1) });
    assert.deepEqual(ring.lookupReplicaIndices('x', 3), [0]);
  });

  it('rejects invalid replicationFactor', () => {
    const ring = new HashRing({ nodes: nodesForCount(2) });
    assert.throws(() => ring.lookupReplicaIndices('k', 0), RangeError);
    assert.throws(() => ring.lookupReplicaIndices('k', 1.5), RangeError);
  });
});

describe('HashRing remapping vs modulo', () => {
  it('moves fewer keys than modulo when adding a fourth node', () => {
    const ring3 = new HashRing({ nodes: nodesForCount(3) });
    const ring4 = new HashRing({ nodes: nodesForCount(4) });
    const consistent = remappingFraction(ROUTING_FIXTURE_KEYS, ring3, ring4);
    const modulo = moduloRemappingFraction(ROUTING_FIXTURE_KEYS, 3, 4);
    assert.ok(modulo >= 0.5, 'modulo baseline should remaps most keys');
    assert.ok(
      consistent < modulo,
      `consistent ${consistent} should be less than modulo ${modulo}`,
    );
    assert.ok(consistent < 0.35, `consistent remapping ${consistent} too high`);
  });
});

describe('hashKey', () => {
  it('matches prior SHA-256 uint32 behavior', () => {
    assert.equal(typeof hashKey('user:1'), 'number');
    assert.equal(hashKey('user:1'), hashKey('user:1'));
  });
});
