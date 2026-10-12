import readline from 'node:readline';
import {
  CacheClient,
  ClusterClient,
  ClientError,
} from '../../../packages/client/index.js';
import { parseResponse } from '../../../packages/protocol/index.js';
import { parseNodeList } from './parse-nodes.js';
import { runClusterCommand } from './cluster-command.js';

/**
 * @typedef {import('./parse-nodes.js').ParsedNodeAddress} ParsedNodeAddress
 */

/**
 * Minimal interactive / one-shot TCP CLI for the cache protocol.
 * @param {{
 *   host?: string,
 *   port?: number,
 *   nodes?: ParsedNodeAddress[],
 *   command?: string,
 * }} options
 */
export async function runCli(options = {}) {
  const clusterMode = options.nodes !== undefined && options.nodes.length > 0;

  /** @type {CacheClient | ClusterClient} */
  const client = clusterMode
    ? new ClusterClient({ nodes: options.nodes })
    : new CacheClient({
        host: options.host ?? '127.0.0.1',
        port: options.port ?? 6379,
      });

  const prompt = clusterMode ? 'cluster> ' : 'cache> ';

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
    prompt,
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
 * @param {CacheClient | ClusterClient} client
 * @param {string} commandLine
 */
async function runOneShot(client, commandLine) {
  if (client instanceof ClusterClient) {
    await runClusterCommand(client, commandLine);
    return;
  }
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

export { parseNodeList };
