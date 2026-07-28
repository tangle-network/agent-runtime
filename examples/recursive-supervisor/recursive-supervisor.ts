/**
 * The recursive execution atom: one `Agent` whose `act()` spawns children
 * through `scope.spawn` on a CONSERVED budget pool, run by `createSupervisor`
 * — then the same topology again as the one-line `fanout` combinator.
 *
 * Children resolve through the open `Executor` port. The scripted executors +
 * registry plumbing live in ./inline-executor.ts so this file shows only the
 * lesson: `spawn` reserves from a shared pool, fails closed when it can't, and
 * the driver selects the best valid settlement. Everything runs offline — no
 * network, no sandbox, no key. Swap the mock for `createExecutor({ backend })`
 * (router / router-tools / sandbox / cli) or any object implementing `Executor`.
 *
 * Run with:
 *   pnpm tsx examples/recursive-supervisor/recursive-supervisor.ts
 */

import {
  type Agent,
  type AgentProfile,
  createExecutorRegistry,
  createSupervisor,
  defaultSelectWinner,
  definePersona,
  fanout,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type Outcome,
  runPersonified,
  type Scope,
  settledToIteration,
} from '@tangle-network/agent-runtime/kernel'
import { leaf, scriptedPersonaRegistry } from './inline-executor'

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
    // A third spawn the pool cannot cover fails CLOSED — nothing silently runs.
    const over = scope.spawn(
      leaf('extra', { out: 'never runs', score: 1, tokens: { input: 1, output: 1 } }),
      task,
      { budget: { maxIterations: 1, maxTokens: 1_000 }, label: 'extra' },
    )
    console.log(`third spawn admitted? ${over.ok ? 'yes' : `no — ${over.reason}`}`)

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
  console.log('— Part 1: raw Supervisor (one driver, two children, one conserved pool)')
  const supervisor = createSupervisor<string, unknown>()
  const result = await supervisor.run(driver, 'name the capital of France', {
    // The pool covers exactly two child reservations; the third fails closed.
    budget: { maxIterations: 2, maxTokens: 2_000 },
    runId: 'recursive-supervisor-demo',
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    executors: createExecutorRegistry(),
  })
  if (result.kind !== 'winner') throw new Error(`expected a winner, got ${result.kind}`)
  console.log(`winner: ${String(result.out)}`)
  console.log(
    `spent: ${result.spentTotal.iterations} iterations, ${result.spentTotal.tokens.input + result.spentTotal.tokens.output} tokens, ${result.tree.nodes.length} nodes in the tree`,
  )

  // ── 2. The same topology as a combinator: fanout over a persona ───────────
  // `definePersona` binds WHO (root spec + directive + executor registry); the
  // shape is content-free and reusable across domains. The mock registry
  // (./inline-executor.ts) mints a fresh scripted leaf per spawn, scored by the
  // angle index the combinator put on the child task.
  console.log('\n— Part 2: the fanout combinator (same atom, zero driver code)')
  const persona = definePersona<string>({
    name: 'analyst',
    root: { profile: { name: 'equity analyst' } as AgentProfile, harness: null },
    directive: 'argue one angle on the thesis',
    context: { role: 'analyst' },
    executors: { registry: scriptedPersonaRegistry() },
  })
  const shape = fanout<{ topic: string }, string, string>(['bull', 'bear', 'base'], {
    itemTask: (angle, index) => ({ angle, index }),
    label: (angle) => `angle:${angle}`,
  })
  const fanned = await runPersonified<{ topic: string }, string>({
    persona,
    shape,
    task: { topic: 'ACME' },
    budget: { maxIterations: 20, maxTokens: 100_000 },
    shapeBudget: { fanout: 3, perChild: { maxIterations: 2, maxTokens: 10_000 } },
  })
  if (fanned.kind !== 'winner') throw new Error(`expected a winner, got ${fanned.kind}`)
  const outcome: Outcome<string> = fanned.out
  if (outcome.kind !== 'done') throw new Error(`fanout blocked: ${outcome.blockers.join('; ')}`)
  console.log(`fanout deliverable: ${outcome.deliverable} (best valid of 3 angles)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
