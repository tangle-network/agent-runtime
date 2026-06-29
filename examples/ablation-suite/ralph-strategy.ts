/**
 * ralph — the dumb while-loop where state lives in the FILE, not the agent's context.
 *
 * ONE persistent artifact; every round a FRESH agent (no carried conversation, no analyst, no driver)
 * re-reads the accumulated file + the failing tests and continues. This is the canonical Ralph:
 *   while not done: dispatch_fresh("here's the spec + current file, run the tests, finish it")
 *
 * The clean contrast the ablation needs:
 *   - `refine` (single)  = ONE continuous agent whose CONVERSATION carries across rounds (and bloats).
 *   - `ralph`            = fresh agent each round, state externalized to the file (context never bloats).
 *   - the supervisor     = an LLM driver that COORDINATES workers (decides, targets, allocates) — Ralph
 *                          plus a brain.
 * If respawn-fresh beats continuous on long tasks, Ralph > refine. If the brain earns its cost, supervisor > Ralph.
 */
import { defineStrategy } from '@tangle-network/agent-runtime/loops'

const ralphContinue =
  'A previous attempt may have left partial work in the implementation file. FIRST read the current file and ' +
  'call run_tests to see which tests pass and which fail, THEN fix exactly the failing tests. Build on the ' +
  'existing file — do not restart from scratch.'

export const ralph = defineStrategy('ralph', async ({ surface, task, budget, shot }) => {
  const handle = await surface.open(task)
  const progression: number[] = []
  let completions = 0
  let shots = 0
  let score = 0
  try {
    for (let i = 0; i < budget; i += 1) {
      // No `messages` ⇒ a FRESH context each round; the persistent `handle` is the only carried state.
      const out = await shot({ handle, steer: ralphContinue })
      if (!out) break
      shots += 1
      completions += out.completions
      score = out.score
      progression.push(out.score)
      if (out.score >= 1) break
    }
    return { score, resolved: score >= 1, completions, progression, shots }
  } finally {
    await surface.close(handle)
  }
})
