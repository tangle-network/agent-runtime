import type { Settled } from '../../runtime'
import { settlementFailureCause } from '../../runtime/failure-cause'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import { BUDGET_STOP_NEXT, budgetOverspendText } from './coordination-budget'
import type { CoordinationToolsOptions, SettledWorker } from './coordination-contracts'
import { modelSubstitutionReport } from './coordination-model-attribution'
import type { createSpawnAdmission } from './coordination-spawn-admission'

export function createWorkerSettlement({
  opts,
  nodeForWorker,
}: {
  readonly opts: CoordinationToolsOptions
  readonly nodeForWorker: ReturnType<typeof createSpawnAdmission>['nodeForWorker']
}) {
  // Outputs this manager learned by content address: settlements and their team summaries.
  const descendantOutRefs = new Set<string>(opts.sourceEvidenceRefs ?? [])
  const projectSettled = (settled: Settled<unknown>, resumed = false): SettledWorker => {
    const node = nodeForWorker(settled.handle.id)
    const assignmentId = settled.handle.assignmentId ?? node?.assignmentId
    const identity = settled.handle.identity ?? node?.identity
    const modelSubstitution = settled.handle.modelSubstitution ?? node?.modelSubstitution
    const materialization = settled.handle.materialization ?? node?.materialization
    const executionBindings = settled.handle.executionBindings ?? node?.executionBindings
    const settledAt = settled.settledAt ?? node?.settledAt
    const trace =
      settled.trace ??
      node?.trace ??
      ({
        status: 'unavailable',
        reason: 'legacy-settlement-without-trace-evidence',
      } as const)
    const common = {
      id: settled.handle.id,
      ...(assignmentId === undefined ? {} : { assignmentId }),
      ...(identity === undefined ? {} : { identity }),
      ...(modelSubstitution === undefined ? {} : modelSubstitutionReport(modelSubstitution)),
      ...(materialization === undefined ? {} : { materialization }),
      ...(executionBindings === undefined ? {} : { executionBindings }),
      ...(settledAt === undefined ? {} : { settledAt }),
      ...(settled.budgetViolation === undefined
        ? {}
        : {
            budgetViolation: settled.budgetViolation,
            budgetStop: budgetOverspendText(settled.budgetViolation),
            ...(assignmentId?.startsWith('key:') === true
              ? { budgetStopNext: BUDGET_STOP_NEXT }
              : {}),
          }),
      trace,
      ...(settled.subtree === undefined ? {} : { subtree: settled.subtree }),
      ...(resumed ? { resumed: true as const } : {}),
    }
    // A manager may read a result it was told about by digest, settled or summarized; no other.
    const told = [settled.outRef, ...(settled.subtree?.results ?? []).map((r) => r.outRef)]
    for (const outRef of told) if (outRef !== undefined) descendantOutRefs.add(outRef)
    return detachedFrozen<SettledWorker>(
      settled.kind === 'done'
        ? {
            ...common,
            status: 'done',
            spent: settled.spent,
            ...(settled.verdict?.score === undefined ? {} : { score: settled.verdict.score }),
            ...(settled.verdict?.valid === undefined ? {} : { valid: settled.verdict.valid }),
            outRef: settled.outRef,
          }
        : {
            ...common,
            status: 'down',
            ...(settled.outRef === undefined ? {} : { outRef: settled.outRef }),
            ...(node?.spent === undefined ? {} : { spent: node.spent }),
            reason: settled.reason,
            failure: settlementFailureCause(settled),
          },
    )
  }

  return { descendantOutRefs, projectSettled }
}
