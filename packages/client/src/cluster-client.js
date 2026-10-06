import { CacheClient } from './cache-client.js';
import { ClientError } from './errors.js';
import { hashKey, pickNodeIndex } from './modulo-router.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RECONNECT_DELAY_MS = 50;

/** @type {ReadonlySet<string>} */
const NODE_UNAVAILABLE_CODES = new Set([
  'CONNECT_TIMEOUT',
  'CONNECTION_ERROR',
  'CONNECTION_CLOSED',
  'COMMAND_TIMEOUT',
]);

/**
 * @typedef {{
 *   id?: string,
 *   host: string,
 *   port: number,
 * }} CacheNodeAddress
 */

/**
 * @typedef {{
 *   nodes: CacheNodeAddress[],
 *   connectTimeoutMs?: number,
 *   commandTimeoutMs?: number,
 *   autoReconnect?: boolean,
 *   maxReconnectAttempts?: number,
 *   reconnectDelayMs?: number,
 *   hashKey?: (key: string) => number,
 * }} ClusterClientOptions
 */

/**
 * @typedef {{ id: string, host: string, port: number }} NormalizedNode
 */

/**
 * @param {CacheNodeAddress[]} nodes
 * @returns {NormalizedNode[]}
 */
function validateAndNormalizeNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length < 1) {
    throw new ClientError('INVALID_OPTIONS', 'nodes must be a non-empty array');
  }

  /** @type {NormalizedNode[]} */
  const normalized = [];
  const seen = new Set();

  for (const entry of nodes) {
    if (entry === null || typeof entry !== 'object') {
      throw new ClientError('INVALID_OPTIONS', 'each node must be an object');
    }
    const host = entry.host;
    if (typeof host !== 'string' || host.length === 0) {
      throw new ClientError('INVALID_OPTIONS', 'each node requires a non-empty host');
    }
    const port = entry.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ClientError(
        'INVALID_OPTIONS',
        'each node requires port in 1..65535',
      );
    }
    const addrKey = `${host}:${port}`;
    if (seen.has(addrKey)) {
      throw new ClientError(
        'INVALID_OPTIONS',
        `duplicate node address ${addrKey}`,
      );
    }
    seen.add(addrKey);
    const id =
      entry.id !== undefined && entry.id !== null && String(entry.id).length > 0
        ? String(entry.id)
        : addrKey;
    normalized.push({ id, host, port });
  }

  return normalized;
}

/**
 * Routes key-bearing commands with hash(key) % N; one CacheClient per node.
 */
export class ClusterClient {
  /**
   * @param {ClusterClientOptions} options
   */
  constructor(options) {
    if (options === null || typeof options !== 'object') {
      throw new ClientError('INVALID_OPTIONS', 'options object is required');
    }

    this.#nodes = validateAndNormalizeNodes(options.nodes);
    this.#connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.#commandTimeoutMs =
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.#autoReconnect = options.autoReconnect ?? true;
    this.#maxReconnectAttempts =
      options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.#reconnectDelayMs =
      options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.#hashFn = options.hashKey ?? hashKey;

    /** @type {(CacheClient | null)[]} */
    this.#clients = this.#nodes.map(() => null);
    this.#closed = false;
  }

  /** @type {NormalizedNode[]} */
  #nodes;

  /** @type {number} */
  #connectTimeoutMs;

  /** @type {number} */
  #commandTimeoutMs;

  /** @type {boolean} */
  #autoReconnect;

  /** @type {number} */
  #maxReconnectAttempts;

  /** @type {number} */
  #reconnectDelayMs;

  /** @type {(key: string) => number} */
  #hashFn;

  /** @type {(CacheClient | null)[]} */
  #clients;

  /** @type {boolean} */
  #closed;

  /**
   * @returns {Array<{ id: string, host: string, port: number, index: number }>}
   */
  getNodes() {
    return this.#nodes.map((node, index) => ({
      id: node.id,
      host: node.host,
      port: node.port,
      index,
    }));
  }

  /**
   * @returns {Promise<void>}
   */
  async connect() {
    this.#assertOpen();
    await Promise.all(
      this.#nodes.map((_node, index) => this.#clientForIndex(index).connect()),
    );
  }

  /**
   * @returns {Promise<void>}
   */
  async close() {
    this.#closed = true;
    const closes = this.#clients.map((client) =>
      client ? client.close() : Promise.resolve(),
    );
    await Promise.all(closes);
    this.#clients = this.#nodes.map(() => null);
  }

  async ping() {
    this.#assertOpen();
    await Promise.all(
      this.#nodes.map((_node, index) =>
        this.#withClient(index, (client) => client.ping(), {
          command: 'PING',
        }),
      ),
    );
  }

  /**
   * @param {string} key
   * @param {string} value
   * @param {{ ex?: number }} [options]
   */
  async set(key, value, options = {}) {
    return this.#routeKeyed(key, 'SET', (client) =>
      client.set(key, value, options),
    );
  }

  /**
   * @param {string} key
   * @returns {Promise<string | null>}
   */
  async get(key) {
    return this.#routeKeyed(key, 'GET', (client) => client.get(key));
  }

  /**
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async del(key) {
    return this.#routeKeyed(key, 'DEL', (client) => client.del(key));
  }

  /**
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async delete(key) {
    return this.#routeKeyed(key, 'DELETE', (client) => client.delete(key));
  }

  /**
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    return this.#routeKeyed(key, 'EXISTS', (client) => client.exists(key));
  }

  /**
   * @param {string} key
   * @returns {Promise<number>}
   */
  async ttl(key) {
    return this.#routeKeyed(key, 'TTL', (client) => client.ttl(key));
  }

  /**
   * @param {string} _commandLine
   * @returns {Promise<string>}
   */
  async executeRaw(_commandLine) {
    this.#assertOpen();
    throw new ClientError(
      'UNSUPPORTED',
      'executeRaw is not supported on ClusterClient',
    );
  }

  /**
   * @param {string} key
   * @param {string} command
   * @param {(client: CacheClient) => Promise<unknown>} fn
   */
  async #routeKeyed(key, command, fn) {
    const nodeIndex = pickNodeIndex(key, this.#nodes.length, this.#hashFn);
    return this.#withClient(nodeIndex, fn, { key, command });
  }

  /**
   * @param {number} nodeIndex
   * @param {(client: CacheClient) => Promise<unknown>} fn
   * @param {{ key?: string, command?: string }} context
   */
  async #withClient(nodeIndex, fn, context = {}) {
    this.#assertOpen();
    const node = this.#nodes[nodeIndex];
    try {
      const client = this.#clientForIndex(nodeIndex);
      return await fn(client);
    } catch (err) {
      throw this.#wrapBackendError(err, node, nodeIndex, context);
    }
  }

  /**
   * @param {number} nodeIndex
   * @returns {CacheClient}
   */
  #clientForIndex(nodeIndex) {
    let client = this.#clients[nodeIndex];
    if (!client) {
      const node = this.#nodes[nodeIndex];
      client = new CacheClient({
        host: node.host,
        port: node.port,
        connectTimeoutMs: this.#connectTimeoutMs,
        commandTimeoutMs: this.#commandTimeoutMs,
        autoReconnect: this.#autoReconnect,
        maxReconnectAttempts: this.#maxReconnectAttempts,
        reconnectDelayMs: this.#reconnectDelayMs,
      });
      this.#clients[nodeIndex] = client;
    }
    return client;
  }

  #assertOpen() {
    if (this.#closed) {
      throw new ClientError('CLIENT_CLOSED', 'client is closed');
    }
  }

  /**
   * @param {unknown} err
   * @param {NormalizedNode} node
   * @param {number} nodeIndex
   * @param {{ key?: string, command?: string }} context
   * @returns {ClientError}
   */
  #wrapBackendError(err, node, nodeIndex, context) {
    if (!(err instanceof ClientError)) {
      return new ClientError(
        'NODE_UNAVAILABLE',
        `node ${node.id} unavailable`,
        {
          nodeIndex,
          nodeId: node.id,
          host: node.host,
          port: node.port,
          key: context.key,
          command: context.command,
        },
      );
    }

    /** @type {import('./errors.js').ClientErrorDetails} */
    const details = {
      nodeIndex,
      nodeId: node.id,
      host: node.host,
      port: node.port,
      key: context.key,
      command: context.command,
      cause: err,
    };

    if (err.code === 'SERVER_ERROR') {
      return new ClientError(err.code, err.message, details);
    }

    if (NODE_UNAVAILABLE_CODES.has(err.code)) {
      return new ClientError(
        'NODE_UNAVAILABLE',
        `node ${node.id} unavailable: ${err.message}`,
        details,
      );
    }

    if (err.code === 'CLIENT_CLOSED') {
      return err;
    }

    return new ClientError(err.code, err.message, details);
  }
}
