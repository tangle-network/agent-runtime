/** One identified task admitted by a caller-owned ready queue. */
export interface TaskQueueEntry<T> {
  readonly id: string
  readonly value: T
}

/** Native promise settlement, retaining the exact returned or thrown value. */
export type TaskQueueSettlement<T, R> = {
  readonly task: TaskQueueEntry<T>
} & (
  | { readonly status: 'fulfilled'; readonly value: R }
  | { readonly status: 'rejected'; readonly reason: unknown }
)

export interface TaskQueueOptions<T, R> {
  readonly concurrency: number
  /** Return the next ready task, or undefined when none is currently admissible.
   * Called again after each yielded settlement; awaiting admission may persist a
   * checkpoint before execute starts. Active identities cannot be admitted twice. */
  readonly take: (
    activeIds: ReadonlySet<string>,
  ) => TaskQueueEntry<T> | undefined | Promise<TaskQueueEntry<T> | undefined>
  readonly execute: (task: TaskQueueEntry<T>) => Promise<R>
}

/**
 * Admit bounded work and yield settlements for the caller's policy to interpret.
 * Readiness, cancellation, retries, and persistence belong to that caller.
 * A throw or early iterator return stops admission and awaits every started task.
 * Settlements are delivered in completion order, before further admission.
 * Task failures are yielded, never normalized or substituted for caller failures.
 */
export async function* runTaskQueue<T, R>(
  options: TaskQueueOptions<T, R>,
): AsyncGenerator<TaskQueueSettlement<T, R>> {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
    throw new RangeError('runTaskQueue: concurrency must be a positive safe integer')
  }
  const active = new Map<string, Promise<TaskQueueSettlement<T, R>>>()
  const completed: TaskQueueSettlement<T, R>[] = []
  try {
    for (;;) {
      while (active.size < options.concurrency && completed.length === 0) {
        const admitted = await options.take(new Set(active.keys()))
        if (admitted === undefined) break
        const task = Object.freeze({ id: admitted.id, value: admitted.value })
        if (active.has(task.id)) {
          throw new Error(`runTaskQueue: task "${task.id}" is already active`)
        }
        const settlement = Promise.resolve()
          .then(() => options.execute(task))
          .then(
            (value): TaskQueueSettlement<T, R> => ({ task, status: 'fulfilled', value }),
            (reason: unknown): TaskQueueSettlement<T, R> => ({ task, status: 'rejected', reason }),
          )
        active.set(
          task.id,
          settlement.then((result) => {
            completed.push(result)
            return result
          }),
        )
      }
      if (active.size === 0) return
      if (completed.length === 0) await Promise.race(active.values())
      const settlement = completed.shift()!
      active.delete(settlement.task.id)
      yield settlement
    }
  } finally {
    await Promise.allSettled(active.values())
  }
}
