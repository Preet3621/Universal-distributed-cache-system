import readline from 'node:readline';
import { CacheClient, ClientError } from '../../../packages/client/index.js';
import { parseResponse } from '../../../packages/protocol/index.js';

/**
 * Minimal interactive / one-shot TCP CLI for the cache protocol.
 * @param {{ host?: string, port?: number, command?: string }} options
 */
export async function runCli(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 6379;

  const client = new CacheClient({ host, port });

  if (options.command) {
    try {
      await runOneShot(client, options.command);
    } finally {
      await client.close();
    }
    return;
  }

  try {
    await client.connect();
  } catch (err) {
    throw wrapClientError(err);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'cache> ',
  });

  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') {
      rl.prompt();
      continue;
    }
    if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
      break;
    }
    try {
      await runOneShot(client, trimmed);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      break;
    }
    rl.prompt();
  }

  rl.close();
  await client.close();
}

/**
 * @param {CacheClient} client
 * @param {string} commandLine
 */
async function runOneShot(client, commandLine) {
  const raw = await client.executeRaw(commandLine);
  printResponse(raw);
}

/**
 * @param {string} raw
 */
function printResponse(raw) {
  try {
    const res = parseResponse(raw);
    switch (res.type) {
      case 'OK':
      case 'PONG':
      case 'NIL':
        console.log(res.type);
        break;
      case 'INT':
        console.log(`(integer) ${res.value}`);
        break;
      case 'STR':
        console.log(`"${res.value}"`);
        break;
      case 'ERR':
        console.log(`(error) ${res.message}`);
        break;
      default:
        console.log(raw);
    }
  } catch {
    console.log(raw);
  }
}

/**
 * @param {unknown} err
 * @returns {Error}
 */
function wrapClientError(err) {
  if (err instanceof ClientError) {
    return new Error(err.message);
  }
  if (err instanceof Error) {
    return err;
  }
  return new Error(String(err));
}
