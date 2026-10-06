/**
 * @typedef {{
 *   nodeIndex: number,
 *   nodeId: string,
 *   host: string,
 *   port: number,
 *   key?: string,
 *   command?: string,
 *   cause?: ClientError,
 * }} ClientErrorDetails
 */

/**
 * Client-side failure (connection, timeout, protocol, server ERR).
 */
export class ClientError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ClientErrorDetails} [details]
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'ClientError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
