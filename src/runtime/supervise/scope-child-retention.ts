import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import type { RetainedRunEnvironmentAdmission } from '../retained-run-types'
import { chargedTokens } from '../util'
import { executorFailureReason } from './executor-outcome'
import {
  executorEvidenceWriter,
  leafContinuationExecutionId,
  type RetainedChildRecovery,
  type RetainedExecutorContext,
  workspaceCaptureWriter,
} from './retained-executor'
import { DEFAULT_BUDGET_STOP_HOLD_MS } from './scope-capabilities'
import type { LiveChild, ScopeArgs } from './scope-contract'
import { detachedSnapshot } from './snapshot'
import { assertValidSpend } from './spend-validation'
import type { TraceRootWriter } from './trace-root'
import type { Budget, NodeExecutionIdentity, NodeId, SpawnOpts, Spend } from './types'

/** Own the retained child invocation and its durable writes. */
export function createChildRetention({
  args,
  controller,
  id,
  ordinal,
  identity,
  recovery,
  opts,
  now,
  traceRoots,
  markRecoveryReady,
  childDeadlineAtMs,
  readLive,
  completeEvidence,
}: {
  args: ScopeArgs
  controller: AbortController
  id: NodeId
  ordinal: number
  identity: NodeExecutionIdentity | undefined
  recovery: RetainedChildRecovery | undefined
  opts: SpawnOpts
  now: () => number
  traceRoots: TraceRootWriter
  markRecoveryReady: (() => void) | undefined
  childDeadlineAtMs: number | undefined
  readLive: () => LiveChild
  completeEvidence: () => Promise<void>
}) {
  const retainedWrites = new Set<Promise<void>>()
  let retainedWritesClosed = false
  const retainedWrite = (write: () => Promise<void>): Promise<void> => {
    controller.signal.throwIfAborted()
    if (retainedWritesClosed) throw new ValidationError('retained child writer is closed')
    const pending = write()
    retainedWrites.add(pending)
    void pending.catch(() => undefined).finally(() => retainedWrites.delete(pending))
    return pending
  }
  const closeRetainedWrites = async () => {
    retainedWritesClosed = true
    await Promise.allSettled([...retainedWrites])
  }
  // The invocation this child runs. A leaf refused for capacity continues in its environment as a
  // later invocation, journaled as an owner's later drive is; its input takes the next number after
  // the spawn ordinal, so a recovery derives the same execution id from the journal.
  let admissions = [...(recovery?.admissions ?? [])]
  let inputSeq = recovery?.continuation?.inputSeq ?? ordinal
  let pauseSeq = 0
  const onAdmission: RetainedExecutorContext['onAdmission'] = (admission) =>
    retainedWrite(async () => {
      const existing = admissions.find((record) => record.phase === admission.phase)
      if (existing) {
        if (contentAddress(existing) !== contentAddress(admission)) {
          throw new ValidationError('scope retained admission conflicts with its committed phase')
        }
        return
      }
      if (identity?.taskDigest === undefined)
        throw new ValidationError('retained execution requires a canonical task identity')
      await args.journal.appendEvent(args.root, {
        kind: 'execution-admitted',
        id,
        admission: detachedSnapshot(admission, 'retained admission'),
        seq: ordinal,
        at: new Date(now()).toISOString(),
      })
      admissions.push(detachedSnapshot(admission, 'retained admission'))
      readLive().recoveryPending = true
      controller.signal.throwIfAborted()
    })
  const onResult: RetainedExecutorContext['onResult'] = (result) =>
    retainedWrite(async () => {
      assertValidSpend(result.spent, 'retained executor result')
      executorFailureReason(result)
      await completeEvidence()
      const outRef = contentAddress(result.out)
      await args.blobs.put(outRef, result.out)
      controller.signal.throwIfAborted()
      // As for a retained owner: an abort that arrives while the events hash still commits.
      const traceRoot = await traceRoots.write(outRef, result)
      await args.journal.appendEvent(args.root, {
        kind: 'execution-result',
        id,
        outRef,
        ...(traceRoot === undefined ? {} : { traceRoot }),
        spent: result.spent,
        ...(result.verdict ? { verdict: result.verdict } : {}),
        ...(result.outcome ? { outcome: result.outcome } : {}),
        ...(result.outputFormat === undefined ? {} : { outputFormat: result.outputFormat }),
        seq: ordinal,
        at: new Date(now()).toISOString(),
      })
      readLive().acceptedResult = detachedSnapshot(
        { ...result, outRef },
        'accepted retained child result',
      )
      readLive().recoveryPending = false
    })
  let captureSeq = 0
  const { onWorkspaceCapture, onWorkspaceCaptureStarted } = workspaceCaptureWriter({
    journal: args.journal,
    rootId: args.root,
    nodeId: id,
    nextSequence: () => captureSeq++,
    now,
  })
  // Only a keyed leaf can be continued, so only it keeps its box after an over-budget or late turn.
  const holdMs = args.budgetStopHoldMs ?? DEFAULT_BUDGET_STOP_HOLD_MS
  const holdOnSettle =
    opts.key !== undefined && holdMs > 0
      ? (spent: Spend): boolean =>
          overBudget(opts.budget, spent) ||
          (childDeadlineAtMs !== undefined && now() > childDeadlineAtMs)
      : undefined
  const retainedContext = (
    continuing:
      | {
          executionId: string
          priorSession: RetainedRunEnvironmentAdmission
          priorSpent?: Spend
        }
      | undefined,
  ): RetainedExecutorContext => ({
    ...(continuing === undefined
      ? {}
      : {
          executionId: continuing.executionId,
          priorSession: continuing.priorSession,
          ...(continuing.priorSpent === undefined ? {} : { priorSpent: continuing.priorSpent }),
        }),
    admissions,
    ...(recovery?.observed === undefined ? {} : { observed: recovery.observed }),
    onObserved: (position) =>
      retainedWrite(() =>
        args.journal.appendEvent(args.root, {
          kind: 'execution-observed',
          id,
          ...position,
          seq: ordinal,
          at: new Date(now()).toISOString(),
        }),
      ),
    ...(holdOnSettle === undefined ? {} : { holdOnSettle }),
    ...(markRecoveryReady && continuing === undefined ? { onReady: markRecoveryReady } : {}),
    onAdmission,
    onResult,
    onEvidence: executorEvidenceWriter({
      journal: args.journal,
      blobs: args.blobs,
      rootId: args.root,
      nodeId: id,
      nextSequence: () => ordinal,
      now,
      traceRoots,
    }),
    onPause: (pause) =>
      retainedWrite(() =>
        args.journal.appendEvent(args.root, {
          kind: 'paused',
          id,
          ...pause,
          seq: pauseSeq++,
          at: new Date(now()).toISOString(),
        }),
      ),
    onWorkspaceCapture,
    onWorkspaceCaptureStarted,
    continueInvocation: async (nextTask) => {
      controller.signal.throwIfAborted()
      const live = readLive()
      // Before a committed result, a new input would pay for the unfinished turn twice.
      if (live.acceptedResult === undefined) {
        throw new ValidationError(
          'scope: a retained child continues only after its invocation committed a result',
        )
      }
      const environment = admissions.find((record) => record.phase === 'environment')
      if (environment?.phase !== 'environment') {
        throw new ValidationError(
          'scope: a retained child continues only in an environment it was admitted to',
        )
      }
      const snapshot = detachedSnapshot(nextTask, 'retained child continuation')
      const taskRef = contentAddress(snapshot)
      const nextSeq = inputSeq + 1
      await retainedWrite(async () => {
        await args.blobs.put(taskRef, snapshot)
        controller.signal.throwIfAborted()
        await args.journal.appendEvent(args.root, {
          kind: 'execution-input',
          id,
          taskRef,
          seq: nextSeq,
          at: new Date(now()).toISOString(),
        })
      })
      inputSeq = nextSeq
      admissions = []
      // That result is the continued invocation's: a cancel now leaves this one pending.
      const priorSpent = live.acceptedResult.spent
      live.acceptedResult = undefined
      return retainedContext({
        executionId: leafContinuationExecutionId(id, nextSeq),
        priorSession: environment,
        priorSpent,
      })
    },
  })
  return {
    retainedContext,
    closeRetainedWrites,
    holdMs,
    readEnvironmentAdmission: () => {
      const admission = admissions.find((record) => record.phase === 'environment')
      return admission?.phase === 'environment' ? admission : undefined
    },
  }
}

/** Whether a settled spend exceeds the budget it was given, by the channels the pool reconciles. */
function overBudget(budget: Budget, spent: Spend): boolean {
  return (
    chargedTokens(spent.tokens) > budget.maxTokens ||
    spent.iterations > budget.maxIterations ||
    (budget.maxUsd !== undefined && spent.usdKnown !== false && spent.usd > budget.maxUsd)
  )
}
