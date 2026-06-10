/**
 * The recursive execution atom: one `Agent` whose `act()` spawns children
 * through `scope.spawn` on a CONSERVED budget pool, run by `createSupervisor`
 * — then the same topology again as the one-line `fanout` combinator.
 *
 * Children resolve through the open `Executor` port. This example brings its
 * own scripted executors so everything runs offline: no network, no sandbox,
 * no key. Swap the mock for `createExecutor({ backend })` (router /
 * router-tools / sandbox / cli) or any object implementing `Executor`.
 *
 * Run with:
 *   pnpm tsx examples/recursive-supervisor/recursive-supervisor.ts
 */

import {
  type Agent,
  type AgentProfile,
  type AgentSpec,
  createExecutorRegistry,
  createSupervisor,
  type DefaultVerdict,
  defaultSelectWinner,
  definePersona,
  type Executor,
  type ExecutorResult,
  fanout,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type Outcome,
  runPersonified,
  type Scope,
  settledToIteration,
  type UsageEvent,
} from '@tangle-network/agent-runtime/loops'

// ── A scripted leaf executor — the offline stand-in for a real runtime ──────
// A real leaf streams `UsageEvent`s as it burns budget and exposes its
// terminal artifact via `resultArtifact()`. The scripted one derives its
// artifact from the task it was handed, with fixed usage numbers.

interface Script {
  out: string
  score: number
  tokens: { input: number; output: number }
}

function scriptedExecutor(scriptFor: (task: unknown) => Script): Executor<unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'router',
    execute(task: unknown): AsyncIterable<UsageEvent> {
      const script = scriptFor(task)
      return (async function* () {
        const verdict: DefaultVerdict = { valid: true, score: script.score }
        artifact = {
          outRef: `mock:${script.out}`,
          out: script.out,
          verdict,
          spent: { iterations: 1, tokens: script.tokens, usd: 0, ms: 0 },
        }
        yield { kind: 'iteration' }
        yield { kind: 'tokens', input: script.tokens.input, output: script.tokens.output }
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) throw new Error('mock executor: resultArtifact before stream drained')
      return artifact
    },
  }
}

/** A leaf agent carrying its executor as the BYO `executorSpec.executor` —
 *  the default registry resolves it verbatim, so no built-in runtime fires. */
function leaf(name: string, script: Script): Agent<unknown, unknown> {
  const spec: AgentSpec = {
    profile: { name } as AgentProfile,
    harness: null,
    executor: scriptedExecutor(() => script),
  }
  return { name, act: async () => script.out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

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
  // `definePersona` binds WHO (root spec + directive + executor registry);
  // the shape is content-free and reusable across domains. The mock registry
  // mints a fresh scripted leaf per spawn, scored by the angle index the
  // combinator put on the child task.
  console.log('\n— Part 2: the fanout combinator (same atom, zero driver code)')
  const base = createExecutorRegistry()
  const persona = definePersona<string>({
    name: 'analyst',
    root: { profile: { name: 'equity analyst' } as AgentProfile, harness: null },
    directive: 'argue one angle on the thesis',
    context: { role: 'analyst' },
    executors: {
      registry: {
        register: base.register.bind(base),
        resolve<Out>(_spec: AgentSpec) {
          return {
            succeeded: true as const,
            value: (): Executor<Out> =>
              scriptedExecutor((task) => {
                const index =
                  task && typeof task === 'object' && 'index' in task
                    ? Number((task as { index: unknown }).index)
                    : 0
                return {
                  out: `thesis-${index}`,
                  score: 0.3 + index * 0.3,
                  tokens: { input: 20, output: 20 },
                }
              }) as Executor<Out>,
          }
        },
      },
    },
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
