import type { Driver } from '../../src/loops'

/**
 * A minimal replay-until-valid driver — test scaffolding only. The product no longer ships a
 * `createRefineDriver` factory (the driver is a sandbox harness, not a code factory; see
 * docs/architecture.md §1). Kernel/composition tests still need *a* driver to exercise the loop, so
 * this 15-line equivalent lives in the test tree, not the library.
 */
export function refineDriver<Task, Output>(
  opts: { maxIterations?: number } = {},
): Driver<Task, Output, 'continue' | 'stop'> {
  const max = opts.maxIterations ?? 5
  return {
    name: 'refine',
    async plan(task, history) {
      if (history.length >= max) return []
      if (history.length === 0) return [task]
      const prior = history.at(-1)
      if (!prior || prior.verdict?.valid === true) return []
      return [prior.task]
    },
    decide(history) {
      const last = history.at(-1)
      if (last?.verdict?.valid === true || history.length >= max) return 'stop'
      return 'continue'
    },
  }
}

/** A single-round fanout: N copies round 0, then stop; the kernel selects the best-valid. Test
 *  scaffolding — the product no longer ships a `createFanoutVoteDriver` factory. */
export function fanoutDriver<Task, Output>(
  n: number,
): Driver<Task, Output, 'pick-winner' | 'fail'> {
  return {
    name: 'fanout',
    plan: async (task, history) =>
      history.length === 0 ? Array.from({ length: n }, () => task) : [],
    decide: (history) => (history.some((i) => i.verdict?.valid === true) ? 'pick-winner' : 'fail'),
  }
}
