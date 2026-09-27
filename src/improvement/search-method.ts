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
 * ships only a claim that shipped, re-derives from the ledger, has complete
 * cost accounting, and clears `minimumLift` with its test lower bound.
 */

import type { ProposalFinding } from '@tangle-network/agent-eval'
import {
  aide,
  asha,
  type CampaignStorage,
  campaignCellSearchResult,
  createRunCostLedger,
  fsCampaignStorage,
  isProposedCandidate,
  type MutableSurface,
  openSearchLedger,
  type ProposeContext,
  type RunCampaignOptions,
  renderSearchSummary,
  resolveRunDir,
  runCampaign,
  runSearch,
  type Scenario,
  type SearchAllocator,
  type SearchArtifactCodec,
  type SearchArtifactRef,
  type SearchCellResult,
  type SearchClaim,
  type SearchExecutionIdentity,
  type SearchPolicy,
  type SearchProposerPort,
  SearchRecorder,
  type SearchSourceRef,
  type SearchTask,
  type SearchTaskOutcome,
  type SearchUnknown,
  type SurfaceProposer,
  searchClaimReserveUsd,
  searchNodeId,
  searchProposalExecution,
  searchProposerView,
  searchReceiptAccounting,
} from '@tangle-network/agent-eval/campaign'
import {
  defineEvaluationClaim,
  summarizeEvaluationUnits,
} from '@tangle-network/agent-eval/experiment'
import { redact } from '@tangle-network/agent-eval/traces'
import {
  type AgentProfile,
  type AgentProfileDiff,
  agentProfileSchema,
  applyAgentProfileDiff,
  canonicalAgentProfileDigest,
  diffAgentProfiles,
} from '@tangle-network/agent-interface'
import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import { privateValuePaths } from './candidate-validation'
import { copyImproveCost } from './improve-result'
import type {
  ImprovementProfileCandidate,
  ImproveSearchMethod,
  ImproveSearchOptions,
  ImproveSearchResult,
} from './improve-types'
import { type PreparedProfileImprovement, prepareProfileImprovement } from './profile-improvement'
import {
  assertSearchLanes,
  isSearchEnvironmentFault,
  type SearchLane,
  searchExecutor,
} from './search-executor'

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
 * process revision every searchMethod ledger records.
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
  ship: 'the claim shipped, re-derives from the ledger, cost accounting is complete, and the shipped finalist test lower bound exceeds minimumLift',
} as const

const SEARCH_METHOD_SOURCE: SearchSourceRef = {
  uri: 'npm:@tangle-network/agent-runtime#searchMethod',
  revision: canonicalCandidateDigest(SEARCH_METHOD_DEFINITION),
}

/** A search node: the surface a proposer wrote, and the exact profile it
 * materializes to, or why it does not. */
interface ProfileNode {
  surface: MutableSurface
  profile: AgentProfile | null
  refusal: string | null
}

export async function runSearchImprovement<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveSearchOptions<TScenario, TArtifact>,
): Promise<ImproveSearchResult> {
  const {
    method,
    claim: inputClaim,
    agent,
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
  if (!isImproveSearchMethod(method)) {
    throw new ConfigError('improve(): a search needs method: searchMethod(...)')
  }
  const claim = defineEvaluationClaim(inputClaim)
  if (claim.minimumEffect === undefined) {
    throw new ConfigError('improve(): a search claim needs minimumEffect for its power check')
  }
  for (const [name, split] of [
    ['trainScenarios', trainScenarios],
    ['selectionScenarios', selectionScenarios],
    ['testScenarios', testScenarios],
  ] as const) {
    if (!Array.isArray(split) || split.length === 0) {
      throw new ConfigError(`improve(): a search needs at least one of ${name}`)
    }
  }
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

  const unitOf = (scenario: TScenario): string =>
    summarizeEvaluationUnits(claim, [scenario]).units[0]!.id
  const tasks = (scenarios: readonly TScenario[]): SearchTask[] =>
    scenarios.map((scenario) => ({
      taskId: scenario.id,
      unitId: unitOf(scenario),
      source: { uri: `scenario://${scenario.id}`, revision: canonicalCandidateDigest(scenario) },
    }))
  const splits = {
    train: tasks(trainScenarios),
    selection: tasks(selectionScenarios),
    test: tasks(testScenarios),
  }
  const developmentUnits = new Set(
    [...splits.train, ...splits.selection].map((task) => task.unitId),
  )
  const execution: SearchExecutionIdentity = {
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
  const reservedClaimUsd = Math.max(
    method.claimReserveUsd ?? 0,
    searchClaimReserveUsd({
      testTasks: splits.test.length,
      reps,
      cellUsd: Math.max(...lanes.map((lane) => lane.cellUsd)),
    }),
  )
  const recorder = await SearchRecorder.open(
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
      splits: {
        ...splits,
        heldOutUnits: splits.test.every((task) => !developmentUnits.has(task.unitId)),
      },
      policy: { expansion: policy.name, allocation: allocation.name, seed },
      budget: {
        maxUsd: costCeiling ?? null,
        maxCells: null,
        maxNodes: 1 + method.maxExpansions * method.childrenPerProposal,
        deadline: method.deadline,
        maxConcurrency: concurrency,
        reservedClaimUsd: costCeiling === undefined ? 0 : reservedClaimUsd,
      },
      containment: null,
      derivedFrom: null,
      identity: execution,
    },
  )

  const nodeOf = (candidateSurface: MutableSurface): ProfileNode => {
    const surface = immutableCandidateValue(candidateSurface)
    try {
      return { surface, profile: prepared.materializeCandidate(surface), refusal: null }
    } catch (error) {
      return { surface, profile: null, refusal: refusalText(error) }
    }
  }
  // Placement reads each node's profile to skip the lanes that refuse it, so every node the
  // ledger holds, and every node this process registers, is known before its cells are placed.
  const profiles = new Map<string, AgentProfile | null>()
  const profiled = profileCodec(prepared)
  const codec: SearchArtifactCodec<ProfileNode> = {
    node(recorder, node) {
      const registered = profiled.node(recorder, node)
      profiles.set(searchNodeId(searchId, registered.artifactDigest), node.profile)
      return registered
    },
    diff: profiled.diff,
    load(recorder, node) {
      const loaded = profiled.load(recorder, node)
      profiles.set(node.nodeId, loaded.profile)
      return loaded
    },
  }
  for (const node of (await recorder.state()).nodes()) codec.load(recorder, node)
  const laneRefusal = (nodeProfile: AgentProfile): string | null => {
    const refusals = lanes.map((lane) => `${lane.name}: ${lane.refusal(nodeProfile)}`)
    return lanes.some((lane) => lane.refusal(nodeProfile) === undefined)
      ? null
      : `no lane can run the profile (${refusals.join('; ')})`
  }
  const root = nodeOf(prepared.baselineSurface)
  if (root.profile) {
    const refused = laneRefusal(root.profile)
    if (refused) throw new ConfigError(`improve(): the baseline profile cannot run: ${refused}`)
  }
  const scenarios = [...trainScenarios, ...selectionScenarios, ...testScenarios]
  const scenarioIds = new Set<string>()
  for (const scenario of scenarios) {
    if (scenarioIds.has(scenario.id)) {
      throw new ConfigError(`improve(): scenario '${scenario.id}' appears in more than one split`)
    }
    scenarioIds.add(scenario.id)
  }
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
    async runAttempt({ work, lane, context, costLedger: cellLedger, span }) {
      const nodeProfile = work.artifact.profile
      if (!nodeProfile) throw new Error(`improve(): refused node ${work.nodeId} was given a cell`)
      const profileDigest = canonicalAgentProfileDigest(nodeProfile)
      let fault: unknown
      const campaign = await runCampaign<TScenario, TArtifact>({
        ...(campaignOptions as Omit<
          RunCampaignOptions<TScenario, TArtifact>,
          'scenarios' | 'dispatch'
        >),
        // A seat's work leaves no receipt, which the campaign would otherwise report as a stub.
        ...(lane.kind === 'subscription' &&
        (campaignOptions as { expectUsage?: unknown }).expectUsage === undefined
          ? { expectUsage: 'off' as const }
          : {}),
        scenarios,
        judges: prepared.judges,
        seed,
        reps,
        storage,
        runDir: `${searchDir}/nodes/${profileDigest.slice('sha256:'.length)}`,
        dispatchRef: `improve:${evaluationRef}:${profileDigest}`,
        async dispatch(scenario, ctx) {
          try {
            return await agent(nodeProfile, scenario, { ...ctx, search: context })
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
      return laneCellResult(
        campaignCellSearchResult(cell, { execution, lane: lane.name }),
        lane,
        cell.errorStage === 'dispatch' ? fault : undefined,
      )
    },
  })

  const { proposer } = method
  const proposerSource: SearchSourceRef = {
    uri: `proposer:${proposer.kind}`,
    revision: canonicalCandidateDigest({
      kind: proposer.kind,
      propose: Function.prototype.toString.call(proposer.propose),
      decide: proposer.decide ? Function.prototype.toString.call(proposer.decide) : null,
    }),
  }
  const proposalPhase = 'search.proposal'
  const port: SearchProposerPort<ProfileNode> = {
    name: proposer.kind,
    kind: 'optimizer',
    source: proposerSource,
    execution: { kind: 'deterministic', source: proposerSource },
    childrenPerProposal: method.childrenPerProposal,
    async propose(request) {
      const before = new Set(costLedger.list({ phase: proposalPhase }).map((r) => r.callId))
      // Read the ledger once, synchronously, before any await: the kernel
      // retires a state view when it appends.
      const state = await recorder.state()
      const parents = request.parents.map(({ nodeId, artifact }) => ({
        nodeId,
        artifact: artifact.surface,
      }))
      const context: ProposeContext<ProposalFinding> = Object.freeze({
        currentSurface: parents[0]?.artifact ?? prepared.baselineSurface,
        operator: request.operator,
        parents,
        train: searchProposerView(state),
        summary: renderSearchSummary(state, { split: 'train' }),
        history: [],
        findings: prepared.findings,
        populationSize: method.childrenPerProposal,
        generation: request.expansion,
        signal: request.signal,
        costLedger,
        costPhase: proposalPhase,
      })
      const decision = proposer.decide?.({ history: [] })
      const proposed = decision?.stop ? [] : await proposer.propose(context)
      if (!Array.isArray(proposed)) {
        throw new ConfigError('improve(): the search proposer must return an array')
      }
      const fresh = costLedger
        .list({ phase: proposalPhase })
        .filter((receipt) => !before.has(receipt.callId))
      return {
        children: proposed.slice(0, method.childrenPerProposal).map((child) =>
          isProposedCandidate(child)
            ? {
                artifact: nodeOf(child.surface),
                label: child.label,
                rationale: child.rationale,
                ...(child.attribution ? { attribution: child.attribution } : {}),
              }
            : { artifact: nodeOf(child), label: '', rationale: '' },
        ),
        ...(decision?.stop ? { stop: decision.reason ?? 'the proposer decided to stop' } : {}),
        accounting: searchReceiptAccounting(fresh),
        execution: searchProposalExecution(
          fresh,
          prepared.searchIdentity.model.provider,
          proposerSource,
        ),
      }
    },
  }
  const admit = (node: ProfileNode): string | null => {
    if (node.refusal !== null || node.profile === null) return node.refusal
    try {
      prepared.admitCandidate(node.profile, node.surface)
    } catch (error) {
      return refusalText(error)
    }
    const paths = privateValuePaths([node.surface])
    if (paths.length > 0) {
      return `the surface carries a credential or private value at ${paths.slice(0, 8).join(', ')}`
    }
    return laneRefusal(node.profile)
  }

  const startedAt = Date.now()
  const result = await runSearch({
    recorder,
    root,
    codec,
    policy,
    allocation,
    proposer: port,
    executor,
    admit,
    maxExpansions: method.maxExpansions,
    maxAttempts: method.maxAttempts,
    ...(signal ? { signal } : {}),
  })

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
  const cost = copyImproveCost(costLedger.summary())
  const shipped = claimResult.finalists.find(
    (finalist) => finalist.nodeId === claimResult.selected && finalist.test !== null,
  )
  const { decision, reason } = runtimeShipDecision({
    claim: claimResult,
    verified: result.claimVerification.status === 'verified',
    accountingComplete: cost.accountingComplete,
    lowerBound: shipped?.test?.interval[0] ?? null,
    minimumLift: prepared.minimumLift,
  })
  return {
    mode: 'search',
    method: method.name,
    candidate,
    decision,
    reason,
    claim: claimResult,
    claimVerification: result.claimVerification,
    ...(shipped?.test
      ? {
          lift: shipped.test.delta,
          liftInterval: { low: shipped.test.interval[0], high: shipped.test.interval[1] },
        }
      : {}),
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

/** Runtime's ship rule over the kernel's statistical claim (design §6.5 step 5). */
function runtimeShipDecision(input: {
  claim: SearchClaim
  verified: boolean
  accountingComplete: boolean
  lowerBound: number | null
  minimumLift: number
}): { decision: 'ship' | 'hold'; reason: string } {
  const { claim } = input
  if (claim.decision !== 'ship') return { decision: 'hold', reason: claim.reason }
  if (!input.verified) {
    return {
      decision: 'hold',
      reason:
        'the claim shipped, but it does not re-derive from the ledger under this rule revision',
    }
  }
  if (!input.accountingComplete) {
    return {
      decision: 'hold',
      reason: 'the claim shipped, but the search cost accounting is incomplete',
    }
  }
  if (input.lowerBound === null || !(input.lowerBound > input.minimumLift)) {
    return {
      decision: 'hold',
      reason: `the claim shipped, but its test lower bound ${input.lowerBound} does not exceed minimumLift ${input.minimumLift}`,
    }
  }
  return { decision: 'ship', reason: claim.reason }
}

/** Profiles as search artifacts: nodes by profile digest, edges by profile diffs. */
function profileCodec<TScenario extends Scenario, TArtifact>(
  prepared: PreparedProfileImprovement<TScenario, TArtifact>,
): SearchArtifactCodec<ProfileNode> {
  const surfaceId = prepared.surface
  return {
    node(recorder, node) {
      if (node.profile) {
        const artifact = recorder.blob('agent-profile', {
          kind: 'agent-profile',
          profile: node.profile,
        })
        return {
          artifactDigest: canonicalAgentProfileDigest(node.profile),
          artifact,
          surfaces: [{ surfaceId, kind: 'agent-profile', artifact }],
        }
      }
      const artifact = recorder.blob('surface', {
        kind: 'unmaterialized-surface',
        surface: node.surface,
        refusal: node.refusal,
      })
      return {
        artifactDigest: canonicalCandidateDigest({
          kind: 'unmaterialized-surface',
          surface: node.surface,
        }),
        artifact,
        surfaces: [{ surfaceId, kind: 'agent-profile', artifact }],
      }
    },
    diff(recorder, parent, child): SearchArtifactRef | SearchUnknown {
      if (!parent.profile || !child.profile) {
        return { unknown: 'a surface that does not materialize has no profile to diff' }
      }
      const diffs: AgentProfileDiff[] = diffAgentProfiles(parent.profile, child.profile)
      const to = canonicalAgentProfileDigest(child.profile)
      if (canonicalAgentProfileDigest(diffs.reduce(applyAgentProfileDiff, parent.profile)) !== to) {
        return { unknown: 'the Interface profile diffs do not reproduce the child profile' }
      }
      return recorder.blob('diff', {
        kind: 'agent-profile-diff',
        from: canonicalAgentProfileDigest(parent.profile),
        to,
        diffs,
      })
    },
    load(recorder, node) {
      const stored = recorder.readBlob(node.artifact) as {
        kind?: unknown
        profile?: unknown
        surface?: MutableSurface
        refusal?: string | null
      }
      if (stored.kind === 'agent-profile') {
        const parsed = agentProfileSchema.safeParse(stored.profile)
        if (!parsed.success) {
          throw new Error(`improve(): node ${node.nodeId} holds an invalid AgentProfile`)
        }
        const loaded = immutableCandidateValue(parsed.data)
        return { surface: prepared.surfaceOf(loaded), profile: loaded, refusal: null }
      }
      if (stored.kind === 'unmaterialized-surface' && stored.surface !== undefined) {
        return { surface: stored.surface, profile: null, refusal: stored.refusal ?? null }
      }
      throw new Error(`improve(): node ${node.nodeId} holds no profile search artifact`)
    },
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

/**
 * The lane's facts over the campaign's measurement. An environment fault the agent raised is
 * retryable: the campaign reports every error as final because it applies its own retry
 * policy, and the kernel owns retries here. A subscription seat reports no tokens and charges
 * no dollar, so its tokens are unknown and a cell with no priced call cost nothing.
 */
function laneCellResult(
  result: SearchCellResult,
  lane: SearchLane,
  fault: unknown,
): SearchCellResult {
  const outcome: SearchTaskOutcome =
    fault !== undefined && result.outcome.status === 'errored'
      ? {
          ...result.outcome,
          error: { code: 'environment-fault', message: refusalText(fault), retryable: true },
        }
      : result.outcome
  if (lane.kind !== 'subscription') return { ...result, outcome }
  const { cost } = result.accounting
  return {
    ...result,
    outcome,
    accounting: {
      tokens: { status: 'unknown', reason: 'a subscription seat reports no token usage' },
      cost: cost.status === 'known' && cost.usd === 0 ? { ...cost, source: 'free' } : cost,
    },
  }
}

/** A refusal as the ledger stores it: redacted with the share profile. */
function refusalText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return redact(message, { profile: 'share' }).value
}
