import { describe, expect, it } from 'vitest'
import { bootstrapWindows, mulberry32 } from './windows.ts'

describe('bootstrapWindows', () => {
  it('is deterministic: same seed, same windows — bit-identical', () => {
    const a = bootstrapWindows(2086, { k: 8, windowDays: 504, seed: 42, warmupDays: 120 })
    const b = bootstrapWindows(2086, { k: 8, windowDays: 504, seed: 42, warmupDays: 120 })
    expect(a).toEqual(b)
  })

  it('different seeds draw different windows', () => {
    const a = bootstrapWindows(2086, { k: 8, windowDays: 504, seed: 42, warmupDays: 120 })
    const b = bootstrapWindows(2086, { k: 8, windowDays: 504, seed: 43, warmupDays: 120 })
    expect(a).not.toEqual(b)
  })

  it('respects warmup and data bounds for every window', () => {
    const windows = bootstrapWindows(2086, { k: 8, windowDays: 504, seed: 7, warmupDays: 120 })
    expect(windows).toHaveLength(8)
    for (const w of windows) {
      expect(w.start).toBeGreaterThanOrEqual(120)
      expect(w.end - w.start).toBe(504)
      expect(w.end).toBeLessThanOrEqual(2086)
    }
    // Sorted ascending, so campaigns log them stably.
    const starts = windows.map((w) => w.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('fails loud when the data cannot fit a window', () => {
    expect(() => bootstrapWindows(400, { k: 8, windowDays: 504, seed: 1, warmupDays: 120 })).toThrow(/cannot fit/)
    expect(() => bootstrapWindows(2086, { k: 0, windowDays: 504, seed: 1, warmupDays: 120 })).toThrow(/positive integer/)
  })

  it('mulberry32 streams are reproducible and in [0, 1)', () => {
    const r1 = mulberry32(123)
    const r2 = mulberry32(123)
    for (let i = 0; i < 100; i++) {
      const v = r1()
      expect(v).toBe(r2())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
