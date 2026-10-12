#!/usr/bin/env node
/**
 * Demo: ClusterClient against locally running cache-node processes.
 *
 * Start nodes first (three terminals):
 *   npm start -- --port 6371
 *   npm start -- --port 6372
 *   npm start -- --port 6373
 *
 * Then: npm run example:cluster
 *
 * Override nodes: CLUSTER_NODES="127.0.0.1:6371,127.0.0.1:6372,127.0.0.1:6373"
 */

import { ClusterClient, HashRing } from '../packages/client/index.js';

const DEFAULT_NODES = [
  { id: 'n1', host: '127.0.0.1', port: 6371 },
  { id: 'n2', host: '127.0.0.1', port: 6372 },
  { id: 'n3', host: '127.0.0.1', port: 6373 },
];

/**
 * @param {string} nodesStr
 */
function nodesFromEnv(nodesStr) {
  return nodesStr.split(',').map((part, i) => {
    const trimmed = part.trim();
    const colon = trimmed.lastIndexOf(':');
    if (colon <= 0) {
      throw new Error(`invalid CLUSTER_NODES entry: ${part}`);
    }
    const host = trimmed.slice(0, colon);
    const port = Number(trimmed.slice(colon + 1));
    if (!Number.isInteger(port)) {
      throw new Error(`invalid port in CLUSTER_NODES: ${part}`);
    }
    return { id: `n${i + 1}`, host, port };
  });
}

const nodes =
  process.env.CLUSTER_NODES !== undefined && process.env.CLUSTER_NODES.length > 0
    ? nodesFromEnv(process.env.CLUSTER_NODES)
    : DEFAULT_NODES;

const ring = new HashRing({
  nodes: nodes.map((n, nodeIndex) => ({ nodeIndex, nodeId: n.id })),
});

const demoKey = 'demo:user:1';
const ownerIndex = ring.lookup(demoKey);

const cluster = new ClusterClient({ nodes });

try {
  await cluster.connect();
  await cluster.ping();
  console.log(`Cluster OK (${nodes.length} nodes)`);
  console.log(
    `Key "${demoKey}" routes to node index ${ownerIndex} (${nodes[ownerIndex].id})`,
  );

  await cluster.set(demoKey, 'Prit');
  const value = await cluster.get(demoKey);
  console.log(`GET ${demoKey} => ${value}`);
} catch (err) {
  console.error(
    err instanceof Error ? err.message : err,
  );
  console.error(
    '\nStart cache-node on each port, e.g. npm start -- --port 6371',
  );
  process.exit(1);
} finally {
  await cluster.close();
}
