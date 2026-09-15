#!/usr/bin/env node
import { CacheServer } from '../src/server.js';

function usage() {
  console.log(`Usage: node apps/cache-node/bin/cache-node.js [--host HOST] [--port PORT] [--idle-timeout-ms N]

Environment:
  CACHE_HOST  (default 127.0.0.1)
  CACHE_PORT  (default 6379)
`);
}

function parseArgs(argv) {
  const opts = {
    host: process.env.CACHE_HOST ?? '127.0.0.1',
    port: Number(process.env.CACHE_PORT ?? 6379),
    idleTimeoutMs: 60_000,
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

  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const server = new CacheServer(opts);

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
