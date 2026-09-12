# Architecture v1 — Universal Distributed Cache System

**Phase:** 0 (Requirements & Design)  
**Companion:** [`requirements.md`](./requirements.md)  
**Note:** This document describes the **target** architecture and phase boundaries. Only Phase 0 design artifacts exist in the repository today.

## 1. Target high-level architecture

```text
Client
  |
  v
Cache Client / Router
  |
  +-------------------------------+
  | Consistent Hash Ring          |
  +-------------------------------+
       |         |         |
       v         v         v
    Node A    Node B    Node C
      |          |         |
   replicas   replicas   replicas
      |          |         |
      +----------+---------+
                 |
        Membership / Health
                 |
       Persistence + Metrics
```

End state (after later phases): clients talk to a router that maps keys onto cache nodes via a consistent hash ring. Nodes may hold replicas. A membership/health layer detects suspected failures and drives failover. Persistence and observability are separate concerns attached to nodes (and optionally the router).

## 2. Phase boundaries

This v1 doc is aspirational for the full system. Implementation must not skip ahead.

| After phase | What exists | Still aspirational |
|-------------|-------------|--------------------|
| **0 (now)** | Requirements + this architecture | All runtime code |
| **1** | In-process `CacheStore` (Map-backed), unit tests | Network, cluster |
| **2–3** | TTL + eviction | TCP |
| **4–5** | TCP server, CLI, `CacheClient` | Multi-node routing |
| **6** | Multiple nodes, modulo-N baseline routing | Consistent hashing |
| **7** | Consistent hash ring + virtual nodes | Replication |
| **8–10** | Replication, heartbeats, failover | Persistence polish |
| **11–15** | Persistence, reliability, metrics, security controls | Docker cluster |
| **16–18** | Compose cluster, failure tests, documented benchmarks | Optional research (Raft, gossip, multi-region) |

**Rule:** do not implement future phases early. Each phase delivers a small, testable increment.

## 3. Intended repository structure

When coding begins, the repo should grow toward:

```text
distributed-cache/   (this repository root)
├── apps/
│   ├── cache-node/
│   ├── router/
│   └── admin-api/
├── packages/
│   ├── protocol/
│   ├── client/
│   ├── cache-core/
│   ├── hashing/
│   ├── replication/
│   └── membership/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── distributed/
│   └── failure/
├── benchmarks/
├── docs/
│   ├── requirements.md
│   ├── architecture-v1.md
│   ├── consistency.md          (later)
│   ├── failure-model.md        (later)
│   └── benchmarks.md           (later)
├── docker-compose.yml          (later)
├── package.json                (later)
└── README.md
```

Phase 1 may start with a smaller layout (e.g. `packages/cache-core` only) and expand as components appear. The structure above is the **intended** monorepo shape, not a mandate to create empty packages early.

## 4. Component responsibilities

| Component | Responsibility |
|-----------|----------------|
| **cache-core** | In-memory store: `SET`/`GET`/`DELETE`/`EXISTS`/`TTL`, expiration metadata, eviction. Pure logic; no networking. |
| **protocol** | Framing, parsing, validation of newline-delimited commands and responses. Shared by server and client. |
| **client** | Connection management, serialize commands, parse responses, timeouts/reconnect. No distributed routing initially. |
| **cache-node (app)** | Process wrapping cache-core + protocol TCP server; later persistence, metrics, replication endpoints. |
| **hashing** | Deterministic hash, sorted ring, virtual nodes, key→node mapping, add/remove with measured key movement. |
| **router (app)** | Uses hashing to forward client ops to the owning node; later reacts to membership changes. |
| **replication** | Fan-out writes to replicas, ack policy, loop prevention, lag/error tracking. |
| **membership** | Heartbeats, last-seen, failure thresholds, idempotent membership broadcasts; “suspected” vs proven failure. |
| **admin-api** | Optional HTTP admin/metrics surface; must not replace the cache protocol. |

## 5. Data flows

### 5.1 Single-node path (Phases 1–4)

```text
Caller / TCP client
       |
       v
  Command parse + validate
       |
       v
    CacheStore
       |
       +--> hit / miss / mutation result
       |
       v
  Response encode
```

- Phase 1: direct in-process calls into `CacheStore`.
- Phase 4: `net.createServer()` accepts connections; newline-framed commands; multiple clients; timeouts and graceful shutdown.

### 5.2 Planned distributed path (Phases 6+)

```text
Client
  -> CacheClient / Router
       -> hash(key) on ring
            -> primary Cache Node
                 -> (Phase 8+) async replicate to N replicas
                 -> (Phase 9+) heartbeats to membership
                 -> (Phase 10+) failover if primary suspected down
```

Baseline learning step (Phase 6): route with `hash(key) % N` to show excessive remapping on topology change, then replace with consistent hashing (Phase 7).

## 6. Consistency model (architecture view)

- **Single node:** linearizable within one Node.js process (event-loop order).
- **Replicas (planned):** asynchronous replication → **eventual consistency**; replication lag is observable, not hidden.
- **Failover (planned):** routing and primary identity change; stale-read windows must be documented when implemented.
- See [`requirements.md`](./requirements.md) §8–§9 for normative goals and unavailable-node behavior.

## 7. Explicitly not building yet

Aligned with the roadmap “What NOT to Build Initially”:

- Kubernetes
- Raft / consensus for metadata or leader election
- Custom binary protocol on day one
- Full suite of eviction algorithms (start with LRU when Phase 3 arrives)
- GUI before core system works
- Multi-region replication
- Claims of exactly-once delivery or perfect failure detection

Optional advanced research (quorum, vector clocks, gossip, split-brain, hot-key mitigation) comes only after the core system.

## 8. Design principles for later implementation

1. Build small → measure → break it → understand → improve → document the trade-off.
2. Prefer simple implementations that expose the concept (e.g. async replication so lag is visible).
3. Use third-party packages for infrastructure only, not to hide core learning objectives.
4. Never claim a guarantee the code does not provide.
5. Keep modules small and independently testable.

## 9. Acceptance for Phase 0

Architecture v1 is complete when the target diagram, phase boundaries, intended layout, component map, and data flows are documented—and it is clear that **no runtime implementation** is required until Phase 1.
