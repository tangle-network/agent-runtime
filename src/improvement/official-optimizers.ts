import { isDeepStrictEqual } from 'node:util'
import { canonicalJson } from '@tangle-network/agent-eval'
import {
  type GepaOptimizationMethodConfig,
  gepaOptimizationMethod,
  type JudgeScore,
  type OptimizationMethod,
  type SkillOptOptimizationMethodConfig,
  skillOptOptimizationMethod,
} from '@tangle-network/agent-eval/campaign'
import { canonicalCandidateDigest } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import { defaultRedactor } from '../redact'
import type { ImproveMethodContext, ImproveMethodFactory } from './improve'

const defaultMaxFindingsChars = 50_000
const pythonClientDocs = 'https://github.com/tangle-network/agent-eval/tree/main/clients/python'
const gepaInstall =
  '`python -m pip install agent-eval-rpc`, then ' +
  '`python -m pip install "gepa[full] @ git+https://github.com/gepa-ai/gepa.git@f919db0a622e2e9f9204779b81fe00cc1b2d808f"`'
const skillOptInstall =
  '`python -m pip install agent-eval-rpc`, then ' +
  '`python -m pip install "skillopt @ git+https://github.com/microsoft/SkillOpt.git@61735e3922efc2b90c6d6cab561e62e98452ca90"`'

/** Runtime context appended to an official optimizer's own configuration. */
export interface OfficialOptimizerContextOptions {
  /** Context supplied to the optimizer before Runtime appends the profile surface and findings. */
  background?: string
  /** Include current trace or analyst findings in the optimizer background. Default true. */
  includeFindings?: boolean
  /** Reject oversized serialized findings before starting Python. Default 50,000 characters. */
  maxFindingsChars?: number
}

/** Official GEPA configuration plus bounded Runtime findings context. */
export type OfficialGepaOptions<
  TScenario extends { id: string; kind: string },
  TArtifact = unknown,
> = Omit<GepaOptimizationMethodConfig<TScenario, TArtifact>, 'background' | 'evaluationId'> &
  OfficialOptimizerContextOptions

/** Official SkillOpt configuration plus bounded Runtime findings context. */
export type OfficialSkillOptOptions<
  TScenario extends { id: string; kind: string },
  TArtifact = unknown,
> = Omit<SkillOptOptimizationMethodConfig<TScenario, TArtifact>, 'background' | 'evaluationId'> &
  OfficialOptimizerContextOptions

/** Missing optional Python dependencies for an official optimizer. */
export class OfficialOptimizerUnavailableError extends ConfigError {
  readonly optimizer: 'gepa' | 'skillopt'

  constructor(optimizer: 'gepa' | 'skillopt', cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    const install =
      optimizer === 'gepa'
        ? `Install the Python bridge and pinned GEPA source: ${gepaInstall}.`
        : `Install Microsoft SkillOpt: ${skillOptInstall}.`
    super(
      [
        `Official ${optimizer === 'gepa' ? 'GEPA' : 'SkillOpt'} could not start.`,
        'Runtime did not use a local fallback.',
        install,
        `Setup: ${pythonClientDocs}.`,
        `Cause: ${detail}`,
      ].join(' '),
      { cause },
    )
    this.optimizer = optimizer
  }
}

/**
 * Build a complete method backed by GEPA's official Optimize Anything API.
 *
 * The recipe is passed through unchanged. Use `engine`, `sequential`,
 * `adaptive-sequential`, `best-of`, `vote`, or `omni` explicitly.
 */
export function officialGepa<TScenario extends { id: string; kind: string }, TArtifact = unknown>(
  options: OfficialGepaOptions<TScenario, TArtifact>,
): ImproveMethodFactory<TScenario, TArtifact> {
  const {
    background,
    includeFindings = true,
    maxFindingsChars,
    describeScenario,
    describeArtifact,
    ...config
  } = options
  assertMaxFindingsChars('officialGepa', maxFindingsChars)
  assertSafeCallerText('officialGepa', 'objective', config.objective)
  return (context) => {
    assertSafeOptimizerSurface('officialGepa', context)
    return withDependencyHelp(
      'gepa',
      context.evaluationRef,
      gepaOptimizationMethod<TScenario, TArtifact>({
        ...config,
        evaluationId: context.evaluationRef,
        background: methodBackground({
          context,
          background,
          includeFindings,
          maxFindingsChars,
          label: 'officialGepa',
        }),
        describeScenario: (scenario) =>
          redactOptimizerEvidence(describeScenario ? describeScenario(scenario) : scenario),
        describeArtifact: (artifact, scenario) =>
          redactOptimizerEvidence(
            describeArtifact ? describeArtifact(artifact, scenario) : artifact,
          ),
      }),
    )
  }
}

/** Build a complete method backed by Microsoft's official SkillOpt trainer. */
export function officialSkillOpt<
  TScenario extends { id: string; kind: string },
  TArtifact = unknown,
>(
  options: OfficialSkillOptOptions<TScenario, TArtifact>,
): ImproveMethodFactory<TScenario, TArtifact> {
  const {
    background,
    includeFindings = true,
    maxFindingsChars,
    describeScenario,
    describeArtifact,
    ...config
  } = options
  assertMaxFindingsChars('officialSkillOpt', maxFindingsChars)
  assertSafeCallerText('officialSkillOpt', 'objective', config.objective)
  return (context) => {
    assertSafeOptimizerSurface('officialSkillOpt', context)
    return withDependencyHelp(
      'skillopt',
      context.evaluationRef,
      skillOptOptimizationMethod<TScenario, TArtifact>({
        ...config,
        evaluationId: context.evaluationRef,
        background: methodBackground({
          context,
          background,
          includeFindings,
          maxFindingsChars,
          label: 'officialSkillOpt',
        }),
        describeScenario: (scenario) =>
          redactOptimizerEvidence(describeScenario ? describeScenario(scenario) : scenario),
        describeArtifact: (artifact, scenario) =>
          redactOptimizerEvidence(
            describeArtifact ? describeArtifact(artifact, scenario) : artifact,
          ),
      }),
    )
  }
}

function assertMaxFindingsChars(label: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new ConfigError(`${label}: maxFindingsChars must be a positive safe integer`)
  }
}

function methodBackground(options: {
  context: ImproveMethodContext
  background: string | undefined
  includeFindings: boolean
  maxFindingsChars: number | undefined
  label: string
}): string {
  const {
    context,
    background,
    includeFindings,
    maxFindingsChars = defaultMaxFindingsChars,
    label,
  } = options
  assertSafeCallerText(label, 'background', background)
  assertSafeCallerText(label, 'profile name', context.profile.name)
  const sections = [
    background?.trim(),
    `Agent profile: ${context.profile.name}. Surface: ${context.surface}.`,
  ].filter((value): value is string => Boolean(value))
  if (includeFindings && context.findings.length > 0) {
    let serialized: string
    try {
      serialized = canonicalJson(defaultRedactor(context.findings))
    } catch (cause) {
      throw new ConfigError(`${label}: findings must be JSON-serializable`, { cause })
    }
    if (serialized.length > maxFindingsChars) {
      throw new ConfigError(
        `${label}: serialized findings exceed maxFindingsChars (${serialized.length} > ${maxFindingsChars})`,
      )
    }
    sections.push(`Observed failures:\n${serialized}`)
  }
  return sections.join('\n\n')
}

function assertSafeOptimizerSurface(label: string, context: ImproveMethodContext): void {
  const redactedValue = defaultRedactor(context.baselineValue)
  const redactedSurface = defaultRedactor(context.baselineSurface)
  if (
    !isDeepStrictEqual(context.baselineValue, redactedValue) ||
    !isDeepStrictEqual(context.baselineSurface, redactedSurface)
  ) {
    throw new ConfigError(
      `${label}: the selected profile surface contains a common credential or private value. ` +
        'Store live credentials as provider references, or remove private data before starting an external optimizer.',
    )
  }
}

function redactOptimizerEvidence(value: unknown): unknown {
  return defaultRedactor(value)
}

function redactJudgeScore(score: JudgeScore): JudgeScore {
  const notes = defaultRedactor(score.notes)
  return {
    ...score,
    notes: typeof notes === 'string' ? notes : '[redacted]',
  }
}

function assertSafeCallerText(label: string, field: string, value: string | undefined): void {
  if (value !== undefined && defaultRedactor(value) !== value) {
    throw new ConfigError(
      `${label}: ${field} contains a common credential or private value. Sanitize it before starting an external optimizer.`,
    )
  }
}

function withDependencyHelp<TScenario extends { id: string; kind: string }, TArtifact>(
  optimizer: 'gepa' | 'skillopt',
  evaluationRef: ImproveMethodContext['evaluationRef'],
  method: OptimizationMethod<TScenario, TArtifact>,
): OptimizationMethod<TScenario, TArtifact> {
  return {
    ...method,
    async optimize(input) {
      try {
        const judges = input.judges.map((judge) =>
          Object.freeze({
            ...judge,
            judgeVersion: canonicalCandidateDigest({
              evaluationRef,
              name: judge.name,
              dimensions: judge.dimensions,
              judgeVersion: judge.judgeVersion ?? null,
              outwardEvidence: 'default-redactor',
            }),
            async score(scoreInput: Parameters<typeof judge.score>[0]) {
              return redactJudgeScore(await judge.score(scoreInput))
            },
          }),
        )
        return await method.optimize({
          ...input,
          judges: Object.freeze(judges),
        })
      } catch (cause) {
        if (isMissingDependency(optimizer, cause)) {
          throw new OfficialOptimizerUnavailableError(optimizer, cause)
        }
        throw cause
      }
    },
  }
}

function isMissingDependency(optimizer: 'gepa' | 'skillopt', cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  const common = [
    `${optimizer === 'gepa' ? 'GEPA' : 'SkillOpt'} bridge could not start`,
    'source inspection could not start',
    "No module named 'agent_eval_rpc'",
    `No module named 'agent_eval_rpc.${optimizer === 'gepa' ? 'gepa_bridge' : 'skillopt_bridge'}'`,
  ]
  const specific =
    optimizer === 'gepa'
      ? [
          'requires GEPA',
          "requires GEPA's Optimize Anything",
          "No module named 'gepa'",
          'gepa is importable but its package metadata is unavailable',
        ]
      : [
          'requires skillopt',
          'requires SkillOpt',
          "No module named 'skillopt'",
          'skillopt is importable but its package metadata is unavailable',
        ]
  return [...common, ...specific].some((fragment) => message.includes(fragment))
}
