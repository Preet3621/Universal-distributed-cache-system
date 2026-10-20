# Replication (Phase 8)

Asynchronous primary → replica write propagation for a consistent-hash cluster. **Eventual consistency** across copies; the client is acked when the **primary** applies the write, not when all replicas finish.

## Topology

- Every cache node shares the same **ordered** cluster node list (`nodeIndex` = position in that list).
- **Primary** for a key: `HashRing.lookup(key)`.
- **Replica set**: walk clockwise on the ring from the key hash; collect distinct physical nodes until `replicationFactor` is reached (default **3**, capped at node count).
- On a 3-node cluster with RF=3, each key exists on all three nodes (one primary + two async replicas).

## Client behavior

- `ClusterClient` still sends user commands to the **primary only** (unchanged from Phase 7).
- Reads from replicas are not routed by the client in this phase (you can observe replica data with a direct `CacheClient` to a peer for testing).

## Wire protocol (node-to-node)

Replication uses internal lines (not exposed via the public CLI):

| Line | Effect on replica |
|------|-------------------|
| `REPL SET key value` | Same as `SET` |
| `REPL SET key value EX n` | Same as `SET … EX n` |
| `REPL DEL key` | Same as `DEL` |

Replicas apply `REPL` locally and **do not** fan-out again (loop prevention).

## Server configuration

Enable on each process with matching cluster metadata:

```bash
npm start -- --port 6371 \
  --node-id n1 \
  --cluster-nodes n1@127.0.0.1:6371,n2@127.0.0.1:6372,n3@127.0.0.1:6373 \
  --replication-factor 3
```

Environment equivalents: `CACHE_NODE_ID`, `CACHE_CLUSTER_NODES`, `CACHE_REPLICATION_FACTOR`, `CACHE_VIRTUAL_NODES_PER_NODE` (default 128, must match `ClusterClient`).

If `--cluster-nodes` is omitted, the node behaves as Phase 7 (no replication).

## Ack policy and failures

- **Primary-only ack**: `OK` / `INT` is sent to the external client before replication completes.
- Replication errors are counted in-memory per peer (`ReplicationEngine` stats on the node); they do not fail the client response.
- No automatic backfill if a replica was down during a write.

## Not in Phase 8

- Heartbeats / membership (Phase 9)
- Failover / promotion (Phase 10)
- Quorum writes, read-from-replica routing, persistence, metrics HTTP

See [requirements.md](./requirements.md) §8–§9 for consistency and unavailable-node goals.
