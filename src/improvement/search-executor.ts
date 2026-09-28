/**
 * The search kernel's executor port for cells Runtime runs.
 *
 * A lane is a pool of execution slots with one cost rule: a shared box, dedicated
 * environments, subscription seats, or the router. The kernel places each cell on a lane and
 * bounds each lane's running cells by its capacity. This executor adds what one search cannot
 * see or enforce on its own:
 *
 * - Fleet slots. A `WorkerSlots` allocator shared by concurrent searches bounds working cells
 *   across all of them. A cell waits for a slot, and the wait is its `queueMs`.
 * - Fleet dollars. On a hard lane a cell holds its enforced maximum as a `BudgetPool` ticket
 *   before it starts, waits while open tickets could return enough, and settles the ticket
 *   with its measured spend. Estimate lanes take no ticket: they cannot bound a cell, and an
 *   unknown cost would close a capped pool for every search that shares it.
 * - Hard caps. On a hard lane every paid call of the cell, the agent's and the judges', holds
 *   its maximum against the lane's `cellUsd` and is refused when it would pass it, so the
 *   kernel's hard reservation is a bound and not a hope.
 * - Adoption. A finished attempt is written under its run id before the kernel sees it, so a
 *   kernel that restarts adopts the attempt instead of running it again. The run id is stable
 *   across restarts; an agent that runs remote work keys it by `ctx.search.runId`, so a lost
 *   response is fetched again rather than executed again.
 * - Accounting. Every paid call is tagged with its search and attempt, and an attempt's cost is
 *   every call tagged with its run id, including calls a process that ended made for it. A
 *   reopened search settles those interrupted calls first: from the provider through the lane's
 *   `recoverReceipt`, else with an unknown cost, never as free.
 * - Environment faults. A `SearchEnvironmentFault`, or a platform failure a repeated request
 *   can change, settles `errored` and retryable, and the kernel runs a fresh attempt.
 * - Traces. Each attempt is one trace whose root span carries `agent.branch.id` = the node id.
 *   The spans the attempt's exporter wrote and dropped go into the cell's `traceRef`.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  CostAccountingIncompleteError,
  CostCeilingReachedError,
  type CostLedgerHandle,
  type CostReceiptInput,
  costForTokenPricing,
  costForUsage,
  type MaximumCharge,
  type PaidCallResult,
  type PendingCostCallView,
  type RunPaidCallInput,
  type RunRecord,
} from '@tangle-network/agent-eval'
import {
  type CampaignStorage,
  type SearchLane as KernelSearchLane,
  type SearchAttemptAccounting,
  type SearchCellResult,
  type SearchCellStage,
  type SearchCellWork,
  type SearchExecutionIdentity,
  type SearchExecutor,
  type SearchSplit,
  type SearchTraceRef,
  searchReceiptAccounting,
} from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ATTR, branchSpan } from '@tangle-network/agent-trace-contract'
import { ConfigError } from '../errors'
import {
  createOpenInferenceFileExporter,
  createOtelExporter,
  generateSpanId,
  type OtelExportConfig,
  type OtelExporter,
  type OtelSpan,
  padSpanId,
  padTraceId,
  toOtelAttributes,
} from '../otel-export'
import {
  DEFAULT_SHARED_BOX_WORKERS,
  isTransientSandboxFailure,
  type SharedBoxPlacement,
  type SharedBoxPlacementOptions,
  sharedBoxPlacement,
} from '../runtime/shared-box'
import type { BudgetPool, ReservationTicket } from '../runtime/supervise/budget'
import type { Spend } from '../runtime/supervise/types'
import { openSlotGroup, type SlotGroup, type WorkerSlots } from '../runtime/supervise/worker-slots'

/** What a lane's slots are. */
export type SearchLaneKind = 'shared-box' | 'dedicated' | 'subscription' | 'router'

/** An execution lane: slots that share one cost rule, and the profiles they cannot run. */
export interface SearchLane extends KernelSearchLane {
  readonly name: string
  readonly kind: SearchLaneKind
  readonly capacity: number
  readonly costCap: 'hard' | 'estimate'
  readonly cellUsd: number
  /** Why this lane cannot run `profile`, or undefined when it can. */
  refusal(profile: AgentProfile): string | undefined
  /** The receipt of a paid call that a process which ended made on this lane, asked of the
   *  provider by `call.callId`; null when the provider cannot say. Without it, such a call
   *  settles with an unknown cost. */
  recoverReceipt?(call: PendingCostCallView): Promise<CostReceiptInput | null>
}

/** Options every lane builder takes. */
export interface SearchLaneOptions {
  name?: string
  recoverReceipt?: SearchLane['recoverReceipt']
}

function laneReceipts(options: SearchLaneOptions): Pick<SearchLane, 'recoverReceipt'> {
  return options.recoverReceipt ? { recoverReceipt: options.recoverReceipt } : {}
}

/** A lane of workers packed into shared Sandbox boxes. Close `placement` when the run settles. */
export interface SharedBoxSearchLane extends SearchLane {
  readonly kind: 'shared-box'
  readonly placement: SharedBoxPlacement
}

const acceptEveryProfile = (): undefined => undefined

function laneName(name: string | undefined, fallback: string): string {
  const resolved = name ?? fallback
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(resolved)) {
    throw new ConfigError(`search lane name '${resolved}' must be 1-64 of [A-Za-z0-9._-]`)
  }
  return resolved
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ConfigError(`${name} must be a positive integer`)
  }
  return value
}

function dollars(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigError(`${name} must be a finite non-negative number of dollars`)
  }
  return value
}

/**
 * Cells as workers packed into shared Sandbox boxes, `workersPerBox` to a box.
 *
 * Capacity is `boxes × workersPerBox`. The workers of one box share its router key, which caps
 * no single worker, so the lane holds an estimate (`cellUsd` is the prior until 20 cells settle).
 * A profile the placement refuses (a repository writer, a replaced system prompt, MCP servers,
 * hooks, subagents, tool grants) needs another lane. The agent reaches the box through
 * `lane.placement.providerFor({ nodeId: ctx.search.runId })`, which names the attempt to the
 * router on every call.
 */
export function sharedBoxLane(
  options: SharedBoxPlacementOptions & SearchLaneOptions & { boxes: number; cellUsd: number },
): SharedBoxSearchLane {
  const { name, boxes, cellUsd, recoverReceipt, ...placementOptions } = options
  const placement = sharedBoxPlacement(placementOptions)
  const workersPerBox = placementOptions.workersPerBox ?? DEFAULT_SHARED_BOX_WORKERS
  return Object.freeze({
    name: laneName(name, 'shared-box'),
    kind: 'shared-box' as const,
    capacity: positiveInteger(boxes, 'sharedBoxLane(): boxes') * workersPerBox,
    costCap: 'estimate' as const,
    cellUsd: dollars(cellUsd, 'sharedBoxLane(): cellUsd'),
    refusal: (profile: AgentProfile) => placement.refusal(profile),
    ...laneReceipts({ recoverReceipt }),
    placement,
  })
}

/**
 * Cells that each run in their own environment, `capacity` at once. The lane cannot bound a
 * cell's dollars, so it holds an estimate: `cellUsd` until 20 cells settle, then 1.5 × the p99
 * of its settled cells.
 */
export function dedicatedLane(
  options: SearchLaneOptions & { capacity: number; cellUsd: number },
): SearchLane {
  return Object.freeze({
    name: laneName(options.name, 'dedicated'),
    kind: 'dedicated' as const,
    capacity: positiveInteger(options.capacity, 'dedicatedLane(): capacity'),
    costCap: 'estimate' as const,
    cellUsd: dollars(options.cellUsd, 'dedicatedLane(): cellUsd'),
    refusal: acceptEveryProfile,
    ...laneReceipts(options),
  })
}

/**
 * Cells on subscription seats, one cell a seat. A seat charges no dollar per call, so its own
 * work costs $0 and reports no tokens. `cellUsd` bounds the cell's priced calls, such as its
 * judges; every one of them must declare a maximum, and the lane refuses a call past it.
 */
export function subscriptionLane(
  options: SearchLaneOptions & { seats: number; cellUsd?: number },
): SearchLane {
  return Object.freeze({
    name: laneName(options.name, 'subscription'),
    kind: 'subscription' as const,
    capacity: positiveInteger(options.seats, 'subscriptionLane(): seats'),
    costCap: 'hard' as const,
    cellUsd: dollars(options.cellUsd ?? 0, 'subscriptionLane(): cellUsd'),
    refusal: acceptEveryProfile,
    ...laneReceipts(options),
  })
}

/**
 * Cells whose model calls are priced router calls, `capacity` at once. Every paid call of a
 * cell must declare its maximum charge, and the lane refuses a call that would take the cell
 * past `cellUsd`, so `cellUsd` is each cell's hard maximum.
 */
export function routerLane(
  options: SearchLaneOptions & { capacity: number; cellUsd: number },
): SearchLane {
  return Object.freeze({
    name: laneName(options.name, 'router'),
    kind: 'router' as const,
    capacity: positiveInteger(options.capacity, 'routerLane(): capacity'),
    costCap: 'hard' as const,
    cellUsd: dollars(options.cellUsd, 'routerLane(): cellUsd'),
    refusal: acceptEveryProfile,
    ...laneReceipts(options),
  })
}

/** Check a lane list: at least one lane, unique names, a hard lane's cap known. */
export function assertSearchLanes(lanes: readonly SearchLane[], context: string): void {
  if (!Array.isArray(lanes) || lanes.length === 0) {
    throw new ConfigError(`${context}: lanes needs at least one lane`)
  }
  const names = new Set<string>()
  for (const lane of lanes) {
    if (!lane || typeof lane.refusal !== 'function' || typeof lane.kind !== 'string') {
      throw new ConfigError(
        `${context}: every lane comes from sharedBoxLane, dedicatedLane, subscriptionLane or routerLane`,
      )
    }
    if (names.has(lane.name)) throw new ConfigError(`${context}: lane '${lane.name}' appears twice`)
    names.add(lane.name)
  }
}

/**
 * The environment, not the candidate, ended the attempt: a box that died, a platform that
 * refused the run, a quota. The attempt settles `errored` and retryable, and the kernel runs a
 * fresh attempt up to its `maxAttempts`. Throw anything else for the agent's own failure.
 */
export class SearchEnvironmentFault extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SearchEnvironmentFault'
  }
}

/** Whether an attempt's error is the environment's: a `SearchEnvironmentFault`, or a platform,
 *  gateway or network failure that a repeated request can change. */
export function isSearchEnvironmentFault(error: unknown): boolean {
  return error instanceof SearchEnvironmentFault || isTransientSandboxFailure(error)
}

/** What the agent of one attempt knows about where and as what it runs. */
export interface SearchCellContext {
  readonly searchId: string
  readonly cellId: string
  readonly nodeId: string
  readonly taskId: string
  readonly split: SearchSplit
  readonly stage: SearchCellStage
  readonly attempt: number
  /** `cellId:attempt`. It is the same after a restart, so key remote work by it: a request sent
   *  again with the same run id must return the first execution's result, not start a second. */
  readonly runId: string
  readonly lane: SearchLane
  /** The attempt's trace. Parent your own spans on `spanId`. Null when tracing is off. */
  readonly trace: { readonly traceId: string; readonly spanId: string } | null
}

/** Where a search's cell spans go. Default: one OpenInference file per search when storage is
 *  the filesystem. `otlp` gives each attempt its own exporter, so its counts are exact. */
export type SearchTraceOptions = 'off' | { readonly otlp: OtelExportConfig }

/** One attempt as the executor hands it to the cell runner. */
export interface SearchAttempt<TArtifact> {
  readonly work: SearchCellWork<TArtifact>
  readonly lane: SearchLane
  readonly context: SearchCellContext
  /** The cost ledger the attempt's paid calls go through. It tags each call with the attempt,
   *  and on a hard lane it refuses a call that would take the attempt past the lane's `cellUsd`,
   *  or that declares no priced maximum. */
  readonly costLedger: CostLedgerHandle
  /** Open a span under the attempt's root span; `end` exports it. */
  span(name: string, attributes?: Record<string, unknown>): SearchAttemptSpan
}

export interface SearchAttemptSpan {
  setAttribute(key: string, value: unknown): void
  end(attributes?: Record<string, unknown>): void
}

export interface SearchExecutorOptions<TArtifact> {
  lanes: readonly SearchLane[]
  /** The profile a node runs, read by placement to skip a lane that refuses it. */
  profileOf(nodeId: string): AgentProfile | null
  /** Run one attempt. Report an environment fault as an `errored` retryable outcome; throw only
   *  for a failure that must stop the search. The executor replaces the result's accounting
   *  with the receipts tagged with the attempt's run id. */
  runAttempt(attempt: SearchAttempt<TArtifact>): Promise<
    SearchCellResult & {
      /** Mint from the final attempt accounting before adoption or ledger settlement. */
      recordCell?: (result: SearchCellResult) => RunRecord | Promise<RunRecord>
    }
  >
  /** The search's cost ledger. */
  costLedger: CostLedgerHandle
  /** What the search runs, recorded on an attempt the search's own stop interrupted. */
  identity: SearchExecutionIdentity
  storage: CampaignStorage
  /** The search's directory: attempt records go in `attempts/`, spans in `spans.otlp.jsonl`. */
  dir: string
  /** Bound working cells across every search that shares this allocator. */
  workerSlots?: WorkerSlots
  /** Fleet dollars: a hard-lane cell holds its maximum here before it starts. */
  budgetPool?: BudgetPool
  trace?: SearchTraceOptions
}

const USD_TOLERANCE = 1e-9

/** The kernel's executor port over Runtime lanes. */
export function searchExecutor<TArtifact>(
  options: SearchExecutorOptions<TArtifact>,
): SearchExecutor<TArtifact> {
  assertSearchLanes(options.lanes, 'searchExecutor()')
  const lanes = new Map(options.lanes.map((lane) => [lane.name, lane]))
  const placed = new Map(options.lanes.map((lane) => [lane.name, 0]))
  const slots: SlotGroup | null = options.workerSlots ? openSlotGroup(options.workerSlots) : null
  const attempts = attemptStore(options.storage, join(options.dir, 'attempts'))
  const tracing = searchTracing(options)

  const laneOf = (work: SearchCellWork<TArtifact>): SearchLane => {
    const lane = lanes.get(work.lane)
    if (!lane)
      throw new Error(`search cell ${work.cellId} was placed on unknown lane '${work.lane}'`)
    return lane
  }

  return {
    lanes: () => options.lanes,
    // Weighted round robin: each lane receives cells in proportion to its capacity, first
    // declared first on a tie, skipping lanes that refuse the node's profile.
    place(cell) {
      const profile = options.profileOf(cell.nodeId)
      let chosen: SearchLane | undefined
      for (const lane of options.lanes) {
        if (profile && lane.refusal(profile) !== undefined) continue
        if (
          chosen === undefined ||
          placed.get(lane.name)! / lane.capacity < placed.get(chosen.name)! / chosen.capacity
        ) {
          chosen = lane
        }
      }
      if (!chosen) {
        throw new Error(
          `no search lane can run node ${cell.nodeId}; admission should have refused it`,
        )
      }
      placed.set(chosen.name, placed.get(chosen.name)! + 1)
      return chosen.name
    },
    async adopt(work) {
      return attempts.read(work.runId)
    },
    async run(work) {
      const lane = laneOf(work)
      const queuedAt = Date.now()
      let hold: FleetHold
      try {
        hold = await holdFleet(lane, work, options.budgetPool, slots)
      } catch (error) {
        // The search stopped while the cell waited: the kernel leaves an errored attempt
        // unsettled while it stops, and the next process runs it.
        if (work.signal.aborted) return interrupted(work, lane, options.identity, error)
        throw error
      }
      const queueMs = Date.now() - queuedAt
      const trace = tracing.open(work, lane)
      let result: SearchCellResult | undefined
      try {
        const context: SearchCellContext = Object.freeze({
          searchId: work.searchId,
          cellId: work.cellId,
          nodeId: work.nodeId,
          taskId: work.taskId,
          split: work.split,
          stage: work.stage,
          attempt: work.attempt,
          runId: work.runId,
          lane,
          trace: trace.ids,
        })
        const tags = searchCallTags(work.searchId, { run: work.runId, lane: lane.name })
        const { recordCell, ...measured } = await options.runAttempt({
          work,
          lane,
          context,
          costLedger: attemptLedger(options.costLedger, lane, tags),
          span: trace.span,
        })
        const traceRef = await trace.finish(measured)
        const execRunId =
          measured.traceRef && 'execRunId' in measured.traceRef ? measured.traceRef.execRunId : null
        result = {
          ...measured,
          accounting: attemptAccounting(options.costLedger, lane, tags),
          queueMs,
          placement: { lane: lane.name, boxId: measured.placement?.boxId ?? null },
          traceRef: execRunId && 'traceId' in traceRef ? { ...traceRef, execRunId } : traceRef,
        }
        if (!work.signal.aborted && recordCell && result.outcome.status !== 'errored') {
          result.runRecord = await recordCell(result)
        }
      } finally {
        hold.release(result)
      }
      // An attempt interrupted by the search stopping is not recorded: the next process runs
      // the same attempt again instead of adopting an interruption as the attempt's result.
      if (!work.signal.aborted) attempts.write(work.runId, result)
      return result
    },
  }
}

function interrupted(
  work: SearchCellWork<unknown>,
  lane: SearchLane,
  identity: SearchExecutionIdentity,
  error: unknown,
): SearchCellResult {
  return {
    outcome: {
      status: 'errored',
      metrics: {},
      error: {
        code: 'interrupted',
        message: `search cell ${work.runId} was interrupted before it ran: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      },
    },
    accounting: {
      tokens: { status: 'known', inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
      cost: { status: 'known', usd: 0, source: 'free' },
    },
    identity,
    placement: { lane: lane.name, boxId: null },
    traceRef: { unknown: 'the attempt never started' },
  }
}

interface FleetHold {
  release(result: SearchCellResult | undefined): void
}

/** Take the attempt's fleet dollars, then its fleet slot. A cell waiting for budget holds no
 *  slot, so it cannot hold a slot the cells it waits on need. */
async function holdFleet(
  lane: SearchLane,
  work: SearchCellWork<unknown>,
  pool: BudgetPool | undefined,
  slots: SlotGroup | null,
): Promise<FleetHold> {
  let ticket: ReservationTicket | undefined
  if (pool && lane.costCap === 'hard' && lane.cellUsd > 0) {
    const reserved = pool.reserve(
      { maxUsd: lane.cellUsd, maxTokens: 0, maxIterations: 0 },
      { label: work.runId, stage: 'admitted' },
      { wait: true },
    )
    if (!reserved.ok) {
      throw new Error(
        `the fleet budget pool refused search cell ${work.runId} on lane ${lane.name}: ${reserved.reason}`,
      )
    }
    ticket = reserved.ticket
    if (reserved.granted) {
      try {
        await abortable(reserved.granted, work.signal)
      } catch (error) {
        pool.reconcile(ticket, noSpend())
        throw error
      }
    }
    pool.attribute(ticket, { label: work.runId, stage: 'executing' })
  }
  const permit = slots?.acquire(0)
  if (permit) {
    try {
      await abortable(permit.ready, work.signal)
    } catch (error) {
      permit.release()
      if (ticket) pool!.reconcile(ticket, noSpend())
      throw error
    }
  }
  return {
    release(result) {
      permit?.release()
      if (!ticket) return
      try {
        pool!.reconcile(ticket, result ? spendOf(result) : unknownSpend())
      } catch {
        // The pool has committed the spend and, for an unknown dollar cost under its cap,
        // closed dollar admission; its next reservation refuses and stops the searches that
        // share it. The cell's own result stands.
      }
    },
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('search cell aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('search cell aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function noSpend(): Spend {
  return { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
}

function unknownSpend(): Spend {
  return { ...noSpend(), usdKnown: false, tokensKnown: false }
}

/** The attempt's spend as the budget pool reads it. Unknown dollars carry their proven floor. */
function spendOf(result: SearchCellResult): Spend {
  const { cost, tokens } = result.accounting
  return {
    iterations: 0,
    tokens:
      tokens.status === 'known'
        ? { input: tokens.inputTokens, output: tokens.outputTokens }
        : { input: 0, output: 0 },
    ...(tokens.status === 'known' ? {} : { tokensKnown: false }),
    usd: cost.status === 'known' ? cost.usd : cost.knownLowerBoundUsd,
    ...(cost.status === 'known' ? {} : { usdKnown: false }),
    ms: result.wallMs ?? 0,
  }
}

/** The dollar maximum a paid call declares, or null when it declares no priced one. */
function chargeMaximumUsd(maximum: MaximumCharge | undefined): number | null {
  if (!maximum) return null
  if ('externallyEnforcedMaximumUsd' in maximum) return maximum.externallyEnforcedMaximumUsd
  if ('customTokenPricing' in maximum)
    return costForTokenPricing(maximum.customTokenPricing, maximum)
  const priced = costForUsage(maximum.model, maximum)
  return priced.costUnknown ? null : priced.costUsd
}

const TAG_SEARCH = 'searchId'
const TAG_RUN = 'searchRunId'
const TAG_LANE = 'searchLane'
const TAG_OPERATION = 'searchOperation'

/** The cost-ledger tags of one search's calls: a cell attempt's, or a proposal operation's. */
export function searchCallTags(
  searchId: string,
  of: { run: string; lane: string } | { operation: string },
): Record<string, string> {
  return 'run' in of
    ? { [TAG_SEARCH]: searchId, [TAG_RUN]: of.run, [TAG_LANE]: of.lane }
    : { [TAG_SEARCH]: searchId, [TAG_OPERATION]: of.operation }
}

/** The search ledger with `tags` added to every paid call. */
export function taggedLedger(
  ledger: CostLedgerHandle,
  tags: Record<string, string>,
): CostLedgerHandle {
  return ledgerView(ledger, (input) =>
    ledger.runPaidCall({ ...input, tags: { ...input.tags, ...tags } }),
  )
}

function ledgerView(
  ledger: CostLedgerHandle,
  runPaidCall: CostLedgerHandle['runPaidCall'],
): CostLedgerHandle {
  return new Proxy(ledger, {
    get(target, property) {
      if (property === 'runPaidCall') return runPaidCall
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * The search ledger seen by one attempt: every paid call carries the attempt's tags. On a hard
 * lane every call also holds its declared maximum against the lane's `cellUsd` until its
 * receipt replaces the hold with the charge, and a call that would pass the cap, or declares no
 * priced maximum, is refused. A charge the provider left unknown keeps its maximum held.
 */
function attemptLedger(
  ledger: CostLedgerHandle,
  lane: SearchLane,
  tags: Record<string, string>,
): CostLedgerHandle {
  const tagged = taggedLedger(ledger, tags)
  if (lane.costCap !== 'hard') return tagged
  let heldUsd = 0
  const runPaidCall = async <T>(input: RunPaidCallInput<T>): Promise<PaidCallResult<T>> => {
    const maximumUsd = chargeMaximumUsd(input.maximumCharge)
    if (maximumUsd === null) {
      return {
        succeeded: false,
        error: new CostAccountingIncompleteError(
          `lane ${lane.name} caps each cell at $${lane.cellUsd}, so paid call '${input.actor}' during '${input.phase}' needs a priced maximumCharge`,
        ),
      }
    }
    if (heldUsd + maximumUsd > lane.cellUsd + USD_TOLERANCE) {
      return {
        succeeded: false,
        error: new CostCeilingReachedError(
          lane.cellUsd,
          heldUsd,
          maximumUsd,
          input.phase,
          input.actor,
        ),
      }
    }
    heldUsd += maximumUsd
    const result = await tagged.runPaidCall(input)
    const { receipt } = result
    if (receipt && !receipt.costUnknown) heldUsd += receipt.costUsd - maximumUsd
    return result
  }
  return ledgerView(tagged, runPaidCall)
}

/**
 * An attempt's cost is every call tagged with its run id, a call a process that ended made for
 * it included; a call still pending makes the cost unknown with the settled calls as its floor.
 * A subscription seat reports no tokens, and its own work charges no dollar.
 */
function attemptAccounting(
  ledger: CostLedgerHandle,
  lane: SearchLane,
  tags: Record<string, string>,
): SearchAttemptAccounting {
  const receipts = ledger.list({ tags })
  const accounting = searchReceiptAccounting(receipts)
  const pending = ledger.listPending?.({ tags }) ?? []
  const floorUsd =
    accounting.cost.status === 'known' ? accounting.cost.usd : accounting.cost.knownLowerBoundUsd
  const cost: SearchAttemptAccounting['cost'] =
    pending.length > 0
      ? {
          status: 'unknown',
          knownLowerBoundUsd: floorUsd,
          reason: `${pending.length} paid call(s) of the attempt had no receipt when it ended`,
        }
      : accounting.cost.status === 'known' &&
          accounting.cost.usd > 0 &&
          receipts.some((receipt) => receipt.actualCostUsd === undefined)
        ? { ...accounting.cost, source: 'pricing-table' }
        : accounting.cost
  return {
    tokens:
      lane.kind === 'subscription'
        ? { status: 'unknown', reason: 'a subscription seat reports no token usage' }
        : accounting.tokens,
    cost,
  }
}

/**
 * Settle every paid call of `searchId` that a process which ended left pending, before the
 * reopened search makes a new one: a capped ledger refuses new paid work while one is
 * unresolved. A cell's call is asked of its lane's provider through `recoverReceipt`; any other
 * call, or one the provider cannot answer, settles failed with an unknown cost.
 */
export async function reconcileInterruptedSearchCalls(
  ledger: CostLedgerHandle,
  searchId: string,
  lanes: readonly SearchLane[],
): Promise<{ recovered: number; unknown: number }> {
  const interrupted = (ledger.listPending?.({ tags: { [TAG_SEARCH]: searchId } }) ?? []).filter(
    (call) => call.state === 'interrupted',
  )
  let recovered = 0
  for (const call of interrupted) {
    const lane = lanes.find((candidate) => candidate.name === call.tags?.[TAG_LANE])
    const receipt = (await lane?.recoverReceipt?.(call)) ?? null
    if (receipt) {
      ledger.reconcile(call.callId, receipt)
      recovered += 1
    } else {
      ledger.reconcile(
        call.callId,
        {
          model: call.model,
          inputTokens: 0,
          outputTokens: 0,
          costUnknown: true,
          usageUnknown: true,
        },
        { error: 'the process that made this call ended before its receipt' },
      )
    }
  }
  return { recovered, unknown: interrupted.length - recovered }
}

/** Finished attempts by run id: the record a restarted kernel adopts. */
function attemptStore(storage: CampaignStorage, dir: string) {
  const pathOf = (runId: string) => join(dir, `${runId.replace(/[^A-Za-z0-9_-]/gu, '.')}.json`)
  storage.ensureDir(dir)
  return {
    read(runId: string): SearchCellResult | null {
      const text = storage.read(pathOf(runId))
      if (text === undefined) return null
      const record = JSON.parse(text) as { runId?: unknown; result?: SearchCellResult }
      if (record.runId !== runId || !record.result) {
        throw new Error(`attempt record ${pathOf(runId)} does not hold run ${runId}`)
      }
      return record.result
    },
    write(runId: string, result: SearchCellResult): void {
      const text = `${JSON.stringify({ runId, result })}\n`
      const path = pathOf(runId)
      if (storage.kind !== 'filesystem') {
        storage.write(path, text)
        return
      }
      // Written whole under a temporary name and renamed, so a killed process leaves the record
      // absent or complete. It is not synced: a record lost to an operating-system crash costs a
      // rerun of the same run id, which a remote worker keyed by run id answers without executing.
      mkdirSync(dirname(path), { recursive: true })
      const temporary = `${path}.${process.pid}.tmp`
      writeFileSync(temporary, text)
      renameSync(temporary, path)
    },
  }
}

interface AttemptTrace {
  readonly ids: { readonly traceId: string; readonly spanId: string } | null
  span(name: string, attributes?: Record<string, unknown>): SearchAttemptSpan
  finish(result: SearchCellResult): Promise<SearchTraceRef>
}

const STATUS_OK = 1
const STATUS_ERROR = 2
const MAX_ATTRIBUTE_CHARS = 256

function searchTracing<TArtifact>(options: SearchExecutorOptions<TArtifact>) {
  const mode = options.trace
  const fileExporter =
    mode === undefined && options.storage.kind === 'filesystem'
      ? createOpenInferenceFileExporter(join(options.dir, 'spans.otlp.jsonl'))
      : undefined
  const off = (reason: string): AttemptTrace => ({
    ids: null,
    span: () => ({ setAttribute() {}, end() {} }),
    finish: async () => ({ unknown: reason }),
  })
  return {
    open(work: SearchCellWork<TArtifact>, lane: SearchLane): AttemptTrace {
      if (mode === 'off') return off('tracing is off for this search')
      const exporter = mode === undefined ? fileExporter : createOtelExporter(mode.otlp)
      if (!exporter) {
        return off(
          mode === undefined
            ? 'the search storage is not the filesystem and no OTLP exporter was configured'
            : 'the OTLP exporter has no endpoint',
        )
      }
      return attemptTrace(work, lane, exporter, mode !== undefined)
    },
  }
}

/**
 * One attempt's trace. Its ids derive from the run id, so an attempt run again after a restart
 * writes into the same trace. A shared file exporter writes each span synchronously, so the
 * attempt's written and dropped counts are the change in the exporter's own counts across each
 * of its spans; an attempt's own OTLP exporter is shut down at the end and read whole.
 */
function attemptTrace(
  work: SearchCellWork<unknown>,
  lane: SearchLane,
  exporter: OtelExporter,
  ownsExporter: boolean,
): AttemptTrace {
  const traceId = padTraceId(`search-cell:${work.runId}`)
  const rootSpanId = padSpanId(`search-cell:${work.runId}`)
  const startMs = Date.now()
  let written = 0
  let dropped = 0
  const exportCounted = (span: OtelSpan) => {
    if (ownsExporter) {
      exporter.exportSpan(span)
      return
    }
    const before = exporter.stats()
    exporter.exportSpan(span)
    const after = exporter.stats()
    written += after.written - before.written
    dropped += after.dropped - before.dropped
  }
  return {
    ids: { traceId, spanId: rootSpanId },
    span(name, attributes = {}) {
      const opened = Date.now()
      const record: Record<string, unknown> = { ...attributes }
      let ended = false
      return {
        setAttribute(key, value) {
          record[key] = value
        },
        end(endAttributes = {}) {
          if (ended) return
          ended = true
          exportCounted(
            otelSpan({
              traceId,
              spanId: generateSpanId(),
              parentSpanId: rootSpanId,
              name,
              startMs: opened,
              endMs: Date.now(),
              attributes: { ...record, ...endAttributes },
              status: STATUS_OK,
            }),
          )
        },
      }
    },
    async finish(result) {
      const root = branchSpan({
        traceId,
        spanId: rootSpanId,
        name: 'search.cell',
        startTime: new Date(startMs).toISOString(),
        branchId: work.nodeId,
        arm: lane.name,
        attributes: {
          'tangle.search.id': work.searchId,
          'tangle.search.cell_id': work.cellId,
          'tangle.search.run_id': work.runId,
          'tangle.search.task_id': work.taskId,
          'tangle.search.split': work.split,
          'tangle.search.stage': work.stage,
          'tangle.search.attempt': work.attempt,
          'tangle.search.lane': lane.name,
          'tangle.search.lane_kind': lane.kind,
          'tangle.search.outcome': result.outcome.status,
          ...('score' in result.outcome ? { [ATTR.score]: result.outcome.score } : {}),
        },
      })
      exportCounted(
        otelSpan({
          traceId,
          spanId: rootSpanId,
          name: root.name,
          startMs,
          endMs: Date.now(),
          attributes: root.attributes,
          status: result.outcome.status === 'errored' ? STATUS_ERROR : STATUS_OK,
        }),
      )
      if (ownsExporter) {
        await exporter.shutdown()
        const stats = exporter.stats()
        written = stats.written
        dropped = stats.dropped
      }
      return { traceId, execRunId: null, spansWritten: written, spansDropped: dropped }
    },
  }
}

function otelSpan(input: {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startMs: number
  endMs: number
  attributes: Record<string, unknown>
  status: number
}): OtelSpan {
  const attributes: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(input.attributes)) {
    if (typeof value === 'number' || typeof value === 'boolean') attributes[key] = value
    else if (typeof value === 'string') attributes[key] = value.slice(0, MAX_ATTRIBUTE_CHARS)
  }
  return {
    traceId: input.traceId,
    spanId: input.spanId,
    ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
    name: input.name,
    kind: 1,
    startTimeUnixNano: (BigInt(Math.floor(input.startMs)) * 1_000_000n).toString(),
    endTimeUnixNano: (
      BigInt(Math.floor(Math.max(input.startMs, input.endMs))) * 1_000_000n
    ).toString(),
    attributes: toOtelAttributes(attributes),
    status: { code: input.status },
  }
}
