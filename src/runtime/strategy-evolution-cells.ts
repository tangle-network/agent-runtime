/**
 * The cell executor of a strategy search: each cell is one `runAgentic` run of one strategy
 * on one task, metered as one paid call on the attempt's cost ledger, with the environment's
 * own faults separated from a strategy that threw.
 */

import type { CostLedgerHandle } from '@tangle-network/agent-eval'
import {
  createRunCostLedger,
  fsCampaignStorage,
  type SearchAttemptAccounting,
  type SearchCellResult,
  type SearchCellWork,
  type SearchExecutor,
  type SearchLane,
} from '@tangle-network/agent-eval/campaign'
import { redact } from '@tangle-network/agent-eval/traces'
import {
  dedicatedLane,
  reconcileInterruptedSearchCalls,
  searchExecutor,
} from '../improvement/search-executor'
import type { Environment } from './run-benchmark'
import { runAgentic } from './strategy'
import type { Strategy } from './strategy-author'
import type { StrategyEvolutionConfig } from './strategy-evolution'
import type { EvolutionPlan } from './strategy-evolution-plan'
/** A search node: the caller's root, or an authored module and why admission refused it. */
export type StrategyNode =
  | { kind: 'root'; name: string }
  | { kind: 'authored'; name: string | null; code: string; refusal: string | null }

/**
 * Cells run in this process on one dedicated lane of Runtime's search executor, which
 * records each finished attempt under its run id (a restarted search adopts it instead of
 * running it again), meters it through the search's cost ledger, and traces it.
 */
export async function openStrategyCellExecutor(
  cfg: StrategyEvolutionConfig,
  plan: EvolutionPlan,
  strategyOf: (node: StrategyNode) => Promise<Strategy>,
): Promise<SearchExecutor<StrategyNode>> {
  const storage = fsCampaignStorage()
  const costLedger = createRunCostLedger({ storage, runDir: plan.searchDir })
  const lanes = [
    dedicatedLane({ name: 'in-process', capacity: plan.concurrency, cellUsd: plan.cellUsd }),
  ]
  await reconcileInterruptedSearchCalls(costLedger, plan.searchId, lanes)
  return searchExecutor<StrategyNode>({
    lanes,
    profileOf: () => cfg.worker.workerProfile,
    costLedger,
    identity: plan.execution,
    storage,
    dir: plan.searchDir,
    ...(cfg.workerSlots ? { workerSlots: cfg.workerSlots } : {}),
    runAttempt: ({ work, lane, costLedger: cellLedger }) =>
      runStrategyCell(cfg, plan, { work, lane, costLedger: cellLedger }, strategyOf),
  })
}

async function runStrategyCell(
  cfg: StrategyEvolutionConfig,
  plan: EvolutionPlan,
  attempt: {
    work: SearchCellWork<StrategyNode>
    lane: SearchLane
    costLedger: CostLedgerHandle
  },
  strategyOf: (node: StrategyNode) => Promise<Strategy>,
): Promise<SearchCellResult> {
  const { work, lane, costLedger: cellLedger } = attempt
  const { workerModel } = plan
  if (work.artifact.kind === 'authored' && work.artifact.refusal !== null) {
    throw new Error(`evolution: refused node ${work.nodeId} was given a cell`)
  }
  const strategy = await strategyOf(work.artifact)
  const task = plan.taskById.get(work.taskId)
  if (!task) throw new Error(`evolution: cell ${work.cellId} names unknown task ${work.taskId}`)
  const faults: string[] = []
  const environment = faultRecording(cfg.environment, faults)
  // The whole run is one paid call on the attempt's ledger, so its measured spend is the
  // attempt's accounting, and a run a killed process left pending settles as unknown.
  const paid = await cellLedger.runPaidCall({
    channel: 'agent',
    phase: `search.${work.stage}`,
    actor: `strategy:${strategy.name}`,
    model: workerModel,
    signal: work.signal,
    execute: () =>
      runAgentic({
        ...cfg.worker,
        surface: environment,
        task,
        strategy,
        budget: plan.budget,
        ...(cfg.hooks ? { hooks: cfg.hooks } : {}),
      }),
    receipt: (run) => ({
      model: workerModel,
      inputTokens: run.tokens.input,
      outputTokens: run.tokens.output,
      ...(run.usdKnown ? { actualCostUsd: run.usd } : { costUnknown: true }),
      ...(run.tokensKnown ? {} : { usageUnknown: true }),
    }),
    receiptFromError: () => ({
      model: workerModel,
      inputTokens: 0,
      outputTokens: 0,
      costUnknown: true,
      usageUnknown: true,
    }),
  })
  const settled = {
    identity: plan.execution,
    placement: { lane: lane.name, boxId: null },
    // The executor replaces this with the receipts the ledger holds for the attempt.
    accounting: unknownAccounting('replaced by the attempt receipts'),
    ...(paid.succeeded ? { wallMs: paid.value.ms } : {}),
  }
  if (faults.length > 0) return { ...settled, ...environmentFault(faults) }
  if (!paid.succeeded) {
    return {
      ...settled,
      outcome: {
        status: 'failed',
        score: 0,
        metrics: {},
        failure: { code: 'strategy-threw', message: shareText(paid.error) },
      },
    }
  }
  const run = paid.value
  return {
    ...settled,
    outcome: {
      status: 'passed',
      score: run.score,
      metrics: { resolved: run.resolved ? 1 : 0, shots: run.shots },
    },
  }
}

/** The environment as one attempt sees it, recording each throw from `open`, `tools`,
 * `score` or `close`: those are the environment's faults. A `call` that throws is a tool
 * error the agent's loop handles. */
function faultRecording(environment: Environment, faults: string[]): Environment {
  const recorded =
    <A extends unknown[], R>(name: string, method: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await method(...args)
      } catch (error) {
        faults.push(`${name}: ${shareText(error)}`)
        throw error
      }
    }
  return {
    name: environment.name,
    open: recorded('open', (task) => environment.open(task)),
    tools: recorded('tools', (task, handle) => environment.tools(task, handle)),
    call: (handle, name, args) => environment.call(handle, name, args),
    score: recorded('score', (task, handle) => environment.score(task, handle)),
    close: recorded('close', (handle) => environment.close(handle)),
  }
}

function environmentFault(faults: string[]): Pick<SearchCellResult, 'outcome'> {
  return {
    outcome: {
      status: 'errored',
      metrics: {},
      error: { code: 'environment-fault', message: faults[0]!, retryable: true },
    },
  }
}

function unknownAccounting(reason: string): SearchAttemptAccounting {
  return {
    tokens: { status: 'unknown', reason },
    cost: { status: 'unknown', knownLowerBoundUsd: 0, reason },
  }
}

/** Free text as the ledger stores it: redacted with the share profile and bounded. */
export function shareText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return redact(text, { profile: 'share' }).value.slice(0, 300)
}
