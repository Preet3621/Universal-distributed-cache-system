/**
 * Per-peer replication counters (in-memory).
 */
export class ReplicationStats {
  /** @type {Map<string, { attempted: number, succeeded: number, failed: number, lastError: string | null }>} */
  #peers;

  constructor() {
    this.#peers = new Map();
    this.dropped = 0;
  }

  /**
   * @param {string} peerId
   */
  #ensurePeer(peerId) {
    if (!this.#peers.has(peerId)) {
      this.#peers.set(peerId, {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        lastError: null,
      });
    }
    return /** @type {{ attempted: number, succeeded: number, failed: number, lastError: string | null }} */ (
      this.#peers.get(peerId)
    );
  }

  /**
   * @param {string} peerId
   */
  recordAttempt(peerId) {
    this.#ensurePeer(peerId).attempted += 1;
  }

  /**
   * @param {string} peerId
   */
  recordSuccess(peerId) {
    this.#ensurePeer(peerId).succeeded += 1;
  }

  /**
   * @param {string} peerId
   * @param {string} message
   */
  recordFailure(peerId, message) {
    const peer = this.#ensurePeer(peerId);
    peer.failed += 1;
    peer.lastError = message;
  }

  recordDropped() {
    this.dropped += 1;
  }

  /**
   * @returns {{ dropped: number, peers: Record<string, { attempted: number, succeeded: number, failed: number, lastError: string | null }> }}
   */
  snapshot() {
    /** @type {Record<string, { attempted: number, succeeded: number, failed: number, lastError: string | null }>} */
    const peers = {};
    for (const [id, stats] of this.#peers) {
      peers[id] = { ...stats };
    }
    return { dropped: this.dropped, peers };
  }
}
