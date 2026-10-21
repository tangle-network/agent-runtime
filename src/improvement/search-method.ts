/**
 * `searchMethod`: Runtime's native profile search on Eval's search kernel
 * (`runSearch`), with no Python bridge.
 *
 * Every node is an exact AgentProfile, content-addressed by
 * `canonicalAgentProfileDigest`, and every edge stores the Interface diffs
 * that turn its parent profile into the child. The policy chooses which node a
 * proposal extends, the allocator where cells go, and the proposer (a
 * `SurfaceProposer`) writes the child surface from the train split only. Each
 * cell is a one-cell `runCampaign` of the materialized profile, so judges,
 * timeouts, traces, the cost ledger and the cell cache behave as in every
 * other campaign. The ledger is the only checkpoint: calling `improve()` again
 * with the same inputs continues an interrupted search, and returns a finished
 * one without running anything.
 *
 * The claim is made once, on the sealed test split, by the kernel. Runtime
 * ships only a claim that shipped, re-derives from the ledger, has complete or
 * bounded cost accounting, and clears `minimumLift` with its test lower bound
 * (`search-decision.ts`).
 */

import type { ProposalFinding } from '@tangle-network/agent-eval'
import {
  aide,
  asha,
  type CampaignStorage,
  createRunCostLedger,
  fsCampaignStorage,
  openSearchLedger,
  type RunCampaignOptions,
  resolveRunDir,
  runSearch,
  type Scenario,
  type SearchAllocator,
  type SearchArtifactCodec,
  type SearchExecutionIdentity,
  type SearchPolicy,
  SearchRecorder,
  type SearchSourceRef,
  type SearchTask,
  type SurfaceProposer,
  searchClaimReserveUsd,
} from '@tangle-network/agent-eval/campaign'
import {
  defineEvaluationClaim,
  type EvaluationClaim,
  summarizeEvaluationUnits,
} from '@tangle-network/agent-eval/experiment'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { canonicalCandidateDigest } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import { privateValuePaths } from './candidate-validation'
import type {
  ImprovementProfileCandidate,
  ImproveSearchMethod,
  ImproveSearchOptions,
  ImproveSearchResult,
} from './improve-types'
import { type PreparedProfileImprovement, prepareProfileImprovement } from './profile-improvement'
import { searchCellRunner } from './search-cell-attempt'
import { decideClosedSearch, improveSearchCost } from './search-decision'
import {
  assertSearchLanes,
  reconcileInterruptedSearchCalls,
  type SearchLane,
  searchExecutor,
} from './search-executor'
import { searchProposerPort } from './search-proposer-port'
import {
  type ProfileNode,
  profileNodeOf,
  registeringProfileCodec,
  type SearchSession,
  searchRefusalText,
} from './search-session'

export interface SearchMethodOptions {
  /** Writes each child surface from the parents the policy chose. It reads the
   * train split only (`ProposeContext.train` and `summary`); `history` is empty. */
  proposer: SurfaceProposer<ProposalFinding>
  /** Proposals the search may make. */
  maxExpansions: number
  /** Which node each proposal extends, and which node the search keeps.
   * Default `aide()`: drafts from the baseline, debugs a node whose cells
   * fail as defects, and otherwise improves a parent drawn by Thompson
   * sampling over each node's posterior, forking from the best node when a
   * lineage stalls. `beam({ width })` expands the top nodes in turn;
   * `incumbent()` is the hill climb, which needs `uniform()`. */
  policy?: SearchPolicy
  /** Where cells go. Default `asha()`: successive halving over one seeded
   * permutation of the selection units. Each node is screened on 6 selection
   * units and 2 train units, and the top third of each rung advances to twice
   * the units. `uniform()` runs every node on every train and selection task.
   * The allocator's `reps` are every split's repeats, the claim's included. */
  allocation?: SearchAllocator
  /** Where cells run: `sharedBoxLane`, `dedicatedLane`, `subscriptionLane`
   * or `routerLane`. Each cell goes to a lane that accepts the node's profile,
   * in proportion to capacity; a hard lane caps each cell's paid calls at its
   * `cellUsd`, and an estimate lane holds `cellUsd` until 20 of its cells
   * settle. The search runs at most the lanes' total capacity at once. */
  lanes: readonly SearchLane[]
  /** Children one proposal asks for. Default 1. */
  childrenPerProposal?: number
  /** Dollars held for the claim from the start. Default: the root and 3
   * finalists on every test task at the largest lane `cellUsd` a cell. */
  claimReserveUsd?: number
  /** ISO time after which the search stops expanding and claims. */
  deadline?: string
  /** Attempts per cell for retryable environment errors. Default 3. */
  maxAttempts?: number
  /** Recorded as the ledger's process name. Default `search`. */
  name?: string
}

/** Build Runtime's native search for `improve(profile, { method })`. */
export function searchMethod(options: SearchMethodOptions): ImproveSearchMethod {
  if (!options || typeof options !== 'object') {
    throw new ConfigError('searchMethod(): options are required')
  }
  const { proposer } = options
  if (!proposer || typeof proposer.kind !== 'string' || typeof proposer.propose !== 'function') {
    throw new ConfigError('searchMethod(): proposer must be a SurfaceProposer')
  }
  const count = (name: string, value: number | undefined, fallback: number, min: number) => {
    const resolved = value ?? fallback
    if (!Number.isSafeInteger(resolved) || resolved < min) {
      throw new ConfigError(`searchMethod(): ${name} must be an integer of at least ${min}`)
    }
    return resolved
  }
  const dollars = (name: string, value: number | undefined): number | null => {
    if (value === undefined) return null
    if (!Number.isFinite(value) || value < 0) {
      throw new ConfigError(`searchMethod(): ${name} must be a finite non-negative number`)
    }
    return value
  }
  if (options.deadline !== undefined && !Number.isFinite(Date.parse(options.deadline))) {
    throw new ConfigError('searchMethod(): deadline must be an ISO time')
  }
  const name = options.name ?? 'search'
  if (!name.trim() || name.trim() !== name) {
    throw new ConfigError('searchMethod(): name must be a trimmed non-empty string')
  }
  assertSearchLanes(options.lanes, 'searchMethod()')
  return Object.freeze({
    kind: 'search' as const,
    name,
    policy: options.policy ?? aide(),
    allocation: options.allocation ?? asha(),
    proposer,
    maxExpansions: count('maxExpansions', options.maxExpansions, Number.NaN, 0),
    childrenPerProposal: count('childrenPerProposal', options.childrenPerProposal, 1, 1),
    lanes: Object.freeze([...options.lanes]),
    claimReserveUsd: dollars('claimReserveUsd', options.claimReserveUsd),
    deadline: options.deadline === undefined ? null : new Date(options.deadline).toISOString(),
    maxAttempts: count('maxAttempts', options.maxAttempts, 3, 1),
  })
}

export function isImproveSearchMethod(value: unknown): value is ImproveSearchMethod {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'search'
  )
}

/**
 * The rules `runSearchImprovement` adds to the kernel's. Its digest is the
 * process revision every searchMethod ledger records. The ship rule is not here:
 * it decides a closed ledger and writes nothing to it, so a changed ship rule
 * re-decides the same search instead of starting another.
 */
const SEARCH_METHOD_DEFINITION = {
  name: 'agent-runtime.search-method.2026-09',
  node: 'an exact AgentProfile materialized from the baseline and one surface, content-addressed by canonicalAgentProfileDigest; a surface that does not materialize is a node addressed by its surface and refused',
  edge: 'the Interface diffs from the parent profile to the child, stored when they reproduce the child digest',
  admission:
    'a candidate is refused when it does not materialize, declares training on a test task, fails the caller validator, carries a credential or private value, or no lane can run its profile',
  cell: 'a one-cell runCampaign of the materialized profile in a directory addressed by its digest, on a lane that accepts the profile; a cached cell is read back, not run again; a finished attempt is recorded by run id before it settles and adopted after a restart',
  lanes:
    'a hard lane refuses a paid call that declares no priced maximum or would take the cell past its cellUsd; an environment fault settles errored and retryable; a subscription seat reports no tokens and charges no dollars',
  proposer:
    'a SurfaceProposer reads the parents, the train view and the train summary; paid calls it makes are its operation accounting',
} as const

const SEARCH_METHOD_SOURCE: SearchSourceRef = {
  uri: 'npm:@tangle-network/agent-runtime#searchMethod',
  revision: canonicalCandidateDigest(SEARCH_METHOD_DEFINITION),
}

export async function runSearchImprovement<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveSearchOptions<TScenario, TArtifact>,
): Promise<ImproveSearchResult> {
  const {
    method,
    claim: inputClaim,
    agent,
    executionRunId,
    recordCell,
    trainScenarios,
    selectionScenarios,
    testScenarios,
    judges: _judges,
    surface: _surface,
    executionRef: _executionRef,
    validateCandidate: _validateCandidate,
    findings: _findings,
    skills: _skills,
    profileComponents: _profileComponents,
    minimumLift: _minimumLift,
    subject: _subject,
    costCeiling,
    costLedger: inputCostLedger,
    seed = 42,
    signal,
    workerSlots,
    budgetPool,
    trace,
    ...campaignOptions
  } = opts
  const splitScenarios = { trainScenarios, selectionScenarios, testScenarios }
  const claim = assertSearchRequest(method, inputClaim, splitScenarios)
  const { allocation, policy, lanes } = method
  const reps = allocation.reps
  const concurrency = lanes.reduce((total, lane) => total + lane.capacity, 0)
  const prepared = prepareProfileImprovement(profile, {
    ...opts,
    seed,
    reps,
    optimizationRunOptions: { reps, maxConcurrency: concurrency },
  })
  const { evaluationRef } = prepared.identity
  const storage: CampaignStorage = campaignOptions.storage ?? fsCampaignStorage()
  const runDir = resolveRunDir(campaignOptions.runDir, campaignOptions.repo)
  const searchKey = canonicalCandidateDigest({
    evaluationRef,
    process: SEARCH_METHOD_SOURCE,
    method: searchMethodDescriptor(method),
  }).slice('sha256:'.length, 'sha256:'.length + 24)
  const searchId = `improve-${searchKey}`
  const searchDir = `${runDir}/search/${searchId}`
  const costLedger =
    inputCostLedger ??
    createRunCostLedger({ storage, runDir: searchDir, costCeilingUsd: costCeiling })
  const execution = searchExecutionIdentity(prepared)
  const recorder = await openSearchRecorder({
    method,
    prepared,
    claim,
    splits: searchSplits(claim, splitScenarios),
    storage,
    searchId,
    searchDir,
    seed,
    costCeiling,
    concurrency,
    execution,
  })
  const session: SearchSession<TScenario, TArtifact> = {
    method,
    prepared,
    storage,
    searchId,
    searchDir,
    costLedger,
    execution,
    recorder,
  }

  const profiles = new Map<string, AgentProfile | null>()
  const codec = registeringProfileCodec(prepared, searchId, profiles)
  for (const node of (await recorder.state()).nodes()) codec.load(recorder, node)
  await reconcileInterruptedSearchCalls(costLedger, searchId, lanes)
  const root = profileNodeOf(prepared, prepared.baselineSurface)
  if (root.profile) {
    const refused = laneRefusal(lanes, root.profile)
    if (refused) throw new ConfigError(`improve(): the baseline profile cannot run: ${refused}`)
  }
  const scenarios = [...trainScenarios, ...selectionScenarios, ...testScenarios]
  assertDistinctScenarios(scenarios)
  const executor = searchExecutor<ProfileNode>({
    lanes,
    profileOf(nodeId) {
      const known = profiles.get(nodeId)
      if (known === undefined) throw new Error(`improve(): node ${nodeId} was placed unregistered`)
      return known
    },
    costLedger,
    identity: execution,
    storage,
    dir: searchDir,
    ...(workerSlots ? { workerSlots } : {}),
    ...(budgetPool ? { budgetPool } : {}),
    ...(trace ? { trace } : {}),
    runAttempt: searchCellRunner<TScenario, TArtifact>({
      campaignOptions: campaignOptions as Omit<
        RunCampaignOptions<TScenario, TArtifact>,
        'scenarios' | 'dispatch'
      >,
      prepared,
      agent,
      executionRunId,
      recordCell,
      scenarios,
      seed,
      reps,
      storage,
      searchDir,
      evaluationRef,
      execution,
    }),
  })

  const startedAt = Date.now()
  const result = await runSearch({
    recorder,
    root,
    codec,
    policy,
    allocation,
    proposer: searchProposerPort(session),
    executor,
    admit: (node) => admissionRefusal(session, node),
    maxExpansions: method.maxExpansions,
    maxAttempts: method.maxAttempts,
    ...(signal ? { signal } : {}),
  })
  return decideSearchResult({ session, codec, result, costCeiling, startedAt })
}

interface OpenSearchRecorderInput<TScenario extends Scenario, TArtifact> {
  method: ImproveSearchMethod
  prepared: PreparedProfileImprovement<TScenario, TArtifact>
  claim: EvaluationClaim
  splits: ReturnType<typeof searchSplits>
  storage: CampaignStorage
  searchId: string
  searchDir: string
  seed: number
  costCeiling: number | undefined
  concurrency: number
  execution: SearchExecutionIdentity
}

/** Open the search's ledger: a fresh search records its opening, an interrupted one continues. */
function openSearchRecorder<TScenario extends Scenario, TArtifact>(
  input: OpenSearchRecorderInput<TScenario, TArtifact>,
): Promise<SearchRecorder> {
  const { method, prepared, claim, splits, storage, searchId, searchDir, seed, costCeiling } = input
  const { policy, allocation, lanes } = method
  const reservedClaimUsd = Math.max(
    method.claimReserveUsd ?? 0,
    searchClaimReserveUsd({
      testTasks: splits.test.length,
      reps: allocation.reps,
      cellUsd: Math.max(...lanes.map((lane) => lane.cellUsd)),
    }),
  )
  return SearchRecorder.open(
    {
      ledger:
        storage.kind === 'filesystem'
          ? openSearchLedger({ path: `${searchDir}/ledger.jsonl`, searchId })
          : openSearchLedger({ path: `${searchDir}/ledger.jsonl`, searchId, store: storage }),
      storage,
    },
    {
      subject: prepared.searchIdentity.subject,
      process: { name: method.name, executionRef: SEARCH_METHOD_SOURCE },
      artifactKind: 'agent-profile',
      objective: {
        metric: 'composite',
        direction: 'maximize',
        judge: prepared.searchIdentity.judge,
        claim,
      },
      splits,
      policy: { expansion: policy.name, allocation: allocation.name, seed },
      budget: {
        maxUsd: costCeiling ?? null,
        maxCells: null,
        maxNodes: 1 + method.maxExpansions * method.childrenPerProposal,
        deadline: method.deadline,
        maxConcurrency: input.concurrency,
        reservedClaimUsd: costCeiling === undefined ? 0 : reservedClaimUsd,
      },
      containment: null,
      derivedFrom: null,
      identity: input.execution,
    },
  )
}

/** The request is a search with a claim that can be powered, and every split has scenarios. */
function assertSearchRequest<TScenario extends Scenario>(
  method: unknown,
  inputClaim: EvaluationClaim,
  splits: Record<'trainScenarios' | 'selectionScenarios' | 'testScenarios', readonly TScenario[]>,
): EvaluationClaim {
  if (!isImproveSearchMethod(method)) {
    throw new ConfigError('improve(): a search needs method: searchMethod(...)')
  }
  const claim = defineEvaluationClaim(inputClaim)
  if (claim.minimumEffect === undefined) {
    throw new ConfigError('improve(): a search claim needs minimumEffect for its power check')
  }
  for (const [name, split] of Object.entries(splits)) {
    if (!Array.isArray(split) || split.length === 0) {
      throw new ConfigError(`improve(): a search needs at least one of ${name}`)
    }
  }
  return claim
}

function assertDistinctScenarios(scenarios: readonly Scenario[]): void {
  const scenarioIds = new Set<string>()
  for (const scenario of scenarios) {
    if (scenarioIds.has(scenario.id)) {
      throw new ConfigError(`improve(): scenario '${scenario.id}' appears in more than one split`)
    }
    scenarioIds.add(scenario.id)
  }
}

/** The search tasks of each split, and whether the test units are held out of development. */
function searchSplits<TScenario extends Scenario>(
  claim: EvaluationClaim,
  scenarios: Record<
    'trainScenarios' | 'selectionScenarios' | 'testScenarios',
    readonly TScenario[]
  >,
) {
  const unitOf = (scenario: TScenario): string =>
    summarizeEvaluationUnits(claim, [scenario]).units[0]!.id
  const tasks = (list: readonly TScenario[]): SearchTask[] =>
    list.map((scenario) => ({
      taskId: scenario.id,
      unitId: unitOf(scenario),
      source: { uri: `scenario://${scenario.id}`, revision: canonicalCandidateDigest(scenario) },
    }))
  const splits = {
    train: tasks(scenarios.trainScenarios),
    selection: tasks(scenarios.selectionScenarios),
    test: tasks(scenarios.testScenarios),
  }
  const developmentUnits = new Set(
    [...splits.train, ...splits.selection].map((task) => task.unitId),
  )
  return {
    ...splits,
    heldOutUnits: splits.test.every((task) => !developmentUnits.has(task.unitId)),
  }
}

function searchExecutionIdentity<TScenario extends Scenario, TArtifact>(
  prepared: PreparedProfileImprovement<TScenario, TArtifact>,
): SearchExecutionIdentity {
  return {
    model: prepared.searchIdentity.model,
    agent: prepared.searchIdentity.agent,
    benchmark: {
      uri: 'agent-runtime:improve-splits',
      revision: canonicalCandidateDigest({
        development: prepared.identity.developmentSplitDigest,
        test: prepared.identity.finalTestSplitDigest,
      }),
    },
  }
}

/** Why no lane can run the profile, or null when one can. */
function laneRefusal(lanes: readonly SearchLane[], nodeProfile: AgentProfile): string | null {
  const refusals = lanes.map((lane) => `${lane.name}: ${lane.refusal(nodeProfile)}`)
  return lanes.some((lane) => lane.refusal(nodeProfile) === undefined)
    ? null
    : `no lane can run the profile (${refusals.join('; ')})`
}

/** Why a node is refused admission to the search, or null when it is admitted. */
function admissionRefusal<TScenario extends Scenario, TArtifact>(
  { prepared, method }: SearchSession<TScenario, TArtifact>,
  node: ProfileNode,
): string | null {
  if (node.refusal !== null || node.profile === null) return node.refusal
  try {
    prepared.admitCandidate(node.profile, node.surface)
  } catch (error) {
    return searchRefusalText(error)
  }
  const paths = privateValuePaths([node.surface])
  if (paths.length > 0) {
    return `the surface carries a credential or private value at ${paths.slice(0, 8).join(', ')}`
  }
  return laneRefusal(method.lanes, node.profile)
}

/** Read the closed search back from its ledger and decide whether its leader ships. */
async function decideSearchResult<TScenario extends Scenario, TArtifact>(input: {
  session: SearchSession<TScenario, TArtifact>
  codec: SearchArtifactCodec<ProfileNode>
  result: Awaited<ReturnType<typeof runSearch<ProfileNode>>>
  costCeiling: number | undefined
  startedAt: number
}): Promise<ImproveSearchResult> {
  const { session, codec, result, costCeiling, startedAt } = input
  const { method, prepared, searchId, costLedger, recorder } = session
  const { state } = result
  const claimResult = result.claim
  if (!claimResult || !result.claimVerification) {
    throw new Error(`improve(): search ${searchId} closed without a claim`)
  }
  const kept = codec.load(recorder, state.node(result.leader)!)
  if (!kept.profile) throw new Error(`improve(): search ${searchId} kept a refused node`)
  const candidate: ImprovementProfileCandidate = Object.freeze({
    surface: prepared.surface,
    value: kept.surface,
    profile: kept.profile,
  })
  const cost = improveSearchCost(costLedger)
  const decided = await decideClosedSearch({
    state,
    claim: claimResult,
    claimVerification: result.claimVerification,
    cost,
    costCeiling,
    minimumLift: prepared.minimumLift,
    profileOf(nodeId) {
      const node = state.node(nodeId)
      const loaded = node ? codec.load(recorder, node) : null
      if (!loaded?.profile)
        throw new Error(`improve(): search ${searchId} node ${nodeId} holds no profile`)
      return loaded.profile
    },
  })
  return {
    mode: 'search',
    method: method.name,
    candidate,
    ...decided,
    claim: claimResult,
    claimVerification: result.claimVerification,
    searchHistory: recorder.receipt({ producerId: method.name, runId: searchId }),
    cost,
    durationMs: Date.now() - startedAt,
    lineage: Object.freeze({
      invocationId: prepared.invocationId,
      runId: searchId,
      developmentSplitDigest: prepared.identity.developmentSplitDigest,
      finalTestSplitDigest: prepared.identity.finalTestSplitDigest,
      scenarioPartitions: prepared.identity.scenarioPartitions,
      executionRef: prepared.executionRef,
      baselineProfileDigest: prepared.baselineProfileDigest,
    }),
    async dispose() {},
  }
}

/** Everything that decides which search a call continues. */
function searchMethodDescriptor(method: ImproveSearchMethod): unknown {
  return {
    name: method.name,
    policy: method.policy.name,
    allocation: method.allocation.name,
    reps: method.allocation.reps,
    proposer: method.proposer.kind,
    maxExpansions: method.maxExpansions,
    childrenPerProposal: method.childrenPerProposal,
    lanes: method.lanes.map(({ name, kind, capacity, costCap, cellUsd }) => ({
      name,
      kind,
      capacity,
      costCap,
      cellUsd,
    })),
    claimReserveUsd: method.claimReserveUsd,
    deadline: method.deadline,
    maxAttempts: method.maxAttempts,
  }
}
