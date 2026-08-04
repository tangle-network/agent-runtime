import { agentProfileSchema } from '@tangle-network/agent-interface'
import type { RagKnowledgeUpdateResult } from '@tangle-network/agent-knowledge'
import { RESEARCHER_SYSTEM_PROMPT } from '../profiles/researcher'
import type { DeliverableSpec } from '../runtime/supervise/completion-gate'
import { assertExecutableAgentProfile } from '../runtime/supervise/model-policy'
import type { ExecutorConfig } from '../runtime/supervise/runtime'
import { type SuperviseOptions, supervise } from '../runtime/supervise/supervise'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import type { Budget, SupervisedResult } from '../runtime/supervise/types'

/** Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers. */
export const RESEARCH_SUPERVISOR_SYSTEM_PROMPT = [
  'You are a research supervisor. You do not answer the research question yourself.',
  'You create and manage researcher workers that improve one shared knowledge base until it is ready.',
  '',
  'Each round:',
  '1. Read the goal and the gaps the readiness check still reports.',
  '2. Decompose the open work into independent sub-topics.',
  '3. Spawn one researcher per sub-topic; split by sub-topic, never duplicate work.',
  '4. Wait for researchers to settle, steer or re-spawn thin sub-topics, then stop when the check passes.',
  '',
  'Conserve the shared budget. Prefer a small number of well-scoped researchers over a large fanout that re-covers the same ground.',
].join('\n')

export interface KnowledgeReadinessCheckInput {
  root: string
  goal: string
  readinessSpecs?: readonly unknown[]
  readinessTaskId?: string
  readiness?: unknown
}

export type KnowledgeReadinessCheckResult =
  | boolean
  | {
      ready: boolean
      summary?: string
      metadata?: Record<string, unknown>
    }

export type KnowledgeReadinessCheck = (
  input: KnowledgeReadinessCheckInput,
) => Promise<KnowledgeReadinessCheckResult> | KnowledgeReadinessCheckResult

export interface SupervisedKnowledgeUpdateInput {
  goal?: string
  root?: string
  candidateRoot?: string
  findings?: readonly unknown[]
  metadata?: Record<string, unknown>
}

export interface SupervisedKnowledgeUpdateResult {
  applied: boolean
  summary: string
  supervised: SupervisedResult<unknown>
  metadata: NonNullable<RagKnowledgeUpdateResult['metadata']>
}

export interface SupervisedKnowledgeUpdateOptions {
  root: string
  goal: string
  readiness: KnowledgeReadinessCheck
  readinessSpecs?: readonly unknown[]
  readinessTaskId?: string
  readinessOptions?: unknown
  findings?: readonly unknown[]
  metadata?: Record<string, unknown>
  budget: Budget
  backend?: ExecutorConfig
  makeWorkerAgent?: SuperviseOptions['makeWorkerAgent']
  /** Caller-owned exact supervisor harness/provider/model identity. */
  supervisorProfile: SupervisorProfile
  superviseOptions?: Partial<
    Omit<
      SuperviseOptions,
      'budget' | 'backend' | 'deliverable' | 'makeWorkerAgent' | 'allowedModels'
    >
  >
  allowedModels?: readonly string[]
  runSupervised?: (
    profile: SupervisorProfile,
    task: unknown,
    opts: SuperviseOptions,
  ) => Promise<SupervisedResult<unknown>>
}

export type SupervisedKnowledgeUpdater = (
  input: SupervisedKnowledgeUpdateInput,
) => Promise<SupervisedKnowledgeUpdateResult>

/** Build the completion check a supervised KB update uses to stop only when the KB is ready. */
export function knowledgeReadinessDeliverable(
  options: Pick<
    SupervisedKnowledgeUpdateOptions,
    'root' | 'goal' | 'readiness' | 'readinessSpecs' | 'readinessTaskId' | 'readinessOptions'
  >,
): DeliverableSpec<unknown> {
  return {
    describe: `knowledge base at ${options.root} is ready for: ${options.goal}`,
    async check() {
      const result = await options.readiness({
        root: options.root,
        goal: options.goal,
        readinessSpecs: options.readinessSpecs,
        readinessTaskId: options.readinessTaskId,
        readiness: options.readinessOptions,
      })
      return typeof result === 'boolean' ? result : result.ready
    },
  }
}

/** Create an `improveKnowledgeBase` update callback backed by runtime supervision. */
export function createSupervisedKnowledgeUpdater(
  options: SupervisedKnowledgeUpdateOptions,
): SupervisedKnowledgeUpdater {
  return (input) =>
    runSupervisedKnowledgeUpdate({
      ...options,
      root: input.candidateRoot ?? input.root ?? options.root,
      goal: input.goal ?? options.goal,
      findings: input.findings ?? options.findings,
      metadata: { ...options.metadata, ...input.metadata },
    })
}

/** Run a runtime supervisor that updates one candidate knowledge base and stops on readiness. */
export async function runSupervisedKnowledgeUpdate(
  options: SupervisedKnowledgeUpdateOptions,
): Promise<SupervisedKnowledgeUpdateResult> {
  const exactSupervisor = agentProfileSchema.parse(options.supervisorProfile) as SupervisorProfile
  assertExecutableAgentProfile(exactSupervisor, 'runSupervisedKnowledgeUpdate')
  const baseInstructions = exactSupervisor.prompt?.systemPrompt ?? RESEARCH_SUPERVISOR_SYSTEM_PROMPT
  const workerContract = RESEARCHER_SYSTEM_PROMPT
  const systemPrompt = workerContract
    ? `${baseInstructions}\n\nEach researcher worker you spawn follows this contract:\n${workerContract}`
    : baseInstructions

  const profile: SupervisorProfile = {
    ...exactSupervisor,
    prompt: { ...exactSupervisor.prompt, systemPrompt },
  }
  const run = options.runSupervised ?? supervise
  const task = formatSupervisedKnowledgeTask(options)
  const supervised = await run(profile, task, {
    ...options.superviseOptions,
    budget: options.budget,
    backend: options.backend,
    deliverable: knowledgeReadinessDeliverable(options),
    makeWorkerAgent: options.makeWorkerAgent,
    allowedModels: options.allowedModels,
  })
  return {
    applied: supervised.kind === 'winner',
    summary:
      supervised.kind === 'winner'
        ? 'research supervisor completed and the knowledge base passed readiness'
        : `research supervisor stopped without a ready knowledge base: ${supervised.reason}`,
    supervised,
    metadata: {
      supervised: true,
      root: options.root,
      goal: options.goal,
      result: supervised.kind,
    },
  }
}

/** Format the supervisor task with the KB root, readiness requirements, current findings, and metadata. */
export function formatSupervisedKnowledgeTask(
  options: Pick<
    SupervisedKnowledgeUpdateOptions,
    'root' | 'goal' | 'readinessSpecs' | 'readinessTaskId' | 'findings' | 'metadata'
  >,
): string {
  const sections = [
    `Goal: ${options.goal}`,
    `Knowledge base root: ${options.root}`,
    options.readinessTaskId ? `Readiness task id: ${options.readinessTaskId}` : undefined,
    options.readinessSpecs?.length
      ? `Readiness specs:\n${JSON.stringify(options.readinessSpecs, null, 2)}`
      : undefined,
    options.findings?.length
      ? `Current findings:\n${JSON.stringify(options.findings, null, 2)}`
      : undefined,
    options.metadata && Object.keys(options.metadata).length > 0
      ? `Metadata:\n${JSON.stringify(options.metadata, null, 2)}`
      : undefined,
  ].filter((section): section is string => Boolean(section))
  return `${sections.join('\n\n')}\n\nUpdate files under the knowledge base root only. Stop when the readiness check passes.`
}
