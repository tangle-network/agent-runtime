import { randomUUID } from 'node:crypto'
import { ValidationError } from '../errors'
import { WorkflowBudget } from './budget'
import { normalizeRuntimeError, type WorkflowRuntimeGlobals } from './realm'
import {
  assertWorkflowString,
  checkpointEndedKind,
  checkpointFailedKind,
  checkpointStartedKind,
  createWorkflowSignal,
  decodeWorkflowDelegateResult,
  fulfilledValues,
  isRejected,
  normalizeWorkflowCaps,
  runWorkflowBody,
  type WorkflowCheckpointRuntimeKind,
  waitForWorkflowBudget,
} from './runtime-support'
import type {
  WorkflowAnalystDelegate,
  WorkflowCheckpointOptions,
  WorkflowDelegateContext,
  WorkflowResult,
  WorkflowReviewerDelegate,
  WorkflowRuntimeOptions,
  WorkflowTraceEvent,
  WorkflowVerifierDelegate,
} from './types'
import { parseWorkflowScript } from './validate'

export async function runWorkflow<TOutput = unknown>(
  options: WorkflowRuntimeOptions,
): Promise<WorkflowResult<TOutput>> {
  const parsed = parseWorkflowScript(options.source)
  const runId = options.runId ?? `workflow-${randomUUID()}`
  const depth = options.depth ?? 0
  const caps = normalizeWorkflowCaps(options.caps)
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
    budget,
    metadata: options.metadata,
  })

  const emitNow = (event: Omit<WorkflowTraceEvent, 'runId' | 'timestamp'>): WorkflowTraceEvent =>
    ({
      ...event,
      runId,
      timestamp: now(),
    }) as WorkflowTraceEvent

  const emitDelegateFailure = async (
    kind:
      | 'workflow.agent.failed'
      | 'workflow.loop.failed'
      | 'workflow.verifier.failed'
      | 'workflow.analyst.failed'
      | 'workflow.reviewer.failed',
    args: {
      err: unknown
      index: number
      label?: string
      startedAt: number
    },
  ): Promise<never> => {
    const normalized = normalizeRuntimeError(args.err)
    await emit(
      emitNow({
        kind,
        payload: {
          index: args.index,
          label: args.label,
          durationMs: now() - args.startedAt,
          message: normalized.message,
          code: normalized.name,
          phase: currentPhase,
        },
      }),
    )
    throw normalized
  }

  const globals: WorkflowRuntimeGlobals = {
    budget,
    phase(title) {
      assertWorkflowString(title, 'phase title')
      currentPhase = title
      void emit(emitNow({ kind: 'workflow.phase', payload: { title } }))
    },
    log(message) {
      assertWorkflowString(message, 'log message')
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
      assertWorkflowString(prompt, 'agent prompt')
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
      try {
        const result = await waitForWorkflowBudget(
          () => options.agent(prompt, agentOptions, delegateCtx()),
          budget,
          workflowSignal.signal,
          workflowSignal.abort,
        )
        const output = decodeWorkflowDelegateResult(result, agentOptions)
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
      } catch (err) {
        return emitDelegateFailure('workflow.agent.failed', {
          err,
          index,
          label,
          startedAt: opStarted,
        })
      }
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
      try {
        const result = await waitForWorkflowBudget(
          () => options.loop!(input, loopOptions, delegateCtx()),
          budget,
          workflowSignal.signal,
          workflowSignal.abort,
        )
        const output = decodeWorkflowDelegateResult(result, loopOptions)
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
      } catch (err) {
        return emitDelegateFailure('workflow.loop.failed', {
          err,
          index,
          label,
          startedAt: opStarted,
        })
      }
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
    try {
      const result = await waitForWorkflowBudget(
        () => args.delegate(args.input, args.checkpointOptions, delegateCtx()),
        budget,
        workflowSignal.signal,
        workflowSignal.abort,
      )
      const output = decodeWorkflowDelegateResult(result, args.checkpointOptions)
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
    } catch (err) {
      return emitDelegateFailure(checkpointFailedKind(args.kind), {
        err,
        index,
        label,
        startedAt: opStarted,
      })
    }
  }

  await emit(emitNow({ kind: 'workflow.started', payload: { meta: parsed.meta, depth, caps } }))
  try {
    const output = (await waitForWorkflowBudget(
      () => runWorkflowBody(parsed.body, parsed.meta.name, globals, options.syncTimeoutMs),
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
