import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommand,
  formatReplCommand,
  ProtocolError,
} from '../../packages/protocol/index.js';

describe('REPL protocol', () => {
  it('parses REPL SET variants', () => {
    assert.deepEqual(parseCommand('REPL SET user:1 Prit'), {
      name: 'REPL',
      inner: { name: 'SET', key: 'user:1', value: 'Prit' },
    });
    assert.deepEqual(parseCommand('REPL SET session abc EX 60'), {
      name: 'REPL',
      inner: { name: 'SET', key: 'session', value: 'abc', ex: 60 },
    });
    assert.deepEqual(parseCommand('REPL SET key'), {
      name: 'REPL',
      inner: { name: 'SET', key: 'key', value: '' },
    });
  });

  it('parses REPL DEL', () => {
    assert.deepEqual(parseCommand('REPL DEL user:1'), {
      name: 'REPL',
      inner: { name: 'DEL', key: 'user:1' },
    });
  });

  it('rejects bad REPL input', () => {
    assert.throws(() => parseCommand('REPL'), ProtocolError);
    assert.throws(() => parseCommand('REPL FOO x'), ProtocolError);
    assert.throws(() => parseCommand('REPL DEL'), ProtocolError);
  });

  it('round-trips REPL SET and DEL', () => {
    const setCases = [
      'REPL SET user:1 Prit',
      'REPL SET session abc EX 60',
      'REPL SET key',
    ];
    for (const line of setCases) {
      const parsed = parseCommand(line);
      assert.equal(parsed.name, 'REPL');
      const wire = formatReplCommand(parsed.inner);
      assert.deepEqual(parseCommand(wire.trim()), parsed);
    }
    const del = parseCommand('REPL DEL k');
    assert.deepEqual(parseCommand(formatReplCommand(del.inner).trim()), del);
  });
});
