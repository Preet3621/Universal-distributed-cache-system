import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { CacheServer } from '../../apps/cache-node/src/server.js';
import { CacheClient, ClientError } from '../../packages/client/index.js';

describe('CacheClient integration', () => {
  /** @type {CacheServer} */
  let server;
  /** @type {string} */
  let host;
  /** @type {number} */
  let port;

  before(async () => {
    server = new CacheServer({
      host: '127.0.0.1',
      port: 0,
      idleTimeoutMs: 60_000,
    });
    const addr = await server.listen();
    host = addr.host === '::' ? '127.0.0.1' : addr.host;
    if (host === '::ffff:127.0.0.1') {
      host = '127.0.0.1';
    }
    port = addr.port;
  });

  after(async () => {
    await server.close({ timeoutMs: 2_000 });
  });

  it('ping and SET/GET round-trip', async () => {
    const client = new CacheClient({ host, port });
    await client.connect();
    await client.ping();
    await client.set('user:1', 'Prit');
    assert.equal(await client.get('user:1'), 'Prit');
    assert.equal(await client.exists('user:1'), true);
    assert.equal(await client.ttl('user:1'), -1);
    assert.equal(await client.del('user:1'), true);
    assert.equal(await client.get('user:1'), null);
    await client.close();
  });

  it('SET with EX and TTL', async () => {
    const client = new CacheClient({ host, port });
    await client.set('temp', 'v', { ex: 30 });
    const ttl = await client.ttl('temp');
    assert.ok(ttl > 0 && ttl <= 30);
    await client.close();
  });

  it('throws SERVER_ERROR for invalid command', async () => {
    const client = new CacheClient({ host, port });
    await assert.rejects(
      () => client.get(''),
      (err) => err instanceof ClientError && err.code === 'SERVER_ERROR',
    );
    await client.close();
  });

  it('handles concurrent commands on one connection', async () => {
    const client = new CacheClient({ host, port });
    await Promise.all([
      client.set('a', '1'),
      client.set('b', '2'),
      client.ping(),
    ]);
    assert.equal(await client.get('a'), '1');
    assert.equal(await client.get('b'), '2');
    await client.close();
  });

  it('connect times out when the host is unreachable', async () => {
    const client = new CacheClient({
      host: '192.0.2.1',
      port: 9,
      connectTimeoutMs: 400,
      maxReconnectAttempts: 1,
    });
    await assert.rejects(
      () => client.connect(),
      (err) => err instanceof ClientError && err.code === 'CONNECT_TIMEOUT',
    );
  });

  it('command times out when server does not respond', async () => {
    const blocker = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.on('data', () => {});
    });
    await new Promise((resolve, reject) => {
      blocker.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
    });
    const addr = blocker.address();
    assert.ok(addr && typeof addr === 'object');

    const client = new CacheClient({
      host: '127.0.0.1',
      port: addr.port,
      commandTimeoutMs: 150,
      maxReconnectAttempts: 1,
    });
    try {
      await assert.rejects(
        () => client.ping(),
        (err) => err instanceof ClientError && err.code === 'COMMAND_TIMEOUT',
      );
    } finally {
      await client.close();
      await new Promise((resolve) => blocker.close(() => resolve()));
    }
  });

  it('reconnects after server idle-closes the connection', async () => {
    const shortIdle = new CacheServer({
      host: '127.0.0.1',
      port: 0,
      idleTimeoutMs: 80,
    });
    const addr = await shortIdle.listen();
    const h = '127.0.0.1';
    const p = addr.port;

    const client = new CacheClient({
      host: h,
      port: p,
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelayMs: 20,
    });
    try {
      await client.set('k', 'v');
      await delay(150);
      assert.equal(await client.get('k'), 'v');
    } finally {
      await client.close();
      await shortIdle.close({ timeoutMs: 2_000 });
    }
  });

  it('does not reconnect when autoReconnect is false', async () => {
    const shortIdle = new CacheServer({
      host: '127.0.0.1',
      port: 0,
      idleTimeoutMs: 80,
    });
    const addr = await shortIdle.listen();
    const client = new CacheClient({
      host: '127.0.0.1',
      port: addr.port,
      autoReconnect: false,
      maxReconnectAttempts: 1,
    });
    try {
      await client.connect();
      await client.set('x', '1');
      await delay(150);
      await assert.rejects(
        () => client.get('x'),
        (err) =>
          err instanceof ClientError && err.code === 'CONNECTION_CLOSED',
      );
    } finally {
      await client.close();
      await shortIdle.close({ timeoutMs: 2_000 });
    }
  });
});

/**
 * @param {number} ms
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
