/**
 * The shared supervisor-driven loop: an LLM SUPERVISOR agent spawns a few WORKER agents
 * and drives them to a CHECKED completion on one conserved budget pool.
 *
 * This is the "an agent drives N agents" path — the real `coordinationDriverAgent` brain,
 * not a hand-rolled loop. The brain runs an LLM tool-loop over the coordination verbs
 * (`spawn_agent` / `await_event` / `observe_worker` / `steer_worker` / `stop`) against a
 * live `Scope`. Each turn it asks its driver-LLM for tool calls, runs them against the
 * scope (which reserves budget, resolves an `Executor`, runs it, settles), folds the
 * results back, and repeats until it stops — OR the conserved pool / deadline / abort
 * bounds it. The supervisor settles on the best DELIVERED worker (the completion oracle:
 * `settled ⟺ a real check passed`), never on the driver's own say-so.
 *
 * THE SWAP SEAM — the worker-leaf `backend`:
 * The worker leaf comes from `createExecutor({ backend, ...seam })`. The SAME code drives
 * the SAME supervisor over `router-tools` (the off-box tool-using router loop), `sandbox`
 * (a coding harness in a box), or `bridge` (harness CLIs behind ~/code/cli-bridge) — zero
 * edits, just a different seam. sandbox ↔ local (cli-bridge) needs NO code change at all.
 * Each per-backend runner (`run-*.ts`) builds the seam and calls `runSupervisorLoop`.
 *
 * THE DRIVER-LLM SEAM — `ToolLoopChat`:
 * `coordinationDriverAgent` drives through an injected `ToolLoopChat` brain (one driver-LLM turn).
 * `run-router.ts` injects `routerBrain` so the driver's turns are real router
 * tool-calls. `run-sandbox.ts`/`run-bridge.ts` default to a SCRIPTED brain
 * (`scriptedSupervisorChat`, exported below) so the box/bridge wiring is the only moving
 * part to debug — or opt into `routerBrain` with a router key. Same brain, different
 * inference seam. The fully offline, no-creds wiring is covered by the coordination-driver
 * unit tests (`tests/loops/coordination-driver.test.ts`).
 */

import {
  type Agent,
  type AgentProfile,
  type AgentSpec,
  coordinationDriverAgent,
  createExecutor,
  createInMemoryRunContext,
  createSupervisor,
  type ExecutorConfig,
  type ExecutorContext,
  gateOnDeliverable,
  type Scope,
  type SupervisedResult,
  type ToolLoopChat,
} from '@tangle-network/agent-runtime/loops'

/** The supervisor's goal + the deployable check that decides DELIVERED. */
export interface SupervisorTask {
  /** The natural-language goal handed to the supervisor (it decomposes + delegates). */
  readonly goal: string
  /**
   * The deployable completion oracle, run on each worker's output. A worker settles
   * `valid:true` ONLY when this returns true — so the driver's keep-best finalize counts
   * it as delivered. Never the model judging itself (Foreman's 0/18 lesson).
   */
  readonly check: (workerOutput: unknown) => boolean | Promise<boolean>
}

/** The marker every runner asks its workers to emit; the check confirms it landed. */
export const expectedAnswer = 'ANSWER=42'

/**
 * The shared demo task: each worker must produce the line `ANSWER=42`. The deployable check
 * (the completion oracle) scans the worker's output for it — text content for the off-box
 * backends, the serialized harness event stream for a box. A worker settles `valid:true`
 * ONLY when this returns true, so the driver's keep-best finalize counts it as delivered.
 */
export const demoTask: SupervisorTask = {
  goal: `Produce the exact line "${expectedAnswer}".`,
  check: (out) => {
    if (out && typeof out === 'object' && 'content' in out) {
      return String((out as { content: unknown }).content).includes(expectedAnswer)
    }
    // A sandbox worker returns its harness event stream as an object; scan the serialized form.
    return JSON.stringify(out ?? '').includes(expectedAnswer)
  },
}

/**
 * A SCRIPTED `ToolLoopChat`: spawn `workerCount` workers (the "drive N workers" shape), await
 * each settlement, then stop. This is the exact contract `routerBrain` fills in production —
 * here it returns a fixed turn sequence so the brain runs with no inference (the same offline
 * seam the driver's own unit tests use). The brain still REASONS the loop (spawn → await → stop)
 * against a live `Scope`; only the driver-LLM call is mocked.
 *
 * The canonical loop parses `toolCalls[].arguments` itself, so each scripted call serializes its
 * arguments to a JSON string; the loop JSON.parses them before running the tool.
 */
export function scriptedSupervisorChat(workerCount: number, labelPrefix = 'solver'): ToolLoopChat {
  interface ScriptedTurn {
    content: string
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>
  }
  const turns: ScriptedTurn[] = []
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({
      content: `delegating slice ${i}`,
      toolCalls: [
        {
          name: 'spawn_agent',
          arguments: {
            profile: { name: `${labelPrefix}-${i}`, systemPrompt: `Emit ${expectedAnswer}.` },
            task: `Emit the exact line ${expectedAnswer} and nothing else.`,
            label: `${labelPrefix}-${i}`,
          },
        },
      ],
    })
  }
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({
      content: 'awaiting a worker',
      toolCalls: [{ name: 'await_event', arguments: {} }],
    })
  }
  turns.push({ content: 'all workers delivered — stopping', toolCalls: [] })

  let i = 0
  return (messages) => {
    // A real brain reads `messages` (the folded tool results) to decide; the scripted one advances
    // its fixed plan. Touch `messages` so the shape is exercised.
    void messages.length
    const turn = turns[Math.min(i, turns.length - 1)] ?? { content: '', toolCalls: [] }
    i += 1
    return Promise.resolve({
      content: turn.content,
      toolCalls: turn.toolCalls.map((tc, j) => ({
        id: `call-${i}-${j}`,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
    })
  }
}

/** Everything a per-backend runner supplies to drive the shared loop. */
export interface RunSupervisorLoopArgs {
  /** The goal + completion check. */
  readonly task: SupervisorTask
  /**
   * The worker-leaf backend config — the swap seam. One of the `createExecutor` seam shapes
   * (router-tools/sandbox/bridge); swapping it is the only change a runner makes.
   */
  readonly backend: ExecutorConfig
  /**
   * The driver-LLM seam — one driver turn over the coordination tools. `run-router.ts`
   * passes `routerBrain(cfg)` (real turns); `run-sandbox.ts`/`run-bridge.ts` default to
   * `scriptedSupervisorChat(...)` so only the box/bridge wiring moves.
   */
  readonly brain: ToolLoopChat
  /** The supervisor's standing instructions (its stance). */
  readonly systemPrompt: string
  /** Per-worker budget reserved atomically from the conserved pool on each spawn. */
  readonly perWorker?: { maxIterations: number; maxTokens: number; maxUsd?: number }
  /** The root conserved-pool ceiling (tokens + iterations + optional usd). */
  readonly budget?: { maxIterations: number; maxTokens: number; maxUsd?: number }
  /** Driver-turn cap before the loop force-finalizes on the best settled worker. Default 12. */
  readonly maxTurns?: number
  /** Trace-correlation + journal root key. Default 'supervisor-loop'. */
  readonly runId?: string
}

/**
 * Resolve a worker `profile` (whatever the supervisor authored in `spawn_agent`) to a
 * leaf `Agent` whose executor is `createExecutor({ backend, ...seam })`, gated on the
 * deployable check. The profile may carry `{ name, systemPrompt }`; we surface them onto
 * the leaf's `AgentProfile` so the backend (router/cli/bridge) folds the systemPrompt into
 * its prompt the same way it would in production.
 */
function makeWorkerAgent(
  rawProfile: unknown,
  backend: ExecutorConfig,
  check: SupervisorTask['check'],
  counter: { n: number },
): Agent<unknown, unknown> {
  const p = (rawProfile ?? {}) as { name?: unknown; systemPrompt?: unknown }
  const name = typeof p.name === 'string' && p.name.length > 0 ? p.name : `worker-${counter.n++}`
  const systemPrompt = typeof p.systemPrompt === 'string' ? p.systemPrompt : undefined

  const profile: AgentProfile = {
    name,
    ...(systemPrompt ? { prompt: { systemPrompt } } : {}),
  } as AgentProfile
  const spec: AgentSpec = { profile, harness: backend.backend === 'sandbox' ? null : null }

  // Construct the built-in leaf from the chosen backend (the swap seam), then gate its
  // verdict on the deployable check. `createExecutor` injects its OWN seam, so the only
  // thing the construction context needs is an abort signal; the spawn-time signal handed
  // to `execute(task, signal)` is the real per-child abort the scope cascades.
  const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
  const leaf = createExecutor(backend)(spec, ctx)
  const gated = gateOnDeliverable(leaf, { check, describe: 'worker delivers the goal' })

  return {
    name,
    // A spawned worker runs THROUGH its executor, never as a root act() — the scope calls
    // `executorSpec.executor.execute`, not this.
    act: async () => '',
    executorSpec: { ...spec, executor: gated },
  } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
}

/**
 * Run the supervisor-driven loop end to end and return the typed result. A `winner`
 * carries the delivered worker's output + the conserved spend breakdown (driver inference
 * vs child work); a `no-winner` is never coerced into a best-effort output.
 */
export async function runSupervisorLoop(
  args: RunSupervisorLoopArgs,
): Promise<SupervisedResult<unknown>> {
  const perWorker = args.perWorker ?? { maxIterations: 2, maxTokens: 50_000 }
  const budget = args.budget ?? { maxIterations: 100, maxTokens: 1_000_000 }
  const counter = { n: 0 }

  // One in-memory run context — fresh journal + blob store + registry. The SAME `blobs`
  // instance must back both the driver (it reads settled worker outputs through it) and the
  // supervisor run (the scope writes them) — `createInMemoryRunContext` single-sources it.
  const run = createInMemoryRunContext()

  // The driver BRAIN: an LLM tool-loop over the coordination verbs. We pass it the run's
  // `blobs` so `observe_worker`/`finalize` read the same store the scope writes to.
  const root = coordinationDriverAgent({
    name: 'supervisor',
    brain: args.brain,
    blobs: run.blobs,
    makeWorkerAgent: (profile) => makeWorkerAgent(profile, args.backend, args.task.check, counter),
    perWorker,
    systemPrompt: args.systemPrompt,
    maxTurns: args.maxTurns ?? 12,
  })

  return createSupervisor<unknown, unknown>().run(root, args.task.goal, {
    budget,
    runId: args.runId ?? 'supervisor-loop',
    ...run,
    maxDepth: 4,
  })
}

/** Pretty-print the typed result for the per-backend runners. */
export function reportResult(result: SupervisedResult<unknown>, backendTag: string): void {
  console.log(`\n── verdict (backend: ${backendTag}) ──`)
  if (result.kind === 'winner') {
    const t = result.spentTotal
    console.log('✅ supervisor drove a worker to a CHECKED delivery')
    console.log(`   winner output : ${JSON.stringify(result.out)}`)
    console.log(`   tree nodes    : ${result.tree.nodes.length}`)
    console.log(
      `   spent         : ${t.iterations} iterations, ${t.tokens.input + t.tokens.output} tokens, $${t.usd.toFixed(4)}`,
    )
    if (result.spentBreakdown) {
      const { driverInference, childWork } = result.spentBreakdown
      console.log(
        `   breakdown     : driver inference ${driverInference.tokens.input + driverInference.tokens.output} tok, child work ${childWork.tokens.input + childWork.tokens.output} tok`,
      )
    }
  } else {
    console.log(`❌ no winner (reason: ${result.reason}, ${result.downCount} children down)`)
    console.log(`   tree nodes    : ${result.tree.nodes.length}`)
  }
}

/** The settled-children helper a runner can use to inspect what was spawned + delivered. */
export function summarizeTree(result: SupervisedResult<unknown>): string {
  return result.tree.nodes.map((n) => `${n.label}[${n.status}]`).join(', ')
}

export type { Scope }
