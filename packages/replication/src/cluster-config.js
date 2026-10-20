import { HashRing } from '../../hashing/index.js';

/**
 * @typedef {{ id: string, host: string, port: number, nodeIndex: number }} ClusterNode
 */

/**
 * @typedef {{
 *   nodeId: string,
 *   myNodeIndex: number,
 *   nodes: ClusterNode[],
 *   replicationFactor: number,
 *   virtualNodesPerNode: number,
 *   ring: HashRing,
 * }} ClusterReplicationConfig
 */

/**
 * @typedef {{
 *   id?: string,
 *   host: string,
 *   port: number,
 * }} NodeAddressInput
 */

/**
 * @param {NodeAddressInput[]} nodes
 * @returns {ClusterNode[]}
 */
export function normalizeClusterNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length < 1) {
    throw new RangeError('cluster nodes must be a non-empty array');
  }

  /** @type {ClusterNode[]} */
  const normalized = [];
  const seenId = new Set();
  const seenAddr = new Set();

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const entry = nodes[nodeIndex];
    if (entry === null || typeof entry !== 'object') {
      throw new RangeError('each cluster node must be an object');
    }
    const host = entry.host;
    if (typeof host !== 'string' || host.length === 0) {
      throw new RangeError('each cluster node requires a non-empty host');
    }
    const port = entry.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new RangeError('each cluster node requires port in 1..65535');
    }
    const addrKey = `${host}:${port}`;
    if (seenAddr.has(addrKey)) {
      throw new RangeError(`duplicate cluster node address ${addrKey}`);
    }
    seenAddr.add(addrKey);

    const id =
      entry.id !== undefined && entry.id !== null && String(entry.id).length > 0
        ? String(entry.id)
        : addrKey;
    if (seenId.has(id)) {
      throw new RangeError(`duplicate cluster node id ${id}`);
    }
    seenId.add(id);

    normalized.push({ id, host, port, nodeIndex });
  }

  return normalized;
}

/**
 * @param {{
 *   nodeId: string,
 *   nodes: NodeAddressInput[],
 *   replicationFactor?: number,
 *   virtualNodesPerNode?: number,
 * }} options
 * @returns {ClusterReplicationConfig}
 */
export function buildClusterReplicationConfig(options) {
  const nodeId = options.nodeId;
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    throw new RangeError('nodeId is required');
  }

  const nodes = normalizeClusterNodes(options.nodes);
  const myNode = nodes.find((n) => n.id === nodeId);
  if (!myNode) {
    throw new RangeError(`nodeId "${nodeId}" not found in cluster nodes`);
  }

  const requestedRf = options.replicationFactor ?? 3;
  if (!Number.isInteger(requestedRf) || requestedRf < 1) {
    throw new RangeError('replicationFactor must be a positive integer');
  }
  const replicationFactor = Math.min(requestedRf, nodes.length);

  const virtualNodesPerNode = options.virtualNodesPerNode ?? 128;
  if (!Number.isInteger(virtualNodesPerNode) || virtualNodesPerNode < 1) {
    throw new RangeError('virtualNodesPerNode must be a positive integer');
  }

  const ring = new HashRing({
    nodes: nodes.map((n) => ({ nodeIndex: n.nodeIndex, nodeId: n.id })),
    virtualNodesPerNode,
  });

  return {
    nodeId,
    myNodeIndex: myNode.nodeIndex,
    nodes,
    replicationFactor,
    virtualNodesPerNode,
    ring,
  };
}
