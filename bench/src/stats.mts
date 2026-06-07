/**
 * Shared statistics + scheduling helpers for the gate runners.
 *
 * The gate runners (humaneval / commit0 / aec / clbench-context / clbench-codebase)
 * each hand-rolled the same three primitives: a bounded-concurrency pool, the
 * mulberry32 PRNG, and the paired-bootstrap lift. They live here once.
 *
 * Two pools coexist on purpose, because the gates and the batch runners want
 * different fault contracts:
 *   - `runPool` (re-exported from ./run-pool) catches a per-item throw and yields
 *     `{ ok, error }` for THAT item — the batch never aborts. Used by the batch
 *     runners / experiment harness that aggregate partial results.
 *   - `pool` (here) lets the worker throw and propagates the rejection — the gates
 *     want a router/sandbox fault to abort the arm loudly rather than score a
 *     phantom 0. It returns `R[]` in item order. This matches the gates' existing
 *     private `pool()` exactly; it is NOT a re-export of `runPool`.
 */

export { runPool, type PoolOutcome } from './run-pool'

/** Bounded-concurrency pool: run `fn` over `items`, at most `limit` in flight,
 *  results returned in item order. A worker that throws propagates the rejection
 *  (fail-loud) — the gates rely on this so a router/judge fault aborts the arm
 *  rather than being silently scored. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const idx = next
      next += 1
      if (idx >= items.length) return
      results[idx] = await fn(items[idx] as T, idx)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()))
  return results
}

/** mulberry32 — deterministic PRNG (Math.imul). Seeded once at 0x9e3779b9 by
 *  `pairedLift` so every gate's bootstrap CI is reproducible and identical. */
export function makeRng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PairedLift {
  point: number
  low: number
  high: number
  pairs: number
  discordant: number
}

/** Paired lift = mean over tasks of (treatment − baseline) with a 95% bootstrap
 *  CI from resampling the paired tasks (mulberry32 seeded 0x9e3779b9, B=10000).
 *  Works on {0,1} arms (humaneval/aec/commit0) and continuous values (clbench
 *  rubric fractions) alike. `discordant` uses a |d| > 1e-9 tolerance, which equals
 *  the exact `d !== 0` test on integer-delta (binary) arms and avoids counting
 *  float noise as a discordant pair on continuous arms. */
export function pairedLift(baseline: number[], treatment: number[], bootstrapN = 10000): PairedLift {
  if (baseline.length !== treatment.length) throw new Error('pairedLift: misaligned arms')
  const n = baseline.length
  if (n === 0) throw new Error('pairedLift: no pairs')
  const deltas = baseline.map((b, i) => (treatment[i] as number) - b)
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  const point = mean(deltas)
  const discordant = deltas.filter((d) => Math.abs(d) > 1e-9).length
  const rng = makeRng(0x9e3779b9)
  const rint = (m: number) => Math.floor(rng() * m)
  const boots: number[] = []
  for (let b = 0; b < bootstrapN; b += 1) {
    let acc = 0
    for (let j = 0; j < n; j += 1) acc += deltas[rint(n)] as number
    boots.push(acc / n)
  }
  boots.sort((x, y) => x - y)
  return {
    point,
    low: boots[Math.floor(0.025 * bootstrapN)] ?? Number.NaN,
    high: boots[Math.floor(0.975 * bootstrapN)] ?? Number.NaN,
    pairs: n,
    discordant,
  }
}
