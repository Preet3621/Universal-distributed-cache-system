import { CacheError } from '../../../packages/cache-core/index.js';
import {
  ProtocolError,
  encodeSimple,
  encodeInt,
  encodeStr,
  encodeNil,
  encodeErr,
} from '../../../packages/protocol/index.js';
import { isPrimaryForKey } from '../../../packages/replication/index.js';

/**
 * Execute a parsed protocol command against a CacheStore.
 * @param {import('../../cache-core/index.js').CacheStore} store
 * @param {import('../../protocol/src/codec.js').Command} command
 * @returns {string} encoded response line (includes trailing newline)
 */
export function executeCommand(store, command) {
  try {
    switch (command.name) {
      case 'PING':
        return encodeSimple('PONG');

      case 'SET': {
        const opts = command.ex !== undefined ? { ex: command.ex } : {};
        store.set(command.key, command.value, opts);
        return encodeSimple('OK');
      }

      case 'GET': {
        const value = store.get(command.key);
        return value === undefined ? encodeNil() : encodeStr(value);
      }

      case 'DEL':
      case 'DELETE': {
        const removed = store.delete(command.key);
        return encodeInt(removed ? 1 : 0);
      }

      case 'EXISTS': {
        return encodeInt(store.exists(command.key) ? 1 : 0);
      }

      case 'TTL': {
        return encodeInt(store.ttl(command.key));
      }

      default:
        return encodeErr(`unknown command`);
    }
  } catch (err) {
    if (err instanceof CacheError || err instanceof ProtocolError) {
      return encodeErr(err.message);
    }
    return encodeErr('internal error');
  }
}

/**
 * Apply an internal replication command (no fan-out).
 * @param {import('../../cache-core/index.js').CacheStore} store
 * @param {import('../../protocol/src/codec.js').ReplCommand} command
 * @returns {string}
 */
export function executeReplCommand(store, command) {
  if (command.name !== 'REPL') {
    return encodeErr('internal error');
  }
  const inner = command.inner;
  try {
    if (inner.name === 'SET') {
      const opts = inner.ex !== undefined ? { ex: inner.ex } : {};
      store.set(inner.key, inner.value, opts);
      return encodeSimple('OK');
    }
    if (inner.name === 'DEL' || inner.name === 'DELETE') {
      const removed = store.delete(inner.key);
      return encodeInt(removed ? 1 : 0);
    }
    return encodeErr('unknown command');
  } catch (err) {
    if (err instanceof CacheError || err instanceof ProtocolError) {
      return encodeErr(err.message);
    }
    return encodeErr('internal error');
  }
}

/**
 * @param {import('../../cache-core/index.js').CacheStore} store
 * @param {import('../../protocol/src/codec.js').Command} command
 * @param {{
 *   replicationEngine?: import('../../replication/index.js').ReplicationEngine | null,
 *   replicationConfig?: import('../../replication/src/cluster-config.js').ClusterReplicationConfig | null,
 * }} [ctx]
 * @returns {string}
 */
export function dispatchCommand(store, command, ctx = {}) {
  if (command.name === 'REPL') {
    return executeReplCommand(store, command);
  }

  const response = executeCommand(store, command);

  const engine = ctx.replicationEngine;
  const config = ctx.replicationConfig;
  if (engine && config) {
    if (command.name === 'SET') {
      if (isPrimaryForKey(config.ring, command.key, config.myNodeIndex)) {
        engine.replicateSet(command.key, {
          value: command.value,
          ex: command.ex,
        });
      }
    } else if (command.name === 'DEL' || command.name === 'DELETE') {
      if (isPrimaryForKey(config.ring, command.key, config.myNodeIndex)) {
        engine.replicateDel(command.key);
      }
    }
  }

  return response;
}
