import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { ValidationError } from '../errors'
import { WorkflowBudget } from './budget'
import { installWorkflowGlobals, normalizeRuntimeError, type WorkflowRuntimeGlobals } from './realm'
import { validateJsonSchema } from './schema'
import type {
  WorkflowAnalystDelegate,
  WorkflowBudgetCaps,
  WorkflowCheckpointOptions,
  WorkflowDelegateContext,
  WorkflowDelegateResult,
  WorkflowResult,
  WorkflowReviewerDelegate,
  WorkflowRuntimeOptions,
  WorkflowTraceEvent,
  WorkflowVerifierDelegate,
} from './types'
import { parseWorkflowScript } from './validate'

const DEFAULT_CAPS: Required<WorkflowBudgetCaps> = {
  maxCostUsd: Number.POSITIVE_INFINITY,
  maxTokens: Number.POSITIVE_INFINITY,
  maxWallMs: 10 * 60_000,
  maxAgentCalls: 32,
  maxLoopCalls: 16,
  maxFanout: 8,
  maxDepth: 1,
}

type WorkflowCheckpointRuntimeKind = 'verifier' | 'analyst' | 'reviewer'

export async function runWorkflow<TOutput = unknown>(
  options: WorkflowRuntimeOptions,
): Promise<WorkflowResult<TOutput>> {
  const parsed = parseWorkflowScript(options.source)
  const runId = options.runId ?? `workflow-${randomUUID()}`
  const depth = options.depth ?? 0
  const caps = normalizeCaps(options.caps)
  if (depth > caps.maxDepth) {
    throw new ValidationError(`workflow depth ${depth} exceeds maxDepth=${caps.maxDepth}`)
  }

  const now = options.now ?? Date.now
  const budget = new WorkflowBudget(caps, now)
  const workflowSignal = createWorkflowSignal(options.signal)
  const events: WorkflowTraceEvent[] = []
  const startedAt = now()
  let currentPhase: string | undefined
  const checkpointCounts: Record<WorkflowCheckpointRuntimeKind, number> = {
    verifier: 0,
    analyst: 0,
    reviewer: 0,
  }

  const emit = async (event: WorkflowTraceEvent): Promise<void> => {
    events.push(event)
    await options.traceEmitter?.emit(event)
  }

  const delegateCtx = (): WorkflowDelegateContext => ({
    workflowRunId: runId,
    depth,
    phase: currentPhase,
    signal: workflowSignal.signal,
    caps,
    metadata: options.metadata,
  })

  const emitNow = (event: Omit<WorkflowTraceEvent, 'runId' | 'timestamp'>): WorkflowTraceEvent =>
    ({
      ...event,
      runId,
      timestamp: now(),
    }) as WorkflowTraceEvent

  const globals: WorkflowRuntimeGlobals = {
    budget,
    phase(title) {
      assertString(title, 'phase title')
      currentPhase = title
      void emit(emitNow({ kind: 'workflow.phase', payload: { title } }))
    },
    log(message) {
      assertString(message, 'log message')
      void emit(emitNow({ kind: 'workflow.log', payload: { message, phase: currentPhase } }))
    },
    async parallel(thunks) {
      if (!Array.isArray(thunks)) throw new ValidationError('parallel() expects an array')
      budget.assertFanout(thunks.length)
      thunks.forEach((thunk, index) => {
        if (typeof thunk !== 'function') {
          throw new ValidationError(`parallel() branch ${index} is not a function`)
        }
      })
      const opStarted = now()
      const operationPhase = currentPhase
      await emit(
        emitNow({
          kind: 'workflow.parallel.started',
          payload: { branchCount: thunks.length, phase: operationPhase },
        }),
      )
      let firstFailure: Error | undefined
      const settled = await Promise.allSettled(
        thunks.map(async (thunk, index) => {
          const branchStarted = now()
          await emit(
            emitNow({
              kind: 'workflow.branch.started',
              payload: { operation: 'parallel', branchIndex: index, phase: operationPhase },
            }),
          )
          try {
            const value = await thunk()
            await emit(
              emitNow({
                kind: 'workflow.branch.ended',
                payload: {
                  operation: 'parallel',
                  branchIndex: index,
                  durationMs: now() - branchStarted,
                  phase: operationPhase,
                },
              }),
            )
            return value
          } catch (err) {
            const normalized = normalizeRuntimeError(err)
            firstFailure ??= normalized
            workflowSignal.abort()
            await emit(
              emitNow({
                kind: 'workflow.branch.failed',
                payload: {
                  operation: 'parallel',
                  branchIndex: index,
                  durationMs: now() - branchStarted,
                  message: normalized.message,
                  code: normalized.name,
                  phase: operationPhase,
                },
              }),
            )
            throw normalized
          }
        }),
      )
      const rejected = settled.find(isRejected)
      if (rejected) throw firstFailure ?? normalizeRuntimeError(rejected.reason)
      await emit(
        emitNow({
          kind: 'workflow.parallel.ended',
          payload: {
            branchCount: thunks.length,
            durationMs: now() - opStarted,
            phase: currentPhase,
          },
        }),
      )
      return fulfilledValues(settled)
    },
    async pipeline(items, ...stages) {
      if (!Array.isArray(items)) throw new ValidationError('pipeline() expects an item array')
      budget.assertFanout(items.length)
      if (stages.length === 0) throw new ValidationError('pipeline() expects at least one stage')
      stages.forEach((stage, index) => {
        if (typeof stage !== 'function') {
          throw new ValidationError(`pipeline() stage ${index} is not a function`)
        }
      })
      const opStarted = now()
      const operationPhase = currentPhase
      await emit(
        emitNow({
          kind: 'workflow.pipeline.started',
          payload: { itemCount: items.length, stageCount: stages.length, phase: operationPhase },
        }),
      )
      let firstFailure: Error | undefined
      const settled = await Promise.allSettled(
        items.map(async (item, index) => {
          const branchStarted = now()
          await emit(
            emitNow({
              kind: 'workflow.branch.started',
              payload: {
                operation: 'pipeline',
                branchIndex: index,
                stageCount: stages.length,
                phase: operationPhase,
              },
            }),
          )
          let stageIndex = -1
          try {
            let value: unknown = item
            for (const stage of stages) {
              stageIndex += 1
              value = await stage(value, item, index)
            }
            await emit(
              emitNow({
                kind: 'workflow.branch.ended',
                payload: {
                  operation: 'pipeline',
                  branchIndex: index,
                  durationMs: now() - branchStarted,
                  stageCount: stages.length,
                  phase: operationPhase,
                },
              }),
            )
            return value as never
          } catch (err) {
            const normalized = normalizeRuntimeError(err)
            firstFailure ??= normalized
            workflowSignal.abort()
            await emit(
              emitNow({
                kind: 'workflow.branch.failed',
                payload: {
                  operation: 'pipeline',
                  branchIndex: index,
                  durationMs: now() - branchStarted,
                  message: normalized.message,
                  code: normalized.name,
                  phase: operationPhase,
                  ...(stageIndex >= 0 ? { stageIndex } : {}),
                },
              }),
            )
            throw normalized
          }
        }),
      )
      const rejected = settled.find(isRejected)
      if (rejected) throw firstFailure ?? normalizeRuntimeError(rejected.reason)
      await emit(
        emitNow({
          kind: 'workflow.pipeline.ended',
          payload: {
            itemCount: items.length,
            stageCount: stages.length,
            durationMs: now() - opStarted,
            phase: currentPhase,
          },
        }),
      )
      return fulfilledValues(settled) as never[]
    },
    async agent(prompt, agentOptions = {}) {
      assertString(prompt, 'agent prompt')
      const index = budget.nextAgentIndex()
      const label = agentOptions.label
      const opStarted = now()
      await emit(
        emitNow({
          kind: 'workflow.agent.started',
          payload: {
            index,
            label,
            promptChars: prompt.length,
            phase: currentPhase,
            metadata: agentOptions.metadata,
          },
        }),
      )
      const result = await waitForBudget(
        () => options.agent(prompt, agentOptions, delegateCtx()),
        budget,
        workflowSignal.signal,
        workflowSignal.abort,
      )
      const output = decodeResult(result, agentOptions)
      const usage = budget.observe(result)
      await emit(
        emitNow({
          kind: 'workflow.agent.ended',
          payload: {
            index,
            label,
            durationMs: now() - opStarted,
            costUsd: usage.costUsd,
            tokenUsage: usage.tokenUsage,
            phase: currentPhase,
            trace: result.trace,
          },
        }),
      )
      return output
    },
    async loop(input, loopOptions = {}) {
      if (!options.loop) throw new ValidationError('workflow loop() delegate is not configured')
      const index = budget.nextLoopIndex()
      const label = loopOptions.label
      const opStarted = now()
      await emit(
        emitNow({
          kind: 'workflow.loop.started',
          payload: {
            index,
            label,
            phase: currentPhase,
            metadata: loopOptions.metadata,
          },
        }),
      )
      const result = await waitForBudget(
        () => options.loop!(input, loopOptions, delegateCtx()),
        budget,
        workflowSignal.signal,
        workflowSignal.abort,
      )
      const output = decodeResult(result, loopOptions)
      const usage = budget.observe(result)
      await emit(
        emitNow({
          kind: 'workflow.loop.ended',
          payload: {
            index,
            label,
            durationMs: now() - opStarted,
            costUsd: usage.costUsd,
            tokenUsage: usage.tokenUsage,
            phase: currentPhase,
            trace: result.trace,
          },
        }),
      )
      return output
    },
    verify(input, verifierOptions = {}) {
      if (!options.verifier) {
        throw new ValidationError('workflow verify() delegate is not configured')
      }
      return runCheckpoint({
        kind: 'verifier',
        input,
        checkpointOptions: verifierOptions,
        delegate: options.verifier,
      })
    },
    analyzeTrace(input, analystOptions = {}) {
      if (!options.analyst) {
        throw new ValidationError('workflow analyzeTrace() delegate is not configured')
      }
      return runCheckpoint({
        kind: 'analyst',
        input,
        checkpointOptions: analystOptions,
        delegate: options.analyst,
      })
    },
    review(input, reviewerOptions = {}) {
      if (!options.reviewer) {
        throw new ValidationError('workflow review() delegate is not configured')
      }
      return runCheckpoint({
        kind: 'reviewer',
        input,
        checkpointOptions: reviewerOptions,
        delegate: options.reviewer,
      })
    },
  }

  async function runCheckpoint(args: {
    kind: WorkflowCheckpointRuntimeKind
    input: unknown
    checkpointOptions: WorkflowCheckpointOptions
    delegate: WorkflowVerifierDelegate | WorkflowAnalystDelegate | WorkflowReviewerDelegate
  }): Promise<unknown> {
    const index = checkpointCounts[args.kind]
    checkpointCounts[args.kind] += 1
    const label = args.checkpointOptions.label
    const opStarted = now()
    await emit(
      emitNow({
        kind: checkpointStartedKind(args.kind),
        payload: {
          index,
          label,
          phase: currentPhase,
          metadata: args.checkpointOptions.metadata,
        },
      }),
    )
    const result = await waitForBudget(
      () => args.delegate(args.input, args.checkpointOptions, delegateCtx()),
      budget,
      workflowSignal.signal,
      workflowSignal.abort,
    )
    const output = decodeResult(result, args.checkpointOptions)
    const usage = budget.observe(result)
    await emit(
      emitNow({
        kind: checkpointEndedKind(args.kind),
        payload: {
          index,
          label,
          durationMs: now() - opStarted,
          costUsd: usage.costUsd,
          tokenUsage: usage.tokenUsage,
          phase: currentPhase,
          trace: result.trace,
        },
      }),
    )
    return output
  }

  await emit(emitNow({ kind: 'workflow.started', payload: { meta: parsed.meta, depth, caps } }))
  try {
    const output = (await waitForBudget(
      () => runBody(parsed.body, parsed.meta.name, globals, options.syncTimeoutMs),
      budget,
      options.signal,
      workflowSignal.abort,
      'body',
    )) as TOutput
    const spent = budget.spent()
    const result: WorkflowResult<TOutput> = {
      runId,
      meta: parsed.meta,
      output,
      events,
      durationMs: now() - startedAt,
      costUsd: spent.costUsd,
      tokenUsage: spent.tokens,
      agentCalls: spent.agentCalls,
      loopCalls: spent.loopCalls,
    }
    await emit(
      emitNow({
        kind: 'workflow.ended',
        payload: {
          durationMs: result.durationMs,
          costUsd: result.costUsd,
          tokenUsage: result.tokenUsage,
          agentCalls: result.agentCalls,
          loopCalls: result.loopCalls,
        },
      }),
    )
    return { ...result, events }
  } catch (err) {
    const normalized = normalizeRuntimeError(err)
    workflowSignal.abort()
    await emit(
      emitNow({
        kind: 'workflow.failed',
        payload: {
          message: normalized.message,
          code: normalized.name,
          phase: currentPhase,
        },
      }),
    )
    throw normalized
  } finally {
    workflowSignal.cleanup()
  }
}

async function runBody(
  body: string,
  workflowName: string,
  globals: WorkflowRuntimeGlobals,
  syncTimeoutMs = 1000,
): Promise<unknown> {
  const context = vm.createContext(Object.create(null), {
    name: `workflow:${workflowName}`,
    codeGeneration: { strings: false, wasm: false },
  })
  installWorkflowGlobals(context, globals)
  const script = new vm.Script(
    `
'use strict'
const __workflowMain = async () => {
${body}
}
__workflowMain()
`,
    { filename: `${workflowName}.workflow.js` },
  )
  return script.runInContext(context, { timeout: syncTimeoutMs })
}

function decodeResult<TOptions extends { schema?: unknown; decode?: (value: unknown) => unknown }>(
  result: WorkflowDelegateResult,
  options: TOptions,
): unknown {
  if (options.schema) validateJsonSchema(result.output, options.schema as never)
  return options.decode ? options.decode(result.output) : result.output
}

function normalizeCaps(caps: WorkflowBudgetCaps = {}): Required<WorkflowBudgetCaps> {
  return {
    maxCostUsd: normalizeCap(caps.maxCostUsd, DEFAULT_CAPS.maxCostUsd, 'maxCostUsd'),
    maxTokens: normalizeCap(caps.maxTokens, DEFAULT_CAPS.maxTokens, 'maxTokens'),
    maxWallMs: normalizeCap(caps.maxWallMs, DEFAULT_CAPS.maxWallMs, 'maxWallMs'),
    maxAgentCalls: normalizeCap(caps.maxAgentCalls, DEFAULT_CAPS.maxAgentCalls, 'maxAgentCalls', {
      integer: true,
    }),
    maxLoopCalls: normalizeCap(caps.maxLoopCalls, DEFAULT_CAPS.maxLoopCalls, 'maxLoopCalls', {
      integer: true,
    }),
    maxFanout: normalizeCap(caps.maxFanout, DEFAULT_CAPS.maxFanout, 'maxFanout', {
      integer: true,
    }),
    maxDepth: normalizeCap(caps.maxDepth, DEFAULT_CAPS.maxDepth, 'maxDepth', { integer: true }),
  }
}

async function waitForBudget<T>(
  run: () => Promise<T>,
  budget: WorkflowBudget,
  signal: AbortSignal | undefined,
  abortWorkflow?: () => void,
  scope: 'delegate' | 'body' = 'delegate',
): Promise<T> {
  budget.assertWall()
  const wallMs = budget.remainingWallMs()
  if (signal?.aborted) throw new ValidationError(`workflow aborted before ${scope} completed`)
  if (wallMs !== undefined && wallMs <= 0) {
    throw new ValidationError('workflow budget exhausted: maxWallMs reached')
  }
  const promise = run()
  if (wallMs === undefined || !Number.isFinite(wallMs)) return promise
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new ValidationError(`workflow ${scope} timed out`))
          abortWorkflow?.()
        }, wallMs)
        abort = () => reject(new ValidationError(`workflow aborted before ${scope} completed`))
        signal?.addEventListener('abort', abort, { once: true })
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (abort) signal?.removeEventListener('abort', abort)
  }
}

function createWorkflowSignal(external: AbortSignal | undefined): {
  signal: AbortSignal
  abort: () => void
  cleanup: () => void
} {
  const controller = new AbortController()
  const abort = () => {
    if (!controller.signal.aborted) controller.abort()
  }
  if (external) {
    if (external.aborted) {
      abort()
    } else {
      external.addEventListener('abort', abort, { once: true })
    }
  }
  return {
    signal: controller.signal,
    abort,
    cleanup: () => external?.removeEventListener('abort', abort),
  }
}

function isRejected<T>(settled: PromiseSettledResult<T>): settled is PromiseRejectedResult {
  return settled.status === 'rejected'
}

function fulfilledValues<T>(settled: readonly PromiseSettledResult<T>[]): T[] {
  return settled.map((item) => (item as PromiseFulfilledResult<T>).value)
}

function normalizeCap(
  value: number | undefined,
  fallback: number,
  field: keyof WorkflowBudgetCaps,
  options: { integer?: boolean } = {},
): number {
  const cap = value ?? fallback
  if (typeof cap !== 'number' || Number.isNaN(cap) || cap < 0) {
    throw new ValidationError(`workflow caps.${field} must be a non-negative number`)
  }
  if (options.integer && Number.isFinite(cap) && !Number.isInteger(cap)) {
    throw new ValidationError(`workflow caps.${field} must be an integer`)
  }
  return cap
}

function checkpointStartedKind(
  kind: WorkflowCheckpointRuntimeKind,
): 'workflow.verifier.started' | 'workflow.analyst.started' | 'workflow.reviewer.started' {
  switch (kind) {
    case 'verifier':
      return 'workflow.verifier.started'
    case 'analyst':
      return 'workflow.analyst.started'
    case 'reviewer':
      return 'workflow.reviewer.started'
  }
}

function checkpointEndedKind(
  kind: WorkflowCheckpointRuntimeKind,
): 'workflow.verifier.ended' | 'workflow.analyst.ended' | 'workflow.reviewer.ended' {
  switch (kind) {
    case 'verifier':
      return 'workflow.verifier.ended'
    case 'analyst':
      return 'workflow.analyst.ended'
    case 'reviewer':
      return 'workflow.reviewer.ended'
  }
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`workflow ${name} must be a non-empty string`)
  }
}
