/**
 * Client-side failure (connection, timeout, protocol, server ERR).
 */
export class ClientError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ClientError';
    this.code = code;
  }
}
