/**
 * Bounded-concurrency pool — the ONE pool every batch runner uses.
 *
 * Every batch-* command, the finsearch loop, and terminal-compare hand-rolled the
 * same shape: a shared `next` cursor, `Math.min(concurrency, items.length)` drain
 * workers, and `Promise.all` over them. That boilerplate lives here once.
 * Aggregation and console output stay at each call site — the pool owns scheduling,
 * nothing else. Item-agnostic on purpose: a pool shouldn't know about BenchTask
 * (terminal-compare pools over task-id strings), so it's generic in the item type.
 *
 * A worker that throws yields `{ ok:false, error }` for THAT item; the batch never
 * aborts because one item failed. Results are returned in item order (indexed by
 * the item's position), not completion order.
 */

export interface PoolOutcome<T, R> {
  index: number
  item: T
  ok: boolean
  value?: R
  error?: string
}

export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  opts?: { onResult?: (o: PoolOutcome<T, R>) => void },
): Promise<PoolOutcome<T, R>[]> {
  const results: PoolOutcome<T, R>[] = new Array(items.length)
  let next = 0
  const drain = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      const item = items[index] as T
      let outcome: PoolOutcome<T, R>
      try {
        outcome = { index, item, ok: true, value: await worker(item, index) }
      } catch (err) {
        outcome = { index, item, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      results[index] = outcome
      opts?.onResult?.(outcome)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, drain))
  return results
}
