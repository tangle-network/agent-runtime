/**
 * In-sample evaluation windows: K overlapping blocks drawn by a seeded block
 * bootstrap over the in-sample years. Deterministic given (totalDays, opts) —
 * the same seed always yields the same windows, so every candidate in a
 * campaign is scored on the SAME slices and reruns reproduce bit-identically.
 */

export interface EvalWindow {
  /** Day-index range [start, end) into the in-sample date axis. */
  start: number
  end: number
}

/** Small deterministic PRNG (mulberry32). Good enough for window draws; NOT
 *  for anything cryptographic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface BootstrapWindowOptions {
  k: number
  windowDays: number
  seed: number
  /** Earliest allowed window start — leaves room for indicator warmup so a
   *  window never scores days where a lookback strategy is still all-cash by
   *  construction. */
  warmupDays: number
}

export function bootstrapWindows(totalDays: number, opts: BootstrapWindowOptions): EvalWindow[] {
  const { k, windowDays, seed, warmupDays } = opts
  if (k < 1 || !Number.isInteger(k)) throw new Error(`bootstrapWindows: k must be a positive integer, got ${k}`)
  if (windowDays < 2) throw new Error(`bootstrapWindows: windowDays must be >= 2, got ${windowDays}`)
  const lastStart = totalDays - windowDays
  if (lastStart < warmupDays) {
    throw new Error(
      `bootstrapWindows: ${totalDays} days cannot fit a ${windowDays}-day window after ${warmupDays} warmup days`,
    )
  }
  const rand = mulberry32(seed)
  const starts: number[] = []
  for (let i = 0; i < k; i++) {
    starts.push(warmupDays + Math.floor(rand() * (lastStart - warmupDays + 1)))
  }
  starts.sort((a, b) => a - b)
  return starts.map((start) => ({ start, end: start + windowDays }))
}
