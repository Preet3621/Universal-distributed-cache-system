#!/usr/bin/env node
import { runCli } from '../src/cli.js';

function usage() {
  console.log(`Usage:
  node apps/cache-node/bin/cache-cli.js [--host HOST] [--port PORT]
  node apps/cache-node/bin/cache-cli.js [--host HOST] [--port PORT] -- <COMMAND...>

Examples:
  node apps/cache-node/bin/cache-cli.js -- PING
  node apps/cache-node/bin/cache-cli.js -- SET user:1 Prit
  node apps/cache-node/bin/cache-cli.js -- GET user:1
`);
}

function parseArgs(argv) {
  const opts = {
    host: process.env.CACHE_HOST ?? '127.0.0.1',
    port: Number(process.env.CACHE_PORT ?? 6379),
    command: /** @type {string | undefined} */ (undefined),
  };

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
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
