# Benchmarks

## LRU hit ratio (Phase 3)

**Script:** [`benchmarks/lru-hit-ratio.js`](../benchmarks/lru-hit-ratio.js)

```bash
npm run bench:lru
```

### Methodology

| Item | Value |
|------|--------|
| Scope | In-process `CacheStore` only (no TCP, no cluster) |
| Capacity | `maxEntries = 1000` |
| Key space | 10,000 distinct keys |
| Operations | 50,000 after warm fill |
| Mix | 80% `GET` / 20% `SET` |
| Workloads | Uniform random keys; Zipf (s=1.0) skewed keys |
| PRNG | Deterministic mulberry32 (`seed = 42`) |

### What we measure

- **Hit ratio** = `hits / (hits + misses)` from `CacheStore`
- Eviction count
- Throughput (ops/s) on the machine that runs the script

### Honesty notes

- Numbers are **not** comparable to Redis or other systems without matching hardware, protocol, and workload.
- Approximate `maxMemoryBytes` is key+value UTF-8 only — not V8 RSS.
- Re-run on your machine and record Node version / OS from the script banner before citing results.

### Expected qualitative result

With cache size ≪ key space, a **Zipf** workload should show a **higher hit ratio** than **uniform** access, because hot keys stay in the LRU working set.
