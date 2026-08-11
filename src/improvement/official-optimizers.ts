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
import {
  defaultRedactor,
  defaultRedactorIdentityMaterial,
  type Redactor,
  resolveRedactor,
} from '../redact'
import type {
  ImproveCandidateValidationInput,
  ImproveMethodContext,
  ImproveMethodFactory,
} from './improve'
import { withMethodRuntimeControls } from './method-controls'

const defaultMaxFindingsChars = 50_000
const pythonClientDocs = 'https://github.com/tangle-network/agent-eval/tree/main/clients/python'
const bridgeInstall = '`python -m pip install "agent-eval-rpc==0.144.10"`'
const gepaWheelInstall = '`python -m pip install "gepa[full]==0.1.4"`'
const gepaSourceInstall =
  '`python -m pip install "gepa[full] @ git+https://github.com/gepa-ai/gepa.git@f919db0a622e2e9f9204779b81fe00cc1b2d808f"`'
const skillOptInstall =
  `${bridgeInstall}, then ` +
  '`python -m pip install "skillopt @ git+https://github.com/microsoft/SkillOpt.git@61735e3922efc2b90c6d6cab561e62e98452ca90"`'

/** Runtime context appended to an official optimizer's own configuration. */
export interface OfficialOptimizerContextOptions {
  /** Context supplied to the optimizer before Runtime appends the profile surface and findings. */
  background?: string
  /** Include current trace or analyst findings in the optimizer background. Default true. */
  includeFindings?: boolean
  /** Reject oversized serialized findings before starting Python. Default 50,000 characters. */
  maxFindingsChars?: number
  /**
   * Redact caller-supplied context and descriptors before they leave Runtime.
   * The built-in redactor is the default. Pass `false` only for public data
   * that has already been reviewed.
   */
  redact?: Redactor | false
  /** Authorize one exact candidate containing structurally sensitive fields.
   * The callback must return true for every accepted baseline and candidate. */
  authorizeSensitiveCandidate?: (input: OfficialSensitiveCandidateInput) => boolean
}

export interface OfficialSensitiveCandidateInput extends ImproveCandidateValidationInput {
  sensitivePaths: readonly string[]
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
        ? [
            `Install the Python bridge: ${bridgeInstall}.`,
            `The direct GEPA engine uses the published wheel: ${gepaWheelInstall}.`,
            `Composed recipes and source-only engines use the tested source revision: ${gepaSourceInstall}.`,
          ].join(' ')
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
    redact,
    authorizeSensitiveCandidate,
    ...config
  } = options
  const redactor = resolveRedactor(redact)
  const redactionPolicyRef = optimizerRedactionPolicyRef(redact)
  assertMaxFindingsChars('officialGepa', maxFindingsChars)
  const objective = redactOptimizerText('officialGepa', 'objective', config.objective, redactor)
  return (context) => {
    const externalEvaluationRef = optimizerEvidencePolicyRef({
      runtimeEvaluationRef: context.evaluationRef,
      redactionPolicyRef,
      describeScenario,
      describeArtifact,
      authorizeSensitiveCandidate,
    })
    const method = withDependencyHelp(
      'gepa',
      externalEvaluationRef,
      redactor,
      redactionPolicyRef,
      gepaOptimizationMethod<TScenario, TArtifact>({
        ...config,
        objective,
        evaluationId: externalEvaluationRef,
        background: methodBackground({
          context,
          background,
          includeFindings,
          maxFindingsChars,
          label: 'officialGepa',
          redactor,
        }),
        ...(describeScenario
          ? {
              describeScenario: (scenario) =>
                redactOptimizerEvidence(
                  'officialGepa',
                  'scenario descriptor',
                  describeScenario(scenario),
                  redactor,
                ),
            }
          : {}),
        ...(describeArtifact
          ? {
              describeArtifact: (artifact, scenario) =>
                redactOptimizerEvidence(
                  'officialGepa',
                  'artifact descriptor',
                  describeArtifact(artifact, scenario),
                  redactor,
                ),
            }
          : {}),
      }),
    )
    return withMethodRuntimeControls(method, {
      costAttribution: 'optimizer-run',
      validateCandidate: (input) =>
        assertSafeOptimizerCandidate('officialGepa', input, authorizeSensitiveCandidate),
    })
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
    redact,
    authorizeSensitiveCandidate,
    ...config
  } = options
  const redactor = resolveRedactor(redact)
  const redactionPolicyRef = optimizerRedactionPolicyRef(redact)
  assertMaxFindingsChars('officialSkillOpt', maxFindingsChars)
  const objective = redactOptimizerText('officialSkillOpt', 'objective', config.objective, redactor)
  return (context) => {
    const externalEvaluationRef = optimizerEvidencePolicyRef({
      runtimeEvaluationRef: context.evaluationRef,
      redactionPolicyRef,
      describeScenario,
      describeArtifact,
      authorizeSensitiveCandidate,
    })
    const method = withDependencyHelp(
      'skillopt',
      externalEvaluationRef,
      redactor,
      redactionPolicyRef,
      skillOptOptimizationMethod<TScenario, TArtifact>({
        ...config,
        objective,
        evaluationId: externalEvaluationRef,
        background: methodBackground({
          context,
          background,
          includeFindings,
          maxFindingsChars,
          label: 'officialSkillOpt',
          redactor,
        }),
        ...(describeScenario
          ? {
              describeScenario: (scenario) =>
                redactOptimizerEvidence(
                  'officialSkillOpt',
                  'scenario descriptor',
                  describeScenario(scenario),
                  redactor,
                ),
            }
          : {}),
        ...(describeArtifact
          ? {
              describeArtifact: (artifact, scenario) =>
                redactOptimizerEvidence(
                  'officialSkillOpt',
                  'artifact descriptor',
                  describeArtifact(artifact, scenario),
                  redactor,
                ),
            }
          : {}),
      }),
    )
    return withMethodRuntimeControls(method, {
      costAttribution: 'optimizer-run',
      validateCandidate: (input) =>
        assertSafeOptimizerCandidate('officialSkillOpt', input, authorizeSensitiveCandidate),
    })
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
  redactor: Redactor
}): string {
  const {
    context,
    background,
    includeFindings,
    maxFindingsChars = defaultMaxFindingsChars,
    label,
    redactor,
  } = options
  const safeBackground =
    background === undefined
      ? undefined
      : redactOptimizerText(label, 'background', background, redactor)
  const safeProfileName =
    context.profile.name === undefined
      ? undefined
      : redactOptimizerText(label, 'profile name', context.profile.name, redactor)
  const sections = [
    safeBackground?.trim(),
    safeProfileName
      ? `Agent profile: ${safeProfileName}. Surface: ${context.surface}.`
      : `Agent surface: ${context.surface}.`,
  ].filter((value): value is string => Boolean(value))
  if (includeFindings && context.findings.length > 0) {
    let serialized: string
    try {
      serialized = canonicalJson(
        redactOptimizerEvidence(label, 'findings', context.findings, redactor),
      )
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

function assertSafeOptimizerCandidate(
  label: string,
  input: ImproveCandidateValidationInput,
  authorizeSensitiveCandidate: ((input: OfficialSensitiveCandidateInput) => boolean) | undefined,
): void {
  const redactedValue = defaultRedactor(input.value)
  const redactedSurface = defaultRedactor(input.candidateSurface)
  if (
    !isDeepStrictEqual(input.value, redactedValue) ||
    !isDeepStrictEqual(input.candidateSurface, redactedSurface)
  ) {
    throw new ConfigError(
      `${label}: the selected profile surface contains a common credential or private value. ` +
        'Store live credentials as provider references, or remove private data before starting an external optimizer.',
    )
  }
  const sensitivePaths = sensitiveProfileSurfacePaths(input)
  if (sensitivePaths.length === 0) return
  let authorized = false
  if (authorizeSensitiveCandidate) {
    try {
      authorized =
        authorizeSensitiveCandidate(
          Object.freeze({
            ...input,
            sensitivePaths: Object.freeze([...sensitivePaths]),
          }),
        ) === true
    } catch (cause) {
      throw new ConfigError(`${label}: sensitive candidate authorization failed`, { cause })
    }
  }
  if (!authorized) {
    throw new ConfigError(
      `${label}: the selected profile surface contains fields that may carry private values: ` +
        `${sensitivePaths.slice(0, 8).join(', ')}. Remove them, replace values with safe references, ` +
        'or authorize the exact profile with authorizeSensitiveCandidate.',
    )
  }
}

function sensitiveProfileSurfacePaths(input: ImproveCandidateValidationInput): string[] {
  const paths = new Set<string>()
  if (
    input.surface === 'tools' ||
    input.surface === 'mcp' ||
    input.surface === 'hooks' ||
    input.surface === 'subagents' ||
    input.surface === 'agent-profile'
  ) {
    paths.add('$')
  }
  const seen = new WeakSet<object>()
  const visit = (current: unknown, path: string): void => {
    if (current === null || typeof current !== 'object') return
    if (seen.has(current)) return
    seen.add(current)
    if (Array.isArray(current)) {
      current.forEach((child, index) => {
        visit(child, `${path}[${index}]`)
      })
      return
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const childPath = `${path}.${key}`
      if (['env', 'headers', 'url', 'metadata', 'extensions'].includes(key.toLowerCase())) {
        paths.add(childPath)
        continue
      }
      visit(child, childPath)
    }
  }
  visit(input.value, '$')
  return [...paths]
}

function redactOptimizerEvidence(
  label: string,
  field: string,
  value: unknown,
  redactor: Redactor,
): unknown {
  try {
    return redactor(value)
  } catch (cause) {
    throw new ConfigError(`${label}: ${field} redaction failed`, { cause })
  }
}

function redactOptimizerText(
  label: string,
  field: string,
  value: string,
  redactor: Redactor,
): string {
  const redacted = redactOptimizerEvidence(label, field, value, redactor)
  if (typeof redacted !== 'string' || !redacted.trim()) {
    throw new ConfigError(`${label}: ${field} redaction must return a non-empty string`)
  }
  return redacted
}

function redactJudgeScore(score: JudgeScore, redactor: Redactor): JudgeScore {
  const notes = redactOptimizerEvidence('official optimizer', 'judge notes', score.notes, redactor)
  return {
    ...score,
    notes: typeof notes === 'string' ? notes : '[redacted]',
  }
}

export function optimizerRedactionPolicyRef(
  redact: Redactor | false | undefined,
  builtInIdentity: unknown = defaultRedactorIdentityMaterial(),
): string {
  if (redact === false) return 'caller-approved-raw'
  return canonicalCandidateDigest({
    kind: redact === undefined ? 'default-redactor' : 'caller-redactor-with-default',
    builtIn: builtInIdentity,
    ...(redact === undefined
      ? {}
      : {
          callerSource: Function.prototype.toString.call(redact),
          composition: Function.prototype.toString.call(resolveRedactor),
        }),
  })
}

function optimizerEvidencePolicyRef(input: {
  runtimeEvaluationRef: ImproveMethodContext['evaluationRef']
  redactionPolicyRef: string
  describeScenario: unknown
  describeArtifact: unknown
  authorizeSensitiveCandidate: unknown
}): ReturnType<typeof canonicalCandidateDigest> {
  return canonicalCandidateDigest({
    runtimeEvaluationRef: input.runtimeEvaluationRef,
    redactionPolicyRef: input.redactionPolicyRef,
    describeScenario: callbackSource(input.describeScenario),
    describeArtifact: callbackSource(input.describeArtifact),
    authorizeSensitiveCandidate: callbackSource(input.authorizeSensitiveCandidate),
  })
}

function callbackSource(callback: unknown): string | null {
  return typeof callback === 'function' ? Function.prototype.toString.call(callback) : null
}

function withDependencyHelp<TScenario extends { id: string; kind: string }, TArtifact>(
  optimizer: 'gepa' | 'skillopt',
  evaluationRef: ImproveMethodContext['evaluationRef'],
  redactor: Redactor,
  redactionPolicyRef: string,
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
              outwardEvidence: redactionPolicyRef,
            }),
            async score(scoreInput: Parameters<typeof judge.score>[0]) {
              return redactJudgeScore(await judge.score(scoreInput), redactor)
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
