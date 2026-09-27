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
  type SearchClaim,
  type SearchExecutionIdentity,
  type SearchExecutor,
  type SearchPolicy,
  type SearchProposerPort,
  SearchRecorder,
  type SearchSourceRef,
  type SearchTask,
  type SearchUnknown,
  type SurfaceProposer,
  searchClaimReserveUsd,
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
  /** Children one proposal asks for. Default 1. */
  childrenPerProposal?: number
  /** Cells that run at once. Default 2. */
  concurrency?: number
  /** Prior cost of one cell in dollars, held for each cell until 20 cells
   * settle and the lane's own costs set the hold. Default 0. */
  cellUsd?: number
  /** Dollars held for the claim from the start. Default: the root and 3
   * finalists on every test task at `cellUsd` a cell. */
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
  return Object.freeze({
    kind: 'search' as const,
    name,
    policy: options.policy ?? aide(),
    allocation: options.allocation ?? asha(),
    proposer,
    maxExpansions: count('maxExpansions', options.maxExpansions, Number.NaN, 0),
    childrenPerProposal: count('childrenPerProposal', options.childrenPerProposal, 1, 1),
    concurrency: count('concurrency', options.concurrency, 2, 1),
    cellUsd: dollars('cellUsd', options.cellUsd) ?? 0,
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
    'a candidate is refused when it does not materialize, declares training on a test task, fails the caller validator, or carries a credential or private value',
  cell: 'a one-cell runCampaign of the materialized profile in a directory addressed by its digest; a cached cell is read back, not run again',
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
  const { allocation, policy } = method
  const reps = allocation.reps
  const prepared = prepareProfileImprovement(profile, {
    ...opts,
    seed,
    reps,
    optimizationRunOptions: { reps, maxConcurrency: method.concurrency },
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
    searchClaimReserveUsd({ testTasks: splits.test.length, reps, cellUsd: method.cellUsd }),
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
        maxConcurrency: method.concurrency,
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
  const codec = profileCodec(prepared)
  const scenarios = [...trainScenarios, ...selectionScenarios, ...testScenarios]
  const scenarioIds = new Set<string>()
  for (const scenario of scenarios) {
    if (scenarioIds.has(scenario.id)) {
      throw new ConfigError(`improve(): scenario '${scenario.id}' appears in more than one split`)
    }
    scenarioIds.add(scenario.id)
  }
  const lane = 'in-process'
  const executor: SearchExecutor<ProfileNode> = {
    lanes: () => [
      { name: lane, capacity: method.concurrency, costCap: 'estimate', cellUsd: method.cellUsd },
    ],
    place: () => lane,
    // A finished cell is in its campaign's cell cache, so `run` reads it back
    // instead of dispatching it again.
    adopt: async () => null,
    async run(work) {
      const nodeProfile = work.artifact.profile
      if (!nodeProfile) throw new Error(`improve(): refused node ${work.nodeId} was given a cell`)
      const profileDigest = canonicalAgentProfileDigest(nodeProfile)
      const campaign = await runCampaign<TScenario, TArtifact>({
        ...(campaignOptions as Omit<
          RunCampaignOptions<TScenario, TArtifact>,
          'scenarios' | 'dispatch'
        >),
        scenarios,
        judges: prepared.judges,
        seed,
        reps,
        storage,
        runDir: `${searchDir}/nodes/${profileDigest.slice('sha256:'.length)}`,
        dispatchRef: `improve:${evaluationRef}:${profileDigest}`,
        dispatch: (scenario, ctx) => agent(nodeProfile, scenario, ctx),
        cellFilter: ({ scenario, rep }) => scenario.id === work.taskId && rep === work.rep,
        resumable: true,
        maxConcurrency: 1,
        costLedger,
        costPhase: `search.${work.stage}`,
        signal: work.signal,
      })
      const cell = campaign.cells[0]
      if (!cell) throw new Error(`improve(): cell ${work.cellId} produced no campaign cell`)
      return campaignCellSearchResult(cell, { execution, lane: work.lane })
    },
  }

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
    return paths.length === 0
      ? null
      : `the surface carries a credential or private value at ${paths.slice(0, 8).join(', ')}`
  }

  const startedAt = Date.now()
  const result = await runSearch({
    recorder,
    root: nodeOf(prepared.baselineSurface),
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

/** Runtime's ship rule over the kernel's statistical claim (design §6.5 step 5), shared by
 * `searchMethod` and `runStrategyEvolution`. */
export function runtimeShipDecision(input: {
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
    concurrency: method.concurrency,
    cellUsd: method.cellUsd,
    claimReserveUsd: method.claimReserveUsd,
    deadline: method.deadline,
    maxAttempts: method.maxAttempts,
  }
}

/** A refusal as the ledger stores it: redacted with the share profile. */
function refusalText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return redact(message, { profile: 'share' }).value
}
