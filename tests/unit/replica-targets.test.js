import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HashRing, nodesForCount } from '../../packages/hashing/index.js';
import {
  replicaPeerIndices,
  isPrimaryForKey,
  buildClusterReplicationConfig,
} from '../../packages/replication/index.js';

describe('replicaPeerIndices', () => {
  it('excludes self and returns stable peers for RF=3', () => {
    const config = buildClusterReplicationConfig({
      nodeId: 'n0',
      nodes: [
        { id: 'n0', host: '127.0.0.1', port: 6371 },
        { id: 'n1', host: '127.0.0.1', port: 6372 },
        { id: 'n2', host: '127.0.0.1', port: 6373 },
      ],
      replicationFactor: 3,
    });
    const key = 'user:1';
    const peers = replicaPeerIndices(
      config.ring,
      key,
      config.replicationFactor,
      config.myNodeIndex,
    );
    assert.equal(peers.length, 2);
    assert.ok(!peers.includes(config.myNodeIndex));
    assert.deepEqual(
      peers,
      replicaPeerIndices(
        config.ring,
        key,
        config.replicationFactor,
        config.myNodeIndex,
      ),
    );
  });

  it('isPrimaryForKey matches ring lookup', () => {
    const ring = new HashRing({ nodes: nodesForCount(3) });
    const key = 'k';
    const primary = ring.lookup(key);
    assert.equal(isPrimaryForKey(ring, key, primary), true);
    assert.equal(isPrimaryForKey(ring, key, (primary + 1) % 3), false);
  });
});
