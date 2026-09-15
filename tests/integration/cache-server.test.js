import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { CacheServer } from '../../apps/cache-node/src/server.js';
import { parseResponse } from '../../packages/protocol/index.js';

/**
 * @param {number} port
 * @param {string} host
 * @param {string} command
 */
function sendCommand(port, host, command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host });
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('connect', () => {
      socket.write(command.endsWith('\n') ? command : `${command}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        socket.end();
        resolve(parseResponse(line));
      }
    });
    socket.on('error', reject);
  });
}

describe('CacheServer TCP integration', () => {
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
      idleTimeoutMs: 5_000,
    });
    const addr = await server.listen();
    host = addr.host === '::' || addr.host === '::ffff:127.0.0.1' ? '127.0.0.1' : addr.host;
    // Node may report IPv6 wildcard; force loopback for clients.
    if (host === '::') {
      host = '127.0.0.1';
    }
    port = addr.port;
  });

  after(async () => {
    await server.close({ timeoutMs: 2_000 });
  });

  it('handles PING', async () => {
    const res = await sendCommand(port, host, 'PING');
    assert.deepEqual(res, { type: 'PONG' });
  });

  it('SET/GET/EXISTS/DEL/TTL round-trip', async () => {
    assert.deepEqual(await sendCommand(port, host, 'SET user:1 Prit'), {
      type: 'OK',
    });
    assert.deepEqual(await sendCommand(port, host, 'GET user:1'), {
      type: 'STR',
      value: 'Prit',
    });
    assert.deepEqual(await sendCommand(port, host, 'EXISTS user:1'), {
      type: 'INT',
      value: 1,
    });
    assert.deepEqual(await sendCommand(port, host, 'TTL user:1'), {
      type: 'INT',
      value: -1,
    });
    assert.deepEqual(await sendCommand(port, host, 'DEL user:1'), {
      type: 'INT',
      value: 1,
    });
    assert.deepEqual(await sendCommand(port, host, 'GET user:1'), {
      type: 'NIL',
    });
  });

  it('SET with EX and TTL', async () => {
    assert.deepEqual(await sendCommand(port, host, 'SET temp v EX 30'), {
      type: 'OK',
    });
    const ttl = await sendCommand(port, host, 'TTL temp');
    assert.equal(ttl.type, 'INT');
    assert.ok(ttl.type === 'INT' && ttl.value > 0 && ttl.value <= 30);
  });

  it('returns ERR for unknown command', async () => {
    const res = await sendCommand(port, host, 'FOOBAR');
    assert.equal(res.type, 'ERR');
  });

  it('serves multiple concurrent clients', async () => {
    const results = await Promise.all([
      sendCommand(port, host, 'SET a 1'),
      sendCommand(port, host, 'SET b 2'),
      sendCommand(port, host, 'PING'),
    ]);
    assert.deepEqual(results[0], { type: 'OK' });
    assert.deepEqual(results[1], { type: 'OK' });
    assert.deepEqual(results[2], { type: 'PONG' });
    assert.deepEqual(await sendCommand(port, host, 'GET a'), {
      type: 'STR',
      value: '1',
    });
  });
});
