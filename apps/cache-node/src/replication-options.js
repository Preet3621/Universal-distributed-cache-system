import { parseNodeList } from './parse-nodes.js';

/**
 * @param {{
 *   nodeId?: string,
 *   clusterNodes?: string,
 *   replicationFactor?: number,
 *   virtualNodesPerNode?: number,
 * }} input
 * @returns {import('./server.js').CacheServer extends new (...args: infer A) => unknown ? A[0]['replication'] : never}
 */
export function replicationOptionsFromEnv(input) {
  const clusterNodes = input.clusterNodes?.trim();
  if (!clusterNodes) {
    return undefined;
  }

  const nodeId = input.nodeId?.trim();
  if (!nodeId) {
    throw new Error('CACHE_NODE_ID / --node-id is required when cluster nodes are configured');
  }

  const nodes = parseNodeList(clusterNodes);
  const replicationFactor = input.replicationFactor ?? 3;
  const virtualNodesPerNode = input.virtualNodesPerNode ?? 128;

  return {
    nodeId,
    nodes,
    replicationFactor,
    virtualNodesPerNode,
  };
}
