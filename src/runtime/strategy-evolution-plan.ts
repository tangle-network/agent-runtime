/**
 * The validated inputs of one `runStrategyEvolution` call: option checks, the three task
 * splits, the identities the ledger records, and the search id derived from them.
 */

import {
  asha,
  beam,
  type SearchAllocator,
  type SearchExecutionIdentity,
  type SearchPolicy,
  type SearchSourceRef,
  type SearchTask,
  searchModelIdentity,
} from '@tangle-network/agent-eval/campaign'
import {
  defineEvaluationClaim,
  type EvaluationClaim,
  summarizeEvaluationUnits,
} from '@tangle-network/agent-eval/experiment'
import { canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import { type AgenticTask, refine } from './strategy'
import { type Strategy, strategyAuthorContract } from './strategy-author'
import type { StrategyEvolutionConfig } from './strategy-evolution'
import { concreteModelId } from './supervise/model-policy'

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

export const STRATEGY_EVOLUTION_SOURCE: SearchSourceRef = {
  uri: 'npm:@tangle-network/agent-runtime#runStrategyEvolution',
  revision: canonicalCandidateDigest(STRATEGY_EVOLUTION_DEFINITION),
}

export interface EvolutionPlan {
  root: Strategy
  budget: number
  concurrency: number
  maxExpansions: number
  maxAttempts: number
  seed: number
  cellUsd: number
  maxUsd: number | null
  policy: SearchPolicy
  allocation: SearchAllocator
  claim: EvaluationClaim
  train: AgenticTask[]
  taskById: Map<string, AgenticTask>
  splits: { train: SearchTask[]; selection: SearchTask[]; test: SearchTask[] }
  developmentUnits: Set<string>
  workerModel: string
  authorModel: string
  authorSource: SearchSourceRef
  environmentSource: SearchSourceRef
  execution: SearchExecutionIdentity
  searchId: string
  searchDir: string
  modulesDir: string
  ledgerPath: string
}

/** Check every option and derive the search's identity; throws `ConfigError` on a bad one. */
export function planStrategyEvolution(cfg: StrategyEvolutionConfig): EvolutionPlan {
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
  const train = splitTasks(taskIds, 'train', cfg.train)
  const selection = splitTasks(taskIds, 'selection', cfg.selection)
  const test = splitTasks(taskIds, 'test', cfg.test)
  const splits = {
    train: searchTasks(claim, train),
    selection: searchTasks(claim, selection),
    test: searchTasks(claim, test),
  }

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
  return {
    root,
    budget,
    concurrency,
    maxExpansions,
    maxAttempts,
    seed,
    cellUsd,
    maxUsd,
    policy,
    allocation,
    claim,
    train,
    taskById: new Map([...train, ...selection, ...test].map((task) => [task.id, task])),
    splits,
    developmentUnits: new Set([...splits.train, ...splits.selection].map((task) => task.unitId)),
    workerModel,
    authorModel,
    authorSource,
    environmentSource,
    execution: {
      model: searchModelIdentity(workerModel, workerProfile.model?.provider ?? 'unknown'),
      agent: workerSource,
      benchmark: environmentSource,
    },
    searchId,
    searchDir,
    modulesDir: `${searchDir}/strategies`,
    ledgerPath: `${searchDir}/ledger.jsonl`,
  }
}

function splitTasks(taskIds: Set<string>, label: string, tasks: AgenticTask[]): AgenticTask[] {
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

function searchTasks(claim: EvaluationClaim, tasks: AgenticTask[]): SearchTask[] {
  return tasks.map((task) => ({
    taskId: task.id,
    unitId: summarizeEvaluationUnits(claim, [task]).units[0]!.id,
    source: { uri: `task://${task.id}`, revision: canonicalCandidateDigest(task) },
  }))
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
