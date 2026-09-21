import net from 'node:net';
import {
  formatCommand,
  parseResponse,
  ProtocolError,
} from '../../protocol/index.js';
import { ClientError } from './errors.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RECONNECT_DELAY_MS = 50;

/**
 * @typedef {{
 *   host?: string,
 *   port?: number,
 *   connectTimeoutMs?: number,
 *   commandTimeoutMs?: number,
 *   autoReconnect?: boolean,
 *   maxReconnectAttempts?: number,
 *   reconnectDelayMs?: number,
 * }} CacheClientOptions
 */

/**
 * TCP cache client: persistent connection, FIFO command queue, typed async API.
 */
export class CacheClient {
  /**
   * @param {CacheClientOptions} [options]
   */
  constructor(options = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 6379;
    this.connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.commandTimeoutMs =
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.reconnectDelayMs =
      options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;

    /** @type {net.Socket | null} */
    this.#socket = null;
    /** @type {string} */
    this.#readBuffer = '';
    /** @type {boolean} */
    this.#connecting = false;
    /** @type {boolean} */
    this.#closed = false;
    /** @type {boolean} */
    this.#intentionalClose = false;
    /** @type {Promise<void> | null} */
    this.#connectPromise = null;

    /** @type {Promise<void> | null} */
    this.#connectingPromise = null;

    /** @type {Array<{
     *   line: string,
     *   throwOnServerErr: boolean,
     *   resolve: (value: unknown) => void,
     *   reject: (err: Error) => void,
     * }>} */
    this.#queue = [];

    /** @type {{
     *   line: string,
     *   throwOnServerErr: boolean,
     *   resolve: (value: unknown) => void,
     *   reject: (err: Error) => void,
     *   timer: NodeJS.Timeout,
     * } | null} */
    this.#inFlight = null;

    /** @type {boolean} */
    this.#draining = false;
  }

  /** @type {net.Socket | null} */
  #socket;

  /** @type {string} */
  #readBuffer;

  /** @type {boolean} */
  #connecting;

  /** @type {boolean} */
  #closed;

  /** @type {boolean} */
  #intentionalClose;

  /** @type {Promise<void> | null} */
  #connectPromise;

  /** @type {Promise<void> | null} */
  #connectingPromise;

  /** @type {Array<{
   *   line: string,
   *   throwOnServerErr: boolean,
   *   resolve: (value: unknown) => void,
   *   reject: (err: Error) => void,
   * }>} */
  #queue;

  /** @type {{
   *   line: string,
   *   throwOnServerErr: boolean,
   *   resolve: (value: unknown) => void,
   *   reject: (err: Error) => void,
   *   timer: NodeJS.Timeout,
   * } | null} */
  #inFlight;

  /** @type {boolean} */
  #draining;

  /**
   * @returns {Promise<void>}
   */
  connect() {
    if (this.#closed) {
      return Promise.reject(
        new ClientError('CLIENT_CLOSED', 'client is closed'),
      );
    }
    if (this.#isConnected()) {
      return Promise.resolve();
    }
    if (this.#connectPromise) {
      return this.#connectPromise;
    }
    this.#connectPromise = this.#ensureConnectedForOperation({
      forExplicitConnect: true,
    }).finally(() => {
      this.#connectPromise = null;
    });
    return this.#connectPromise;
  }

  /**
   * @returns {Promise<void>}
   */
  async close() {
    this.#intentionalClose = true;
    this.#closed = true;
    this.#rejectInFlight(
      new ClientError('CLIENT_CLOSED', 'client is closed'),
    );
    this.#rejectQueue(
      new ClientError('CLIENT_CLOSED', 'client is closed'),
    );
    this.#destroySocket();
  }

  async ping() {
    const res = await this.#command({ name: 'PING' });
    if (res.type !== 'PONG') {
      throw new ClientError(
        'PROTOCOL_ERROR',
        `unexpected response to PING: ${res.type}`,
      );
    }
  }

  /**
   * @param {string} key
   * @param {string} value
   * @param {{ ex?: number }} [options]
   */
  async set(key, value, options = {}) {
    /** @type {{ name: 'SET', key: string, value: string, ex?: number }} */
    const cmd = { name: 'SET', key, value };
    if (options.ex !== undefined) {
      cmd.ex = options.ex;
    }
    const res = await this.#command(cmd);
    if (res.type !== 'OK') {
      throw new ClientError(
        'PROTOCOL_ERROR',
        `unexpected response to SET: ${res.type}`,
      );
    }
  }

  /**
   * @param {string} key
   * @returns {Promise<string | null>}
   */
  async get(key) {
    const res = await this.#command({ name: 'GET', key });
    if (res.type === 'NIL') {
      return null;
    }
    if (res.type === 'STR') {
      return res.value;
    }
    throw new ClientError(
      'PROTOCOL_ERROR',
      `unexpected response to GET: ${res.type}`,
    );
  }

  /**
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async del(key) {
    return this.#intAsBoolean({ name: 'DEL', key });
  }

  /**
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async delete(key) {
    return this.#intAsBoolean({ name: 'DELETE', key });
  }

  /**
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    return this.#intAsBoolean({ name: 'EXISTS', key });
  }

  /**
   * @param {string} key
   * @returns {Promise<number>}
   */
  async ttl(key) {
    const res = await this.#command({ name: 'TTL', key });
    if (res.type === 'INT') {
      return res.value;
    }
    throw new ClientError(
      'PROTOCOL_ERROR',
      `unexpected response to TTL: ${res.type}`,
    );
  }

  /**
   * Send a raw command line (for CLI / advanced use). Server ERR is returned as a line, not thrown.
   * @param {string} commandLine
   * @returns {Promise<string>}
   */
  async executeRaw(commandLine) {
    const trimmed = commandLine.trim();
    if (trimmed.length === 0) {
      throw new ClientError('PROTOCOL_ERROR', 'empty command');
    }
    const line = `${trimmed}\n`;
    const res = await this.#commandLine(line, { throwOnServerErr: false });
    return responseToLine(res);
  }

  /**
   * @param {import('../../protocol/src/codec.js').Command} cmd
   * @returns {Promise<boolean>}
   */
  async #intAsBoolean(cmd) {
    const res = await this.#command(cmd);
    if (res.type === 'INT') {
      return res.value === 1;
    }
    throw new ClientError(
      'PROTOCOL_ERROR',
      `unexpected response to ${cmd.name}: ${res.type}`,
    );
  }

  /**
   * @param {import('../../protocol/src/codec.js').Command} cmd
   * @returns {Promise<ReturnType<typeof parseResponse>>}
   */
  async #command(cmd) {
    const line = formatCommand(cmd);
    const res = await this.#commandLine(line, { throwOnServerErr: true });
    return res;
  }

  /**
   * @param {string} line
   * @param {{ throwOnServerErr?: boolean }} options
   * @returns {Promise<ReturnType<typeof parseResponse>>}
   */
  async #commandLine(line, options = {}) {
    if (this.#closed) {
      throw new ClientError('CLIENT_CLOSED', 'client is closed');
    }
    const throwOnServerErr = options.throwOnServerErr ?? true;
    return /** @type {Promise<ReturnType<typeof parseResponse>>} */ (
      new Promise((resolve, reject) => {
        this.#queue.push({
          line,
          throwOnServerErr,
          resolve: (value) =>
            resolve(/** @type {ReturnType<typeof parseResponse>} */ (value)),
          reject,
        });
        this.#drainQueue();
      })
    );
  }

  #drainQueue() {
    if (this.#draining || this.#inFlight || this.#queue.length === 0) {
      return;
    }
    this.#draining = true;
    void this.#processNext().finally(() => {
      this.#draining = false;
      if (this.#queue.length > 0 && !this.#inFlight) {
        this.#drainQueue();
      }
    });
  }

  async #processNext() {
    while (this.#queue.length > 0 && !this.#closed) {
      const item = this.#queue.shift();
      if (!item) {
        return;
      }

      try {
        await this.#ensureConnectedForOperation();
      } catch (err) {
        item.reject(err instanceof Error ? err : new Error(String(err)));
        continue;
      }

      const socket = this.#socket;
      if (!socket) {
        item.reject(
          new ClientError('CONNECTION_CLOSED', 'not connected'),
        );
        continue;
      }

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const err = new ClientError('COMMAND_TIMEOUT', 'command timed out');
          this.#failInFlight(err);
          this.#destroySocket();
          reject(err);
        }, this.commandTimeoutMs);

        this.#inFlight = {
          line: item.line,
          throwOnServerErr: item.throwOnServerErr,
          resolve: (value) => {
            clearTimeout(timer);
            item.resolve(value);
            resolve();
          },
          reject: (err) => {
            clearTimeout(timer);
            item.reject(err);
            reject(err);
          },
          timer,
        };

        socket.write(item.line, (err) => {
          if (err) {
            clearTimeout(timer);
            const wrapped = new ClientError(
              'CONNECTION_ERROR',
              err.message,
            );
            this.#failInFlight(wrapped);
            item.reject(wrapped);
            reject(wrapped);
          }
        });
      }).catch(() => {
        /* rejection handled via item.reject */
      });
    }
  }

  /**
   * @param {{ forExplicitConnect?: boolean }} [options]
   */
  async #ensureConnectedForOperation(options = {}) {
    if (this.#isConnected()) {
      return;
    }
    if (!options.forExplicitConnect && !this.autoReconnect) {
      throw new ClientError(
        'CONNECTION_CLOSED',
        'not connected (autoReconnect disabled)',
      );
    }

    let lastError = new ClientError('CONNECTION_ERROR', 'connect failed');
    for (let attempt = 1; attempt <= this.maxReconnectAttempts; attempt++) {
      try {
        await this.#connectOnce();
        return;
      } catch (err) {
        lastError =
          err instanceof ClientError
            ? err
            : new ClientError(
                'CONNECTION_ERROR',
                err instanceof Error ? err.message : String(err),
              );
        if (attempt < this.maxReconnectAttempts) {
          await delay(this.reconnectDelayMs);
        }
      }
    }
    throw lastError;
  }

  /**
   * @returns {Promise<void>}
   */
  #connectOnce() {
    if (this.#isConnected()) {
      return Promise.resolve();
    }
    if (this.#connectingPromise) {
      return this.#connectingPromise;
    }

    this.#destroySocket();
    this.#connecting = true;

    this.#connectingPromise = new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.host,
        port: this.port,
      });
      socket.setEncoding('utf8');

      const onConnectTimeout = setTimeout(() => {
        cleanup();
        this.#connecting = false;
        this.#connectingPromise = null;
        socket.destroy();
        reject(
          new ClientError('CONNECT_TIMEOUT', 'connect timed out'),
        );
      }, this.connectTimeoutMs);

      const cleanup = () => {
        clearTimeout(onConnectTimeout);
        socket.off('connect', onConnected);
        socket.off('error', onError);
      };

      const onConnected = () => {
        cleanup();
        this.#socket = socket;
        this.#connecting = false;
        this.#connectingPromise = null;
        this.#readBuffer = '';
        this.#attachSocketHandlers(socket);
        resolve();
      };

      /** @param {Error} err */
      const onError = (err) => {
        cleanup();
        this.#connecting = false;
        this.#connectingPromise = null;
        socket.destroy();
        reject(new ClientError('CONNECTION_ERROR', err.message));
      };

      socket.once('connect', onConnected);
      socket.once('error', onError);
    });

    return this.#connectingPromise;
  }

  /**
   * @param {net.Socket} socket
   */
  #attachSocketHandlers(socket) {
    socket.on('data', (chunk) => {
      this.#readBuffer += chunk;
      let idx;
      while ((idx = this.#readBuffer.indexOf('\n')) !== -1) {
        const line = this.#readBuffer.slice(0, idx).replace(/\r$/, '');
        this.#readBuffer = this.#readBuffer.slice(idx + 1);
        this.#dispatchResponseLine(line);
      }
    });

    socket.on('error', (err) => {
      if (this.#intentionalClose) {
        return;
      }
      this.#failInFlight(
        new ClientError('CONNECTION_ERROR', err.message),
      );
      this.#destroySocket();
    });

    socket.on('close', () => {
      if (this.#intentionalClose) {
        return;
      }
      this.#failInFlight(
        new ClientError('CONNECTION_CLOSED', 'connection closed'),
      );
      this.#destroySocket();
    });
  }

  /**
   * @param {string} line
   */
  #dispatchResponseLine(line) {
    const inFlight = this.#inFlight;
    if (!inFlight) {
      return;
    }

    let parsed;
    try {
      parsed = parseResponse(line);
    } catch (err) {
      const wrapped =
        err instanceof ProtocolError
          ? new ClientError('PROTOCOL_ERROR', err.message)
          : new ClientError('PROTOCOL_ERROR', 'invalid response');
      inFlight.reject(wrapped);
      this.#clearInFlight();
      return;
    }

    if (parsed.type === 'ERR') {
      if (inFlight.throwOnServerErr) {
        inFlight.reject(
          new ClientError('SERVER_ERROR', parsed.message),
        );
      } else {
        inFlight.resolve(parsed);
      }
      this.#clearInFlight();
      this.#drainQueue();
      return;
    }

    inFlight.resolve(parsed);
    this.#clearInFlight();
    this.#drainQueue();
  }

  #isConnected() {
    return (
      this.#socket !== null &&
      !this.#socket.destroyed &&
      this.#socket.writable
    );
  }

  #destroySocket() {
    const socket = this.#socket;
    this.#socket = null;
    this.#connecting = false;
    if (socket && !socket.destroyed) {
      socket.removeAllListeners();
      socket.destroy();
    }
  }

  /**
   * @param {ClientError} err
   */
  #failInFlight(err) {
    const inFlight = this.#inFlight;
    if (!inFlight) {
      return;
    }
    clearTimeout(inFlight.timer);
    inFlight.reject(err);
    this.#clearInFlight();
  }

  /**
   * @param {ClientError} err
   */
  #rejectInFlight(err) {
    this.#failInFlight(err);
  }

  /**
   * @param {ClientError} err
   */
  #rejectQueue(err) {
    while (this.#queue.length > 0) {
      const item = this.#queue.shift();
      item?.reject(err);
    }
  }

  #clearInFlight() {
    this.#inFlight = null;
  }
}

/**
 * @param {number} ms
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {ReturnType<typeof parseResponse>} res
 * @returns {string}
 */
function responseToLine(res) {
  switch (res.type) {
    case 'OK':
    case 'PONG':
    case 'NIL':
      return res.type;
    case 'INT':
      return `INT ${res.value}`;
    case 'STR':
      return res.value === '' ? 'STR' : `STR ${res.value}`;
    case 'ERR':
      return `ERR ${res.message}`;
    default:
      throw new ClientError('PROTOCOL_ERROR', 'invalid response');
  }
}
