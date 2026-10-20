import { hashKey } from './hash.js';

/**
 * @typedef {{ nodeIndex: number, nodeId: string }} HashRingNode
 */

/**
 * @typedef {{
 *   nodes: HashRingNode[],
 *   virtualNodesPerNode?: number,
 *   hashFn?: (key: string) => number,
 * }} HashRingOptions
 */

/**
 * Consistent hash ring with virtual nodes per physical node.
 */
export class HashRing {
  /**
   * @param {HashRingOptions} options
   */
  constructor(options) {
    const nodes = options.nodes;
    if (!Array.isArray(nodes) || nodes.length < 1) {
      throw new RangeError('nodes must be a non-empty array');
    }
    const virtualNodesPerNode = options.virtualNodesPerNode ?? 128;
    if (
      !Number.isInteger(virtualNodesPerNode) ||
      virtualNodesPerNode < 1
    ) {
      throw new RangeError('virtualNodesPerNode must be a positive integer');
    }

    this.#hashFn = options.hashFn ?? hashKey;
    this.#nodeCount = nodes.length;
    this.#entries = buildRingEntries(nodes, virtualNodesPerNode, this.#hashFn);
  }

  /** @type {(key: string) => number} */
  #hashFn;

  /** @type {number} */
  #nodeCount;

  /** @type {Array<{ hash: number, nodeIndex: number }>} */
  #entries;

  /**
   * @param {string} key
   * @returns {number}
   */
  lookup(key) {
    if (this.#entries.length === 0) {
      throw new RangeError('empty hash ring');
    }
    const start = this.#ringStartIndex(key);
    return this.#entries[start].nodeIndex;
  }

  /**
   * Primary first, then distinct replicas clockwise on the ring.
   * @param {string} key
   * @param {number} replicationFactor
   * @returns {number[]}
   */
  lookupReplicaIndices(key, replicationFactor) {
    if (
      !Number.isInteger(replicationFactor) ||
      replicationFactor < 1
    ) {
      throw new RangeError('replicationFactor must be a positive integer');
    }
    const target = Math.min(replicationFactor, this.#nodeCount);
    if (this.#entries.length === 0) {
      return [];
    }

    const start = this.#ringStartIndex(key);
    /** @type {number[]} */
    const result = [];
    const seen = new Set();

    for (let i = 0; i < this.#entries.length && result.length < target; i++) {
      const entry = this.#entries[(start + i) % this.#entries.length];
      if (!seen.has(entry.nodeIndex)) {
        seen.add(entry.nodeIndex);
        result.push(entry.nodeIndex);
      }
    }
    return result;
  }

  /**
   * @param {string} key
   * @returns {number}
   */
  #ringStartIndex(key) {
    const h = this.#hashFn(key);
    let lo = 0;
    let hi = this.#entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.#entries[mid].hash < h) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo >= this.#entries.length) {
      return 0;
    }
    return lo;
  }
}

/**
 * @param {HashRingNode[]} nodes
 * @param {number} virtualNodesPerNode
 * @param {(key: string) => number} hashFn
 * @returns {Array<{ hash: number, nodeIndex: number }>}
 */
function buildRingEntries(nodes, virtualNodesPerNode, hashFn) {
  /** @type {Array<{ hash: number, nodeIndex: number }>} */
  const entries = [];
  for (const node of nodes) {
    for (let v = 0; v < virtualNodesPerNode; v++) {
      entries.push({
        hash: hashFn(`${node.nodeId}#${v}`),
        nodeIndex: node.nodeIndex,
      });
    }
  }
  entries.sort((a, b) => {
    if (a.hash !== b.hash) {
      return a.hash - b.hash;
    }
    return a.nodeIndex - b.nodeIndex;
  });
  return entries;
}

/**
 * @param {readonly string[]} keys
 * @param {HashRing} ringA
 * @param {HashRing} ringB
 * @returns {number}
 */
export function remappingFraction(keys, ringA, ringB) {
  if (keys.length === 0) {
    return 0;
  }
  let changed = 0;
  for (const key of keys) {
    if (ringA.lookup(key) !== ringB.lookup(key)) {
      changed += 1;
    }
  }
  return changed / keys.length;
}

/**
 * @param {number} count
 * @param {string} [idPrefix]
 * @returns {HashRingNode[]}
 */
export function nodesForCount(count, idPrefix = 'n') {
  return Array.from({ length: count }, (_, nodeIndex) => ({
    nodeIndex,
    nodeId: `${idPrefix}${nodeIndex}`,
  }));
}
