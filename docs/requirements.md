# Requirements — Universal Distributed Cache System

**Phase:** 0 (Requirements & Design)  
**Status:** Design contract for subsequent phases  
**Stack:** Node.js LTS, ES Modules, TCP protocol (later), Docker Compose (later)

## 1. Problem statement

Build a Redis-inspired distributed in-memory key-value cache from scratch for learning and demonstrating distributed-systems engineering. The system progresses from a single-node in-process store to sharding, replication, failure detection, failover, persistence, observability, and local cluster deployment.

This is **not** a production Redis replacement.

## 2. Goals

- Expose a clear client/server command protocol for cache operations.
- Support TTL, eviction, sharding (consistent hashing), replication, membership/health, and failover over time.
- Make consistency, availability, and failure trade-offs explicit and measurable.
- Keep implementations simple enough to teach the underlying concepts.

## 3. Non-goals (initial)

- Kubernetes or cloud orchestration.
- Raft / consensus-based leader election.
- Custom binary protocol on day one.
- Every eviction algorithm.
- GUI / dashboard before core correctness.
- Multi-region replication.
- Exactly-once delivery or perfect failure detection claims without proof.

## 4. Value model & serialization

| Decision | Choice |
|----------|--------|
| Value type (Phases 1–5) | UTF-8 strings |
| JSON | Client concern only; the cache does **not** parse JSON on store |
| Buffers / typed protocol | Deferred; not part of v1 contract |
| Command framing (Phase 4+) | Newline-delimited text over TCP |
| Responses | Simple status / bulk text lines (exact wire format defined in Phase 4) |

Keys and values are opaque UTF-8 strings to the cache. Application-level encoding is the client's responsibility.

## 5. Key / value limits

| Limit | Value | Behavior on violation |
|-------|-------|------------------------|
| Max key length | 256 bytes (UTF-8) | Reject with explicit error |
| Max value size | 1 MiB (1,048,576 bytes) | Reject with explicit error |
| Empty key | Not allowed | Reject with explicit error |
| Empty value | Allowed | Stored as empty string |

Validation happens at the command boundary before mutating store state.

## 6. Commands (v1)

Commands below are the Phase 0 contract. Wire protocol arrives in Phase 4; in-process API arrives in Phase 1.

| Command | Args | Success | Notes |
|---------|------|---------|-------|
| `SET` | `key` `value` \[`EX` `seconds`\] | OK / acknowledgement | Overwrites existing key. `EX` optional (Phase 2). |
| `GET` | `key` | Value, or nil/miss | Expired keys behave as missing. |
| `DELETE` | `key` | 1 if removed, 0 if absent | Alias: `DEL`. Idempotent for missing keys. |
| `EXISTS` | `key` | 1 or 0 | Expired keys → 0. |
| `TTL` | `key` | Remaining seconds, or sentinel for no-expiry / missing | Exact semantics finalized with Phase 2. |
| `PING` | (none) | `PONG` | Liveness probe; no store mutation. |

### Future commands (not v1)

Cluster / admin commands (node join/leave, membership, replication status, metrics, auth) are deferred to later phases. They must not be invented ad hoc in early phases.

### Error handling

- Invalid command name → explicit error (not silent ignore).
- Wrong arity / invalid arguments → explicit error.
- Oversized key/value → explicit error.
- Errors must be distinguishable from cache misses.

### Idempotency (v1 expectations)

- `SET` of the same key/value is safe to retry (last write wins).
- `DELETE` / `EXISTS` / `GET` / `PING` are safe to retry.
- Distributed idempotency for replication/control messages is a later-phase concern.

## 7. TTL semantics

- Expiration is **not** guaranteed at the exact millisecond of the deadline.
- **Lazy expiration first** (Phase 2): expired keys are treated as missing on read/access; they may remain in memory until observed or cleaned up.
- **Active/background expiration later**: optional sweeper; still best-effort, not hard real-time.
- On `GET` / `EXISTS` / `TTL` / `DELETE`, an expired key behaves as if it does not exist.
- Updating a key with `SET` replaces value and TTL metadata according to the new command.
- Do **not** create one JavaScript timer per key at scale (design constraint for Phase 2+).

## 8. Consistency & availability goals

### Single-node (Phases 1–5)

- Operations on one process are **linearizable** relative to that node's event-loop ordering.
- No multi-key atomic transactions in v1.

### Cluster (Phases 6+)

| Property | Goal |
|----------|------|
| Consistency | **Eventual** across replicas with **async replication** (Phase 8) |
| Strong cross-node consistency | **Not claimed** |
| Availability (pre-failover) | Keys whose primary (and unreplicated sole copy) is down are **unavailable** |
| Availability (post-failover, Phase 10) | Promote eligible replica; update routing; continue service for remapped keys |
| Partition behavior | Prefer documenting degradation over pretending CAP magic; heartbeat failure means *suspected* unavailable, not proof |

Never claim a guarantee the implementation does not provide.

## 9. Behavior when a node is unavailable

| Stage | Behavior |
|-------|----------|
| Before membership/failover | Client/router surfaces an error (timeout / connection failure) for keys routed to the down node. No silent data invention. |
| With replication, before failover | Reads may fail or see stale replica data depending on read policy (defined in Phase 8); writes to the failed primary are rejected. |
| After failover (Phase 10) | Eligible replica promoted; routing metadata updated; clients must not send new writes to the failed primary. |
| Node returns | Rejoin / reconciliation rules defined in Phase 10; stale data reconciliation must be explicit. |

## 10. Success metrics

These are **measurement goals**, not SLAs. Methodology and hardware must be documented with any published numbers (Phase 18).

| Metric | Definition |
|--------|------------|
| Latency | p50 / p95 / p99 end-to-end command latency |
| Throughput | Successful operations per second under a defined workload |
| Hit ratio | Hits / (hits + misses); expired-as-miss counted as miss |
| Memory usage | Process RSS and/or approximate entry/byte accounting as key count grows |
| Recovery time | Time from restart (or failover trigger) until the node/cluster accepts traffic again with restored or promoted state |

Supporting counters (later observability): requests/sec, misses, evictions, expirations, replication lag, failed requests, open connections, node health events.

## 11. Non-functional requirements

- **Operability:** structured logs and metrics endpoint in later phases; graceful shutdown when networking exists.
- **Testability:** every command and important failure path covered by automated tests as features land.
- **Complexity honesty:** prefer simple designs that expose distributed-systems behavior over opaque libraries for core learning objectives.
- **Memory bounds:** configurable max entries / approximate memory limits arrive with eviction (Phase 3).

## 12. Phase scope map (pointer only)

| Phases | Focus |
|--------|--------|
| 0 | This requirements doc + architecture v1 |
| 1 | In-process `CacheStore` + unit tests |
| 2–3 | TTL, eviction |
| 4–5 | TCP server, client library |
| 6–7 | Multi-node, consistent hashing |
| 8–10 | Replication, membership, failover |
| 11–15 | Persistence, concurrency, reliability, observability, security |
| 16–18 | Docker cluster, testing strategy, benchmarking |

## 13. Acceptance for Phase 0

Phase 0 is complete when this document and [`architecture-v1.md`](./architecture-v1.md) together define commands, limits, serialization, TTL semantics, consistency/availability goals, unavailable-node behavior, and success metrics—without implementing runtime code.
