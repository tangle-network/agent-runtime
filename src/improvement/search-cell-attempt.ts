/**
 * One search cell: a one-cell `runCampaign` of a node's materialized profile,
 * so judges, timeouts, traces, the cost ledger and the cell cache behave as in
 * every other campaign. An environment fault the agent or a judge raises
 * settles the cell errored and retryable.
 */
import {
  type CampaignStorage,
  campaignCellSearchResult,
  type RunCampaignOptions,
  runCampaign,
  type Scenario,
  type SearchCellResult,
  type SearchExecutionIdentity,
} from '@tangle-network/agent-eval/campaign'
import { canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import type { ImproveSearchOptions } from './improve-types'
import type { PreparedProfileImprovement } from './profile-improvement'
import { isSearchEnvironmentFault, type searchExecutor } from './search-executor'
import { type ProfileNode, searchRefusalText } from './search-session'

type RunAttempt = Parameters<typeof searchExecutor<ProfileNode>>[0]['runAttempt']

/** What every cell of one search shares. */
export interface SearchCellEnvironment<TScenario extends Scenario, TArtifact> {
  readonly campaignOptions: Omit<RunCampaignOptions<TScenario, TArtifact>, 'scenarios' | 'dispatch'>
  readonly prepared: PreparedProfileImprovement<TScenario, TArtifact>
  readonly agent: ImproveSearchOptions<TScenario, TArtifact>['agent']
  readonly executionRunId: ImproveSearchOptions<TScenario, TArtifact>['executionRunId']
  readonly recordCell: ImproveSearchOptions<TScenario, TArtifact>['recordCell']
  readonly scenarios: TScenario[]
  readonly seed: number
  readonly reps: number
  readonly storage: CampaignStorage
  readonly searchDir: string
  readonly evaluationRef: string
  readonly execution: SearchExecutionIdentity
}

/** The executor's cell runner for one search. */
export function searchCellRunner<TScenario extends Scenario, TArtifact>(
  env: SearchCellEnvironment<TScenario, TArtifact>,
): RunAttempt {
  const { campaignOptions, prepared, executionRunId, recordCell, execution } = env
  return async ({ work, lane, context, costLedger: cellLedger, span }) => {
    const nodeProfile = work.artifact.profile
    if (!nodeProfile) throw new Error(`improve(): refused node ${work.nodeId} was given a cell`)
    const profileDigest = canonicalAgentProfileDigest(nodeProfile)
    let fault: unknown
    const campaign = await runCampaign<TScenario, TArtifact>({
      ...campaignOptions,
      // A seat's work leaves no receipt, which the campaign would otherwise report as a stub.
      ...(lane.kind === 'subscription' &&
      (campaignOptions as { expectUsage?: unknown }).expectUsage === undefined
        ? { expectUsage: 'off' as const }
        : {}),
      scenarios: env.scenarios,
      judges: prepared.judges.map((judge) => ({
        ...judge,
        async score(input) {
          try {
            return await judge.score(input)
          } catch (error) {
            if (isSearchEnvironmentFault(error)) fault = error
            throw error
          }
        },
      })),
      seed: env.seed,
      reps: env.reps,
      storage: env.storage,
      runDir: `${env.searchDir}/nodes/${profileDigest.slice('sha256:'.length)}`,
      dispatchRef: `improve:${env.evaluationRef}:${profileDigest}`,
      async dispatch(scenario, ctx) {
        try {
          return await env.agent(nodeProfile, scenario, { ...ctx, search: context })
        } catch (error) {
          if (isSearchEnvironmentFault(error)) fault = error
          throw error
        }
      },
      cellFilter: ({ scenario, rep }) => scenario.id === work.taskId && rep === work.rep,
      resumable: true,
      maxConcurrency: 1,
      costLedger: cellLedger,
      costPhase: `search.${work.stage}`,
      buildTraceWriter: () => ({ span, flush: async () => {} }),
      signal: work.signal,
    })
    const cell = campaign.cells[0]
    if (!cell) throw new Error(`improve(): cell ${work.cellId} produced no campaign cell`)
    const result = campaignCellSearchResult(cell, { execution, lane: lane.name })
    const execRunId = cell.error ? null : (executionRunId?.(cell.artifact) ?? null)
    const settled = faultResult(
      execRunId && context.trace
        ? {
            ...result,
            traceRef: {
              traceId: context.trace.traceId,
              execRunId,
              spansWritten: null,
              spansDropped: null,
            },
          }
        : result,
      fault,
    )
    return recordCell && settled.outcome.status !== 'errored'
      ? {
          ...settled,
          recordCell: (finalResult) => recordCell({ cell, search: context, result: finalResult }),
        }
      : settled
  }
}

/**
 * An environment fault the agent raised settles retryable. The campaign reports every error as
 * final because it applies its own retry policy; here the kernel owns retries.
 */
function faultResult(result: SearchCellResult, fault: unknown): SearchCellResult {
  if (fault === undefined || result.outcome.status !== 'errored') return result
  return {
    ...result,
    outcome: {
      ...result.outcome,
      error: { code: 'environment-fault', message: searchRefusalText(fault), retryable: true },
    },
  }
}
