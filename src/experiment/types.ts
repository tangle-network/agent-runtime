/**
 * The deliberation-policy experiment substrate: a typed ledger that records one
 * row per {task, target, arm, rep} of a compute-matched agent comparison.
 *
 * The unit of optimization is the induced *deliberation policy* (a point in the
 * eight-axis space below), realized as an {@link AgentProfile}. This module owns
 * the schema; `./ledger` owns persistence/summary and `./integrity` owns the
 * capture-integrity guards. It is presentation-free: report rendering is an
 * injected callback so the substrate carries no formatting opinion.
 */
import type { AgentProfile } from '../runtime'

export const policyOrigins = [
  'baseline',
  'manual',
  'compiler_generated',
  'artifact_replay',
] as const
export type PolicyOrigin = (typeof policyOrigins)[number]

export const armRoles = ['baseline', 'treatment', 'control', 'safety'] as const
export type ArmRole = (typeof armRoles)[number]

export const experimentObjectives = [
  'quality',
  'qoq',
  'pareto',
  'transfer',
  'non_universality',
  'safety',
] as const
export type ExperimentObjective = (typeof experimentObjectives)[number]

export const evidenceKinds = [
  'stateful-agent',
  'carrier-control',
  'sandbox-agent-profile',
  'agentic-surface',
  'benchmark',
  'artifact-replay',
] as const
export type EvidenceKind = (typeof evidenceKinds)[number]

export const runAdapterKinds = [
  'fixture',
  'router-chat',
  'open-sandbox-run',
  'run-agentic',
  'run-benchmark',
  'run-eval-campaign',
  'artifact-replay',
] as const
export type RunAdapterKind = (typeof runAdapterKinds)[number]

/** Recommended carrier levels. The schema accepts any string so consumers are
 *  not locked into this vocabulary; these are the levels the substrate documents. */
export const recommendedCarriers = [
  'original_text',
  'shorter_text',
  'deletion_text',
  'shorter_then_deletion_text',
  'image',
  'shorter_text_image',
  'audio',
  'hybrid',
] as const
export const recommendedPromptTransformations = [
  'none',
  'compress',
  'delete',
  'shorten_then_delete',
  'render_image',
  'render_audio',
  'workflow_directive',
  'other',
] as const

export interface ReasoningBudgetPolicy {
  readonly kind:
    | 'fixed_tokens'
    | 'adaptive_tokens'
    | 'max_turns'
    | 'samples'
    | 'wall_time'
    | 'effort_flag'
    | 'none'
  readonly maxTokens?: number
  readonly maxTurns?: number
  readonly samples?: number
  readonly wallClockMs?: number
  readonly effort?: string
}

/** The eight axes of a deliberation policy. `carrier` and `promptTransformation`
 *  are intentionally open strings (see {@link recommendedCarriers}); the
 *  remaining axes use the documented level sets. */
export interface DeliberationPolicyAxes {
  readonly carrier: string
  readonly promptTransformation: string
  readonly reasoningRepresentation:
    | 'answer_only'
    | 'draft'
    | 'equations'
    | 'prose'
    | 'pseudocode'
    | 'evidence_first'
    | 'verify_only'
    | 'concise_plan'
    | 'tool_contract'
  readonly reasoningBudget: ReasoningBudgetPolicy
  readonly sampling:
    | 'single'
    | 'one_long_trace'
    | 'many_short_traces'
    | 'self_consistency'
    | 'panel'
    | 'fanout_vote'
  readonly verification:
    | 'none'
    | 'self_check'
    | 'independent_verifier'
    | 'early_exit'
    | 'verifier_only'
    | 'tool_state_check'
  readonly stopRule:
    | 'fixed'
    | 'confidence_threshold'
    | 'no_change'
    | 'verifier_pass'
    | 'budget_cap'
    | 'validator_success'
  readonly outputContract:
    | 'final_answer'
    | 'structured_final'
    | 'json'
    | 'patch'
    | 'artifact'
    | 'runtime_tool_loop'
    | 'agent_profile_skill_tool'
}

export interface DeploymentTarget {
  readonly id: string
  readonly model: string
  readonly provider?: string
  readonly runtime?: 'router' | 'sandbox' | 'local' | 'fixture' | 'artifact'
  readonly tokenizer?: string
  readonly quantization?: string
  readonly servingStack?: string
}

export interface TaskSlice {
  readonly id: string
  readonly family: string
  readonly split:
    | 'train'
    | 'dev'
    | 'holdout'
    | 'fresh_holdout'
    | 'source_adapted'
    | 'no_match'
    | 'off_family'
    | 'smoke'
  readonly taskId: string
  readonly source?: string
  readonly frozenHash?: string
  readonly input?: unknown
}

export interface ExperimentArm {
  readonly id: string
  readonly role: ArmRole
  readonly origin: PolicyOrigin
  readonly description: string
  readonly policy: DeliberationPolicyAxes
  readonly runtime?: {
    readonly adapter: RunAdapterKind
    readonly evidenceKind: EvidenceKind
    readonly agentProfile?: AgentProfile
    readonly profileId?: string
    readonly notes?: readonly string[]
  }
}

export interface ExperimentCampaignManifest {
  readonly schemaVersion: 1
  readonly campaignId: string
  readonly title: string
  readonly researchQuestion: string
  readonly objective: ExperimentObjective
  readonly createdAt: string
  readonly preregistrationHash?: string
  readonly configHash?: string
  readonly taskSlices: readonly TaskSlice[]
  readonly deploymentTargets: readonly DeploymentTarget[]
  readonly arms: readonly ExperimentArm[]
  readonly reps: number
  readonly notes?: readonly string[]
}

export interface ExperimentCellSpec {
  readonly campaignId: string
  readonly configHash: string
  readonly cellId: string
  readonly task: TaskSlice
  readonly target: DeploymentTarget
  readonly arm: ExperimentArm
  readonly rep: number
  readonly seed: number
}

export interface UsageMeasurement {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens?: number
  readonly costUsd: number
  readonly latencyMs: number
}

export interface RunEvidence {
  readonly score: number | null
  readonly passed: boolean | null
  readonly usage: UsageMeasurement
  readonly outputContractValid: boolean | null
  readonly providerError?: string
  readonly failureClass?: string
  readonly metrics?: Record<string, number>
  readonly tracePointers?: Record<string, string | null>
  readonly raw?: unknown
}

export interface ExperimentCellRecord extends ExperimentCellSpec {
  readonly schemaVersion: 1
  readonly recordedAt: string
  readonly adapter: RunAdapterKind
  readonly evidenceKind: EvidenceKind
  readonly result: RunEvidence
}

export interface CampaignSummaryArm {
  readonly armId: string
  readonly role: ArmRole
  readonly origin: PolicyOrigin
  readonly cells: number
  readonly scoredCells: number
  readonly meanScore: number | null
  readonly passRate: number | null
  readonly totalCostUsd: number
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly latencyMs: {
    readonly min: number | null
    readonly median: number | null
    readonly p90: number | null
    readonly max: number | null
  }
}

/** Capture-integrity counters computed by construction over the ledger. A
 *  non-zero `zeroUsageRealCells` is the canonical fake-backend alarm: a live
 *  cell that scored while spending no tokens and no dollars. */
export interface CampaignIntegrity {
  readonly zeroUsageRealCells: number
  readonly meteringUnavailableCells: number
  readonly erroredCells: number
  readonly unscoredCells: number
}

export interface CampaignSummary {
  readonly campaignId: string
  readonly configHash: string
  readonly cells: number
  readonly arms: readonly CampaignSummaryArm[]
  readonly byEvidenceKind: Record<string, number>
  readonly byAdapter: Record<string, number>
  readonly integrity: CampaignIntegrity
}

export interface CampaignArtifact {
  readonly schemaVersion: 1
  readonly manifest: ExperimentCampaignManifest
  readonly summary: CampaignSummary
  readonly cells: readonly ExperimentCellRecord[]
}

export interface CampaignAdapter {
  readonly kind: RunAdapterKind
  readonly evidenceKind: EvidenceKind
  runCell(cell: ExperimentCellSpec): Promise<RunEvidence>
}

export type CampaignAdapterRegistry = Partial<Record<RunAdapterKind, CampaignAdapter>>

/** Renders a campaign artifact to markdown. Injected into
 *  {@link writeCampaignArtifact} so the substrate stays presentation-free. */
export type CampaignReportRenderer = (artifact: CampaignArtifact) => string
