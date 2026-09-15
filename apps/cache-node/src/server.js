import net from 'node:net';
import { CacheStore } from '../../../packages/cache-core/index.js';
import { parseCommand, encodeErr } from '../../../packages/protocol/index.js';
import { executeCommand } from './command-handler.js';

/**
 * TCP cache node: newline-delimited commands, one CacheStore per process.
 */
export class CacheServer {
  /**
   * @param {{
   *   host?: string,
   *   port?: number,
   *   idleTimeoutMs?: number,
   *   maxLineBytes?: number,
   *   store?: CacheStore,
   *   storeOptions?: ConstructorParameters<typeof CacheStore>[0],
   * }} [options]
   */
  constructor(options = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 6379;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    this.maxLineBytes = options.maxLineBytes ?? 1_048_576 + 512;
    this.store = options.store ?? new CacheStore(options.storeOptions);
    /** @type {net.Server | null} */
    this.#server = null;
    /** @type {Set<net.Socket>} */
    this.#sockets = new Set();
    this.#closing = false;
  }

  /** @type {net.Server | null} */
  #server;

  /** @type {Set<net.Socket>} */
  #sockets;

  /** @type {boolean} */
  #closing;

  /**
   * @returns {Promise<{ host: string, port: number }>}
   */
  listen() {
    if (this.#server) {
      return Promise.reject(new Error('server already listening'));
    }

    this.#closing = false;
    this.#server = net.createServer((socket) => this.#onConnection(socket));

    return new Promise((resolve, reject) => {
      const server = this.#server;
      if (!server) {
        reject(new Error('server not created'));
        return;
      }

      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        server.off('error', reject);
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.host = addr.address;
        }
        resolve({ host: this.host, port: this.port });
      });
    });
  }

  /**
   * Stop accepting connections, end clients, close server.
   * @param {{ timeoutMs?: number }} [options]
   * @returns {Promise<void>}
   */
  async close(options = {}) {
    const timeoutMs = options.timeoutMs ?? 5_000;
    this.#closing = true;

    for (const socket of [...this.#sockets]) {
      socket.end();
    }

    const server = this.#server;
    this.#server = null;
    if (!server) {
      return;
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        for (const socket of [...this.#sockets]) {
          socket.destroy();
        }
      }, timeoutMs);

      server.close((err) => {
        clearTimeout(timer);
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * @returns {boolean}
   */
  isListening() {
    return this.#server !== null && this.#server.listening;
  }

  /**
   * @param {net.Socket} socket
   */
  #onConnection(socket) {
    if (this.#closing) {
      socket.destroy();
      return;
    }

    this.#sockets.add(socket);
    socket.setEncoding('utf8');
    socket.setTimeout(this.idleTimeoutMs);

    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > this.maxLineBytes * 2) {
        socket.write(encodeErr('input too large'));
        socket.end();
        return;
      }

      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);

        if (Buffer.byteLength(line, 'utf8') > this.maxLineBytes) {
          socket.write(encodeErr('line too long'));
          continue;
        }

        if (line.trim().length === 0) {
          continue;
        }

        let response;
        try {
          const command = parseCommand(line);
          response = executeCommand(this.store, command);
        } catch (err) {
          response = encodeErr(err instanceof Error ? err.message : 'bad request');
        }
        socket.write(response);
      }
    });

    socket.on('timeout', () => {
      socket.write(encodeErr('idle timeout'));
      socket.end();
    });

    const cleanup = () => {
      this.#sockets.delete(socket);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  }
}
