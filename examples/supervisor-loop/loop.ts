/**
 * The shared supervisor-driven loop: an LLM SUPERVISOR agent spawns a few WORKER agents
 * and drives them to a CHECKED completion on one conserved budget pool.
 *
 * This is the "an agent drives N agents" path — the real `coordinationDriverAgent` brain,
 * not a hand-rolled loop. The brain runs an LLM tool-loop over the coordination verbs
 * (`spawn_worker` / `await_event` / `observe_worker` / `steer_worker` / `stop`) against a
 * live `Scope`. Each turn it asks its driver-LLM for tool calls, runs them against the
 * scope (which reserves budget, resolves an `Executor`, runs it, settles), folds the
 * results back, and repeats until it stops — OR the conserved pool / deadline / abort
 * bounds it. The supervisor settles on the best DELIVERED worker (the completion oracle:
 * `settled ⟺ a real check passed`), never on the driver's own say-so.
 *
 * THE SWAP SEAM — `LOOP_BACKEND`:
 * The worker leaf comes from `createExecutor({ backend, ...seam })` where `backend` is
 * chosen from `process.env.LOOP_BACKEND`. The SAME code drives the SAME supervisor over
 * `cli` (local subprocess, no creds), `router-tools` (the off-box tool-using router loop),
 * `sandbox` (a coding harness in a box), or `bridge` (harness CLIs behind the cli-bridge) —
 * zero edits, just a different env var + the matching seam. Each per-backend runner
 * (`run-*.ts`) builds the seam and calls `runSupervisorLoop` with it.
 *
 * THE DRIVER-LLM SEAM — `DriverChat`:
 * `coordinationDriverAgent` drives through an injected `DriverChat` (one driver-LLM turn).
 * `run-local.ts` injects a SCRIPTED `DriverChat` so the real brain runs offline at $0 (the
 * same seam the driver's own unit tests use). `run-router.ts` injects `routerDriverChat`
 * so the driver's turns are real router tool-calls. Same brain, different inference seam.
 */

import {
  type Agent,
  type AgentProfile,
  type AgentSpec,
  coordinationDriverAgent,
  createExecutor,
  createInMemoryRunContext,
  createSupervisor,
  type DriverChat,
  type ExecutorConfig,
  type ExecutorContext,
  gateOnDeliverable,
  type Scope,
  type SupervisedResult,
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

/** Everything a per-backend runner supplies to drive the shared loop. */
export interface RunSupervisorLoopArgs {
  /** The goal + completion check. */
  readonly task: SupervisorTask
  /**
   * The worker-leaf backend config, MINUS its `backend` tag — the runner picks the tag
   * from `LOOP_BACKEND` (the swap seam) and the seam fields are the rest. Concretely this
   * is one of the `createExecutor` seam shapes (router/router-tools/sandbox/cli/bridge).
   */
  readonly backend: ExecutorConfig
  /**
   * The driver-LLM seam — one driver turn over the coordination tools. `run-local.ts`
   * passes a scripted mock ($0, offline); `run-router.ts` passes `routerDriverChat(cfg)`.
   */
  readonly chat: DriverChat
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
 * Resolve a worker `profile` (whatever the supervisor authored in `spawn_worker`) to a
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
    chat: args.chat,
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
