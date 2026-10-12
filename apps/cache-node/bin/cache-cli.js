#!/usr/bin/env node
import { runCli, parseNodeList } from '../src/cli.js';

function usage() {
  console.log(`Usage:
  node apps/cache-node/bin/cache-cli.js [--host HOST] [--port PORT]
  node apps/cache-node/bin/cache-cli.js [--host HOST] [--port PORT] -- <COMMAND...>
  node apps/cache-node/bin/cache-cli.js --nodes HOST:PORT[,HOST:PORT...] [-- <COMMAND...>]

Cluster mode (--nodes): routes keyed commands via ClusterClient (consistent hash).
Optional node id: id@host:port (e.g. n1@127.0.0.1:6371,n2@127.0.0.1:6372)

Environment:
  CACHE_HOST, CACHE_PORT     single-node defaults
  CACHE_NODES                comma-separated list (same format as --nodes)

Examples:
  npm run cli -- PING
  npm run cli -- SET user:1 Prit
  npm run cli -- --nodes 127.0.0.1:6371,127.0.0.1:6372,127.0.0.1:6373 -- PING
  npm run cli -- --nodes 127.0.0.1:6371,127.0.0.1:6372,127.0.0.1:6373 -- GET user:1
`);
}

function parseArgs(argv) {
  const opts = {
    host: process.env.CACHE_HOST ?? '127.0.0.1',
    port: Number(process.env.CACHE_PORT ?? 6379),
    nodes: undefined,
    command: /** @type {string | undefined} */ (undefined),
  };

  const envNodes = process.env.CACHE_NODES?.trim();
  if (envNodes) {
    opts.nodes = parseNodeList(envNodes);
  }

  const parts = [];
  let passthrough = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (passthrough) {
      parts.push(arg);
      continue;
    }
    if (arg === '--') {
      passthrough = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--host') {
      opts.host = argv[++i];
    } else if (arg === '--port') {
      opts.port = Number(argv[++i]);
    } else if (arg === '--nodes') {
      opts.nodes = parseNodeList(argv[++i] ?? '');
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(1);
    }
  }

  if (parts.length > 0) {
    opts.command = parts.join(' ');
  }

  return opts;
}

const opts = parseArgs(process.argv.slice(2));

try {
  await runCli(opts);
} 
catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
