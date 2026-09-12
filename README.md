# Universal Distributed Cache System

Redis-inspired distributed in-memory cache built from scratch in Node.js (ES Modules), progressing phase by phase from a single-node store to sharding, replication, failover, persistence, and local Docker clusters.

This is a learning / portfolio systems project—not a production Redis replacement.

## Current phase

**Phase 1 — Single-node in-memory cache** (in progress: scaffold + `CacheStore` core)

Phase 0 design docs are complete.

## Docs

- [Requirements](docs/requirements.md) — commands, limits, TTL, consistency/availability, failure behavior, success metrics
- [Architecture v1](docs/architecture-v1.md) — target diagram, phase boundaries, components, data flows
- Full roadmap: [Universal_Distributed_Cache_System_Roadmap.docx](Universal_Distributed_Cache_System_Roadmap.docx)

## Layout (so far)

```text
packages/cache-core/   # in-process CacheStore
tests/unit/            # Node.js built-in test runner
```

## Commands

```bash
npm test
```

Requires Node.js 20+.

## Next

Phase 1 remaining: input validation (key/value limits) and fuller failure-case tests.
