/**
 * runStrategyEvolution: strategy search on Eval's search kernel (`runSearch`).
 *
 * Every node is a strategy: the caller's root, or a module an author model wrote from the
 * train results of the parent the policy chose. The default policy is `beam({ width: 2 })`
 * and the default allocator `asha()`, so a strategy is screened on a few selection tasks and
 * earns more tasks only by ranking well. Each cell is one `runAgentic` run of one strategy on
 * one task, scored by the environment's own check.
 *
 * Measurement follows the kernel's splits. The author reads train results only; the policy
 * and allocator rank on the private selection split; the claim runs the root and at most 3
 * finalists together on the sealed test split, once, with a power check and a Bonferroni
 * decision. The report is a projection of the ledger, and the ledger is the only checkpoint:
 * calling again with the same inputs continues an interrupted search and returns a finished
 * one without running anything.
 *
 * @experimental
 */

import { mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import {
  asha,
  beam,
  createRunCostLedger,
  estimateNode,
  fsCampaignStorage,
  type NodeEstimate,
  openSearchLedger,
  renderSearchSummary,
  runSearch,
  type SearchAllocator,
  type SearchArtifactCodec,
  type SearchAttemptAccounting,
  type SearchCellResult,
  type SearchClaim,
  type SearchClaimVerification,
  type SearchCloseReason,
  type SearchExecutionIdentity,
  type SearchNodeStatus,
  type SearchPolicy,
  type SearchProposerPort,
  SearchRecorder,
  type SearchSourceRef,
  type SearchSplit,
  type SearchStateView,
  type SearchTask,
  searchClaimReserveUsd,
  searchModelIdentity,
  surfaceDiff,
} from '@tangle-network/agent-eval/campaign'
import {
  defineEvaluationClaim,
  type EvaluationClaim,
  summarizeEvaluationUnits,
} from '@tangle-network/agent-eval/experiment'
import { redact } from '@tangle-network/agent-eval/traces'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  canonicalCandidateDigest,
  immutableCandidateValue,
  sha256Bytes,
} from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import { runtimeShipDecision } from '../improvement/search-decision'
import {
  dedicatedLane,
  reconcileInterruptedSearchCalls,
  searchExecutor,
} from '../improvement/search-executor'
import type { RuntimeHooks } from '../runtime-hooks'
import { type BenchmarkConfig, type Environment, preflightModels } from './run-benchmark'
import {
  type AgenticOptions,
  type AgenticTask,
  refine,
  runAgentic,
  type Strategy,
} from './strategy'
import {
  loadAuthoredStrategy,
  requestStrategySource,
  type StrategyAuthorTurn,
  strategyAuthorContract,
} from './strategy-author'
import { concreteModelId } from './supervise/model-policy'
import type { ExecutorConfig } from './supervise/runtime'
import type { WorkerSlots } from './supervise/worker-slots'

export interface EvolutionAuthor {
  /** Exact author identity. */
  profile: AgentProfile
  /** Execution substrate. All behavior comes from the profile. */
  executor: ExecutorConfig
  /** Exact fallback identity, tried once when the primary call fails or writes no module. */
  fallbackProfile?: AgentProfile
}

export interface StrategyEvolutionConfig {
  environment: Environment
  /** Tasks the author learns from: it reads every strategy's results on them. */
  train: AgenticTask[]
  /** Private tasks the policy and allocator rank strategies on. The author never sees them. */
  selection: AgenticTask[]
  /** Sealed tasks: the claim runs the root and at most 3 finalists on them, together, once. */
  test: AgenticTask[]
  /** What the numbers may claim. `independentUnit` is a path into each task, for example
   * `id`, or `meta.repo` when tasks from one repository are not independent. The power
   * check needs `minimumEffect`. */
  claim: EvaluationClaim
  /** Digest of what the ledger cannot see: the environment's code and state, the root's
   * code, transports and callbacks. Change it whenever one of them changes. */
  executionRef: Sha256Digest
  worker: AgenticOptions
  author: EvolutionAuthor
  /** The strategy to beat and the tree's root. Default `refine`. */
  root?: Strategy
  /** Rollouts (sample) or shots (refine) per strategy per task. Default 3. */
  budget?: number
  /** Strategies the author writes. Default 4. */
  maxExpansions?: number
  /** Which strategy each authoring extends. Default `beam({ width: 2 })`. */
  policy?: SearchPolicy
  /** Where cells go. Default `asha()`. `uniform()` runs every strategy on every train and
   * selection task. The allocator's `reps` are every split's repeats, the claim's included. */
  allocation?: SearchAllocator
  /** Cells that run at once. Default 3. */
  concurrency?: number
  /** Dollar cap on committed spend plus open holds. Default none. */
  maxUsd?: number
  /** Prior dollar hold for one cell, until 20 cells settle. Default 0. */
  cellUsd?: number
  /** ISO time after which the search stops authoring and claims. */
  deadline?: string
  /** Attempts per cell when the environment faults. Default 3. */
  maxAttempts?: number
  /** Seeds the allocator's task permutation. Default 42. */
  seed?: number
  /** The search's directory is `<outDir>/<searchId>`: its ledger, blobs and authored
   * modules. Authored modules import `@tangle-network/agent-runtime/kernel`, so `outDir`
   * must sit inside a project that resolves it, under a TypeScript-capable loader. */
  outDir: string
  /** Model availability check before the search runs. See `BenchmarkConfig.modelPreflight`. */
  modelPreflight?: BenchmarkConfig['modelPreflight']
  /** Maximum time for each model availability check. Default 30 seconds. */
  modelPreflightTimeoutMs?: BenchmarkConfig['modelPreflightTimeoutMs']
  hooks?: RuntimeHooks
  /** Bound working cells across every search that shares this allocator. */
  workerSlots?: WorkerSlots
  /** Aborting pauses the search once running cells settle; call again to continue. */
  signal?: AbortSignal
}

/** One strategy the search registered, as the ledger records it. */
export interface EvolutionStrategy {
  /** Unique within the report: the strategy's name, suffixed `~<ordinal>` on a collision. */
  name: string
  nodeId: string
  /** The name of the strategy it was authored from; null for the root. */
  parent: string | null
  source: 'root' | 'authored'
  /** The node's latest decision; null while undecided. */
  status: SearchNodeStatus | null
  /** The authored module's source; null for the root. */
  code: string | null
  /** Description length of the authored source in gzip bits; null for the root. */
  gzipBits: number | null
  /** Why admission refused the module; null when admitted. */
  refusal: string | null
  /** Paired contrast against the root on the selection split; null for the root. */
  selection: NodeEstimate | null
}

/** One strategy on one task at one repeat: the settled cell's final attempt. */
export interface TournamentCell {
  /** Null when the cell ended unscored (an environment fault with no attempt left). */
  score: number | null
  outcome: 'passed' | 'failed' | 'errored'
  /** Known dollars plus proven floors of unknown ones. */
  usd: number
  usdKnown: boolean
}

export interface TournamentRow {
  taskId: string
  unitId: string
  rep: number
  cells: Record<string, TournamentCell>
}

/** Every settled cell of one split, by task and strategy. Strategies measured on different
 * tasks have unpaired means; compare them with the paired `selection` estimates. */
export interface StrategyTournament {
  split: SearchSplit
  rows: TournamentRow[]
  perStrategy: Record<
    string,
    { cells: number; scored: number; score: number | null; usd: number; usdKnown: boolean }
  >
}

export interface EvolutionReport {
  searchId: string
  /** The search ledger: the only record and checkpoint. */
  ledger: string
  closeReason: SearchCloseReason
  /** Root first, in registration order. */
  strategies: EvolutionStrategy[]
  /** The strategy the search keeps: the claim's selection, else the root. */
  selected: EvolutionStrategy
  claim: SearchClaim
  claimVerification: SearchClaimVerification
  /** `ship` only when the claim shipped, re-derives from the ledger, every cost is known, and
   * the shipped finalist's test lower bound is above zero. */
  decision: 'ship' | 'hold'
  reason: string
  tournament: Record<SearchSplit, StrategyTournament>
  /** Known dollars, proven floors of unknown ones, and how many cells and operations (an
   * authoring an interrupted process lost, for example) have an unknown cost. */
  spend: {
    knownUsd: number
    floorUsd: number
    unknownCostCells: number
    unknownCostOperations: number
  }
}

/** A search node: the caller's root, or an authored module and why admission refused it. */
type StrategyNode =
  | { kind: 'root'; name: string }
  | { kind: 'authored'; name: string | null; code: string; refusal: string | null }

/** The rules `runStrategyEvolution` adds to the kernel's; its digest is the process
 * revision every evolution ledger records. */
const STRATEGY_EVOLUTION_DEFINITION = {
  name: 'agent-runtime.strategy-evolution.2026-09',
  node: 'the root strategy by name under the caller executionRef, or an authored module content-addressed by the sha256 of its source',
  edge: 'a text diff from the parent module source to the child; unknown from the root, which has no source here',
  admission:
    'a module is refused when the reply carries none, it breaks the author contract, or it does not load a default Strategy',
  cell: 'one runAgentic run on one task, metered as one paid call on the search cost ledger through the Runtime search executor; an environment fault during it is errored and retried, a thrown strategy is failed at score 0, anything else passed at its harness-verified score',
  proposer:
    'the author reads the strategy contract, the task tools, the train summary, the train results of every strategy and the parent source',
  ship: 'the claim shipped, re-derives from the ledger, cost accounting is complete, and the shipped finalist test lower bound exceeds 0',
} as const

const STRATEGY_EVOLUTION_SOURCE: SearchSourceRef = {
  uri: 'npm:@tangle-network/agent-runtime#runStrategyEvolution',
  revision: canonicalCandidateDigest(STRATEGY_EVOLUTION_DEFINITION),
}

const NO_MODULE = 'the author reply carried no fenced ts module'

/** Evolve a strategy on the search kernel and claim once on the sealed test split. */
export async function runStrategyEvolution(cfg: StrategyEvolutionConfig): Promise<EvolutionReport> {
  const root = cfg.root ?? refine
  const budget = positiveInteger('budget', cfg.budget ?? 3)
  const concurrency = positiveInteger('concurrency', cfg.concurrency ?? 3)
  const maxExpansions = nonNegativeInteger('maxExpansions', cfg.maxExpansions ?? 4)
  const maxAttempts = positiveInteger('maxAttempts', cfg.maxAttempts ?? 3)
  const seed = nonNegativeInteger('seed', cfg.seed ?? 42)
  const cellUsd = dollars('cellUsd', cfg.cellUsd) ?? 0
  const maxUsd = dollars('maxUsd', cfg.maxUsd)
  const policy = cfg.policy ?? beam({ width: 2 })
  const allocation = cfg.allocation ?? asha()
  if (cfg.deadline !== undefined && !Number.isFinite(Date.parse(cfg.deadline))) {
    throw new ConfigError('evolution: deadline must be an ISO time')
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(cfg.executionRef)) {
    throw new ConfigError('evolution: executionRef must be a lowercase sha256:<64 hex> digest')
  }
  if (!root.name.trim() || typeof root.driver !== 'function') {
    throw new ConfigError('evolution: root must be a named Strategy')
  }
  const claim = defineEvaluationClaim(cfg.claim)
  if (claim.minimumEffect === undefined) {
    throw new ConfigError('evolution: the claim needs minimumEffect for its power check')
  }
  const taskIds = new Set<string>()
  const splitTasks = (label: string, tasks: AgenticTask[]): AgenticTask[] => {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new ConfigError(`evolution: ${label} needs at least one task`)
    }
    for (const task of tasks) {
      if (typeof task.id !== 'string' || !task.id.trim() || taskIds.has(task.id)) {
        throw new ConfigError(`evolution: task IDs must be non-empty and unique across splits`)
      }
      taskIds.add(task.id)
    }
    return immutableCandidateValue(tasks)
  }
  const train = splitTasks('train', cfg.train)
  const selection = splitTasks('selection', cfg.selection)
  const test = splitTasks('test', cfg.test)
  const taskById = new Map([...train, ...selection, ...test].map((task) => [task.id, task]))
  const searchTasks = (tasks: AgenticTask[]): SearchTask[] =>
    tasks.map((task) => ({
      taskId: task.id,
      unitId: summarizeEvaluationUnits(claim, [task]).units[0]!.id,
      source: { uri: `task://${task.id}`, revision: canonicalCandidateDigest(task) },
    }))
  const splits = {
    train: searchTasks(train),
    selection: searchTasks(selection),
    test: searchTasks(test),
  }
  const developmentUnits = new Set(
    [...splits.train, ...splits.selection].map((task) => task.unitId),
  )

  const workerProfile = cfg.worker.workerProfile
  const analystProfile = cfg.worker.analystProfile ?? workerProfile
  const workerModel = concreteModelId(workerProfile.model?.default)
  if (!workerModel) {
    throw new ConfigError('evolution: worker AgentProfile.model.default must name an exact model')
  }
  const authorModel = concreteModelId(cfg.author.profile.model?.default)
  if (!authorModel) {
    throw new ConfigError('evolution: author AgentProfile.model.default must name an exact model')
  }
  const workerSource: SearchSourceRef = {
    uri: 'npm:@tangle-network/agent-runtime#runAgentic',
    revision: canonicalCandidateDigest({
      worker: canonicalAgentProfileDigest(workerProfile),
      analyst: canonicalAgentProfileDigest(analystProfile),
      routerBaseUrl: cfg.worker.routerBaseUrl,
      corpusTags: cfg.worker.corpusTags ?? [],
      corpusReadback: cfg.worker.corpusReadback ?? null,
      budget,
    }),
  }
  const authorSource: SearchSourceRef = {
    uri: `agent-profile:${cfg.author.profile.name}`,
    revision: canonicalCandidateDigest({
      profile: canonicalAgentProfileDigest(cfg.author.profile),
      fallback: cfg.author.fallbackProfile
        ? canonicalAgentProfileDigest(cfg.author.fallbackProfile)
        : null,
      backend: cfg.author.executor.backend,
      contract: strategyAuthorContract,
    }),
  }
  const environmentSource: SearchSourceRef = {
    uri: `environment:${cfg.environment.name}`,
    revision: cfg.executionRef,
  }
  const execution: SearchExecutionIdentity = {
    model: searchModelIdentity(workerModel, workerProfile.model?.provider ?? 'unknown'),
    agent: workerSource,
    benchmark: environmentSource,
  }
  const searchKey = canonicalCandidateDigest({
    process: STRATEGY_EVOLUTION_SOURCE,
    executionRef: cfg.executionRef,
    root: root.name,
    worker: workerSource,
    author: authorSource,
    claim,
    splits,
    policy: policy.name,
    allocation: allocation.name,
    reps: allocation.reps,
    maxExpansions,
    concurrency,
    maxUsd,
    cellUsd,
    deadline: cfg.deadline ?? null,
    maxAttempts,
    seed,
  }).slice('sha256:'.length, 'sha256:'.length + 24)
  const searchId = `evolution-${searchKey}`
  const searchDir = `${cfg.outDir}/${searchId}`
  const modulesDir = `${searchDir}/strategies`
  const ledgerPath = `${searchDir}/ledger.jsonl`

  mkdirSync(searchDir, { recursive: true })
  const recorder = await SearchRecorder.open(
    { ledger: openSearchLedger({ path: ledgerPath, searchId }) },
    {
      subject: `strategy/${cfg.environment.name}`,
      process: { name: 'strategy-evolution', executionRef: STRATEGY_EVOLUTION_SOURCE },
      artifactKind: 'code',
      objective: { metric: 'score', direction: 'maximize', judge: environmentSource, claim },
      splits: {
        ...splits,
        heldOutUnits: splits.test.every((task) => !developmentUnits.has(task.unitId)),
      },
      policy: { expansion: policy.name, allocation: allocation.name, seed },
      budget: {
        maxUsd,
        maxCells: null,
        maxNodes: 1 + maxExpansions,
        deadline: cfg.deadline === undefined ? null : new Date(cfg.deadline).toISOString(),
        maxConcurrency: concurrency,
        reservedClaimUsd:
          maxUsd === null
            ? 0
            : searchClaimReserveUsd({
                testTasks: splits.test.length,
                reps: allocation.reps,
                cellUsd,
              }),
      },
      containment: null,
      derivedFrom: null,
      identity: execution,
    },
  )
  if (!(await recorder.state()).closed) {
    await preflightModels({
      worker: cfg.worker,
      modelPreflight: cfg.modelPreflight,
      modelPreflightTimeoutMs: cfg.modelPreflightTimeoutMs,
    })
  }

  const rootNode: StrategyNode = { kind: 'root', name: root.name }
  const codec: SearchArtifactCodec<StrategyNode> = {
    node(rec, node) {
      const artifact = rec.blob('strategy', { ...node })
      return {
        artifactDigest:
          node.kind === 'root'
            ? canonicalCandidateDigest({ kind: 'root', name: node.name })
            : sha256Bytes(Buffer.from(node.code, 'utf8')),
        artifact,
        surfaces: [{ surfaceId: 'strategy', kind: 'code', artifact }],
      }
    },
    diff(rec, parent, child) {
      if (parent.kind === 'root' || child.kind === 'root') {
        return { unknown: 'the root is a caller-supplied strategy with no source here' }
      }
      return surfaceDiff(rec, parent.code, child.code)
    },
    load(rec, node) {
      const stored = rec.readBlob(node.artifact) as StrategyNode
      if (stored.kind === 'root') {
        if (stored.name !== root.name) {
          throw new Error(
            `evolution: node ${node.nodeId} is root '${stored.name}', not '${root.name}'`,
          )
        }
        return rootNode
      }
      if (stored.kind === 'authored' && typeof stored.code === 'string') return stored
      throw new Error(`evolution: node ${node.nodeId} holds no strategy`)
    },
  }

  const loaded = new Map<string, Promise<Strategy>>()
  const strategyOf = (node: StrategyNode): Promise<Strategy> => {
    if (node.kind === 'root') return Promise.resolve(root)
    let strategy = loaded.get(node.code)
    if (!strategy) {
      strategy = loadAuthoredStrategy(node.code, modulesDir).then((module) => module.strategy)
      loaded.set(node.code, strategy)
    }
    return strategy
  }

  // Cells run in this process on one dedicated lane of Runtime's search executor, which
  // records each finished attempt under its run id (a restarted search adopts it instead of
  // running it again), meters it through the search's cost ledger, and traces it.
  const storage = fsCampaignStorage()
  const costLedger = createRunCostLedger({ storage, runDir: searchDir })
  const lanes = [dedicatedLane({ name: 'in-process', capacity: concurrency, cellUsd })]
  await reconcileInterruptedSearchCalls(costLedger, searchId, lanes)
  const executor = searchExecutor<StrategyNode>({
    lanes,
    profileOf: () => workerProfile,
    costLedger,
    identity: execution,
    storage,
    dir: searchDir,
    ...(cfg.workerSlots ? { workerSlots: cfg.workerSlots } : {}),
    async runAttempt({ work, lane, costLedger: cellLedger }): Promise<SearchCellResult> {
      if (work.artifact.kind === 'authored' && work.artifact.refusal !== null) {
        throw new Error(`evolution: refused node ${work.nodeId} was given a cell`)
      }
      const strategy = await strategyOf(work.artifact)
      const task = taskById.get(work.taskId)
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
            budget,
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
        identity: execution,
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
    },
  })

  let toolCatalog: Promise<string> | undefined
  const catalog = (): Promise<string> => {
    toolCatalog ??= listToolCatalog(cfg.environment, train[0]!)
    return toolCatalog
  }
  const authorProvider = cfg.author.profile.model?.provider ?? 'unknown'
  const proposer: SearchProposerPort<StrategyNode> = {
    name: 'strategy-author',
    kind: 'frontier-author',
    source: authorSource,
    execution: {
      kind: 'model',
      model: searchModelIdentity(authorModel, authorProvider),
      source: authorSource,
    },
    childrenPerProposal: 1,
    async propose(request) {
      // Read the ledger once, synchronously, before any await: the kernel retires a state
      // view when it appends.
      const state = await recorder.state()
      const names = strategyNames(state, recorder, codec)
      const losses = JSON.stringify(
        strategyTournament(state, 'train', names).rows.map((row) => ({
          task: row.taskId,
          ...(row.rep > 0 ? { rep: row.rep } : {}),
          cells: row.cells,
        })),
      ).slice(0, 12_000)
      const summary = renderSearchSummary(state, { split: 'train' })
      const parent = request.parents[0]!
      const parentName = names.get(parent.nodeId) ?? parent.nodeId
      const tried = [...names.values()].join(', ')
      const parentSource =
        parent.artifact.kind === 'authored'
          ? `\n\nPARENT STRATEGY "${parentName}" (improve on it):\n${parent.artifact.code}`
          : `\n\nPARENT STRATEGY "${parentName}" is the built-in baseline; improve on it.`
      const contract = `${strategyAuthorContract}\n\nEXAMPLE TOOLS FROM ONE TASK (tool sets VARY per task on this domain — a strategy MUST select tool names from await listTools(handle) at runtime; hardcoding these example names will zero your score on most tasks):\n${await catalog()}\n\nTHE SEARCH SO FAR (train split):\n${summary}\n\nSTRATEGIES ALREADY TRIED (author something MEANINGFULLY different — a new composition, not a rename): ${tried}${parentSource}`
      const source = await requestStrategySource({
        profile: cfg.author.profile,
        executor: cfg.author.executor,
        ...(cfg.author.fallbackProfile ? { fallbackProfile: cfg.author.fallbackProfile } : {}),
        contract,
        environmentName: cfg.environment.name,
        lossesJson: losses,
        budget,
        outDir: modulesDir,
        signal: request.signal,
      })
      let child: StrategyNode = { kind: 'authored', name: null, code: '', refusal: NO_MODULE }
      if (source.code !== null) {
        try {
          const { strategy } = await loadAuthoredStrategy(source.code, modulesDir)
          child = { kind: 'authored', name: strategy.name, code: source.code, refusal: null }
        } catch (error) {
          child = { kind: 'authored', name: null, code: source.code, refusal: shareText(error) }
        }
      }
      const answered = source.turns.at(-1)
      return {
        children: [
          {
            artifact: child,
            label: child.name ?? 'refused module',
            rationale: `authored from the train results of ${parentName} and ${names.size - 1} other strategies`,
          },
        ],
        accounting: authorAccounting(source.turns),
        ...(answered
          ? {
              execution: {
                kind: 'model' as const,
                model: searchModelIdentity(answered.model, authorProvider),
                source: authorSource,
              },
            }
          : {}),
      }
    },
  }

  const result = await runSearch({
    recorder,
    root: rootNode,
    codec,
    policy,
    allocation,
    proposer,
    executor,
    admit: (node) => (node.kind === 'authored' ? node.refusal : null),
    maxExpansions,
    maxAttempts,
    ...(cfg.signal ? { signal: cfg.signal } : {}),
  })
  if (!result.claim || !result.claimVerification) {
    throw new Error(`evolution: search ${searchId} closed without a claim`)
  }
  const { state } = result
  const names = strategyNames(state, recorder, codec)
  const rootId = state.rootNodeId!
  const strategies = state.nodes().map((node): EvolutionStrategy => {
    const artifact = codec.load(recorder, node)
    const authored = artifact.kind === 'authored' ? artifact : null
    return {
      name: names.get(node.nodeId)!,
      nodeId: node.nodeId,
      parent: node.primaryParentId === null ? null : names.get(node.primaryParentId)!,
      source: artifact.kind,
      status: node.status,
      code: authored?.code ?? null,
      gzipBits: authored ? gzipSync(Buffer.from(authored.code)).length * 8 : null,
      refusal: authored?.refusal ?? null,
      selection:
        node.nodeId === rootId
          ? null
          : estimateNode(state, node.nodeId, { against: rootId, split: 'selection' }),
    }
  })
  const claimResult = result.claim
  const shipped = claimResult.finalists.find(
    (finalist) => finalist.nodeId === claimResult.selected && finalist.test !== null,
  )
  const { spend } = state.audit
  const { decision, reason } = runtimeShipDecision({
    claim: claimResult,
    verified: result.claimVerification.status === 'verified',
    cost: {
      accountingComplete: spend.unknownCostCells === 0 && spend.unknownCostOperations === 0,
    },
    costCeiling: undefined,
    lowerBound: shipped?.test?.interval[0] ?? null,
    minimumLift: 0,
  })
  return {
    searchId,
    ledger: ledgerPath,
    closeReason: result.reason,
    strategies,
    selected: strategies.find((strategy) => strategy.nodeId === result.leader)!,
    claim: claimResult,
    claimVerification: result.claimVerification,
    decision,
    reason,
    tournament: {
      train: strategyTournament(state, 'train', names),
      selection: strategyTournament(state, 'selection', names),
      test: strategyTournament(state, 'test', names),
    },
    spend: {
      knownUsd: spend.knownUsd,
      floorUsd: spend.floorUsd,
      unknownCostCells: spend.unknownCostCells,
      unknownCostOperations: spend.unknownCostOperations,
    },
  }
}

/**
 * The tournament on one split, projected from the ledger: each settled cell's final attempt,
 * by task and repeat, keyed by strategy name. `names` maps node ids to report names.
 */
export function strategyTournament(
  state: SearchStateView,
  split: SearchSplit,
  names: ReadonlyMap<string, string>,
): StrategyTournament {
  const rows = new Map<string, TournamentRow>()
  const perStrategy: StrategyTournament['perStrategy'] = {}
  for (const nodeId of state.nodeIds()) {
    const name = names.get(nodeId)
    if (name === undefined) throw new Error(`strategyTournament: node ${nodeId} has no name`)
    perStrategy[name] = { cells: 0, scored: 0, score: null, usd: 0, usdKnown: true }
  }
  const sums = new Map<string, number>()
  const cells = state
    .cells()
    .filter((cell) => cell.split === split && cell.outcome !== null)
    .sort((left, right) => compare(left.taskId, right.taskId) || left.rep - right.rep)
  for (const cell of cells) {
    const name = names.get(cell.nodeId)!
    const key = `${cell.taskId}\u0000${cell.rep}`
    let row = rows.get(key)
    if (!row) {
      row = { taskId: cell.taskId, unitId: cell.unitId, rep: cell.rep, cells: {} }
      rows.set(key, row)
    }
    const outcome = cell.outcome as TournamentCell['outcome']
    row.cells[name] = { score: cell.score, outcome, usd: cell.spentUsd, usdKnown: cell.costKnown }
    const summary = perStrategy[name]!
    summary.cells += 1
    summary.usd += cell.spentUsd
    summary.usdKnown &&= cell.costKnown
    if (cell.score !== null) {
      summary.scored += 1
      sums.set(name, (sums.get(name) ?? 0) + cell.score)
    }
  }
  for (const [name, summary] of Object.entries(perStrategy)) {
    summary.score = summary.scored === 0 ? null : sums.get(name)! / summary.scored
  }
  return { split, rows: [...rows.values()], perStrategy }
}

/** Report names: each node's strategy name, suffixed `~<ordinal>` when an earlier node has it. */
function strategyNames(
  state: SearchStateView,
  recorder: SearchRecorder,
  codec: SearchArtifactCodec<StrategyNode>,
): Map<string, string> {
  const names = new Map<string, string>()
  const taken = new Set<string>()
  for (const node of state.nodes()) {
    const artifact = codec.load(recorder, node)
    const base = artifact.name ?? 'refused-module'
    const name = taken.has(base) ? `${base}~${node.ordinal}` : base
    taken.add(name)
    names.set(node.nodeId, name)
  }
  return names
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

function authorAccounting(turns: readonly StrategyAuthorTurn[]): SearchAttemptAccounting {
  let usd = 0
  let costKnown = true
  for (const turn of turns) {
    if (turn.costUsd === null) costKnown = false
    else usd += turn.costUsd
  }
  return {
    tokens: turns.every((turn) => turn.tokensKnown)
      ? {
          status: 'known',
          inputTokens: turns.reduce((sum, turn) => sum + turn.inputTokens, 0),
          outputTokens: turns.reduce((sum, turn) => sum + turn.outputTokens, 0),
          cachedTokens: 0,
        }
      : { status: 'unknown', reason: 'an authoring call reported no token usage' },
    cost: costKnown
      ? { status: 'known', usd, source: usd === 0 ? 'free' : 'provider' }
      : {
          status: 'unknown',
          knownLowerBoundUsd: usd,
          reason: 'an authoring call reported no billed cost',
        },
  }
}

function unknownAccounting(reason: string): SearchAttemptAccounting {
  return {
    tokens: { status: 'unknown', reason },
    cost: { status: 'unknown', knownLowerBoundUsd: 0, reason },
  }
}

/** One probe round-trip lists the domain's tools so the author can focus shots, names and
 * descriptions only, never the implementations. */
async function listToolCatalog(environment: Environment, task: AgenticTask): Promise<string> {
  const handle = await environment.open(task)
  try {
    return (await environment.tools(task, handle))
      .map(
        (tool) =>
          `- ${tool.function.name}${tool.function.description ? ` — ${tool.function.description.slice(0, 120)}` : ''}`,
      )
      .join('\n')
  } finally {
    await environment.close(handle)
  }
}

/** Free text as the ledger stores it: redacted with the share profile and bounded. */
function shareText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return redact(text, { profile: 'share' }).value.slice(0, 300)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ConfigError(`evolution: ${name} must be a positive integer`)
  }
  return value
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ConfigError(`evolution: ${name} must be a non-negative integer`)
  }
  return value
}

function dollars(name: string, value: number | undefined): number | null {
  if (value === undefined) return null
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigError(`evolution: ${name} must be a finite non-negative number`)
  }
  return value
}
