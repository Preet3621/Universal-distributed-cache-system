import { CacheClient } from '../../client/index.js';
import { formatReplCommand } from '../../protocol/index.js';
import { replicaPeerIndices } from './replica-targets.js';
import { ReplicationStats } from './replication-stats.js';

const DEFAULT_MAX_PENDING = 1024;

/**
 * @typedef {import('./cluster-config.js').ClusterReplicationConfig} ClusterReplicationConfig
 */

/**
 * Async primary → replica fan-out (primary-only client ack is handled by the server).
 */
export class ReplicationEngine {
  /**
   * @param {ClusterReplicationConfig} config
   * @param {{ maxPending?: number, clientOptions?: ConstructorParameters<typeof CacheClient>[0] }} [options]
   */
  constructor(config, options = {}) {
    this.#config = config;
    this.#maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.#clientOptions = options.clientOptions ?? {};
    this.#stats = new ReplicationStats();
    /** @type {Map<number, CacheClient>} */
    this.#clientsByIndex = new Map();
    this.#pending = 0;
    this.#closed = false;
  }

  /** @type {ClusterReplicationConfig} */
  #config;

  /** @type {number} */
  #maxPending;

  /** @type {ConstructorParameters<typeof CacheClient>[0]} */
  #clientOptions;

  /** @type {ReplicationStats} */
  #stats;

  /** @type {Map<number, CacheClient>} */
  #clientsByIndex;

  /** @type {number} */
  #pending;

  /** @type {boolean} */
  #closed;

  get stats() {
    return this.#stats;
  }

  /**
   * @param {string} key
   * @param {{ value: string, ex?: number }} mutation
   */
  replicateSet(key, mutation) {
    /** @type {import('../../protocol/src/codec.js').SetCommand} */
    const inner = { name: 'SET', key, value: mutation.value };
    if (mutation.ex !== undefined) {
      inner.ex = mutation.ex;
    }
    this.#schedule(formatReplCommand(inner), key);
  }

  /**
   * @param {string} key
   */
  replicateDel(key) {
    this.#schedule(formatReplCommand({ name: 'DEL', key }), key);
  }

  /**
   * @param {string} wireLine includes trailing newline
   * @param {string} key
   */
  #schedule(wireLine, key) {
    if (this.#closed) {
      return;
    }
    if (this.#pending >= this.#maxPending) {
      this.#stats.recordDropped();
      return;
    }

    const peerIndices = replicaPeerIndices(
      this.#config.ring,
      key,
      this.#config.replicationFactor,
      this.#config.myNodeIndex,
    );
    if (peerIndices.length === 0) {
      return;
    }

    this.#pending += 1;
    void this.#fanOut(wireLine, peerIndices).finally(() => {
      this.#pending -= 1;
    });
  }

  /**
   * @param {string} wireLine
   * @param {number[]} peerIndices
   */
  async #fanOut(wireLine, peerIndices) {
    const commandLine = wireLine.trimEnd();
    await Promise.allSettled(
      peerIndices.map(async (index) => {
        const node = this.#config.nodes[index];
        this.#stats.recordAttempt(node.id);
        try {
          const client = this.#clientForIndex(index);
          await client.connect();
          const line = await client.executeRaw(commandLine);
          if (line !== 'OK' && !line.startsWith('INT ')) {
            throw new Error(line.startsWith('ERR ') ? line : `unexpected ${line}`);
          }
          this.#stats.recordSuccess(node.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.#stats.recordFailure(node.id, message);
        }
      }),
    );
  }

  /**
   * @param {number} nodeIndex
   * @returns {CacheClient}
   */
  #clientForIndex(nodeIndex) {
    let client = this.#clientsByIndex.get(nodeIndex);
    if (!client) {
      const node = this.#config.nodes[nodeIndex];
      client = new CacheClient({
        host: node.host,
        port: node.port,
        ...this.#clientOptions,
      });
      this.#clientsByIndex.set(nodeIndex, client);
    }
    return client;
  }

  /**
   * @returns {Promise<void>}
   */
  async close() {
    this.#closed = true;
    const closes = [...this.#clientsByIndex.values()].map((c) => c.close());
    await Promise.all(closes);
    this.#clientsByIndex.clear();
  }
}
