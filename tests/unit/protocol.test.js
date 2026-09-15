import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommand,
  parseResponse,
  encodeSimple,
  encodeInt,
  encodeStr,
  encodeNil,
  encodeErr,
  ProtocolError,
} from '../../packages/protocol/index.js';

describe('protocol parseCommand', () => {
  it('parses PING', () => {
    assert.deepEqual(parseCommand('PING'), { name: 'PING' });
    assert.deepEqual(parseCommand('ping'), { name: 'PING' });
  });

  it('parses GET/DEL/EXISTS/TTL', () => {
    assert.deepEqual(parseCommand('GET user:1'), { name: 'GET', key: 'user:1' });
    assert.deepEqual(parseCommand('DEL user:1'), { name: 'DEL', key: 'user:1' });
    assert.deepEqual(parseCommand('DELETE user:1'), {
      name: 'DELETE',
      key: 'user:1',
    });
    assert.deepEqual(parseCommand('EXISTS k'), { name: 'EXISTS', key: 'k' });
    assert.deepEqual(parseCommand('TTL k'), { name: 'TTL', key: 'k' });
  });

  it('parses SET with optional EX', () => {
    assert.deepEqual(parseCommand('SET user:1 Prit'), {
      name: 'SET',
      key: 'user:1',
      value: 'Prit',
    });
    assert.deepEqual(parseCommand('SET session abc EX 60'), {
      name: 'SET',
      key: 'session',
      value: 'abc',
      ex: 60,
    });
  });

  it('rejects unknown and bad arity', () => {
    assert.throws(() => parseCommand('FOO'), ProtocolError);
    assert.throws(() => parseCommand('GET'), ProtocolError);
    assert.throws(() => parseCommand('SET'), ProtocolError);
    assert.throws(() => parseCommand('SET k v EX no'), ProtocolError);
    assert.throws(() => parseCommand(''), ProtocolError);
  });

  it('parses SET with empty value', () => {
    assert.deepEqual(parseCommand('SET key'), {
      name: 'SET',
      key: 'key',
      value: '',
    });
  });
});

describe('protocol encode/parse response', () => {
  it('round-trips response kinds', () => {
    assert.equal(encodeSimple('OK'), 'OK\n');
    assert.equal(encodeSimple('PONG'), 'PONG\n');
    assert.equal(encodeNil(), 'NIL\n');
    assert.equal(encodeInt(-2), 'INT -2\n');
    assert.equal(encodeStr('Prit'), 'STR Prit\n');
    assert.equal(encodeErr('boom\nline'), 'ERR boom line\n');

    assert.deepEqual(parseResponse('OK'), { type: 'OK' });
    assert.deepEqual(parseResponse('PONG'), { type: 'PONG' });
    assert.deepEqual(parseResponse('NIL'), { type: 'NIL' });
    assert.deepEqual(parseResponse('INT 1'), { type: 'INT', value: 1 });
    assert.deepEqual(parseResponse('STR Prit'), { type: 'STR', value: 'Prit' });
    assert.deepEqual(parseResponse('ERR nope'), {
      type: 'ERR',
      message: 'nope',
    });
  });
});
