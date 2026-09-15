import net from 'node:net';
import readline from 'node:readline';
import { parseResponse } from '../../../packages/protocol/index.js';

/**
 * Minimal interactive / one-shot TCP CLI for the cache protocol.
 * @param {{ host?: string, port?: number, command?: string }} options
 */
export async function runCli(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 6379;

  const socket = net.createConnection({ host, port });
  socket.setEncoding('utf8');

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  /**
   * @param {string} line
   * @returns {Promise<string>}
   */
  function request(line) {
    return new Promise((resolve, reject) => {
      let buffer = '';
      /** @param {string} chunk */
      const onData = (chunk) => {
        buffer += chunk;
        const idx = buffer.indexOf('\n');
        if (idx !== -1) {
          socket.off('data', onData);
          socket.off('error', onError);
          resolve(buffer.slice(0, idx).replace(/\r$/, ''));
        }
      };
      /** @param {Error} err */
      const onError = (err) => {
        socket.off('data', onData);
        reject(err);
      };
      socket.on('data', onData);
      socket.once('error', onError);
      socket.write(line.endsWith('\n') ? line : `${line}\n`);
    });
  }

  if (options.command) {
    const raw = await request(options.command);
    printResponse(raw);
    socket.end();
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'cache> ',
  });

  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '' ) {
      rl.prompt();
      continue;
    }
    if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
      break;
    }
    try {
      const raw = await request(trimmed);
      printResponse(raw);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      break;
    }
    rl.prompt();
  }

  rl.close();
  socket.end();
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
