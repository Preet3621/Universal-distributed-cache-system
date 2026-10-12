import { ClientError } from '../../../packages/client/index.js';

/**
 * @typedef {{ id?: string, host: string, port: number }} ParsedNodeAddress
 */

/**
 * Comma-separated host:port list, optional id@host:port per entry.
 * Examples: "127.0.0.1:6371,127.0.0.1:6372" or "n1@127.0.0.1:6371,n2@127.0.0.1:6372"
 * @param {string} nodesStr
 * @returns {ParsedNodeAddress[]}
 */
export function parseNodeList(nodesStr) {
  const trimmed = nodesStr.trim();
  if (trimmed.length === 0) {
    throw new ClientError('INVALID_OPTIONS', 'empty --nodes value');
  }

  /** @type {ParsedNodeAddress[]} */
  const nodes = [];
  const parts = trimmed.split(',');

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (part.length === 0) {
      throw new ClientError('INVALID_OPTIONS', 'empty node entry in --nodes');
    }

    let id;
    let hostPort = part;
    const at = part.indexOf('@');
    if (at !== -1) {
      id = part.slice(0, at).trim();
      hostPort = part.slice(at + 1).trim();
      if (id.length === 0 || hostPort.length === 0) {
        throw new ClientError('INVALID_OPTIONS', `invalid node entry "${part}"`);
      }
    }

    const colon = hostPort.lastIndexOf(':');
    if (colon <= 0 || colon === hostPort.length - 1) {
      throw new ClientError(
        'INVALID_OPTIONS',
        `expected host:port, got "${part}"`,
      );
    }

    const host = hostPort.slice(0, colon);
    const port = Number(hostPort.slice(colon + 1));
    if (host.length === 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ClientError('INVALID_OPTIONS', `invalid port in "${part}"`);
    }

    /** @type {ParsedNodeAddress} */
    const entry = { host, port };
    if (id !== undefined) {
      entry.id = id;
    }
    nodes.push(entry);
  }

  return nodes;
}
