# Universal Distributed Cache System

Redis-inspired distributed in-memory cache built from scratch in Node.js (ES Modules), progressing phase by phase from a single-node store to sharding, replication, failover, persistence, and local Docker clusters.

This is a learning / portfolio systems project—not a production Redis replacement.

## Current phase

**Phase 2 — TTL & Expiration** (complete: lazy + optional active sweeper)

## Docs

- [Requirements](docs/requirements.md) — commands, limits, TTL, consistency/availability, failure behavior, success metrics
- [Architecture v1](docs/architecture-v1.md) — target diagram, phase boundaries, components, data flows
- Full roadmap: [Universal_Distributed_Cache_System_Roadmap.docx](Universal_Distributed_Cache_System_Roadmap.docx)

## Layout (so far)

```text
packages/cache-core/   # in-process CacheStore (validation + TTL)
tests/unit/            # Node.js built-in test runner
```

## Commands

```bash
npm test
```

Requires Node.js 20+.

### CacheStore API (in-process)

```js
import { CacheStore } from './packages/cache-core/index.js';

const cache = new CacheStore(); // optional: { now, scheduler, sweeper }
cache.set('user:1', 'Prit');
cache.set('session', 'abc', { ex: 60 }); // expire in 60 seconds
cache.get('session');   // string | undefined
cache.exists('session');
cache.delete('session');
cache.ttl('session');   // -2 missing, -1 no expiry, else seconds left

// Active expiration (optional; still best-effort, not exact-ms)
cache.purgeExpired(); // scan / sample now
cache.startSweeper({ intervalMs: 1000, maxExamined: 20 });
cache.stopSweeper();
```

Exact-millisecond expiry is **not** guaranteed.

- **Lazy:** expired keys are removed on access (`get` / `exists` / `delete` / `ttl`).
- **Active:** optional shared interval samples keys in round-robin batches — **no per-key timers**.
- Without a sweeper, expired keys may remain in memory until touched.

## Next

Phase 3 — Eviction & memory management (LRU).
