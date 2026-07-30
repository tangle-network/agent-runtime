import type { AgentProfile } from '@tangle-network/agent-interface'
import type { RagKnowledgeUpdateResult } from '@tangle-network/agent-knowledge'
import type { DeliverableSpec } from '../runtime/supervise/completion-gate'
import { type SuperviseOptions, supervise } from '../runtime/supervise/supervise'
import type { SupervisedResult } from '../runtime/supervise/types'

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
  leaderProfile: AgentProfile
  /** Complete runtime policy. */
  superviseOptions: SuperviseOptions
  runSupervised?: (
    profile: AgentProfile,
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
  const run = options.runSupervised ?? supervise
  const task = formatSupervisedKnowledgeTask(options)
  const supervised = await run(options.leaderProfile, task, options.superviseOptions)
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
