import { resolve } from 'node:path'
import { readRunCancellation, readRunCancelRequest, writeRunCancellation } from './run-layout'
import type { RootProviderModelEvidence, SupervisedResult } from './types'

/**
 * Record what a run-scoped cancel actually did, at the ONE place that observes the run's terminal
 * state: the `supervise()` settle path.
 *
 * The observer writes `cancel_requested` when it issues the abort; only here is the run's own
 * outcome known. An aborted run reads `cancelled` only with confirmed teardown, otherwise `unknown`.
 * A run that reached any other terminal state despite the request terminated nothing and reads `not_live`,
 * never a success. A request the run ended before applying is expired here too, so a reader can
 * tell run-over from in-progress and a stale request cannot outlive its run.
 */
export function recordRunCancellationOutcome(
  runDir: string | undefined,
  result: SupervisedResult<unknown>,
  now: () => number,
): void {
  if (runDir === undefined) return
  const dir = resolve(runDir)
  const request = readRunCancelRequest(dir)
  if (request === undefined) return
  const record = readRunCancellation(dir, request.operationId)
  if (record !== undefined && record.effect !== 'cancel_requested') return
  const aborted =
    result.kind === 'no-winner' &&
    result.reason === 'cancelled' &&
    result.operationId === request.operationId
  const observedAt = new Date(now()).toISOString()
  const base = {
    operationId: request.operationId,
    requestedAt: request.at,
    observedAt,
    ...(record?.path === undefined ? {} : { path: record.path }),
    ...(record?.appliedAfterMs === undefined ? {} : { appliedAfterMs: record.appliedAfterMs }),
    ...(record?.deadlineExceeded === undefined
      ? {}
      : { deadlineExceeded: record.deadlineExceeded }),
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(request.operator === undefined ? {} : { operator: request.operator }),
  }
  if (record === undefined) {
    writeRunCancellation(dir, {
      ...base,
      effect: 'not_live',
      detail: 'run ended before the request was applied',
    })
    return
  }
  if (aborted && result.teardownUnconfirmed?.length) {
    writeRunCancellation(dir, {
      ...base,
      effect: 'unknown',
      detail: `run aborted but teardown remains unconfirmed for: ${result.teardownUnconfirmed
        .map((node) =>
          node.environments?.length
            ? `${node.id} (${node.environments.map((environment) => `${environment.provider}:${environment.environmentId}`).join(', ')})`
            : node.id,
        )
        .join(', ')}`,
    })
    return
  }
  writeRunCancellation(
    dir,
    aborted
      ? { ...base, effect: 'cancelled', detail: 'the run reached its terminal cancelled state' }
      : {
          ...base,
          effect: 'not_live',
          detail: `run settled ${result.kind === 'winner' ? 'winner' : result.reason} despite the abort request; nothing was terminated`,
        },
  )
}

export function rootProviderModelEvidence(
  observations: ReadonlyArray<string | undefined>,
): RootProviderModelEvidence {
  const attempts = Object.freeze(
    observations.map((model) =>
      Object.freeze({ observations: Object.freeze(model === undefined ? [] : [model]) }),
    ),
  )
  const models = [...new Set(observations.filter((model): model is string => model !== undefined))]
  if (observations.length === 0 || observations.some((model) => model === undefined)) {
    return Object.freeze({
      status: 'unknown' as const,
      attempts,
      models: Object.freeze(models),
      reason: 'provider-model-missing' as const,
    })
  }
  return Object.freeze({ status: 'known' as const, attempts, models: Object.freeze(models) })
}

export function rootProviderModelEvidenceFromExecution(
  evidence: RootProviderModelEvidence | undefined,
): RootProviderModelEvidence {
  return evidence ?? rootProviderModelEvidence([])
}
