/**
 * Small Phase 3 benchmark: LRU hit ratio under zipf-ish vs uniform key access.
 *
 * Methodology (document when claiming numbers):
 * - In-process CacheStore only (no TCP)
 * - Fixed seed PRNG for reproducibility
 * - Warm cache with sequential inserts, then mixed GET workload
 * - Hardware / Node version printed at runtime
 *
 * Run: npm run bench:lru
 */
import { CacheStore } from '../packages/cache-core/index.js';

/**
 * Deterministic mulberry32 PRNG.
 * @param {number} seed
 * @returns {() => number} float in [0, 1)
 */
function createRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} n
 * @param {number} s
 * @returns {Float64Array} cumulative probabilities
 */
function buildZipfCdf(n, s = 1.0) {
  const weights = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = 1 / (i + 1) ** s;
    weights[i] = w;
    sum += w;
  }
  const cdf = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += weights[i] / sum;
    cdf[i] = acc;
  }
  cdf[n - 1] = 1;
  return cdf;
}

/**
 * @param {() => number} rng
 * @param {Float64Array} cdf
 */
function sampleCdf(rng, cdf) {
  const u = rng();
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (u <= cdf[mid]) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/**
 * @param {{
 *   label: string,
 *   maxEntries: number,
 *   keySpace: number,
 *   ops: number,
 *   seed: number,
 *   mode: 'uniform' | 'zipf',
 * }} config
 */
function runWorkload(config) {
  const { label, maxEntries, keySpace, ops, seed, mode } = config;
  const rng = createRng(seed);
  const cache = new CacheStore({ maxEntries });
  const zipfCdf = mode === 'zipf' ? buildZipfCdf(keySpace, 1.0) : null;

  const keyOf = (i) => `k${i}`;

  // Warm: insert up to capacity (or keySpace if smaller).
  const warm = Math.min(maxEntries, keySpace);
  for (let i = 0; i < warm; i++) {
    cache.set(keyOf(i), 'v');
  }

  const started = performance.now();
  for (let i = 0; i < ops; i++) {
    const idx =
      mode === 'zipf' && zipfCdf !== null
        ? sampleCdf(rng, zipfCdf)
        : Math.floor(rng() * keySpace);
    // 80% GET / 20% SET — typical cache-aside-ish mix
    if (rng() < 0.8) {
      cache.get(keyOf(idx));
    } else {
      cache.set(keyOf(idx), 'v');
    }
  }
  const elapsedMs = performance.now() - started;

  return {
    label,
    mode,
    maxEntries,
    keySpace,
    ops,
    hits: cache.hits,
    misses: cache.misses,
    hitRatio: cache.hitRatio,
    evictions: cache.evictions,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    opsPerSec: Math.round(ops / (elapsedMs / 1000)),
  };
}

function main() {
  const keySpace = 10_000;
  const maxEntries = 1_000;
  const ops = 50_000;
  const seed = 42;

  console.log('LRU hit-ratio benchmark (Phase 3)');
  console.log(`Node ${process.version} | ${process.platform} ${process.arch}`);
  console.log(
    `keySpace=${keySpace} maxEntries=${maxEntries} ops=${ops} seed=${seed}`,
  );
  console.log('Workload: 80% GET / 20% SET after sequential warm fill.\n');

  const results = [
    runWorkload({
      label: 'uniform',
      mode: 'uniform',
      maxEntries,
      keySpace,
      ops,
      seed,
    }),
    runWorkload({
      label: 'zipf',
      mode: 'zipf',
      maxEntries,
      keySpace,
      ops,
      seed,
    }),
  ];

  for (const r of results) {
    console.log(
      `${r.label.padEnd(8)} hitRatio=${r.hitRatio.toFixed(4)} ` +
        `hits=${r.hits} misses=${r.misses} evictions=${r.evictions} ` +
        `${r.opsPerSec} ops/s (${r.elapsedMs} ms)`,
    );
  }

  console.log(
    '\nExpect zipf hitRatio > uniform when working set is skewed and cache is smaller than keySpace.',
  );
}

main();
