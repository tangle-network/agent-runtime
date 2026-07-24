import type {
  CostLedgerHandle,
  OptimizationMethodInput,
  OptimizationMethodResult,
  Scenario,
} from '@tangle-network/agent-eval/campaign'
import type { Sha256Digest } from '@tangle-network/agent-interface'
import { ConfigError } from '../errors'

type LedgerFilter = Parameters<CostLedgerHandle['summary']>[0]
type LedgerWaitOptions = Parameters<NonNullable<CostLedgerHandle['waitForIdle']>>[0]

const EVALUATION_TAG = 'runtimeEvaluationRef'
const INVOCATION_TAG = 'runtimeInvocationId'

interface MethodCostScope {
  evaluationRef: Sha256Digest
  invocationId: string
}

export type MethodCostAttribution = 'invocation' | 'optimizer-run'

export function methodInputWithScopedCost<TScenario extends Scenario, TArtifact>(
  input: OptimizationMethodInput<TScenario, TArtifact>,
  scope: MethodCostScope,
  costAttribution: MethodCostAttribution = 'invocation',
): OptimizationMethodInput<TScenario, TArtifact> {
  return Object.freeze({
    ...input,
    costLedger: scopedCostLedger(input.costLedger, scope, costAttribution),
  })
}

export function methodInvocationCostLedger(
  ledger: CostLedgerHandle,
  scope: MethodCostScope,
): CostLedgerHandle {
  return scopedCostLedger(ledger, scope, 'invocation')
}

export function assertMethodCostRecorded(
  methodName: string,
  result: Pick<OptimizationMethodResult, 'cost' | 'provenance'>,
  compatibleLedger: CostLedgerHandle,
  invocationLedger: CostLedgerHandle,
  costCeiling: number | undefined,
  costAttribution: MethodCostAttribution = 'invocation',
): void {
  const { cost } = result
  const observed =
    costAttribution === 'optimizer-run' && result.provenance?.runId
      ? compatibleLedger.summary({ tags: { optimizerRun: result.provenance.runId } })
      : invocationLedger.summary()
  if (costCeiling !== undefined && !cost.accountingComplete) {
    throw new ConfigError(
      `improve(): method '${methodName}' returned incomplete cost accounting under costCeiling; refusing final scoring`,
    )
  }
  if (costCeiling !== undefined && exceeds(cost.totalCostUsd, costCeiling)) {
    throw new ConfigError(
      `improve(): method '${methodName}' reported cost $${cost.totalCostUsd} above costCeiling $${costCeiling}; refusing final scoring`,
    )
  }
  if (cost.accountingComplete && !observed.accountingComplete) {
    throw new ConfigError(
      `improve(): method '${methodName}' reported complete cost accounting but its shared cost receipts are incomplete`,
    )
  }
  if (cost.accountingComplete && !approximatelyEqual(cost.totalCostUsd, observed.totalCostUsd)) {
    throw new ConfigError(
      `improve(): method '${methodName}' reported $${cost.totalCostUsd} but recorded $${observed.totalCostUsd} through input.costLedger`,
    )
  }
}

function scopedCostLedger(
  parent: CostLedgerHandle,
  scope: MethodCostScope,
  costAttribution: MethodCostAttribution,
): CostLedgerHandle {
  const evaluationTags = {
    [EVALUATION_TAG]: scope.evaluationRef,
  }
  const invocationTags = {
    ...evaluationTags,
    [INVOCATION_TAG]: scope.invocationId,
  }
  const readTags = (filter: LedgerFilter): Record<string, string> =>
    costAttribution === 'optimizer-run' && hasOptimizerRunFilter(filter)
      ? evaluationTags
      : invocationTags
  return {
    costCeilingUsd: parent.costCeilingUsd,
    runPaidCall: (input) =>
      parent.runPaidCall({
        ...input,
        tags: { ...(input.tags ?? {}), ...invocationTags },
      }),
    reconcile: (...args) => parent.reconcile(...args),
    list: (filter) => parent.list(withTags(filter, readTags(filter))),
    listPending: (filter) => parent.listPending?.(withTags(filter, readTags(filter))) ?? [],
    summary: (filter) => parent.summary(withTags(filter, readTags(filter))),
    waitForIdle: (options: LedgerWaitOptions = {}) =>
      parent.waitForIdle?.({
        ...options,
        filter: withTags(options.filter, readTags(options.filter)),
      }) ??
      Promise.resolve(
        parent.summary(withTags(options.filter, readTags(options.filter))).pendingCalls === 0,
      ),
    markCompleted: (count) => parent.markCompleted(count),
    costPerCompletedTask: () => parent.costPerCompletedTask(),
  }
}

function hasOptimizerRunFilter(filter: LedgerFilter): boolean {
  return typeof filter?.tags?.optimizerRun === 'string' && filter.tags.optimizerRun.length > 0
}

function withTags(filter: LedgerFilter, tags: Record<string, string>): LedgerFilter {
  return {
    ...(filter ?? {}),
    tags: { ...(filter?.tags ?? {}), ...tags },
  }
}

function approximatelyEqual(left: number, right: number): boolean {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8
  return Math.abs(left - right) <= tolerance
}

function exceeds(value: number, limit: number): boolean {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(limit)) * 8
  return value - limit > tolerance
}
