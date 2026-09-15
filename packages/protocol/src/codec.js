/**
 * Line-oriented cache protocol (Phase 4).
 *
 * Requests: one command per line, whitespace-separated tokens.
 *   SET key value
 *   SET key value EX seconds
 *   GET key | DEL key | DELETE key | EXISTS key | TTL key | PING
 *
 * Values/keys must not contain spaces or newlines (learning protocol).
 *
 * Responses (single line each):
 *   OK
 *   PONG
 *   NIL
 *   INT <n>
 *   STR <value>     (value may be empty: "STR ")
 *   ERR <message>
 */

export class ProtocolError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/**
 * @typedef {{ name: 'PING' }} PingCommand
 * @typedef {{ name: 'GET' | 'DEL' | 'DELETE' | 'EXISTS' | 'TTL', key: string }} KeyCommand
 * @typedef {{ name: 'SET', key: string, value: string, ex?: number }} SetCommand
 * @typedef {PingCommand | KeyCommand | SetCommand} Command
 */

/**
 * @param {string} line
 * @returns {Command}
 */
export function parseCommand(line) {
  if (typeof line !== 'string') {
    throw new ProtocolError('command must be a string');
  }

  const trimmed = line.trim();
  if (trimmed.length === 0) {
    throw new ProtocolError('empty command');
  }

  if (trimmed.includes('\0')) {
    throw new ProtocolError('command contains NUL');
  }

  const parts = trimmed.split(/\s+/);
  const name = parts[0].toUpperCase();

  switch (name) {
    case 'PING':
      if (parts.length !== 1) {
        throw new ProtocolError('wrong number of arguments for PING');
      }
      return { name: 'PING' };

    case 'GET':
    case 'DEL':
    case 'DELETE':
    case 'EXISTS':
    case 'TTL':
      if (parts.length !== 2) {
        throw new ProtocolError(`wrong number of arguments for ${name}`);
      }
      assertToken(parts[1], 'key');
      return /** @type {KeyCommand} */ ({ name, key: parts[1] });

    case 'SET':
      return parseSet(parts);

    default:
      throw new ProtocolError(`unknown command '${parts[0]}'`);
  }
}

/**
 * @param {string[]} parts
 * @returns {SetCommand}
 */
function parseSet(parts) {
  // SET key                  → empty value
  // SET key value
  // SET key value EX seconds
  // SET key EX seconds       → empty value with TTL
  if (parts.length === 2) {
    assertToken(parts[1], 'key');
    return { name: 'SET', key: parts[1], value: '' };
  }

  if (parts.length === 3) {
    assertToken(parts[1], 'key');
    assertToken(parts[2], 'value');
    return { name: 'SET', key: parts[1], value: parts[2] };
  }

  if (parts.length === 4 && parts[2].toUpperCase() === 'EX') {
    assertToken(parts[1], 'key');
    const seconds = Number(parts[3]);
    if (!Number.isInteger(seconds) || seconds <= 0) {
      throw new ProtocolError('EX seconds must be a positive integer');
    }
    return { name: 'SET', key: parts[1], value: '', ex: seconds };
  }

  if (parts.length === 5 && parts[3].toUpperCase() === 'EX') {
    assertToken(parts[1], 'key');
    assertToken(parts[2], 'value');
    const seconds = Number(parts[4]);
    if (!Number.isInteger(seconds) || seconds <= 0) {
      throw new ProtocolError('EX seconds must be a positive integer');
    }
    return { name: 'SET', key: parts[1], value: parts[2], ex: seconds };
  }

  throw new ProtocolError('wrong number of arguments for SET');
}

/**
 * @param {string} token
 * @param {string} label
 */
function assertToken(token, label) {
  if (token.length === 0) {
    throw new ProtocolError(`${label} must not be empty`);
  }
}

/**
 * @param {'OK' | 'PONG'} type
 * @returns {string}
 */
export function encodeSimple(type) {
  return `${type}\n`;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function encodeInt(n) {
  if (!Number.isInteger(n)) {
    throw new ProtocolError('INT payload must be an integer');
  }
  return `INT ${n}\n`;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function encodeStr(value) {
  if (typeof value !== 'string') {
    throw new ProtocolError('STR payload must be a string');
  }
  if (/[\r\n]/.test(value)) {
    throw new ProtocolError('STR payload must not contain newlines');
  }
  return `STR ${value}\n`;
}

/**
 * @returns {string}
 */
export function encodeNil() {
  return 'NIL\n';
}

/**
 * @param {string} message
 * @returns {string}
 */
export function encodeErr(message) {
  const safe = String(message).replace(/[\r\n]+/g, ' ');
  return `ERR ${safe}\n`;
}

/**
 * Parse one response line (without trailing newline).
 * @param {string} line
 * @returns {{ type: 'OK' | 'PONG' | 'NIL' } | { type: 'INT', value: number } | { type: 'STR', value: string } | { type: 'ERR', message: string }}
 */
export function parseResponse(line) {
  const trimmed = line.trim();
  if (trimmed === 'OK' || trimmed === 'PONG' || trimmed === 'NIL') {
    return { type: trimmed };
  }
  if (trimmed.startsWith('INT ')) {
    const n = Number(trimmed.slice(4));
    if (!Number.isInteger(n)) {
      throw new ProtocolError('invalid INT response');
    }
    return { type: 'INT', value: n };
  }
  if (trimmed.startsWith('STR ')) {
    return { type: 'STR', value: trimmed.slice(4) };
  }
  if (trimmed === 'STR') {
    return { type: 'STR', value: '' };
  }
  if (trimmed.startsWith('ERR ')) {
    return { type: 'ERR', message: trimmed.slice(4) };
  }
  throw new ProtocolError(`invalid response: ${trimmed}`);
}
