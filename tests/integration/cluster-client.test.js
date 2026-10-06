import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CacheServer } from '../../apps/cache-node/src/server.js';
import {
  CacheClient,
  ClusterClient,
  ClientError,
  pickNodeIndex,
  ROUTING_FIXTURE_KEYS,
} from '../../packages/client/index.js';

/**
 * @param {number} nodeCount
 * @returns {string[]}
 */
function keysForEachNode(nodeCount) {
  /** @type {Map<number, string>} */
  const found = new Map();
  for (const key of ROUTING_FIXTURE_KEYS) {
    const idx = pickNodeIndex(key, nodeCount);
    if (!found.has(idx)) {
      found.set(idx, key);
    }
    if (found.size === nodeCount) {
      break;
    }
  }
  if (found.size !== nodeCount) {
    throw new Error('could not find fixture keys for each node index');
  }
  return Array.from({ length: nodeCount }, (_, i) => {
    const key = found.get(i);
    assert.ok(key);
    return key;
  });
}

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
 */
async function startServers(count) {
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
    const host = normalizeHost(addr.host);
    servers.push(server);
    nodes.push({ id: `n${i}`, host, port: addr.port });
  }

  return { servers, nodes };
}

describe('ClusterClient integration', () => {
  /** @type {CacheServer[]} */
  let servers;
  /** @type {Array<{ id: string, host: string, port: number }>} */
  let nodes;

  before(async () => {
    ({ servers, nodes } = await startServers(3));
  });

  after(async () => {
    await Promise.all(
      servers.map((s) => s.close({ timeoutMs: 2_000 })),
    );
  });

  it('round-trips set/get/exists/ttl/del', async () => {
    const cluster = new ClusterClient({ nodes });
    await cluster.set('user:1', 'Prit');
    assert.equal(await cluster.get('user:1'), 'Prit');
    assert.equal(await cluster.exists('user:1'), true);
    assert.equal(await cluster.ttl('user:1'), -1);
    assert.equal(await cluster.del('user:1'), true);
    assert.equal(await cluster.get('user:1'), null);
    await cluster.close();
  });

  it('isolates data to the owning shard', async () => {
    const cluster = new ClusterClient({
      nodes,
      hashKey: () => 1,
    });
    await cluster.set('shard-key', 'only-on-n1');

    const node0 = new CacheClient({ host: nodes[0].host, port: nodes[0].port });
    assert.equal(await node0.get('shard-key'), null);
    await node0.close();

    assert.equal(await cluster.get('shard-key'), 'only-on-n1');
    await cluster.close();
  });

  it('handles concurrent commands on keys routed to different nodes', async () => {
    const keys = keysForEachNode(3);

    const cluster = new ClusterClient({ nodes });
    await Promise.all(keys.map((k) => cluster.set(k, `v-${k}`)));
    const values = await Promise.all(keys.map((k) => cluster.get(k)));
    assert.deepEqual(
      values,
      keys.map((k) => `v-${k}`),
    );
    await cluster.close();
  });

  it('ping succeeds when all nodes are up and fails when one is down', async () => {
    const local = await startServers(3);
    try {
      const cluster = new ClusterClient({ nodes: local.nodes });
      await cluster.ping();

      await local.servers[1].close({ timeoutMs: 2_000 });

      await assert.rejects(
        () => cluster.ping(),
        (err) =>
          err instanceof ClientError &&
          err.code === 'NODE_UNAVAILABLE' &&
          err.details?.nodeIndex === 1,
      );
      await cluster.close();
    } finally {
      await Promise.all(
        local.servers.map((s, i) =>
          i === 1 ? Promise.resolve() : s.close({ timeoutMs: 2_000 }),
        ),
      );
    }
  });

  it('returns NODE_UNAVAILABLE when the owning node is down', async () => {
    const local = await startServers(3);
    try {
      const cluster = new ClusterClient({
        nodes: local.nodes,
        hashKey: () => 1,
        maxReconnectAttempts: 1,
      });
      await cluster.set('owned-by-1', 'x');
      await local.servers[1].close({ timeoutMs: 2_000 });

      await assert.rejects(
        () => cluster.get('owned-by-1'),
        (err) =>
          err instanceof ClientError &&
          err.code === 'NODE_UNAVAILABLE' &&
          err.details?.nodeIndex === 1 &&
          err.details?.key === 'owned-by-1' &&
          err.details?.command === 'GET',
      );
      await cluster.close();
    } finally {
      await Promise.all(
        local.servers.map((s, i) =>
          i === 1 ? Promise.resolve() : s.close({ timeoutMs: 2_000 }),
        ),
      );
    }
  });

  it('still serves keys on other nodes when a non-owner is down', async () => {
    const local = await startServers(3);
    try {
      const cluster = new ClusterClient({
        nodes: local.nodes,
        hashKey: (key) => (key === 'on-b' ? 1 : 0),
      });
      await cluster.set('on-b', 'value-b');
      await local.servers[0].close({ timeoutMs: 2_000 });
      assert.equal(await cluster.get('on-b'), 'value-b');
      await cluster.close();
    } finally {
      await Promise.all(
        local.servers.map((s, i) =>
          i === 0 ? Promise.resolve() : s.close({ timeoutMs: 2_000 }),
        ),
      );
    }
  });

  it('passes through SERVER_ERROR for invalid keys', async () => {
    const cluster = new ClusterClient({ nodes });
    await assert.rejects(
      () => cluster.get(''),
      (err) =>
        err instanceof ClientError &&
        err.code === 'SERVER_ERROR' &&
        err.details?.command === 'GET',
    );
    await cluster.close();
  });

  it('with a single node routes all keys to index 0', async () => {
    const cluster = new ClusterClient({ nodes: [nodes[0]] });
    await cluster.set('solo', '1');
    assert.equal(await cluster.get('solo'), '1');
    await cluster.close();
  });

  it('rejects operations after close', async () => {
    const cluster = new ClusterClient({ nodes: [nodes[0]] });
    await cluster.close();
    await assert.rejects(
      () => cluster.get('k'),
      (err) => err instanceof ClientError && err.code === 'CLIENT_CLOSED',
    );
  });
});

describe('ClusterClient options validation', () => {
  it('rejects empty node list', () => {
    assert.throws(
      () => new ClusterClient({ nodes: [] }),
      (err) => err instanceof ClientError && err.code === 'INVALID_OPTIONS',
    );
  });

  it('rejects duplicate node addresses', () => {
    assert.throws(
      () =>
        new ClusterClient({
          nodes: [
            { host: '127.0.0.1', port: 6379 },
            { host: '127.0.0.1', port: 6379 },
          ],
        }),
      (err) => err instanceof ClientError && err.code === 'INVALID_OPTIONS',
    );
  });
});
