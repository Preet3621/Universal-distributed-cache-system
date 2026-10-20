import { HashRing } from '../../hashing/index.js';

/**
 * @param {HashRing} ring
 * @param {string} key
 * @param {number} replicationFactor
 * @param {number} myNodeIndex
 * @returns {number[]}
 */
export function replicaPeerIndices(ring, key, replicationFactor, myNodeIndex) {
  return ring
    .lookupReplicaIndices(key, replicationFactor)
    .filter((index) => index !== myNodeIndex);
}

/**
 * @param {HashRing} ring
 * @param {string} key
 * @param {number} myNodeIndex
 * @returns {boolean}
 */
export function isPrimaryForKey(ring, key, myNodeIndex) {
  return ring.lookup(key) === myNodeIndex;
}
