import type { Driver } from '../../src/loops'

/**
 * A minimal replay-until-valid driver — test scaffolding only. The product no longer ships a
 * `createRefineDriver` factory (the driver is a sandbox harness, not a code factory; see
 * docs/architecture.md §1). Kernel/composition tests still need *a* driver to exercise the loop, so
 * this 15-line equivalent lives in the test tree, not the library.
 */
export function refineDriver<Task, Output>(opts: { maxIterations?: number } = {}): Driver<Task, Output, 'continue' | 'stop'> {
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
