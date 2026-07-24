/**
 *
 * `improve` — the ONE public, surface-pluggable RSI verb.
 *
 * A thin facade over agent-eval's `selfImprove` (the held-out-gated closed
 * loop). It removes the two things a caller otherwise has to know to drive the
 * loop by hand: WHICH `MutableSurface` of the profile is being optimized, and
 * WHICH `SurfaceProposer` mutates that surface. You name a `surface`; the
 * facade picks the matching default proposer, extracts the baseline surface from
 * the profile, and runs `selfImprove`. It returns a frozen candidate and never
 * changes the input profile or caller-owned state.
 *
 *   - `surface: 'prompt'` → `gepaProposer` mutates `profile.prompt.systemPrompt`.
 *   - `surface: 'skills'` → `skillOptProposer` mutates one named inline skill.
 *   - `surface: 'memory'` → `memoryCurationProposer` curates the profile's
 *     additional instructions as bounded durable lessons.
 *   - `surface: 'rollout-policy'` → `rolloutPolicyProposer` mutates the
 *     inference-time `StructuralRolloutPolicy` dials ({ k, repairRounds, testgen })
 *     persisted in `profile.extensions['structural-rollout']` — deterministic
 *     bounded neighbor enumeration; the held-out gate does the deciding. No-op
 *     (nothing proposed, nothing shipped) when the profile has no such extension.
 *   - `surface: 'agent-profile'` → caller-supplied proposer mutates the complete
 *     canonical AgentProfile JSON in one candidate.
 *   - `surface` ∈ {`tools`, `mcp`, `hooks`, `subagents`, `agent-profile`} → no zero-config default
 *     proposer exists (a code/config proposer needs caller-supplied wiring — a
 *     worktree repo root, a candidate generator, a serializer). The facade
 *     requires an explicit `opts.generator` for these and throws a `ConfigError`
 *     otherwise. This is a designed boundary, not a missing default: there is
 *     no safe value the facade could invent for those surfaces. Code instead
 *     requires `opts.code.repoRoot` and accepts only the runtime-owned
 *     `opts.code.generator` path so every isolated checkout can be released.
 *
 * Everything else (`scenarios`, `judge`, `agent`, `budget`, `llm`) passes
 * straight through to `selfImprove`.
 *
 * @experimental
 */

import { canonicalJson, makeFinding } from '@tangle-network/agent-eval'
import {
  gepaProposer,
  gitWorktreeAdapter,
  memoryCurationProposer,
  type ProfileDispatchFn,
  skillOptProposer,
  type Worktree,
  type WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'
import {
  type CodeSurface,
  type MutableSurface,
  type Scenario,
  type SelfImproveBudget,
  type SelfImproveLlm,
  type SelfImproveOptions,
  type SelfImproveResult,
  type SurfaceProposer,
  selfImprove,
} from '@tangle-network/agent-eval/contract'
import {
  type AgentProfile,
  type AgentProfileResourceRef,
  agentProfileSchema,
} from '@tangle-network/agent-interface'
import { immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import type { LocalHarness } from '../mcp/local-harness'
import { assertModelAllowed } from '../runtime/supervise/model-policy'
import { agenticGenerator, type Verifier } from './agentic-generator'
import { rethrowAfterCleanup } from './cleanup'
import {
  type CandidateGenerator,
  improvementDriver,
  type ManagedImprovementDriver,
} from './improvement-driver'
import { rawTraceDistiller } from './raw-trace-distiller'
import {
  applyRolloutPolicyToProfile,
  normalizeRolloutPolicy,
  rolloutPolicyProposer,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from './rollout-policy'

/** The executable agent lever `improve` optimizes. Profile fields remain
 *  portable AgentProfile coordinates; implementation and orchestration files
 *  use the code surface so a winner can be sealed into an exact candidate.
 *  `rollout-policy` is the inference-time structuralRollout dials
 *  (`profile.extensions['structural-rollout']`). */
export type ImproveSurface =
  | 'prompt'
  | 'skills'
  | 'tools'
  | 'mcp'
  | 'hooks'
  | 'subagents'
  | 'agent-profile'
  | 'memory'
  | 'code'
  | 'rollout-policy'

export interface ImproveOptions<TScenario extends Scenario, TArtifact>
  extends Omit<
    SelfImproveOptions<TScenario, TArtifact>,
    'agent' | 'analyzeGeneration' | 'baselineSurface' | 'findings' | 'gate' | 'proposer'
  > {
  /** Dispatch the mutable surface directly when the host already owns that seam.
   * Exactly one of `agent` or `profileDispatch` is required. */
  agent?: SelfImproveOptions<TScenario, TArtifact>['agent']
  /** Dispatch each baseline or candidate as its complete AgentProfile.
   * Exactly one of `agent` or `profileDispatch` is required. */
  profileDispatch?: ProfileDispatchFn<TScenario, TArtifact>
  /** Which profile lever to optimize. Default `'prompt'`. Selects the default
   *  generator + the baseline-surface extraction shape. */
  surface?: ImproveSurface
  /** The `SurfaceProposer` that mutates a profile surface. When unset, the facade
   *  picks the default for prompt, skills, and memory; surfaces
   *  with no default REQUIRE this (fail-loud otherwise). Forbidden for code;
   *  use `code.generator` so the runtime owns candidate cleanup. */
  generator?: SurfaceProposer
  /** Gate mode. `'holdout'` (default) runs the held-out promotion gate;
   *  `'none'` is a baseline-only run (`budget.generations = 0`). */
  gate?: 'holdout' | 'none'
  /** Restrict the run to this subset of models. When set, the reflection model
   *  (`llm.model`, or the default when unset) must be a member, or `improve()` throws
   *  a `ConfigError` before the generator is built. Unset = unrestricted. */
  allowedModels?: readonly string[]
  /** Per-generation findings producer passthrough (see selfImprove.analyzeGeneration).
   *  DEFAULT: with a real (non-`mem://`) `runDir`, the raw-trace distiller
   *  (`rawTraceDistiller`) — typed `AnalystFinding`s pointing the proposer at the
   *  prior generation's actual on-disk traces; for in-memory runs (no traces on
   *  disk to point at), the built-in failure distiller — the worst-scoring/errored
   *  cells distilled into typed `AnalystFinding`s for the NEXT proposal round.
   *  Pass your own producer to replace either; pass `null` to disable and keep the
   *  static `findings` all the way through. */
  analyzeGeneration?: SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration'] | null
  /** META-HARNESS mode: instead of the distilled findings, feed the proposer
   *  RAW-TRACE FILESYSTEM CONTEXT — the PATHS into the prior generation's
   *  real run traces under `runDir` (per-cell `spans.jsonl` event logs +
   *  `cached-result.json` scores + artifacts) plus a `grep`/`cat`-to-diagnose
   *  instruction — so the coding agent reads the actual failures itself rather than
   *  a pre-summary. Unset (default): raw-trace findings whenever the run is durable
   *  (a real `runDir` — that is where the traces live), the distilled failure digest
   *  otherwise; the `memory` surface always defaults to its curation distiller.
   *  `true` forces `rawTraceDistiller()` even for an in-memory run (it emits a loud
   *  warning finding instead of paths); `false` forces the digest distiller even
   *  with a real `runDir`. Ignored when `analyzeGeneration` is set explicitly
   *  (that wins) or is `null` (disabled). */
  rawTraceContext?: boolean
  /** CODE-surface wiring: name `surface: 'code'`, point at a repo, and the
   *  facade assembles the whole candidate pipeline — an isolated incumbent plus git worktrees
   *  (`gitWorktreeAdapter`) driven by `improvementDriver` with the full agentic
   *  generator (a real coding harness edits each candidate worktree; a `verify`
   *  hook gates candidates before they are ever measured). Ignored when
   *  `opts.generator` is supplied. Required for every code run because a real
   *  repository and base ref are necessary to measure the incumbent. */
  code?: ImproveCodeOptions
  /** Select the exact inline skill document to optimize. */
  skills?: ImproveSkillsOptions
  /** Custom held-back-exam decision. The string `gate` above controls whether
   *  the exam runs; this callback controls how its evidence decides promotion. */
  promotionGate?: SelfImproveOptions<TScenario, TArtifact>['gate']
}

export interface ImproveSkillsOptions {
  /** `name` of one inline entry in `profile.resources.skills`. */
  resourceName: string
}

export interface ImproveCodeOptions {
  /** Repo root candidate worktrees fork from. */
  repoRoot: string
  /** Base ref candidates fork from. Default `main`. */
  baseRef?: string
  /** Directory worktrees are created under. Default `<repoRoot>/.worktrees`. */
  worktreeDir?: string
  /** Git-compatible adapter override, primarily for tests. Candidate advancement
   *  still requires normal Git worktree and commit semantics. */
  worktree?: WorktreeAdapter
  /** Coding harness the agentic generator runs in each worktree. Default `claude`. */
  harness?: LocalHarness
  /** Verify a candidate worktree before it becomes a measurable surface; failures
   *  feed the next shot (see `agenticGenerator.verify` / `commandVerifier`). */
  verify?: Verifier
  /** Per-shot wall-clock timeout for the harness (ms). */
  timeoutMs?: number
  /** Byte-producer override — the test seam and the escape hatch for custom
   *  candidate production. When set, `harness`/`verify`/`timeoutMs` are unused. */
  generator?: CandidateGenerator
}

export interface ImprovementCandidate {
  /** Surface searched by this run. */
  surface: ImproveSurface
  /** Exact winning value returned by agent-eval. */
  value: MutableSurface
  /** Detached profile candidate when the surface maps directly to AgentProfile. */
  profile?: AgentProfile
}

export interface ImproveResult<TScenario extends Scenario, TArtifact> {
  /** Frozen candidate only. Live state is changed through an approved activation. */
  candidate: ImprovementCandidate
  /** Held-out decision for this search result. */
  decision: SelfImproveResult<TScenario, TArtifact>['gateDecision']
  /** Held-out lift (`winner − baseline` composite). Absent iff
   *  `budget.holdout === 'deferred'` — no held-out measurement ran, so there
   *  is no lift to report (never a fabricated 0). */
  lift?: number
  /** Full `selfImprove` result for advanced inspection. For code runs,
   *  `raw.winner.surface.worktreeRef` remains live after return whether the
   *  candidate passed or held; call `dispose()` after consuming it. */
  raw: SelfImproveResult<TScenario, TArtifact>
  /** Release resources owned by this result. Idempotent; currently disposes
   *  the returned code worktree and is a no-op for profile-only surfaces. */
  dispose(): Promise<void>
}

/** Default model id for the reflective drivers when `llm.model` is unset — a model the Tangle
 *  router actually serves (callers should pass their own `llm.model`). */
const defaultReflectionModel = 'deepseek-v4-flash'

/** The reflective proposers (`gepaProposer`/`skillOptProposer`) take a full
 *  `LlmClientOptions`; `SelfImproveLlm` is the thin user-facing subset. */
function llmClientOptions(llm: SelfImproveLlm | undefined): { baseUrl?: string; apiKey?: string } {
  return { baseUrl: llm?.baseUrl, apiKey: llm?.apiKey }
}

/** The default proposer for a surface, or `undefined` when the surface has no
 *  zero-config default (the caller must supply `opts.generator`). */
function defaultGeneratorFor(
  surface: ImproveSurface,
  llm: SelfImproveLlm | undefined,
): SurfaceProposer | undefined {
  const model = llm?.model ?? defaultReflectionModel
  switch (surface) {
    case 'prompt':
      return gepaProposer({ llm: llmClientOptions(llm), model, target: 'agent system prompt' })
    case 'skills':
      return skillOptProposer({ llm: llmClientOptions(llm), model, target: 'agent skill document' })
    case 'memory':
      return memoryCurationProposer()
    case 'rollout-policy':
      // Deterministic bounded enumeration — no LLM, so `llm` is unused here.
      return rolloutPolicyProposer()
    default:
      return undefined
  }
}

/** Extract the baseline surface a driver mutates from the profile field that
 *  backs `surface`. Prompt, skills, and memory are text surfaces; config
 *  surfaces serialize the matching profile record. */
function baselineSurfaceFor(
  profile: AgentProfile,
  surface: ImproveSurface,
  skills?: ImproveSkillsOptions,
): MutableSurface {
  switch (surface) {
    case 'prompt':
      return profile.prompt?.systemPrompt ?? ''
    case 'skills':
      return inlineSkill(profile, skills).content
    case 'tools':
      return JSON.stringify(profile.tools ?? {})
    case 'mcp':
      return JSON.stringify(profile.mcp ?? {})
    case 'hooks':
      return JSON.stringify(profile.hooks ?? {})
    case 'subagents':
      return JSON.stringify(profile.subagents ?? {})
    case 'agent-profile':
      return canonicalJson(profile)
    case 'memory':
      return profileInstructions(profile)
    case 'rollout-policy': {
      // Empty surface when the profile never opted into structural rollout: the
      // proposer reads it as "propose nothing", so the loop runs baseline-only and
      // holds — tuning dials nothing consumes would ship dead config.
      const policy = structuralRolloutPolicyFromProfile(profile)
      return policy ? serializeRolloutPolicy(policy) : ''
    }
    case 'code':
      throw new ConfigError(
        'improve(): code requires the isolated baseline created from opts.code.repoRoot',
      )
  }
}

/** Slice bound for distilled judge notes: wide enough that a real traceback /
 *  failing-assertion note survives intact — clipping mid-traceback would leave
 *  the proposer trace-blind. Referenced by the `rawTraceContext` docs. */
const DISTILLED_NOTES_MAX_CHARS = 1500

/** Slice bound for a cell's error string — tighter than notes (errors are
 *  usually one line; the full text stays on the raw cell). Also bounds the
 *  error-derived `claim` fallback. */
const DISTILLED_ERROR_MAX_CHARS = 500

/** The in-memory-run `analyzeGeneration`: distill each generation's failing cells
 *  into TYPED `AnalystFinding`s for the next proposal round — the same envelope
 *  `rawTraceDistiller` and the analyst registry emit, so consumers never branch on
 *  a second ad-hoc digest shape. Judge notes and errors are already the domain's
 *  own diagnosis (executable gates put their reasons there); a trace-analyst can
 *  replace this wholesale via `opts.analyzeGeneration`. Falls back to the static
 *  seed findings when the generation had no failures, so a clean round never wipes
 *  the seed context. */
function generationFailureDistiller<TScenario extends Scenario, TArtifact>(
  staticFindings: unknown[],
): NonNullable<SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration']> {
  const CAP = 12
  return async (input) => {
    const failures: Array<{
      scenario: string
      composite: number
      notes: string
      claim?: string
      error?: string
    }> = []
    for (const candidate of input.candidates) {
      for (const rawCell of candidate.campaign.cells) {
        const cell = rawCell as unknown as Record<string, unknown>
        const scenario = String(cell.scenarioId ?? 'unknown')
        const error = typeof cell.error === 'string' ? cell.error : undefined
        const judgeScores =
          cell.judgeScores && typeof cell.judgeScores === 'object'
            ? Object.values(
                cell.judgeScores as Record<string, { composite?: number; notes?: string }>,
              )
            : []
        const composite =
          judgeScores.length === 0
            ? 0
            : judgeScores.reduce((sum, j) => sum + (j.composite ?? 0), 0) / judgeScores.length
        if (!error && composite >= 0.999) continue
        const notes = judgeScores
          .map((j) => j.notes)
          .filter((n): n is string => typeof n === 'string' && n.length > 0)
          .join('; ')
          .slice(0, DISTILLED_NOTES_MAX_CHARS)
        const claim =
          notes ||
          (error ? `Scenario ${scenario} failed: ${error.slice(0, DISTILLED_ERROR_MAX_CHARS)}` : '')
        failures.push({
          scenario,
          composite: Number(composite.toFixed(3)),
          notes,
          ...(claim ? { claim } : {}),
          ...(error ? { error: error.slice(0, DISTILLED_ERROR_MAX_CHARS) } : {}),
        })
      }
    }
    if (failures.length === 0) return staticFindings
    failures.sort((a, b) => a.composite - b.composite)
    return failures.slice(0, CAP).map((f) =>
      makeFinding({
        analyst_id: 'generation-failure-distiller',
        severity: f.error !== undefined || f.composite < 0.5 ? 'high' : 'medium',
        area: 'generation-failure',
        confidence: 1,
        subject: f.scenario,
        claim: `Scenario ${f.scenario} scored composite ${f.composite}${
          f.notes ? `: ${f.notes}` : ''
        }${f.error ? ` (error: ${f.error})` : ''}`,
        evidence_refs: [],
        metadata: {
          scenario: f.scenario,
          composite: f.composite,
          ...(f.notes ? { notes: f.notes } : {}),
          ...(f.error !== undefined ? { error: f.error } : {}),
        },
      }),
    )
  }
}

/** Memory accumulates durable lessons, so keep the caller's seed findings while
 * adding fresh judge failures. Curator proposers consume `claim`; the generic
 * distiller retains the richer diagnostic fields for reflective proposers. */
function memoryGenerationDistiller<TScenario extends Scenario, TArtifact>(
  staticFindings: unknown[],
): NonNullable<SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration']> {
  const distillFailures = generationFailureDistiller<TScenario, TArtifact>(staticFindings)
  return async (input) => {
    const fresh = await distillFailures(input)
    return fresh === staticFindings ? staticFindings : [...staticFindings, ...fresh]
  }
}

/** The default `analyzeGeneration` when the caller passed none: raw-trace context
 *  whenever the run is durable (a real `runDir` is where the traces live — see
 *  `rawTraceDistiller`), the failure digest for in-memory runs, with
 *  `rawTraceContext` as the explicit override in either direction. The `memory`
 *  surface keeps its curation distiller (its proposer consumes `claim` findings,
 *  not trace paths) unless `rawTraceContext: true` is explicit. */
function defaultDistillerFor<TScenario extends Scenario, TArtifact>(
  opts: ImproveOptions<TScenario, TArtifact>,
  findings: unknown[],
): NonNullable<SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration']> {
  const surface = opts.surface ?? 'prompt'
  const durableRun = opts.runDir !== undefined && !opts.runDir.startsWith('mem://')
  const useRawTraces = opts.rawTraceContext ?? (surface === 'memory' ? false : durableRun)
  if (useRawTraces) return rawTraceDistiller<TScenario, TArtifact>({ fallbackFindings: findings })
  if (surface === 'memory') return memoryGenerationDistiller<TScenario, TArtifact>(findings)
  return generationFailureDistiller<TScenario, TArtifact>(findings)
}

interface PreparedCodeRun {
  baseline: CodeSurface
  proposer: SurfaceProposer
  cleanup(retainedWinner?: MutableSurface): Promise<void>
}

async function discardPreparedBaseline(
  worktree: WorktreeAdapter,
  baselineWorktree: Worktree,
  cause: unknown,
): Promise<never> {
  return rethrowAfterCleanup(
    cause,
    () => worktree.discard(baselineWorktree),
    'improve(): code preparation failed',
  )
}

function isCodeSurface(surface: MutableSurface | undefined): surface is CodeSurface {
  return typeof surface === 'object' && surface !== null && surface.kind === 'code'
}

/** Create a clean incumbent checkout and the candidate producer for a code run. */
async function prepareCodeRun(code: ImproveCodeOptions): Promise<PreparedCodeRun> {
  const baseRef = code.baseRef ?? 'main'
  const worktree =
    code.worktree ??
    gitWorktreeAdapter({
      repoRoot: code.repoRoot,
      ...(code.worktreeDir ? { worktreeDir: code.worktreeDir } : {}),
    })
  const baselineWorktree = await worktree.create({ baseRef, label: 'incumbent-baseline' })
  try {
    const baseline = await worktree.finalize(baselineWorktree, 'Incumbent code checkout')
    let baselineDiscarded = false
    const generator =
      code.generator ??
      agenticGenerator({
        ...(code.harness ? { harness: code.harness } : {}),
        ...(code.verify ? { verify: code.verify } : {}),
        ...(code.timeoutMs ? { timeoutMs: code.timeoutMs } : {}),
      })
    const managed: ManagedImprovementDriver = improvementDriver({ worktree, generator, baseRef })

    return {
      baseline,
      proposer: managed,
      async cleanup(retainedWinner) {
        const errors: unknown[] = []
        const retainedWorktreeRef = isCodeSurface(retainedWinner)
          ? retainedWinner.worktreeRef
          : undefined
        try {
          await managed?.cleanup(retainedWorktreeRef ? [retainedWorktreeRef] : [])
        } catch (cause) {
          errors.push(cause)
        }
        if (!baselineDiscarded && retainedWorktreeRef !== baseline.worktreeRef) {
          try {
            await worktree.discard(baselineWorktree)
            baselineDiscarded = true
          } catch (cause) {
            errors.push(cause)
          }
        }
        if (errors.length > 0) {
          throw new AggregateError(errors, 'improve(): failed to clean code improvement worktrees')
        }
      },
    }
  } catch (cause) {
    return discardPreparedBaseline(worktree, baselineWorktree, cause)
  }
}

function idempotentDispose(dispose: () => Promise<void>): () => Promise<void> {
  let disposed = false
  let inFlight: Promise<void> | undefined
  return async () => {
    if (disposed) return
    if (inFlight) return inFlight
    inFlight = (async () => {
      await dispose()
      disposed = true
    })()
    try {
      await inFlight
    } finally {
      inFlight = undefined
    }
  }
}

/** Parse a JSON winner surface with a typed, contextual error. */
function parseWinnerJson<T>(winner: string, surface: ImproveSurface): T {
  try {
    return JSON.parse(winner) as T
  } catch (cause) {
    throw new ConfigError(
      `improve(): the '${surface}' candidate is not valid JSON, so it cannot form a profile candidate: ${
        (cause as Error).message
      }`,
    )
  }
}

function assertCandidateSurfaceKind(
  surface: ImproveSurface,
  winner: MutableSurface,
): asserts winner is MutableSurface {
  if (surface === 'code' ? typeof winner === 'string' : typeof winner !== 'string') {
    throw new ConfigError(
      `improve(): the '${surface}' candidate returned an incompatible surface value`,
    )
  }
}

/** Materialize a detached profile candidate without changing the baseline. */
function materializeImprovementProfileCandidate(
  profile: AgentProfile,
  surface: ImproveSurface,
  winner: MutableSurface,
  skills?: ImproveSkillsOptions,
): AgentProfile | undefined {
  if (typeof winner !== 'string') return undefined
  let candidate: AgentProfile
  switch (surface) {
    case 'prompt':
      candidate = { ...profile, prompt: { ...profile.prompt, systemPrompt: winner } }
      break
    case 'skills': {
      const selectedSkill = inlineSkill(profile, skills)
      candidate = {
        ...profile,
        resources: {
          ...profile.resources,
          skills: profile.resources?.skills?.map((resource) =>
            resource === selectedSkill ? { ...resource, content: winner } : resource,
          ),
        },
      }
      break
    }
    case 'tools':
      candidate = { ...profile, tools: parseWinnerJson(winner, surface) }
      break
    case 'mcp':
      candidate = { ...profile, mcp: parseWinnerJson(winner, surface) }
      break
    case 'hooks':
      candidate = { ...profile, hooks: parseWinnerJson(winner, surface) }
      break
    case 'subagents':
      candidate = { ...profile, subagents: parseWinnerJson(winner, surface) }
      break
    case 'agent-profile':
      candidate = parseWinnerJson(winner, surface)
      break
    case 'memory':
      candidate = {
        ...profile,
        resources: {
          ...profile.resources,
          instructions: replaceProfileInstructions(profile, winner),
        },
      }
      break
    case 'rollout-policy': {
      // An empty winner is the never-opted-in baseline (see baselineSurfaceFor):
      // nothing to apply, so no profile candidate — never a parse error.
      if (winner === '') return undefined
      // Parse + re-validate the winner against the policy's own invariants — a
      // custom generator's malformed dial must fail loud, not persist silently.
      const policy = normalizeRolloutPolicy(parseWinnerJson(winner, surface))
      if (!policy) {
        throw new ConfigError(
          `improve(): the shipped 'rollout-policy' winner is not a valid StructuralRolloutPolicy ` +
            `(integer k >= 1, repairRounds >= 0, testgen >= 0), so it cannot be applied: ${winner}`,
        )
      }
      candidate = applyRolloutPolicyToProfile(profile, policy)
      break
    }
    case 'code':
      return undefined
  }
  const parsed = agentProfileSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new ConfigError(
      `improve(): the '${surface}' candidate does not produce a valid AgentProfile: ${parsed.error.message}`,
    )
  }
  return immutableCandidateValue(parsed.data)
}

/** Build the mutable-surface callback expected by agent-eval from a host that
 * runs complete profiles. The host sees the same immutable baseline/candidate
 * profile Runtime reports as the result; it never needs to duplicate surface
 * replacement rules. */
function profileImprovementAgent<TScenario extends Scenario, TArtifact>(input: {
  baselineProfile: AgentProfile
  surface: ImproveSurface
  skills?: ImproveSkillsOptions
  dispatch: ProfileDispatchFn<TScenario, TArtifact>
}): SelfImproveOptions<TScenario, TArtifact>['agent'] {
  return (surfaceValue, scenario, ctx) => {
    const profile = materializeImprovementProfileCandidate(
      input.baselineProfile,
      input.surface,
      surfaceValue,
      input.skills,
    )
    // An unset rollout policy deliberately uses the unchanged profile as its
    // baseline. Every other unsupported surface must stop before a host run.
    const dispatchedProfile =
      profile ??
      (input.surface === 'rollout-policy' && surfaceValue === ''
        ? input.baselineProfile
        : undefined)
    if (!dispatchedProfile) {
      throw new ConfigError(
        `improve(): surface '${input.surface}' cannot run through profileDispatch; use opts.agent for a non-profile surface`,
      )
    }
    return input.dispatch(dispatchedProfile, scenario, ctx)
  }
}

function inlineSkill(
  profile: AgentProfile,
  options: ImproveSkillsOptions | undefined,
): Extract<AgentProfileResourceRef, { kind: 'inline' }> {
  const resourceName = options?.resourceName.trim()
  if (!resourceName) {
    throw new ConfigError(
      "improve(): surface 'skills' requires opts.skills.resourceName for one inline profile skill",
    )
  }
  assertFailClosedResources(profile, 'skills')
  const matches = (profile.resources?.skills ?? []).filter(
    (resource) => resource.name === resourceName,
  )
  if (matches.length !== 1 || matches[0]?.kind !== 'inline') {
    throw new ConfigError(
      `improve(): skill '${resourceName}' must identify exactly one inline profile resource`,
    )
  }
  return matches[0]
}

function profileInstructions(profile: AgentProfile): string {
  assertFailClosedResources(profile, 'memory')
  const instructions = profile.resources?.instructions
  if (instructions === undefined) return ''
  if (typeof instructions === 'string') return instructions
  if (instructions.kind === 'inline') return instructions.content
  throw new ConfigError(
    "improve(): surface 'memory' requires inline profile instructions so candidate bytes are exact",
  )
}

function replaceProfileInstructions(
  profile: AgentProfile,
  content: string,
): string | AgentProfileResourceRef {
  const instructions = profile.resources?.instructions
  if (typeof instructions !== 'object') return content
  if (instructions.kind !== 'inline') {
    throw new ConfigError(
      "improve(): surface 'memory' requires inline profile instructions so candidate bytes are exact",
    )
  }
  return { ...instructions, content }
}

function assertFailClosedResources(profile: AgentProfile, surface: 'skills' | 'memory'): void {
  if (profile.resources?.failOnError !== true) {
    throw new ConfigError(
      `improve(): surface '${surface}' requires profile.resources.failOnError: true`,
    )
  }
}

/**
 * Run the held-out-gated self-improvement loop on ONE profile surface.
 *
 * @example Optimize the system prompt, default holdout gate:
 *
 *   const out = await improve(profile, findings, {
 *     surface: 'prompt',
 *     scenarios,
 *     judge,
 *     agent: (surface, scenario, ctx) => runAgent(surface, scenario, ctx.signal),
 *   })
 *   if (out.decision === 'ship') console.log(out.candidate)
 */
export async function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  findings: unknown[],
  opts: ImproveOptions<TScenario, TArtifact>,
): Promise<ImproveResult<TScenario, TArtifact>> {
  const {
    surface = 'prompt',
    gate = 'holdout',
    agent,
    profileDispatch,
    generator,
    allowedModels,
    rawTraceContext,
    code,
    skills,
    promotionGate,
    analyzeGeneration,
    ...sharedOptions
  } = opts

  const parsedProfile = agentProfileSchema.safeParse(profile)
  if (!parsedProfile.success) {
    throw new ConfigError(
      `improve(): input is not a valid AgentProfile: ${parsedProfile.error.message}`,
    )
  }
  if (agent !== undefined && profileDispatch !== undefined) {
    throw new ConfigError('improve(): provide exactly one of opts.agent or opts.profileDispatch')
  }
  if (agent === undefined && profileDispatch === undefined) {
    throw new ConfigError('improve(): provide exactly one of opts.agent or opts.profileDispatch')
  }
  const baselineProfile = immutableCandidateValue(parsedProfile.data)
  if (profileDispatch && surface === 'code') {
    throw new ConfigError(
      "improve(): surface 'code' cannot use profileDispatch because code candidates require isolated worktree execution; use opts.agent",
    )
  }
  if (surface === 'code' && generator) {
    throw new ConfigError(
      "improve(): surface 'code' forbids opts.generator because an external SurfaceProposer cannot transfer checkout ownership; pass opts.code.generator instead",
    )
  }
  const usesReflectionModel = !generator && (surface === 'prompt' || surface === 'skills')
  if (usesReflectionModel) {
    assertModelAllowed(sharedOptions.llm?.model ?? defaultReflectionModel, allowedModels)
  }

  let preparedCode: PreparedCodeRun | undefined
  if (surface === 'code') {
    if (!code) {
      throw new ConfigError(
        "improve(): surface 'code' requires opts.code.repoRoot so the incumbent can run from an isolated checkout",
      )
    }
    preparedCode = await prepareCodeRun(code)
  }
  const proposer =
    preparedCode?.proposer ?? generator ?? defaultGeneratorFor(surface, sharedOptions.llm)
  if (!proposer) {
    throw new ConfigError(
      `improve(): surface '${surface}' has no default generator — pass opts.generator (a SurfaceProposer) explicitly`,
    )
  }

  const budget: SelfImproveBudget =
    gate === 'none' ? { ...sharedOptions.budget, generations: 0 } : { ...sharedOptions.budget }
  const effectiveAgent =
    profileDispatch === undefined
      ? agent
      : profileImprovementAgent({
          baselineProfile,
          surface,
          ...(skills === undefined ? {} : { skills }),
          dispatch: profileDispatch,
        })
  if (!effectiveAgent) {
    throw new ConfigError('improve(): provide exactly one of opts.agent or opts.profileDispatch')
  }

  let raw: SelfImproveResult<TScenario, TArtifact>
  try {
    raw = await selfImprove<TScenario, TArtifact>({
      ...sharedOptions,
      agent: effectiveAgent,
      baselineSurface:
        preparedCode?.baseline ?? baselineSurfaceFor(baselineProfile, surface, skills),
      proposer,
      budget,
      findings,
      ...(promotionGate !== undefined ? { gate: promotionGate } : {}),
      ...(analyzeGeneration === null
        ? {}
        : {
            analyzeGeneration:
              analyzeGeneration ?? defaultDistillerFor<TScenario, TArtifact>(opts, findings),
          }),
    })
  } catch (cause) {
    if (!preparedCode) throw cause
    return rethrowAfterCleanup(
      cause,
      () => preparedCode.cleanup(),
      'improve(): code improvement failed',
    )
  }

  const winnerSurface = raw.winner.surface
  assertCandidateSurfaceKind(surface, winnerSurface)
  if (preparedCode) {
    try {
      await preparedCode.cleanup(winnerSurface)
    } catch (cleanupCause) {
      try {
        await preparedCode.cleanup()
      } catch (finalCleanupCause) {
        throw new AggregateError(
          [cleanupCause, finalCleanupCause],
          'improve(): code result cleanup failed, including the final all-worktree retry',
        )
      }
      throw new AggregateError(
        [cleanupCause],
        'improve(): code result cleanup failed; the final all-worktree retry succeeded',
      )
    }
  }
  const dispose = idempotentDispose(async () => preparedCode?.cleanup())
  const candidateProfile = materializeImprovementProfileCandidate(
    baselineProfile,
    surface,
    winnerSurface,
    skills,
  )
  const candidate = immutableCandidateValue<ImprovementCandidate>({
    surface,
    value: winnerSurface,
    ...(candidateProfile ? { profile: candidateProfile } : {}),
  })

  return {
    candidate,
    decision: raw.gateDecision,
    ...(raw.lift !== undefined ? { lift: raw.lift } : {}),
    raw,
    dispose,
  }
}
