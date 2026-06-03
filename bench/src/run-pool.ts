/**
 * Bounded-concurrency task pool — the ONE pool every batch runner uses.
 *
 * Every batch-* command and the finsearch loop hand-rolled the same shape: a
 * shared `next` cursor, `Math.min(concurrency, tasks.length)` drain workers, and
 * `Promise.all` over them. That boilerplate lives here once. Aggregation and
 * console output stay at each call site — the pool owns scheduling, nothing else.
 *
 * A worker that throws yields `{ ok:false, error }` for THAT task; the batch never
 * aborts because one task failed. Results are returned in task order (indexed by
 * the task's position), not completion order.
 */
import type { BenchTask } from './benchmarks/types'

export interface PoolOutcome<R> {
  index: number
  task: BenchTask
  ok: boolean
  value?: R
  error?: string
}

export async function runPool<R>(
  tasks: BenchTask[],
  concurrency: number,
  worker: (task: BenchTask, index: number) => Promise<R>,
  opts?: { onResult?: (o: PoolOutcome<R>) => void },
): Promise<PoolOutcome<R>[]> {
  const results: PoolOutcome<R>[] = new Array(tasks.length)
  let next = 0
  const drain = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next++
      const task = tasks[index] as BenchTask
      let outcome: PoolOutcome<R>
      try {
        outcome = { index, task, ok: true, value: await worker(task, index) }
      } catch (err) {
        outcome = { index, task, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      results[index] = outcome
      opts?.onResult?.(outcome)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, drain))
  return results
}
