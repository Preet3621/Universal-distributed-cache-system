#!/usr/bin/env node
import { CacheServer } from '../src/server.js';
import { replicationOptionsFromEnv } from '../src/replication-options.js';

function usage() {
  console.log(`Usage: node apps/cache-node/bin/cache-node.js [options]

Options:
  --host HOST
  --port PORT
  --idle-timeout-ms N
  --node-id ID              Required with --cluster-nodes (CACHE_NODE_ID)
  --cluster-nodes LIST      Comma-separated id@host:port or host:port (CACHE_CLUSTER_NODES)
  --replication-factor N    Default 3 when cluster enabled (CACHE_REPLICATION_FACTOR)
  --virtual-nodes-per-node N  Default 128 (CACHE_VIRTUAL_NODES_PER_NODE)

Environment:
  CACHE_HOST, CACHE_PORT, CACHE_NODE_ID, CACHE_CLUSTER_NODES,
  CACHE_REPLICATION_FACTOR, CACHE_VIRTUAL_NODES_PER_NODE
`);
}

function parseArgs(argv) {
  const opts = {
    host: process.env.CACHE_HOST ?? '127.0.0.1',
    port: Number(process.env.CACHE_PORT ?? 6379),
    idleTimeoutMs: 60_000,
    nodeId: process.env.CACHE_NODE_ID,
    clusterNodes: process.env.CACHE_CLUSTER_NODES,
    replicationFactor:
      process.env.CACHE_REPLICATION_FACTOR !== undefined
        ? Number(process.env.CACHE_REPLICATION_FACTOR)
        : undefined,
    virtualNodesPerNode:
      process.env.CACHE_VIRTUAL_NODES_PER_NODE !== undefined
        ? Number(process.env.CACHE_VIRTUAL_NODES_PER_NODE)
        : undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--host') {
      opts.host = argv[++i];
    } else if (arg === '--port') {
      opts.port = Number(argv[++i]);
    } else if (arg === '--idle-timeout-ms') {
      opts.idleTimeoutMs = Number(argv[++i]);
    } else if (arg === '--node-id') {
      opts.nodeId = argv[++i];
    } else if (arg === '--cluster-nodes') {
      opts.clusterNodes = argv[++i];
    } else if (arg === '--replication-factor') {
      opts.replicationFactor = Number(argv[++i]);
    } else if (arg === '--virtual-nodes-per-node') {
      opts.virtualNodesPerNode = Number(argv[++i]);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(1);
    }
  }

  if (!Number.isInteger(opts.port) || opts.port < 0) {
    console.error('Invalid --port');
    process.exit(1);
  }
  if (!Number.isInteger(opts.idleTimeoutMs) || opts.idleTimeoutMs <= 0) {
    console.error('Invalid --idle-timeout-ms');
    process.exit(1);
  }
  if (
    opts.replicationFactor !== undefined &&
    (!Number.isInteger(opts.replicationFactor) || opts.replicationFactor < 1)
  ) {
    console.error('Invalid --replication-factor');
    process.exit(1);
  }
  if (
    opts.virtualNodesPerNode !== undefined &&
    (!Number.isInteger(opts.virtualNodesPerNode) || opts.virtualNodesPerNode < 1)
  ) {
    console.error('Invalid --virtual-nodes-per-node');
    process.exit(1);
  }

  return opts;
}

const opts = parseArgs(process.argv.slice(2));
let replication;
try {
  replication = replicationOptionsFromEnv(opts);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const server = new CacheServer({
  host: opts.host,
  port: opts.port,
  idleTimeoutMs: opts.idleTimeoutMs,
  replication,
});

const { host, port } = await server.listen();
console.log(`cache-node listening on ${host}:${port}`);

async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  try {
    await server.close({ timeoutMs: 5_000 });
    console.log('shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
