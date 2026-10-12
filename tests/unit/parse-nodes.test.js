import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseNodeList } from '../../apps/cache-node/src/parse-nodes.js';
import { ClientError } from '../../packages/client/index.js';

describe('parseNodeList', () => {
  it('parses host:port entries', () => {
    const nodes = parseNodeList('127.0.0.1:6371,127.0.0.1:6372');
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].host, '127.0.0.1');
    assert.equal(nodes[0].port, 6371);
    assert.equal(nodes[1].port, 6372);
  });

  it('parses optional id@host:port', () => {
    const nodes = parseNodeList('n1@127.0.0.1:6371');
    assert.equal(nodes[0].id, 'n1');
    assert.equal(nodes[0].port, 6371);
  });

  it('rejects invalid input', () => {
    assert.throws(
      () => parseNodeList(''),
      (err) => err instanceof ClientError && err.code === 'INVALID_OPTIONS',
    );
    assert.throws(
      () => parseNodeList('bad'),
      (err) => err instanceof ClientError && err.code === 'INVALID_OPTIONS',
    );
  });
});
