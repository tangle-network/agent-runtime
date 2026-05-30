/**
 * @experimental
 *
 * `runLoop` — the topology-agnostic kernel built atop the sandbox SDK.
 *
 * Each iteration:
 *   1. `driver.plan(task, history)` → N tasks (1 = refine, N = fanout, 0 = stop)
 *   2. For each task (parallel, bounded by `maxConcurrency`):
 *        a. round-robin an `AgentRunSpec` from `agentRuns`
 *        b. `sandboxClient.create({ backend: { profile }, ...overrides })`
 *        c. emit `loop.iteration.dispatch` with the placement
 *           (`{ sibling, sandboxId }` or `{ fleet, fleetId, machineId, sandboxId }`)
 *        d. iterate `box.streamPrompt(taskToPrompt(task))` and collect events
 *   3. `output.parse(events)` → typed `Output`
 *   4. `validator?.validate(output)` → `DefaultVerdict`
 *   5. Append `Iteration` to history; emit `loop.iteration.ended`
 *   6. `driver.decide(history)` → if terminal, return result + winner
 *
 * The kernel owns: iteration accounting, per-iteration timing, error
 * capture, abort propagation, concurrency cap, cost aggregation, and trace
 * emission. The kernel does NOT own: what the agent runs (sandbox SDK +
 * profile), how outputs are decoded (output adapter), how outputs are
 * scored (validator), or topology (driver).
 */

import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import type { RuntimeStreamEvent } from '../types'
import type {
  AgentRunSpec,
  Driver,
  ExecCtx,
  Iteration,
  LoopResult,
  LoopSandboxClient,
  LoopSandboxPlacement,
  LoopTraceEmitter,
  LoopTraceEvent,
  LoopWinner,
  OutputAdapter,
  Validator,
} from './types'

const DEFAULT_MAX_ITERATIONS = 10
const DEFAULT_MAX_CONCURRENCY = 4

/** @experimental */
export interface RunLoopOptions<Task, Output, Decision> {
  driver: Driver<Task, Output, Decision>
  /**
   * Single agent spec — every iteration uses this profile. Mutually
   * exclusive with `agentRuns`.
   */
  agentRun?: AgentRunSpec<Task>
  /**
   * Multiple specs for heterogeneous fanout. The kernel round-robins
   * through them when the driver plans N tasks. Mutually exclusive with
   * `agentRun`.
   */
  agentRuns?: AgentRunSpec<Task>[]
  output: OutputAdapter<Output>
  validator?: Validator<Output>
  task: Task
  ctx: ExecCtx
  /** Default 10. Hard cap on total iterations across all `plan()` rounds. */
  maxIterations?: number
  /** Default 4. In-flight worker cap within a single `plan()` batch. */
  maxConcurrency?: number
  /**
   * Pre-allocated id for trace correlation. Default = `loop-${random}`.
   * Surfaces as `runId` on every emitted `LoopTraceEvent`.
   */
  runId?: string
  /**
   * Clock override; default `Date.now`. Deterministic tests pass a
   * monotonic counter to stabilize iteration timing fields.
   */
  now?: () => number
  /**
   * Override the default winner selector (highest-valid-score, ties broken
   * by earliest iteration).
   */
  selectWinner?: (iterations: Iteration<Task, Output>[]) => LoopWinner<Task, Output> | undefined
}

/** @experimental */
export async function runLoop<Task, Output, Decision>(
  options: RunLoopOptions<Task, Output, Decision>,
): Promise<LoopResult<Task, Output, Decision>> {
  const specs = resolveAgentRuns(options)
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    throw new ValidationError('runLoop: maxIterations must be > 0')
  }
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
  if (!Number.isFinite(maxConcurrency) || maxConcurrency <= 0) {
    throw new ValidationError('runLoop: maxConcurrency must be > 0')
  }
  if (!options.ctx?.sandboxClient || typeof options.ctx.sandboxClient.create !== 'function') {
    throw new ValidationError('runLoop: ctx.sandboxClient.create is required')
  }
  const now = options.now ?? Date.now
  const runId = options.runId ?? `loop-${randomSuffix()}`
  const loopStart = now()
  const driverName = options.driver.name ?? 'driver'
  const iterations: Iteration<Task, Output>[] = []

  await emitTrace(options.ctx.traceEmitter, {
    kind: 'loop.started',
    runId,
    timestamp: now(),
    payload: {
      driver: driverName,
      agentRunNames: specs.map((spec) => spec.name ?? spec.profile.name ?? 'agent'),
      maxIterations,
      maxConcurrency,
    },
  })

  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  if (options.ctx.signal) {
    if (options.ctx.signal.aborted) controller.abort()
    else options.ctx.signal.addEventListener('abort', onOuterAbort, { once: true })
  }

  try {
    while (iterations.length < maxIterations) {
      if (controller.signal.aborted) throwAbort()
      const planned = await options.driver.plan(options.task, iterations)
      if (planned.length === 0) break

      const remaining = maxIterations - iterations.length
      const slice = planned.slice(0, remaining)
      const baseIndex = iterations.length
      // Reserve slots up front so concurrent workers may mutate by index.
      for (let i = 0; i < slice.length; i += 1) {
        const spec = specs[(baseIndex + i) % specs.length]!
        iterations.push({
          index: baseIndex + i,
          task: slice[i] as Task,
          agentRunName: spec.name ?? spec.profile.name ?? 'agent',
          events: [],
          startedAt: now(),
          endedAt: 0,
          costUsd: 0,
          tokenUsage: { input: 0, output: 0 },
        })
      }

      await runBatch({
        slice,
        baseIndex,
        iterations,
        specs,
        output: options.output,
        validator: options.validator,
        maxConcurrency,
        signal: controller.signal,
        ctx: options.ctx,
        runId,
        now,
      })

      if (controller.signal.aborted) throwAbort()

      const decision = await options.driver.decide(iterations)
      await emitTrace(options.ctx.traceEmitter, {
        kind: 'loop.decision',
        runId,
        timestamp: now(),
        payload: { decision: serializeDecision(decision), historyLength: iterations.length },
      })
      if (isTerminalDecision(decision)) {
        return finalize({
          options,
          decision,
          iterations,
          startMs: loopStart,
          now,
          runId,
        })
      }
    }

    if (iterations.length >= maxIterations) {
      // Cap reached without a terminal decision — ask the driver one more time
      // for its final state, then close out.
      const decision = await options.driver.decide(iterations)
      await emitTrace(options.ctx.traceEmitter, {
        kind: 'loop.decision',
        runId,
        timestamp: now(),
        payload: { decision: serializeDecision(decision), historyLength: iterations.length },
      })
      return finalize({ options, decision, iterations, startMs: loopStart, now, runId })
    }
    // `plan()` returned `[]` before `decide()` reached a terminal state.
    const decision = await options.driver.decide(iterations)
    await emitTrace(options.ctx.traceEmitter, {
      kind: 'loop.decision',
      runId,
      timestamp: now(),
      payload: { decision: serializeDecision(decision), historyLength: iterations.length },
    })
    return finalize({ options, decision, iterations, startMs: loopStart, now, runId })
  } finally {
    if (options.ctx.signal) options.ctx.signal.removeEventListener('abort', onOuterAbort)
  }
}

interface RunBatchArgs<Task, Output> {
  slice: Task[]
  baseIndex: number
  iterations: Iteration<Task, Output>[]
  specs: AgentRunSpec<Task>[]
  output: OutputAdapter<Output>
  validator: Validator<Output> | undefined
  maxConcurrency: number
  signal: AbortSignal
  ctx: ExecCtx
  runId: string
  now: () => number
}

async function runBatch<Task, Output>(args: RunBatchArgs<Task, Output>) {
  const queue = args.slice.map((task, offset) => ({ task, index: args.baseIndex + offset }))
  const inflight = new Set<Promise<void>>()
  while (queue.length > 0 || inflight.size > 0) {
    while (inflight.size < args.maxConcurrency && queue.length > 0) {
      const item = queue.shift()!
      const p = executeIteration({ ...args, item }).finally(() => inflight.delete(p))
      inflight.add(p)
    }
    if (inflight.size === 0) break
    await Promise.race(inflight)
  }
}

interface ExecuteIterationArgs<Task, Output> extends RunBatchArgs<Task, Output> {
  item: { task: Task; index: number }
}

async function executeIteration<Task, Output>(args: ExecuteIterationArgs<Task, Output>) {
  const slot = args.iterations[args.item.index]
  if (!slot)
    throw new ValidationError(`runLoop: missing iteration slot at index ${args.item.index}`)
  const spec = args.specs[args.item.index % args.specs.length]
  if (!spec) throw new ValidationError('runLoop: no AgentRunSpec available for iteration')
  slot.startedAt = args.now()
  slot.agentRunName = spec.name ?? spec.profile.name ?? 'agent'

  await emitTrace(args.ctx.traceEmitter, {
    kind: 'loop.iteration.started',
    runId: args.runId,
    timestamp: args.now(),
    payload: {
      iterationIndex: args.item.index,
      agentRunName: slot.agentRunName,
      taskHash: hashJson(args.item.task),
    },
  })

  try {
    const box = await createSandboxForSpec(args.ctx.sandboxClient, spec, args.signal)
    const placement = describePlacementSafe(args.ctx.sandboxClient, box)
    await emitTrace(args.ctx.traceEmitter, {
      kind: 'loop.iteration.dispatch',
      runId: args.runId,
      timestamp: args.now(),
      payload: {
        iterationIndex: args.item.index,
        agentRunName: slot.agentRunName,
        placement: placement.kind,
        sandboxId: placement.sandboxId,
        fleetId: placement.fleetId,
        machineId: placement.machineId,
      },
    })
    const message = spec.taskToPrompt(args.item.task)
    const events: SandboxEvent[] = []
    for await (const event of box.streamPrompt(message, { signal: args.signal })) {
      events.push(event)
      const llmCall = extractLlmCallEvent(event, slot.agentRunName)
      if (llmCall) {
        slot.costUsd += llmCall.costUsd ?? 0
        slot.tokenUsage.input += llmCall.tokensIn ?? 0
        slot.tokenUsage.output += llmCall.tokensOut ?? 0
        args.ctx.runHandle?.observe(llmCall)
      }
    }
    slot.events = events
    slot.output = args.output.parse(events)
    if (args.validator) {
      slot.verdict = await args.validator.validate(slot.output, {
        iteration: args.item.index,
        signal: args.signal,
        traceEmitter: args.ctx.traceEmitter,
      })
    }
  } catch (err) {
    slot.error = err instanceof Error ? err : new Error(String(err))
  } finally {
    slot.endedAt = args.now()
    await emitTrace(args.ctx.traceEmitter, {
      kind: 'loop.iteration.ended',
      runId: args.runId,
      timestamp: args.now(),
      payload: {
        iterationIndex: args.item.index,
        agentRunName: slot.agentRunName,
        outputHash: slot.output !== undefined ? hashJson(slot.output) : undefined,
        verdict: slot.verdict,
        error: slot.error?.message,
        costUsd: slot.costUsd,
        durationMs: slot.endedAt - slot.startedAt,
      },
    })
  }
}

function describePlacementSafe(
  client: LoopSandboxClient,
  box: SandboxInstance,
): LoopSandboxPlacement {
  if (typeof client.describePlacement === 'function') {
    try {
      const result = client.describePlacement(box)
      if (
        result &&
        typeof result === 'object' &&
        (result.kind === 'sibling' || result.kind === 'fleet')
      ) {
        return {
          kind: result.kind,
          sandboxId: result.sandboxId ?? readSandboxId(box),
          fleetId: result.fleetId,
          machineId: result.machineId,
        }
      }
    } catch {
      // Adapter bug must not corrupt the iteration; fall through to default.
    }
  }
  return { kind: 'sibling', sandboxId: readSandboxId(box) }
}

function readSandboxId(box: SandboxInstance): string | undefined {
  const raw = (box as unknown as { id?: unknown }).id
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

async function createSandboxForSpec<Task>(
  client: LoopSandboxClient,
  spec: AgentRunSpec<Task>,
  signal: AbortSignal,
): Promise<SandboxInstance> {
  const overrides = spec.sandboxOverrides ?? {}
  const overrideBackend = overrides.backend
  const opts: CreateSandboxOptions = {
    ...overrides,
    backend: {
      type: overrideBackend?.type ?? inferBackendType(spec.profile),
      profile: spec.profile satisfies AgentProfile,
      ...(overrideBackend?.model ? { model: overrideBackend.model } : {}),
      ...(overrideBackend?.server ? { server: overrideBackend.server } : {}),
    },
  }
  // Cooperative cancellation: if the abort signal fires while .create is
  // pending, the promise itself is not abortable but the inflight prompt is.
  if (signal.aborted) throwAbort()
  return client.create(opts)
}

function inferBackendType(
  profile: AgentProfile,
): CreateSandboxOptions['backend'] extends infer B
  ? B extends { type: infer T }
    ? T
    : never
  : never {
  // The sandbox SDK accepts profile-driven backend selection by name. When the
  // profile has no explicit hint we fall through to the SDK's default
  // ('opencode' on the platform side). Returning a literal here would lie
  // about provenance — let the SDK pick.
  type BackendType = NonNullable<CreateSandboxOptions['backend']>['type']
  const explicit = profile.metadata?.backendType
  if (typeof explicit === 'string') return explicit as BackendType
  return 'opencode' as BackendType
}

interface FinalizeArgs<Task, Output, Decision> {
  options: RunLoopOptions<Task, Output, Decision>
  decision: Decision
  iterations: Iteration<Task, Output>[]
  startMs: number
  now: () => number
  runId: string
}

function finalize<Task, Output, Decision>(
  args: FinalizeArgs<Task, Output, Decision>,
): LoopResult<Task, Output, Decision> {
  const winner = (args.options.selectWinner ?? defaultSelectWinner)(args.iterations)
  const costUsd = args.iterations.reduce((sum, iter) => sum + (iter.costUsd || 0), 0)
  const tokenUsage = args.iterations.reduce(
    (acc, iter) => {
      acc.input += iter.tokenUsage?.input ?? 0
      acc.output += iter.tokenUsage?.output ?? 0
      return acc
    },
    { input: 0, output: 0 },
  )
  const result: LoopResult<Task, Output, Decision> = {
    decision: args.decision,
    iterations: args.iterations,
    winner,
    durationMs: args.now() - args.startMs,
    costUsd,
    tokenUsage,
  }
  void emitTrace(args.options.ctx.traceEmitter, {
    kind: 'loop.ended',
    runId: args.runId,
    timestamp: args.now(),
    payload: {
      winnerIterationIndex: winner?.iterationIndex,
      totalCostUsd: costUsd,
      durationMs: result.durationMs,
      iterations: args.iterations.length,
    },
  })
  return result
}

function defaultSelectWinner<Task, Output>(
  iterations: Iteration<Task, Output>[],
): LoopWinner<Task, Output> | undefined {
  const candidates = iterations.filter((iter) => iter.output !== undefined && !iter.error)
  if (candidates.length === 0) return undefined
  const valid = candidates.filter((iter) => iter.verdict?.valid === true)
  const pool = valid.length > 0 ? valid : candidates
  const sorted = [...pool].sort(
    (a, b) => (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0) || a.index - b.index,
  )
  const top = sorted[0]
  if (!top || top.output === undefined) return undefined
  return {
    task: top.task,
    output: top.output,
    verdict: top.verdict,
    iterationIndex: top.index,
    agentRunName: top.agentRunName,
  }
}

function resolveAgentRuns<Task, Output, Decision>(
  options: RunLoopOptions<Task, Output, Decision>,
): AgentRunSpec<Task>[] {
  if (options.agentRun && options.agentRuns) {
    throw new ValidationError('runLoop: pass exactly one of `agentRun` or `agentRuns`')
  }
  if (options.agentRun) return [options.agentRun]
  if (options.agentRuns && options.agentRuns.length > 0) return options.agentRuns
  throw new ValidationError('runLoop: `agentRun` or non-empty `agentRuns` is required')
}

function isTerminalDecision(decision: unknown): boolean {
  return (
    decision === 'stop' || decision === 'pick-winner' || decision === 'fail' || decision === 'done'
  )
}

function serializeDecision(decision: unknown): string {
  if (typeof decision === 'string') return decision
  if (decision === null || decision === undefined) return 'null'
  try {
    return JSON.stringify(decision)
  } catch {
    return String(decision)
  }
}

async function emitTrace(
  emitter: LoopTraceEmitter | undefined,
  event: LoopTraceEvent,
): Promise<void> {
  if (!emitter) return
  await emitter.emit(event)
}

function randomSuffix(len = 8): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + len)
}

function throwAbort(): never {
  const err = new Error('aborted')
  err.name = 'AbortError'
  throw err
}

/**
 * Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when
 * the event carries usage/cost data. Returns `undefined` for non-cost events
 * so the kernel can iterate the full stream without branching.
 *
 * Sandbox SDK emits a polymorphic `SandboxEvent = { type, data, id? }`. The
 * canonical cost-carrying types observed in the wild:
 *   - `llm_call` — `data: { model, tokensIn, tokensOut, costUsd, ... }`
 *   - `message.completed` / `result` — `data: { usage: { inputTokens,
 *      outputTokens, totalCostUsd? } }`
 *   - `cost.usage` — same shape under a dedicated type
 *
 * Numeric coercion is strict: `Number.isFinite` gates every accumulator
 * write so a sentinel `NaN` from a misbehaving backend cannot poison the
 * ledger.
 */
function extractLlmCallEvent(
  event: SandboxEvent,
  agentRunName: string,
): (RuntimeStreamEvent & { type: 'llm_call' }) | undefined {
  if (!event || typeof event !== 'object') return undefined
  const type = String(event.type ?? '')
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  if (type === 'llm_call' || type === 'cost.usage' || type === 'usage') {
    return buildLlmCall(data, agentRunName)
  }
  if (type === 'message.completed' || type === 'result' || type === 'final') {
    const usage = data.usage as Record<string, unknown> | undefined
    if (!usage || typeof usage !== 'object') return undefined
    return buildLlmCall({ ...usage, model: data.model ?? usage.model }, agentRunName)
  }
  return undefined
}

function buildLlmCall(
  data: Record<string, unknown>,
  agentRunName: string,
): (RuntimeStreamEvent & { type: 'llm_call' }) | undefined {
  const tokensIn = pickFiniteNumber(data, ['tokensIn', 'inputTokens', 'prompt_tokens'])
  const tokensOut = pickFiniteNumber(data, ['tokensOut', 'outputTokens', 'completion_tokens'])
  const costUsd = pickFiniteNumber(data, ['costUsd', 'totalCostUsd', 'cost_usd', 'cost'])
  if (tokensIn === undefined && tokensOut === undefined && costUsd === undefined) {
    return undefined
  }
  const model = typeof data.model === 'string' && data.model.length > 0 ? data.model : agentRunName
  const event: RuntimeStreamEvent & { type: 'llm_call' } = {
    type: 'llm_call',
    model,
  }
  if (tokensIn !== undefined) event.tokensIn = tokensIn
  if (tokensOut !== undefined) event.tokensOut = tokensOut
  if (costUsd !== undefined) event.costUsd = costUsd
  return event
}

function pickFiniteNumber(data: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * Stable hash for the trace payload. Not cryptographic — only used so
 * downstream eval pipelines can group iterations whose task / output is the
 * same. Bare structural hash; non-JSON values stringify via their `toString`.
 */
function hashJson(value: unknown): string {
  let str: string
  try {
    str = JSON.stringify(value) ?? String(value)
  } catch {
    str = String(value)
  }
  // FNV-1a 32-bit — branch-free, dependency-free, good enough for grouping.
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
