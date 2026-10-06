import { createHash } from 'node:crypto';

/**
 * Deterministic non-negative hash of a cache key (SHA-256, first 4 bytes as uint32).
 * @param {string} key
 * @returns {number}
 */
export function hashKey(key) {
  const digest = createHash('sha256').update(key, 'utf8').digest();
  return digest.readUInt32BE(0);
}

/**
 * @param {number} nodeCount
 */
export function assertPositiveNodeCount(nodeCount) {
  if (!Number.isInteger(nodeCount) || nodeCount < 1) {
    throw new RangeError('nodeCount must be a positive integer');
  }
}

/**
 * @param {string} key
 * @param {number} nodeCount
 * @param {(key: string) => number} [hashFn]
 * @returns {number}
 */
export function pickNodeIndex(key, nodeCount, hashFn = hashKey) {
  assertPositiveNodeCount(nodeCount);
  const h = hashFn(key);
  return h % nodeCount;
}

/** Fixed key set for remapping / distribution tests */
export const ROUTING_FIXTURE_KEYS = [
  'user:1',
  'user:2',
  'session:abc',
  'item:42',
  'cache:alpha',
  'cache:beta',
  'cache:gamma',
  'cache:delta',
  'cache:epsilon',
  'cache:zeta',
  'cache:eta',
  'cache:theta',
];

/**
 * @param {readonly string[]} keys
 * @param {number} fromCount
 * @param {number} toCount
 * @param {(key: string) => number} [hashFn]
 * @returns {number} fraction of keys whose index changes when N changes
 */
export function remappingFraction(keys, fromCount, toCount, hashFn = hashKey) {
  if (keys.length === 0) {
    return 0;
  }
  let changed = 0;
  for (const key of keys) {
    const before = pickNodeIndex(key, fromCount, hashFn);
    const after = pickNodeIndex(key, toCount, hashFn);
    if (before !== after) {
      changed += 1;
    }
  }
  return changed / keys.length;
}
