import { CacheError } from '../../../packages/cache-core/index.js';
import {
  ProtocolError,
  encodeSimple,
  encodeInt,
  encodeStr,
  encodeNil,
  encodeErr,
} from '../../../packages/protocol/index.js';

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
