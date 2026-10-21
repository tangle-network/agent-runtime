/**
 * Running the executor under the frozen task deadline, then proving its process stopped,
 * capturing its final evidence, and disposing its resources.
 */

import type { TraceStore } from '@tangle-network/agent-eval'
import type {
  AgentCandidateTaskOutcomeSpec,
  AgentCandidateTermination,
} from '@tangle-network/agent-interface'
import { withinCandidateCleanupDeadline } from './cleanup'
import { joinErrors } from './execute-cleanup'
import {
  type SealedAgentCandidateExecutorFinalCapture,
  sealAgentCandidateExecutorFinalCapture,
  sealAgentCandidateExecutorStopAcknowledgement,
  sealAgentCandidateProtectedRunCapture,
} from './executor-capture'
import type {
  AgentCandidateExecutorPort,
  AgentCandidateExecutorRequest,
  AgentCandidateProtectedRunCapture,
} from './types'

export type ExecutorOutcome =
  | {
      kind: 'capture'
      capture: AgentCandidateProtectedRunCapture
      termination: AgentCandidateTermination
      finalCapture: SealedAgentCandidateExecutorFinalCapture
      processStopped: true
      error?: undefined
    }
  | {
      kind: 'timeout'
      termination: AgentCandidateTermination & { kind: 'timeout' }
      finalCapture: SealedAgentCandidateExecutorFinalCapture
      processStopped: true
      error?: undefined
    }
  | {
      kind: 'error'
      error: unknown
      termination?: AgentCandidateTermination
      finalCapture?: SealedAgentCandidateExecutorFinalCapture
      processStopped: boolean
    }

/** The executor's run as it unfolds: what it returned, and whether the deadline cut it off. */
interface ExecutorRun {
  readonly controller: AbortController
  readonly timeoutError: CandidateExecutionDeadlineError
  timer: ReturnType<typeof setTimeout> | undefined
  timedOut: boolean
  capture: AgentCandidateProtectedRunCapture | undefined
  executionError: unknown
}

/** Run the executor until it returns or the deadline passes, then stop and capture it. */
export async function runAndStopExecutor(
  executor: AgentCandidateExecutorPort,
  request: AgentCandidateExecutorRequest,
  expectedOutcome: AgentCandidateTaskOutcomeSpec,
  traceStore: TraceStore,
  deadlineAtMs: number,
  cleanupTimeoutMs: number,
): Promise<ExecutorOutcome> {
  const timeoutMs = request.hardLimits.timeoutMs
  const timeoutError = new CandidateExecutionDeadlineError(timeoutMs)
  if (Date.now() >= deadlineAtMs) {
    return {
      kind: 'error',
      error: timeoutError,
      termination: { kind: 'timeout', timeoutMs },
      processStopped: true,
    }
  }
  const run = await executeUntilDeadline(executor, request, traceStore, deadlineAtMs, timeoutError)
  rejectAmbiguousCapture(run, request, deadlineAtMs)

  const { controller } = run
  if (!run.capture || run.timedOut) controller.abort(run.executionError)
  const stopReason = run.timedOut ? 'timeout' : run.capture ? 'completed' : 'failed'
  const cleanupDeadlineAtMs = Date.now() + cleanupTimeoutMs
  const timeoutTermination = () =>
    run.timedOut ? { termination: { kind: 'timeout' as const, timeoutMs } } : {}
  const stop = await stopExecutor(executor, request, traceStore, stopReason, cleanupDeadlineAtMs)
  if (!stop.stopped) {
    const disposalError = await disposalFailure(executor, request, cleanupDeadlineAtMs)
    if (run.timer) clearTimeout(run.timer)
    controller.abort(stop.error)
    return {
      kind: 'error',
      error: new Error(joinErrors(run.executionError, stop.error, disposalError)),
      ...timeoutTermination(),
      processStopped: false,
    }
  }

  const final = await captureFinalEvidence(
    executor,
    request,
    traceStore,
    expectedOutcome,
    cleanupDeadlineAtMs,
  )
  const disposalError = await disposalFailure(executor, request, cleanupDeadlineAtMs)
  const { finalCapture } = final
  if (final.error || disposalError || !finalCapture) {
    if (run.timer) clearTimeout(run.timer)
    controller.abort(final.error ?? disposalError)
    return {
      kind: 'error',
      error: new Error(joinErrors(run.executionError, final.error, disposalError)),
      ...timeoutTermination(),
      processStopped: true,
    }
  }

  if (Date.now() >= deadlineAtMs) {
    run.timedOut = true
    run.executionError = timeoutError
    run.capture = undefined
    controller.abort(timeoutError)
  }
  if (run.timer) clearTimeout(run.timer)

  if (run.timedOut) {
    return {
      kind: 'timeout',
      termination: { kind: 'timeout', timeoutMs },
      finalCapture,
      processStopped: true,
    }
  }
  if (run.executionError || !run.capture) {
    return {
      kind: 'error',
      error: run.executionError ?? new Error('candidate executor returned no capture'),
      finalCapture,
      processStopped: true,
    }
  }
  return {
    kind: 'capture',
    capture: run.capture,
    termination: run.capture.termination,
    finalCapture,
    processStopped: true,
  }
}

async function executeUntilDeadline(
  executor: AgentCandidateExecutorPort,
  request: AgentCandidateExecutorRequest,
  traceStore: TraceStore,
  deadlineAtMs: number,
  timeoutError: CandidateExecutionDeadlineError,
): Promise<ExecutorRun> {
  const run: ExecutorRun = {
    controller: new AbortController(),
    timeoutError,
    timer: undefined,
    timedOut: false,
    capture: undefined,
    executionError: undefined,
  }
  const executionPromise = Promise.resolve().then(() =>
    executor.execute(request, {
      traceStore,
      signal: run.controller.signal,
      deadlineAtMs,
    }),
  )
  // A stopped process may still leave a buggy adapter promise pending. Attach a
  // terminal handler now so the deadline path cannot create an unhandled rejection.
  void executionPromise.catch(() => undefined)
  const deadlinePromise = new Promise<never>((_resolve, reject) => {
    run.timer = setTimeout(
      () => {
        run.timedOut = true
        run.controller.abort(timeoutError)
        reject(timeoutError)
      },
      Math.max(0, deadlineAtMs - Date.now()),
    )
  })
  void deadlinePromise.catch(() => undefined)
  try {
    run.capture = sealAgentCandidateProtectedRunCapture(
      await Promise.race([executionPromise, deadlinePromise]),
    )
  } catch (error) {
    run.executionError = error
  }
  return run
}

/** Refuse a capture for another execution, one at the deadline, or one that claims the timeout. */
function rejectAmbiguousCapture(
  run: ExecutorRun,
  request: AgentCandidateExecutorRequest,
  deadlineAtMs: number,
): void {
  const { capture } = run
  if (!run.timedOut && capture && capture.executionId !== request.executionId) {
    run.executionError = new Error('candidate execution capture id does not match the request')
    run.capture = undefined
  } else if (!run.timedOut && capture && Date.now() >= deadlineAtMs) {
    // Promise resolution at the boundary is ambiguous under event-loop delay.
    // Fail closed unless completion is observed strictly before the deadline.
    run.timedOut = true
    run.executionError = run.timeoutError
    run.capture = undefined
  } else if (!run.timedOut && capture?.termination.kind === 'timeout') {
    run.executionError = new Error('candidate executor cannot declare the runtime-owned timeout')
    run.capture = undefined
  }
}

async function stopExecutor(
  executor: AgentCandidateExecutorPort,
  request: AgentCandidateExecutorRequest,
  traceStore: TraceStore,
  reason: 'timeout' | 'completed' | 'failed',
  cleanupDeadlineAtMs: number,
): Promise<{ stopped: true } | { stopped: false; error: unknown }> {
  try {
    const stopped = await withinCandidateCleanupDeadline(
      (cleanupSignal) =>
        executor.stop(executionTarget(request), {
          traceStore,
          reason,
          signal: cleanupSignal,
          deadlineAtMs: cleanupDeadlineAtMs,
        }),
      cleanupDeadlineAtMs,
      'candidate process termination',
    )
    sealAgentCandidateExecutorStopAcknowledgement(stopped)
    return { stopped: true }
  } catch (error) {
    return { stopped: false, error }
  }
}

async function captureFinalEvidence(
  executor: AgentCandidateExecutorPort,
  request: AgentCandidateExecutorRequest,
  traceStore: TraceStore,
  expectedOutcome: AgentCandidateTaskOutcomeSpec,
  cleanupDeadlineAtMs: number,
): Promise<{ finalCapture?: SealedAgentCandidateExecutorFinalCapture; error?: unknown }> {
  try {
    return {
      finalCapture: sealAgentCandidateExecutorFinalCapture(
        await withinCandidateCleanupDeadline(
          (cleanupSignal) =>
            executor.capture(executionTarget(request), { traceStore, signal: cleanupSignal }),
          cleanupDeadlineAtMs,
          'candidate final evidence capture',
        ),
        expectedOutcome,
      ),
    }
  } catch (error) {
    return { error }
  }
}

/** The error disposal threw, or undefined when the executor's resources were disposed. */
async function disposalFailure(
  executor: AgentCandidateExecutorPort,
  request: AgentCandidateExecutorRequest,
  cleanupDeadlineAtMs: number,
): Promise<unknown> {
  try {
    const dispose = executor.dispose
    if (!dispose) return undefined
    const disposed = await withinCandidateCleanupDeadline(
      (cleanupSignal) =>
        dispose.call(executor, executionTarget(request), { signal: cleanupSignal }),
      cleanupDeadlineAtMs,
      'candidate execution resource disposal',
    )
    if (disposed?.disposed !== true || Object.keys(disposed).some((key) => key !== 'disposed')) {
      throw new Error('candidate executor did not acknowledge resource disposal')
    }
    return undefined
  } catch (error) {
    return error
  }
}

const executionTarget = (request: AgentCandidateExecutorRequest) => ({
  executionId: request.executionId,
  executionPlanDigest: request.executionPlan.value.digest,
})

class CandidateExecutionDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`candidate execution reached its frozen ${timeoutMs}ms deadline`)
    this.name = 'CandidateExecutionDeadlineError'
  }
}
