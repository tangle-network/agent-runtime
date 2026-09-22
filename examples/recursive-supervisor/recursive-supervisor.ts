/**
 * The recursive execution atom: one `Agent` whose `act()` spawns children
 * through `scope.spawn` on a conserved budget pool, run by `createSupervisor`.
 *
 * Children resolve through the open `Executor` port. The scripted executors +
 * registry plumbing live in ./inline-executor.ts so this file shows only the
 * lesson: `spawn` reserves from a shared pool, fails closed when it can't, and
 * the driver selects the best valid settlement. Everything runs offline with no
 * network, no sandbox, no key. A production caller can provide any `Executor`.
 *
 * Run with:
 *   pnpm tsx examples/recursive-supervisor/recursive-supervisor.ts
 */

import {
  type Agent,
  createInMemoryRunContext,
  createSupervisor,
  defaultSelectWinner,
  type Scope,
  settledToIteration,
} from '@tangle-network/agent-runtime/loops'
import { leaf } from './inline-executor'

// ── 1. A driver Agent: spawn two children, drain, select the best valid ─────
// `spawn` RESERVES each child's whole ceiling atomically from the shared pool
// and fails closed (`{ ok: false }`) when the pool cannot cover it — equal
// compute across arms holds by construction, not by discipline.

const driver: Agent<string, unknown> = {
  name: 'two-arm-driver',
  async act(task: string, scope: Scope<unknown>): Promise<unknown> {
    const arms = [
      leaf('careful', {
        out: `careful answer to "${task}"`,
        score: 0.9,
        tokens: { input: 40, output: 40 },
      }),
      leaf('fast', {
        out: `fast answer to "${task}"`,
        score: 0.4,
        tokens: { input: 10, output: 10 },
      }),
    ]
    for (const arm of arms) {
      const res = scope.spawn(arm, task, {
        budget: { maxIterations: 1, maxTokens: 1_000 },
        label: arm.name,
      })
      if (!res.ok) throw new Error(`spawn ${arm.name} rejected: ${res.reason}`)
    }
    // A third spawn the pool cannot cover fails closed, so nothing silently runs.
    const over = scope.spawn(
      leaf('extra', { out: 'never runs', score: 1, tokens: { input: 1, output: 1 } }),
      task,
      { budget: { maxIterations: 1, maxTokens: 1_000 }, label: 'extra' },
    )
    console.log(`third spawn admitted? ${over.ok ? 'yes' : `no - ${over.reason}`}`)

    // Drain settlements in cursor order; select via the SAME single-sourced
    // argmax the loop kernel uses (selection lives in the driver, not the pool).
    const iterations = []
    for (let s = await scope.next(); s !== null; s = await scope.next()) {
      if (s.kind === 'done') iterations.push(settledToIteration(s))
    }
    const winner = defaultSelectWinner(iterations)
    if (!winner) throw new Error('no valid child settled')
    return winner.output
  },
}

async function main(): Promise<void> {
  console.log('Part 1: raw Supervisor (one driver, two children, one conserved pool)')
  const supervisor = createSupervisor<string, unknown>()
  const context = createInMemoryRunContext()
  const result = await supervisor.run(driver, 'name the capital of France', {
    // The pool covers exactly two child reservations; the third fails closed.
    budget: { maxIterations: 2, maxTokens: 2_000 },
    runId: 'recursive-supervisor-demo',
    journal: context.journal,
    blobs: context.blobs,
    executors: context.executors,
  })
  if (result.kind !== 'winner') throw new Error(`expected a winner, got ${result.kind}`)
  console.log(`winner: ${String(result.out)}`)
  console.log(
    `spent: ${result.spentTotal.iterations} iterations, ${result.spentTotal.tokens.input + result.spentTotal.tokens.output} tokens, ${result.tree.nodes.length} nodes in the tree`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
