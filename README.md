# Universal Distributed Cache System

Redis-inspired distributed in-memory cache built from scratch in Node.js (ES Modules), progressing phase by phase from a single-node store to sharding, replication, failover, persistence, and local Docker clusters.

This is a learning / portfolio systems project—not a production Redis replacement.

## Current phase

**Phase 4 — TCP Cache Server** (complete: newline protocol, multi-client server, CLI)

## Docs

- [Requirements](docs/requirements.md) — commands, limits, TTL, consistency/availability, failure behavior, success metrics
- [Architecture v1](docs/architecture-v1.md) — target diagram, phase boundaries, components, data flows
- [Benchmarks](docs/benchmarks.md) — LRU hit-ratio methodology
- Full roadmap: [Universal_Distributed_Cache_System_Roadmap.docx](Universal_Distributed_Cache_System_Roadmap.docx)

## Layout (so far)

```text
packages/cache-core/   # CacheStore: validation, TTL, LRU, memory
packages/protocol/     # newline-delimited command/response codec
apps/cache-node/       # TCP server + CLI
tests/unit/
tests/integration/
benchmarks/
docs/
```

## Commands

```bash
npm test
npm start                          # cache-node on 127.0.0.1:6379
npm run cli -- PING
npm run cli -- SET user:1 Prit
npm run cli -- GET user:1
npm run bench:lru
```

Requires Node.js 20+.

### TCP protocol (learning)

One command per line. Keys/values **must not contain spaces** (simple framing).

| Request | Response examples |
|---------|-------------------|
| `PING` | `PONG` |
| `SET key value` / `SET key value EX 60` | `OK` |
| `GET key` | `STR value` or `NIL` |
| `DEL key` / `DELETE key` | `INT 1` / `INT 0` |
| `EXISTS key` | `INT 1` / `INT 0` |
| `TTL key` | `INT n` (`-2` missing, `-1` no expiry) |
| bad input | `ERR message` |

Idle connections time out (default 60s). `SIGINT`/`SIGTERM` trigger graceful shutdown.

```bash
# terminal 1
npm start -- --port 6379

# terminal 2
npm run cli -- --port 6379 -- SET user:1 Prit
npm run cli -- --port 6379 -- GET user:1
```

Interactive: `npm run cli` then type commands; `quit` to exit.

### CacheStore API (in-process)

Still available for unit tests and later phases — see Phase 1–3. Options include `maxEntries`, `maxMemoryBytes`, TTL sweeper, injectable `now`.

### Eviction / TTL

Unchanged from Phase 2–3: lazy + optional active expiry; LRU with entry/memory caps. LFU deferred.

## Next

Phase 5 — reusable Node.js `CacheClient` library (reconnect, timeouts, async API).
