/**
 * Runtime's decision on a closed search, made from its records alone: the claim
 * the ledger supports, the cost ledger's accounting, the ship rule, and, when
 * the search ships, the profiles-table promotion that cites the claim.
 *
 * `improve()` applies it when a search closes. `decideSearchImprovement`
 * applies it to a closed search's directory, so a search is decided again under
 * the current rule without running or spending anything. The ship rule is not
 * part of a search's identity: the same ledger re-decided after a rule change is
 * the same search.
 */

import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { CostLedgerHandle, PairedPromotionDecision } from '@tangle-network/agent-eval'
import {
  type CampaignStorage,
  createRunCostLedger,
  fsCampaignStorage,
  openSearchLedger,
  type SearchArtifactRef,
  type SearchClaim,
  type SearchClaimVerification,
  type SearchStateView,
  searchClaimDecision,
  verifySearchClaim,
} from '@tangle-network/agent-eval/campaign'
import { type ExperimentSpec, sealExperiment } from '@tangle-network/agent-eval/experiment'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import { immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import type { ImproveCost, SearchPromotion } from './improve-types'

/** What Runtime decided about a closed search. */
export interface SearchShipDecision {
  decision: 'ship' | 'hold'
  /** The claim's reason, the Runtime rule that held a statistical ship, and any
   * cost bound the decision relied on. */
  reason: string
  /** The shipped finalist's test delta against the root, when the claim tested it. */
  lift?: number
  liftInterval?: { low: number; high: number }
  /** Present exactly when `decision` is `ship`: the sealed claim and Eval's
   * paired decision, ready for `SuperviseRegistry.profiles` beside the shipped
   * profile. */
  promotion?: SearchPromotion
}

/**
 * A search's cost as `ImproveCost`: the ledger's summary, plus the bound on the
 * calls whose cost is unknown when each declared a maximum before it ran. Those
 * are calls that failed with no receipt, or that a killed process left pending
 * and a restart settled unknown. Each counts at its maximum, the same bound the
 * ledger enforces its ceiling with.
 */
export function improveSearchCost(ledger: CostLedgerHandle): ImproveCost {
  const summary = ledger.summary()
  const cost: ImproveCost = {
    totalCostUsd: summary.totalCostUsd,
    accountingComplete: summary.accountingComplete,
    incompleteReasons: [...summary.incompleteReasons],
  }
  if (summary.accountingComplete || summary.pendingCalls > 0) return cost
  let unknownCalls = 0
  let unknownMaximumUsd = 0
  for (const receipt of ledger.list()) {
    if (receipt.costUnknown) {
      if (receipt.maximumCostUsd === undefined) return cost
      unknownCalls += 1
      unknownMaximumUsd += receipt.maximumCostUsd
    } else if (
      receipt.usageUnknown ||
      (receipt.maximumCostUsd !== undefined && receipt.costUsd > receipt.maximumCostUsd)
    ) {
      // Unknown usage on a priced call, or a call above its own maximum, is not
      // a bounded unknown: the accounting stays incomplete.
      return cost
    }
  }
  if (unknownCalls === 0) return cost
  return {
    ...cost,
    costBound: {
      unknownCalls,
      unknownMaximumUsd,
      totalMaximumUsd: summary.totalCostUsd + unknownMaximumUsd,
    },
  }
}

/** Runtime's ship rule over the kernel's statistical claim (design §6.5 step 5), shared by
 * `searchMethod` and `runStrategyEvolution`. */
export function runtimeShipDecision(input: {
  claim: SearchClaim
  verified: boolean
  cost: Pick<ImproveCost, 'accountingComplete' | 'costBound'>
  costCeiling: number | undefined
  lowerBound: number | null
  minimumLift: number
}): { decision: 'ship' | 'hold'; reason: string } {
  const { claim, cost, costCeiling } = input
  if (claim.decision !== 'ship') return { decision: 'hold', reason: claim.reason }
  if (!input.verified) {
    return {
      decision: 'hold',
      reason:
        'the claim shipped, but it does not re-derive from the ledger under this rule revision',
    }
  }
  const bound = cost.accountingComplete ? undefined : cost.costBound
  if (!cost.accountingComplete && bound === undefined) {
    return {
      decision: 'hold',
      reason: 'the claim shipped, but the search cost accounting is incomplete',
    }
  }
  if (bound && costCeiling !== undefined && bound.totalMaximumUsd > costCeiling) {
    return {
      decision: 'hold',
      reason: `the claim shipped, but ${bound.unknownCalls} call(s) of unknown cost, counted at their declared maximum, put the search at up to $${dollars(bound.totalMaximumUsd)}, above its $${dollars(costCeiling)} ceiling`,
    }
  }
  if (input.lowerBound === null || !(input.lowerBound > input.minimumLift)) {
    return {
      decision: 'hold',
      reason: `the claim shipped, but its test lower bound ${input.lowerBound} does not exceed minimumLift ${input.minimumLift}`,
    }
  }
  return {
    decision: 'ship',
    reason: bound
      ? `${claim.reason}; ${bound.unknownCalls} call(s) ended with no receipt and count at their declared maximum, $${dollars(bound.unknownMaximumUsd)}, so the search cost at most $${dollars(bound.totalMaximumUsd)}${costCeiling === undefined ? '' : ` of its $${dollars(costCeiling)} ceiling`}`
      : claim.reason,
  }
}

/**
 * Decide a closed search: the ship rule, and the promotion when it ships.
 * `profileOf` returns the exact profile a node holds.
 */
export async function decideClosedSearch(input: {
  state: SearchStateView
  claim: SearchClaim
  claimVerification: SearchClaimVerification
  cost: ImproveCost
  costCeiling: number | undefined
  minimumLift: number
  profileOf: (nodeId: string) => AgentProfile
}): Promise<SearchShipDecision> {
  const { claim, state } = input
  const shipped = claim.finalists.find(
    (finalist) => finalist.nodeId === claim.selected && finalist.test !== null,
  )
  const ruled = runtimeShipDecision({
    claim,
    verified: input.claimVerification.status === 'verified',
    cost: input.cost,
    costCeiling: input.costCeiling,
    lowerBound: shipped?.test?.interval[0] ?? null,
    minimumLift: input.minimumLift,
  })
  const lift = shipped?.test
    ? {
        lift: shipped.test.delta,
        liftInterval: { low: shipped.test.interval[0], high: shipped.test.interval[1] },
      }
    : {}
  if (ruled.decision !== 'ship') return { ...ruled, ...lift }
  const promotion = await searchPromotion(state, claim, input.profileOf)
  if ('refused' in promotion) {
    return { decision: 'hold', reason: `${ruled.reason}; held: ${promotion.refused}`, ...lift }
  }
  return { ...ruled, ...lift, promotion }
}

/**
 * The claim as a profiles-table promotion. The sealed experiment states the
 * claim's design: the root as control and every finalist the claim tested as a
 * treatment, each by its exact profile digest, fixed before any test cell ran.
 * The decision is Eval's paired decision for the selected finalist, made again
 * from the ledger by `searchClaimDecision`. The seal is dated by the search's
 * close, so the same ledger always yields the same promotion.
 */
async function searchPromotion(
  state: SearchStateView,
  claim: SearchClaim,
  profileOf: (nodeId: string) => AgentProfile,
): Promise<SearchPromotion | { refused: string }> {
  const header = state.header
  const closed = state.closed
  const root = state.rootNodeId
  const selected = claim.selected
  if (!header || !closed || root === null || selected === null) {
    return { refused: 'the ledger holds no closed claim with a selected finalist' }
  }
  const decision: PairedPromotionDecision | null = searchClaimDecision(state, selected)
  if (decision === null || decision.promote !== true) {
    return { refused: `Eval's paired decision for ${selected} does not promote` }
  }
  if (!('adequate' in claim.power)) {
    return { refused: 'the claim tested its finalists without a known power' }
  }
  const tested = claim.finalists.filter((finalist) => finalist.test !== null)
  const estimator = claim.power.estimator
  let outcome: ExperimentSpec['outcome']
  if (estimator.kind === 'binary') {
    outcome = { kind: 'binary', pass: `the per-unit test mean equals ${estimator.scale}` }
  } else {
    // A campaign judge's composite is on [0, 1] by convention; a score off that
    // scale has no registered bound, so the claim cannot be stated as a bounded score.
    const scores = [root, ...tested.map((finalist) => finalist.nodeId)].flatMap((nodeId) =>
      state.unitScores(nodeId, 'test').map((unit) => unit.mean),
    )
    if (scores.some((score) => score < 0 || score > 1)) {
      return { refused: "a test score leaves the campaign's [0, 1] score scale" }
    }
    outcome = {
      kind: 'bounded-score',
      min: 0,
      max: 1,
      orientation:
        header.objective.direction === 'maximize' ? 'higher-is-better' : 'lower-is-better',
    }
  }
  const arm = (nodeId: string, role: 'control' | 'treatment') => ({
    id: nodeId,
    role,
    profileDigest: canonicalAgentProfileDigest(profileOf(nodeId)),
    pins: { searchId: state.searchId, nodeId },
  })
  const testUnits = new Set(header.splits.test.tasks.map((task) => task.unitId)).size
  const experiment = await sealExperiment(
    {
      id: `${state.searchId}.claim`,
      claim: header.objective.claim,
      hypothesis: `Each finalist of search ${state.searchId} beats the root on its ${testUnits} sealed test units at confidence ${tested[0]?.test?.confidence ?? claim.confidence}, by Eval's paired decision (${claim.rule.uri} ${claim.rule.revision}); the claim fixed these arms before any test cell ran.`,
      arms: [arm(root, 'control'), ...tested.map((finalist) => arm(finalist.nodeId, 'treatment'))],
      outcome,
      decision: { kind: 'report-only', estimands: [], intervals: [], perRow: [] },
      seed: header.policy.seed,
    },
    { sealedAt: closed.occurredAt },
  )
  return { experiment, decision }
}

export interface DecideSearchImprovementOptions {
  /** The closed search's directory, `<runDir>/search/<searchId>`: its
   * `ledger.jsonl`, `blobs/` and, unless `costLedger` is given, `cost-ledger.jsonl`. */
  searchDir: string
  /** The `minimumLift` the search ran with. Default 0, as in `improve()`. */
  minimumLift?: number
  /** The cost ledger the search recorded into, when `improve()` was given one. */
  costLedger?: CostLedgerHandle
  storage?: CampaignStorage
}

export interface SearchImprovementDecision extends SearchShipDecision {
  searchId: string
  claim: SearchClaim
  claimVerification: SearchClaimVerification
  cost: ImproveCost
  /** The root's exact profile. */
  baseline: AgentProfile
  /** The profile the search keeps: the shipped finalist, else the claim's
   * selection, else the root. */
  candidate: AgentProfile
}

/**
 * Decide a closed search from its directory, under the current ship rule, with
 * no model call: the claim verified from the ledger, the cost from its cost
 * ledger, and the promotion when it ships. Use it to cite a finished search as
 * a registry promotion, or to re-decide one that an earlier rule held.
 */
export async function decideSearchImprovement(
  options: DecideSearchImprovementOptions,
): Promise<SearchImprovementDecision> {
  const storage = options.storage ?? fsCampaignStorage()
  const minimumLift = options.minimumLift ?? 0
  if (!Number.isFinite(minimumLift) || minimumLift < 0) {
    throw new ConfigError(
      'decideSearchImprovement(): minimumLift must be a finite number of at least 0',
    )
  }
  const ledgerPath = join(options.searchDir, 'ledger.jsonl')
  const text = storage.read(ledgerPath)
  if (text === undefined) {
    throw new ConfigError(`decideSearchImprovement(): no search ledger at ${ledgerPath}`)
  }
  const first = text.slice(0, text.indexOf('\n'))
  const searchId = (JSON.parse(first) as { searchId?: unknown }).searchId
  if (typeof searchId !== 'string') {
    throw new ConfigError(`decideSearchImprovement(): ${ledgerPath} names no searchId`)
  }
  const ledger =
    storage.kind === 'filesystem'
      ? openSearchLedger({ path: ledgerPath, searchId })
      : openSearchLedger({ path: ledgerPath, searchId, store: storage })
  const state = await ledger.state()
  const claim = state.closed?.claim
  if (!state.closed || !claim) {
    throw new ConfigError(
      `decideSearchImprovement(): search ${searchId} is ${state.closed ? 'closed without a claim' : 'still open'}`,
    )
  }
  const costLedger =
    options.costLedger ??
    createRunCostLedger({ storage, runDir: options.searchDir, ensureRunDir: false })
  const profileOf = searchProfileReader(state, storage, dirname(ledgerPath))
  const cost = improveSearchCost(costLedger)
  const claimVerification = verifySearchClaim(state)!
  const decided = await decideClosedSearch({
    state,
    claim,
    claimVerification,
    cost,
    costCeiling: state.header?.budget.maxUsd ?? undefined,
    minimumLift,
    profileOf,
  })
  const root = state.rootNodeId!
  return {
    searchId,
    claim,
    claimVerification,
    cost,
    ...decided,
    baseline: profileOf(root),
    candidate: profileOf(claim.selected ?? root),
  }
}

/** Each node's exact profile from the search's blob store, checked against
 * the blob's content address and the node's profile digest. */
function searchProfileReader(
  state: SearchStateView,
  storage: CampaignStorage,
  dir: string,
): (nodeId: string) => AgentProfile {
  const read = new Map<string, AgentProfile>()
  return (nodeId) => {
    const known = read.get(nodeId)
    if (known) return known
    const node = state.node(nodeId)
    if (!node) throw new ConfigError(`decideSearchImprovement(): no node ${nodeId}`)
    const stored = readBlob(storage, dir, node.artifact) as { kind?: unknown; profile?: unknown }
    const parsed = agentProfileSchema.safeParse(stored.profile)
    if (stored.kind !== 'agent-profile' || !parsed.success) {
      throw new ConfigError(`decideSearchImprovement(): node ${nodeId} holds no AgentProfile`)
    }
    const profile = immutableCandidateValue(parsed.data) as AgentProfile
    if (canonicalAgentProfileDigest(profile) !== node.artifactDigest) {
      throw new ConfigError(
        `decideSearchImprovement(): node ${nodeId}'s profile does not match its digest ${node.artifactDigest}`,
      )
    }
    read.set(nodeId, profile)
    return profile
  }
}

/** A blob the search stored, read from the blob directory beside its ledger,
 * whatever directory the ledger was written in, and checked against its digest. */
function readBlob(storage: CampaignStorage, dir: string, ref: SearchArtifactRef): unknown {
  const hex = ref.sha256.slice('sha256:'.length)
  const path = join(dir, 'blobs', `${hex}.json`)
  const text = storage.read(path)
  if (text === undefined) throw new ConfigError(`decideSearchImprovement(): missing blob ${path}`)
  if (createHash('sha256').update(text, 'utf8').digest('hex') !== hex) {
    throw new ConfigError(`decideSearchImprovement(): blob ${path} does not match its digest`)
  }
  return JSON.parse(text)
}

function dollars(value: number): string {
  return value.toFixed(value < 1 ? 4 : 2)
}
