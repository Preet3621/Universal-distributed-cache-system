/**
 * O(1) LRU order tracker: doubly linked list + key → node map.
 * Head = most recently used (MRU). Tail = least recently used (LRU).
 *
 * @typedef {{ key: string, prev: LruNode | null, next: LruNode | null }} LruNode
 */
export class LruList {
  constructor() {
    /** @type {Map<string, LruNode>} */
    this.#nodes = new Map();
    /** @type {LruNode | null} */
    this.#head = null;
    /** @type {LruNode | null} */
    this.#tail = null;
  }

  /** @type {Map<string, LruNode>} */
  #nodes;

  /** @type {LruNode | null} */
  #head;

  /** @type {LruNode | null} */
  #tail;

  /** @returns {number} */
  get size() {
    return this.#nodes.size;
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.#nodes.has(key);
  }

  /**
   * Insert key as MRU, or move to MRU if already present.
   * @param {string} key
   */
  add(key) {
    if (this.#nodes.has(key)) {
      this.touch(key);
      return;
    }

    /** @type {LruNode} */
    const node = { key, prev: null, next: this.#head };
    if (this.#head !== null) {
      this.#head.prev = node;
    }
    this.#head = node;
    if (this.#tail === null) {
      this.#tail = node;
    }
    this.#nodes.set(key, node);
  }

  /**
   * Mark key as most recently used. No-op if missing.
   * @param {string} key
   */
  touch(key) {
    const node = this.#nodes.get(key);
    if (node === undefined || node === this.#head) {
      return;
    }

    this.#unlink(node);
    node.prev = null;
    node.next = this.#head;
    if (this.#head !== null) {
      this.#head.prev = node;
    }
    this.#head = node;
    if (this.#tail === null) {
      this.#tail = node;
    }
  }

  /**
   * @param {string} key
   * @returns {boolean} true if the key was in the list
   */
  remove(key) {
    const node = this.#nodes.get(key);
    if (node === undefined) {
      return false;
    }
    this.#unlink(node);
    this.#nodes.delete(key);
    return true;
  }

  /**
   * Remove and return the least-recently-used key.
   * @returns {string | undefined}
   */
  evictLru() {
    if (this.#tail === null) {
      return undefined;
    }
    const key = this.#tail.key;
    this.remove(key);
    return key;
  }

  /**
   * @returns {string | undefined}
   */
  peekLru() {
    return this.#tail === null ? undefined : this.#tail.key;
  }

  /**
   * @returns {string | undefined}
   */
  peekMru() {
    return this.#head === null ? undefined : this.#head.key;
  }

  /**
   * @param {LruNode} node
   */
  #unlink(node) {
    if (node.prev !== null) {
      node.prev.next = node.next;
    } else {
      this.#head = node.next;
    }

    if (node.next !== null) {
      node.next.prev = node.prev;
    } else {
      this.#tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }
}
