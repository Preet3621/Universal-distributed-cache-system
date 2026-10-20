import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CacheServer } from '../../apps/cache-node/src/server.js';
import {
  CacheClient,
  ClusterClient,
  HashRing,
  nodesForCount,
  ROUTING_FIXTURE_KEYS,
} from '../../packages/client/index.js';
import { formatReplCommand } from '../../packages/protocol/index.js';

/**
 * @param {string} host
 */
function normalizeHost(host) {
  if (host === '::' || host === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }
  return host;
}

/**
 * @param {number} count
 * @param {{ replicationFactor?: number, primaryBadPeer?: boolean }} [options]
 */
async function startReplicatedCluster(count, options = {}) {
  /** @type {CacheServer[]} */
  const servers = [];
  /** @type {Array<{ id: string, host: string, port: number }>} */
  const nodes = [];

  for (let i = 0; i < count; i++) {
    const server = new CacheServer({
      host: '127.0.0.1',
      port: 0,
      idleTimeoutMs: 60_000,
    });
    const addr = await server.listen();
    nodes.push({
      id: `n${i}`,
      host: normalizeHost(addr.host),
      port: addr.port,
    });
    servers.push(server);
  }

  const replicationFactor = options.replicationFactor ?? 3;
  const clientOptions = {
    connectTimeoutMs: 500,
    commandTimeoutMs: 500,
    maxReconnectAttempts: 1,
  };
  try {
    for (let i = 0; i < count; i++) {
      let clusterNodes = nodes;
      if (options.primaryBadPeer && i === 0) {
        clusterNodes = nodes.map((n, idx) =>
          idx === 1 ? { ...n, port: 9 } : n,
        );
      }
      servers[i].enableReplication({
        nodeId: `n${i}`,
        nodes: clusterNodes,
        replicationFactor,
        virtualNodesPerNode: 128,
        clientOptions,
      });
    }
  } catch (err) {
    await Promise.all(servers.map((s) => s.close({ timeoutMs: 500 })));
    throw err;
  }

  return { servers, nodes };
}

/**
 * @param {number} nodeCount
 * @returns {string}
 */
function keyOwnedByNode0(nodeCount) {
  const ring = new HashRing({ nodes: nodesForCount(nodeCount) });
  for (const key of ROUTING_FIXTURE_KEYS) {
    if (ring.lookup(key) === 0) {
      return key;
    }
  }
  throw new Error('no fixture key for node 0');
}

/**
 * @param {() => Promise<string | null>} read
 * @param {string | null} expected
 * @param {number} [timeoutMs]
 */
async function waitUntilGet(read, expected, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for value ${expected}`);
}

/**
 * @param {() => Promise<unknown>} fn
 * @param {number} [timeoutMs]
 */
async function waitUntil(fn, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fn();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  await fn();
}

describe('replication integration', () => {
  /** @type {CacheServer[]} */
  let servers;
  /** @type {Array<{ id: string, host: string, port: number }>} */
  let nodes;

  before(async () => {
    ({ servers, nodes } = await startReplicatedCluster(3));
  });

  after(async () => {
    await Promise.all(servers.map((s) => s.close({ timeoutMs: 2_000 })));
  });

  it('replicates SET to peer nodes asynchronously', async () => {
    const key = keyOwnedByNode0(3);
    const cluster = new ClusterClient({ nodes });
    await cluster.set(key, 'replicated-value');
    await cluster.close();

    const peer1 = new CacheClient({ host: nodes[1].host, port: nodes[1].port });
    const peer2 = new CacheClient({ host: nodes[2].host, port: nodes[2].port });
    await peer1.connect();
    await peer2.connect();

    await waitUntilGet(() => peer1.get(key), 'replicated-value');
    await waitUntilGet(() => peer2.get(key), 'replicated-value');

    await peer1.close();
    await peer2.close();
  });

  it('replicates DEL to peer nodes', async () => {
    const key = keyOwnedByNode0(3);
    const cluster = new ClusterClient({ nodes });
    await cluster.set(key, 'gone-soon');
    await cluster.close();

    const peer1 = new CacheClient({ host: nodes[1].host, port: nodes[1].port });
    await peer1.connect();
    await waitUntilGet(() => peer1.get(key), 'gone-soon');
    await peer1.close();

    const cluster2 = new ClusterClient({ nodes });
    await cluster2.del(key);
    await cluster2.close();

    const peer1b = new CacheClient({ host: nodes[1].host, port: nodes[1].port });
    const peer2 = new CacheClient({ host: nodes[2].host, port: nodes[2].port });
    await peer1b.connect();
    await peer2.connect();
    await waitUntilGet(() => peer1b.get(key), null);
    await waitUntilGet(() => peer2.get(key), null);
    await peer1b.close();
    await peer2.close();
  });

  it('does not fan-out when applying REPL on a replica', async () => {
    const replica = new CacheClient({
      host: nodes[1].host,
      port: nodes[1].port,
    });
    await replica.connect();
    const line = formatReplCommand({
      name: 'SET',
      key: 'repl-only',
      value: 'x',
    }).trim();
    const res = await replica.executeRaw(line);
    assert.equal(res, 'OK');
    await replica.close();

    const stats = servers[1].getReplicationStats();
    assert.ok(stats);
    assert.equal(stats.peers.n0?.attempted ?? 0, 0);
    assert.equal(stats.peers.n2?.attempted ?? 0, 0);
  });
});

describe('replication failure stats', () => {
  it('returns OK to client when a peer is unreachable', async () => {
    const { servers, nodes } = await startReplicatedCluster(3, {
      primaryBadPeer: true,
    });
    try {
      const key = keyOwnedByNode0(3);
      const cluster = new ClusterClient({ nodes });
      await cluster.set(key, 'still-ok');
      await cluster.close();

      await waitUntil(async () => {
        const stats = servers[0].getReplicationStats();
        assert.ok(stats);
        const peer = stats.peers.n1;
        assert.ok(peer && peer.failed >= 1, 'expected replication failure for n1');
      });
    } finally {
      await Promise.all(servers.map((s) => s.close({ timeoutMs: 2_000 })));
    }
  });
});
