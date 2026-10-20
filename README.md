# Universal Distributed Cache System

Redis-inspired distributed in-memory cache built from scratch in Node.js (ES Modules), progressing phase by phase from a single-node store to sharding, replication, failover, persistence, and local Docker clusters.

This is a learning / portfolio systems project—not a production Redis replacement.

## Current phase

**Phase 8 — Async replication** (complete: `packages/replication`, `REPL` wire commands, primary-only ack, RF=3 default on clustered nodes)

## Docs

- [Requirements](docs/requirements.md) — commands, limits, TTL, consistency/availability, failure behavior, success metrics
- [Architecture v1](docs/architecture-v1.md) — target diagram, phase boundaries, components, data flows
- [Replication](docs/replication.md) — RF, REPL protocol, node flags, limits
- [Benchmarks](docs/benchmarks.md) — LRU hit-ratio methodology
- Full roadmap: [Universal_Distributed_Cache_System_Roadmap.docx](Universal_Distributed_Cache_System_Roadmap.docx)

## Layout (so far)

```text
packages/cache-core/   # CacheStore: validation, TTL, LRU, memory
packages/protocol/     # newline-delimited command/response codec
packages/hashing/        # hashKey, HashRing (virtual nodes, replica walk)
packages/replication/    # async fan-out, cluster config, per-peer stats
packages/client/         # CacheClient + ClusterClient (consistent hash default)
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
npm run example:cluster          # ClusterClient demo (nodes on 6371–6373)
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

**Cluster CLI** (uses `ClusterClient` + consistent hash):

```bash
npm run cli -- --nodes 127.0.0.1:6371,127.0.0.1:6372,127.0.0.1:6373 -- PING
npm run cli -- --nodes 127.0.0.1:6371,127.0.0.1:6372,127.0.0.1:6373 -- SET user:1 Prit
npm run cli -- --nodes 127.0.0.1:6371,127.0.0.1:6372,127.0.0.1:6373 -- GET user:1
```

Or set `CACHE_NODES` to the same comma-separated list. Optional ids: `n1@127.0.0.1:6371,n2@127.0.0.1:6372`.

### CacheClient (programmatic)

Persistent TCP connection with a FIFO command queue (safe for `Promise.all` on one client). Options include `connectTimeoutMs`, `commandTimeoutMs`, `autoReconnect`, and `maxReconnectAttempts`.

```js
import { CacheClient } from './packages/client/index.js';

const client = new CacheClient({ host: '127.0.0.1', port: 6379 });
await client.connect();
await client.set('user:1', 'Prit');
console.log(await client.get('user:1')); // "Prit"
await client.close();
```

Server `ERR` responses throw `ClientError` with code `SERVER_ERROR`. Connection loss with `autoReconnect: true` (default) retries before the next command.

### ClusterClient (sharded cluster)

Fixed node list; key commands route via a **consistent hash ring** with **128 virtual nodes per physical node** (default). Shared `hashKey` is SHA-256 → uint32. One TCP connection pool per node. `ping()` probes **all** nodes. If the owning node is unreachable after reconnect, operations throw `ClientError` with code `NODE_UNAVAILABLE` and `details` (`nodeId`, `nodeIndex`, `key`, `cause`, …)—no silent reroute.

For comparison with Phase 6, pass `routing: 'modulo'` (uses `hash(key) % N`). Options: `virtualNodesPerNode` (default `128`).

Run multiple nodes locally (three terminals). For **replication**, each node needs the same cluster list and its own `--node-id` (see [Replication](docs/replication.md)):

```bash
CLUSTER="n1@127.0.0.1:6371,n2@127.0.0.1:6372,n3@127.0.0.1:6373"

npm start -- --port 6371 --node-id n1 --cluster-nodes "$CLUSTER"
npm start -- --port 6372 --node-id n2 --cluster-nodes "$CLUSTER"
npm start -- --port 6373 --node-id n3 --cluster-nodes "$CLUSTER"
```

Without cluster flags, nodes only shard (Phase 7):

```bash
npm start -- --port 6371
npm start -- --port 6372
npm start -- --port 6373
```

```js
import { ClusterClient } from './packages/client/index.js';

const cluster = new ClusterClient({
  nodes: [
    { id: 'n1', host: '127.0.0.1', port: 6371 },
    { id: 'n2', host: '127.0.0.1', port: 6372 },
    { id: 'n3', host: '127.0.0.1', port: 6373 },
  ],
});
await cluster.connect();
await cluster.set('user:1', 'Prit');
console.log(await cluster.get('user:1'));
await cluster.close();
```

Adding a node moves far fewer keys than modulo-N (see `tests/unit/hash-ring.test.js` vs `modulo-router.test.js`).

Try the repo demo after starting three nodes: `npm run example:cluster` (see [`examples/cluster-demo.js`](examples/cluster-demo.js)).

### CacheStore API (in-process)

Still available for unit tests and later phases — see Phase 1–3. Options include `maxEntries`, `maxMemoryBytes`, TTL sweeper, injectable `now`.

### Eviction / TTL

Unchanged from Phase 2–3: lazy + optional active expiry; LRU with entry/memory caps. LFU deferred.

## Next

Phase 9 — membership and heartbeats.
