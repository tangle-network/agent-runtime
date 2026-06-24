/**
 * Offline solution SOURCE for the round-invariant scenarios (csv-parser, lru-cache).
 *
 * These two tasks have no honest "hollow stub" round-0 cheat — the real algorithm IS the whole point
 * — so their offline agent writes the real implementation from round 0. We keep that source here as
 * readable template literals (not `+ '\n' +` escaped strings) so the offline agent script in
 * `benchmark.ts` stays a one-liner. The rate-limiter, which DOES carry a deliberate round-0 cheat, is
 * the one teaching pair and lives inline in `benchmark.ts`.
 */

/** A single-pass RFC-4180 CSV parser — handles quoted fields, doubled-quote escapes, and embedded
 *  newlines within quoted fields. */
export const csvParserSource = `export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < input.length; i++) {
    const c = input.charAt(i)
    if (inQuotes) {
      if (c === '"' && input.charAt(i + 1) === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  row.push(field); rows.push(row)
  return rows
}
`

/** An insertion-ordered-Map LRU cache — O(1) get/set, recency refresh on read, evict the LRU at
 *  capacity. */
export const lruCacheSource = `export class LruCache<K, V> {
  private map = new Map<K, V>()
  constructor(private capacity: number) {}
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const v = this.map.get(key) as V
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    else if (this.map.size >= this.capacity) this.map.delete(this.map.keys().next().value as K)
    this.map.set(key, value)
  }
}
`
