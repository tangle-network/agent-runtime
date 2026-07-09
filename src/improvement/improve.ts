/**
 *
 * `improve` — the ONE public, surface-pluggable RSI verb.
 *
 * A thin facade over agent-eval's `selfImprove` (the held-out-gated closed
 * loop). It removes the two things a caller otherwise has to know to drive the
 * loop by hand: WHICH `MutableSurface` of the profile is being optimized, and
 * WHICH `SurfaceProposer` mutates that surface. You name a `surface`; the
 * facade picks the matching default proposer, extracts the baseline surface from
 * the profile, runs `selfImprove`, and (on a ship verdict) writes the promoted
 * winner back into the corresponding profile field.
 *
 *   - `surface: 'prompt'` → `gepaProposer` mutates `profile.prompt.systemPrompt`.
 *   - `surface: 'skills'` → `skillOptProposer` mutates a skills document string.
 *   - `surface: 'rollout-policy'` → `rolloutPolicyProposer` mutates the
 *     inference-time `StructuralRolloutPolicy` dials ({ k, repairRounds, testgen })
 *     persisted in `profile.extensions['structural-rollout']` — deterministic
 *     bounded neighbor enumeration; the held-out gate does the deciding. No-op
 *     (nothing proposed, nothing shipped) when the profile has no such extension.
 *   - `surface` ∈ {`tools`, `mcp`, `hooks`, `code`} → no zero-config default
 *     proposer exists (a code/config proposer needs caller-supplied wiring — a
 *     worktree repo root, a candidate generator, a serializer). The facade
 *     requires an explicit `opts.generator` for these and throws a `ConfigError`
 *     otherwise. This is a designed boundary, not a missing default: there is
 *     no safe value the facade could invent for those seams.
 *
 * Everything else (`scenarios`, `judge`, `agent`, `budget`, `llm`) passes
 * straight through to `selfImprove`.
 *
 * @experimental
 */

import {
  gepaProposer,
  gitWorktreeAdapter,
  skillOptProposer,
} from '@tangle-network/agent-eval/campaign'
import {
  type DispatchContext,
  type JudgeConfig,
  type MutableSurface,
  type Scenario,
  type SelfImproveBudget,
  type SelfImproveLlm,
  type SelfImproveOptions,
  type SelfImproveResult,
  type SurfaceProposer,
  selfImprove,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../errors'
import type { LocalHarness } from '../mcp/local-harness'
import { assertModelAllowed } from '../runtime/supervise/model-policy'
import { agenticGenerator, type Verifier } from './agentic-generator'
import { type CandidateGenerator, improvementDriver } from './improvement-driver'
import { rawTraceDistiller } from './raw-trace-distiller'
import {
  applyRolloutPolicyToProfile,
  normalizeRolloutPolicy,
  rolloutPolicyProposer,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from './rollout-policy'

/** The agent-profile lever `improve` optimizes. Mirrors the AgentProfile-law
 *  profile levers; `code` is the implementation-tier surface, `rollout-policy`
 *  the inference-time structuralRollout dials
 *  (`profile.extensions['structural-rollout']`). */
export type ImproveSurface =
  | 'prompt'
  | 'skills'
  | 'tools'
  | 'mcp'
  | 'hooks'
  | 'code'
  | 'rollout-policy'

export interface ImproveOptions<TScenario extends Scenario, TArtifact> {
  /** Which profile lever to optimize. Default `'prompt'`. Selects the default
   *  generator + the baseline-surface extraction shape. */
  surface?: ImproveSurface
  /** The `SurfaceProposer` that mutates the surface. When unset, the facade
   *  picks the default for `surface` (`gepaProposer` for prompt, `skillOptProposer`
   *  for skills); surfaces with no default REQUIRE this (fail-loud otherwise). */
  generator?: SurfaceProposer
  /** Gate mode. `'holdout'` (default) runs the held-out promotion gate;
   *  `'none'` is a baseline-only run (`budget.generations = 0`). */
  gate?: 'holdout' | 'none'
  /** Scenarios to evaluate against. Passthrough to `selfImprove`. */
  scenarios: TScenario[]
  /** Judge that scores artifacts. Passthrough to `selfImprove`. */
  judge: JudgeConfig<TArtifact, TScenario>
  /** The agent under improvement — same shape as `selfImprove.agent`: it takes
   *  the current surface + scenario + ctx and returns the artifact to judge. */
  agent: (surface: MutableSurface, scenario: TScenario, ctx: DispatchContext) => Promise<TArtifact>
  /** Budget + loop shape. Passthrough; `gate: 'none'` forces `generations = 0`. */
  budget?: SelfImproveBudget
  /** LLM config. Passthrough to `selfImprove` AND used to construct the default
   *  reflective proposer (`gepaProposer`/`skillOptProposer`) when `generator` is unset. */
  llm?: SelfImproveLlm
  /** Restrict the run to this subset of models. When set, the reflection model
   *  (`llm.model`, or the default when unset) must be a member, or `improve()` throws
   *  a `ConfigError` before the generator is built. Unset = unrestricted. */
  allowedModels?: readonly string[]
  /** Run directory passthrough to `selfImprove`. Pass a REAL path to make the loop
   *  durable: campaign cells + the loop provenance record land on the filesystem as
   *  they complete, so a multi-hour search survives a process/infra death instead of
   *  losing every generation with it (the default `mem://` run keeps everything
   *  in-process). */
  runDir?: string
  /** Per-generation findings producer passthrough (see selfImprove.analyzeGeneration).
   *  DEFAULT: the built-in failure distiller — after each generation it turns the
   *  worst-scoring/errored cells into structured findings ({ scenario, composite,
   *  notes, error }) for the NEXT proposal round, so the proposer reasons over what
   *  actually failed instead of a static seed. Pass your own producer (e.g. a
   *  trace-analyst over the runDir's traces) to replace it; pass `null` to disable
   *  and keep the static `findings` all the way through. */
  analyzeGeneration?: SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration'] | null
  /** META-HARNESS mode: instead of the ~400-char distilled findings, feed the
   *  proposer RAW-TRACE FILESYSTEM CONTEXT — the PATHS into the prior generation's
   *  real run traces under `runDir` (per-cell `spans.jsonl` event logs +
   *  `cached-result.json` scores + artifacts) plus a `grep`/`cat`-to-diagnose
   *  instruction — so the coding agent reads the actual failures itself rather than
   *  a pre-summary. Requires a REAL `runDir` (that is where the traces live).
   *  Ignored when `analyzeGeneration` is set explicitly (that wins) or is `null`
   *  (disabled). Equivalent to `analyzeGeneration: rawTraceDistiller()`; this flag
   *  is the one-line enable. Default `false` (the distiller stays the default). */
  rawTraceContext?: boolean
  /** CODE-surface wiring with prompt-parity DX: name `surface: 'code'`, point at a
   *  repo, and the facade assembles the whole candidate pipeline — git worktrees
   *  (`gitWorktreeAdapter`) driven by `improvementDriver` with the full agentic
   *  generator (a real coding harness edits each candidate worktree; a `verify`
   *  hook gates candidates before they are ever measured). Ignored when
   *  `opts.generator` is supplied. Without either, `surface: 'code'` still fails
   *  loud — there is no safe zero-config repo to invent. */
  code?: ImproveCodeOptions
  /** SKILLS-surface wiring for real skill-DOCUMENT optimization. Without this,
   *  `surface: 'skills'` optimizes the profile's skills REFS array (file pointers)
   *  — which `skillOptProposer` (a document patcher) cannot meaningfully edit.
   *  Provide the document CONTENT to optimize + a `writeBack` to persist the
   *  shipped winner (the profile ref points at a file the caller owns). This is
   *  what makes skillOpt reachable through improve(). */
  skills?: ImproveSkillsOptions
  /** Storage passthrough to `selfImprove`; overrides the default chosen from `runDir`. */
  storage?: SelfImproveOptions<TScenario, TArtifact>['storage']
}

export interface ImproveSkillsOptions {
  /** The skill document's current text — the baseline `skillOptProposer` patches. */
  document: string
  /** Persist the shipped winner document (write the file the profile ref points at).
   *  Called only on a ship verdict. When omitted, the winner is still returned in
   *  `result.raw.winner.surface` for the caller to materialize. */
  writeBack?: (winnerDocument: string) => void
}

export interface ImproveCodeOptions {
  /** Repo root candidate worktrees fork from. */
  repoRoot: string
  /** Base ref candidates fork from. Default `main`. */
  baseRef?: string
  /** Directory worktrees are created under. Default `<repoRoot>/.worktrees`. */
  worktreeDir?: string
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

export interface ImproveResult<TScenario extends Scenario, TArtifact> {
  /** The profile after improvement: the winner surface applied back into the
   *  matching field when the gate shipped, else the input profile unchanged. */
  profile: AgentProfile
  /** True when `gateDecision === 'ship'`. */
  shipped: boolean
  /** Held-out lift (`winner − baseline` composite). */
  lift: number
  /** The five-valued gate verdict from `selfImprove`. */
  gateDecision: SelfImproveResult<TScenario, TArtifact>['gateDecision']
  /** Full `selfImprove` result for advanced inspection. */
  raw: SelfImproveResult<TScenario, TArtifact>
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
    case 'rollout-policy':
      // Deterministic bounded enumeration — no LLM, so `llm` is unused here.
      return rolloutPolicyProposer()
    default:
      return undefined
  }
}

/** Extract the baseline surface a driver mutates from the profile field that
 *  backs `surface`. `prompt`/`skills` are string surfaces; the config surfaces
 *  serialize the matching profile record. */
function baselineSurfaceFor(
  profile: AgentProfile,
  surface: ImproveSurface,
  skills?: ImproveSkillsOptions,
): MutableSurface {
  switch (surface) {
    case 'prompt':
      return profile.prompt?.systemPrompt ?? ''
    case 'skills':
      // With a document supplied, optimize its CONTENT (the real skillOpt path);
      // otherwise fall back to the refs-array surface for back-compat.
      return skills?.document ?? JSON.stringify(profile.resources?.skills ?? [])
    case 'tools':
      return JSON.stringify(profile.tools ?? {})
    case 'mcp':
      return JSON.stringify(profile.mcp ?? {})
    case 'hooks':
      return JSON.stringify(profile.hooks ?? {})
    case 'rollout-policy': {
      // Empty surface when the profile never opted into structural rollout: the
      // proposer reads it as "propose nothing", so the loop runs baseline-only and
      // holds — tuning dials nothing consumes would ship dead config.
      const policy = structuralRolloutPolicyFromProfile(profile)
      return policy ? serializeRolloutPolicy(policy) : ''
    }
    case 'code':
      // A code surface is produced by the caller's generator from a worktree;
      // the facade has no worktree ref to seed, so the baseline is the empty
      // string (the driver opens its own worktree off `baseRef`).
      return ''
  }
}

/** The default `analyzeGeneration`: distill each generation's failing cells into
 *  findings for the next proposal round. Deliberately dependency-free — judge notes
 *  and errors are already the domain's own diagnosis (executable gates put their
 *  reasons there); a trace-analyst can replace this wholesale via
 *  `opts.analyzeGeneration`. Falls back to the static seed findings when the
 *  generation had no failures, so a clean round never wipes the seed context. */
function generationFailureDistiller<TScenario extends Scenario, TArtifact>(
  staticFindings: unknown[],
): NonNullable<SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration']> {
  const CAP = 12
  return async (input) => {
    const failures: Array<{ scenario: string; composite: number; notes: string; error?: string }> =
      []
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
          .slice(0, 400)
        failures.push({
          scenario,
          composite: Number(composite.toFixed(3)),
          notes,
          ...(error ? { error: error.slice(0, 200) } : {}),
        })
      }
    }
    if (failures.length === 0) return staticFindings
    failures.sort((a, b) => a.composite - b.composite)
    return failures.slice(0, CAP)
  }
}

/** Assemble the code-surface proposer from `opts.code`: git worktrees + the
 *  improvement driver + (by default) the full agentic generator. Returns
 *  `undefined` when the surface is not `code` or no code options were given —
 *  the caller then falls through to the fail-loud ConfigError. */
function codeProposerFor(
  surface: ImproveSurface,
  code: ImproveCodeOptions | undefined,
): SurfaceProposer | undefined {
  if (surface !== 'code' || !code) return undefined
  const generator =
    code.generator ??
    agenticGenerator({
      ...(code.harness ? { harness: code.harness } : {}),
      ...(code.verify ? { verify: code.verify } : {}),
      ...(code.timeoutMs ? { timeoutMs: code.timeoutMs } : {}),
    })
  return improvementDriver({
    worktree: gitWorktreeAdapter({
      repoRoot: code.repoRoot,
      ...(code.worktreeDir ? { worktreeDir: code.worktreeDir } : {}),
    }),
    generator,
    ...(code.baseRef ? { baseRef: code.baseRef } : {}),
  }) as SurfaceProposer
}

/** Parse a JSON winner surface (`skills`/`tools`/`mcp`/`hooks`) with a typed,
 *  contextual error. A malformed generator output must fail loud here, not throw
 *  a raw `SyntaxError` to the caller after a ship verdict. */
function parseWinnerJson<T>(winner: string, surface: ImproveSurface): T {
  try {
    return JSON.parse(winner) as T
  } catch (cause) {
    throw new ConfigError(
      `improve(): the shipped '${surface}' winner is not valid JSON, so it cannot be applied back to the profile: ${
        (cause as Error).message
      }`,
    )
  }
}

/** Apply a promoted winner surface back into the profile field for `surface`.
 *  Returns a shallow copy; never mutates the input profile. */
function applyWinnerToProfile(
  profile: AgentProfile,
  surface: ImproveSurface,
  winner: MutableSurface,
): AgentProfile {
  // Only string surfaces map cleanly back onto a profile field. A `CodeSurface`
  // winner (the `code` lever) is a worktree ref, not a profile value — the
  // caller materializes it from `raw.winner.surface`; the returned profile is
  // unchanged for that lever.
  if (typeof winner !== 'string') return profile
  switch (surface) {
    case 'prompt':
      return { ...profile, prompt: { ...profile.prompt, systemPrompt: winner } }
    case 'skills':
      return {
        ...profile,
        resources: { ...profile.resources, skills: parseWinnerJson(winner, surface) },
      }
    case 'tools':
      return { ...profile, tools: parseWinnerJson(winner, surface) }
    case 'mcp':
      return { ...profile, mcp: parseWinnerJson(winner, surface) }
    case 'hooks':
      return { ...profile, hooks: parseWinnerJson(winner, surface) }
    case 'rollout-policy': {
      // Parse + re-validate the winner against the policy's own invariants — a
      // custom generator's malformed dial must fail loud, not persist silently.
      const policy = normalizeRolloutPolicy(parseWinnerJson(winner, surface))
      if (!policy) {
        throw new ConfigError(
          `improve(): the shipped 'rollout-policy' winner is not a valid StructuralRolloutPolicy ` +
            `(integer k >= 1, repairRounds >= 0, testgen >= 0), so it cannot be applied: ${winner}`,
        )
      }
      return applyRolloutPolicyToProfile(profile, policy)
    }
    case 'code':
      return profile
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
 *   if (out.shipped) deploy(out.profile)
 */
export async function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  findings: unknown[],
  opts: ImproveOptions<TScenario, TArtifact>,
): Promise<ImproveResult<TScenario, TArtifact>> {
  const surface = opts.surface ?? 'prompt'
  const gate = opts.gate ?? 'holdout'

  // Fail loud before the generator is built: the reflection model must be in the allowed subset
  // (no-op when allowedModels is unset).
  assertModelAllowed(opts.llm?.model ?? defaultReflectionModel, opts.allowedModels)

  const proposer =
    opts.generator ?? defaultGeneratorFor(surface, opts.llm) ?? codeProposerFor(surface, opts.code)
  if (!proposer) {
    throw new ConfigError(
      surface === 'code'
        ? `improve(): surface 'code' needs either opts.generator or opts.code ({ repoRoot, ... }) — there is no safe zero-config repo to invent`
        : `improve(): surface '${surface}' has no default generator — pass opts.generator (a SurfaceProposer) explicitly`,
    )
  }

  const budget: SelfImproveBudget =
    gate === 'none' ? { ...opts.budget, generations: 0 } : { ...opts.budget }

  const raw = await selfImprove<TScenario, TArtifact>({
    agent: opts.agent,
    scenarios: opts.scenarios,
    judge: opts.judge,
    baselineSurface: baselineSurfaceFor(profile, surface, opts.skills),
    proposer,
    budget,
    llm: opts.llm,
    findings,
    ...(opts.runDir !== undefined ? { runDir: opts.runDir } : {}),
    ...(opts.storage !== undefined ? { storage: opts.storage } : {}),
    ...(opts.analyzeGeneration === null
      ? {}
      : {
          analyzeGeneration:
            opts.analyzeGeneration ??
            (opts.rawTraceContext
              ? rawTraceDistiller<TScenario, TArtifact>({ fallbackFindings: findings })
              : generationFailureDistiller<TScenario, TArtifact>(findings)),
        }),
  })

  const shipped = raw.gateDecision === 'ship'
  // When a skill DOCUMENT was optimized, the winner is document text — persist it
  // via writeBack (the profile ref points at the caller's file, unchanged) rather
  // than parsing it as a refs array. Otherwise use the standard field write-back.
  const usedSkillDocument = surface === 'skills' && opts.skills !== undefined
  if (shipped && usedSkillDocument && typeof raw.winner.surface === 'string') {
    opts.skills?.writeBack?.(raw.winner.surface)
  }
  const nextProfile =
    shipped && !usedSkillDocument
      ? applyWinnerToProfile(profile, surface, raw.winner.surface)
      : profile

  return { profile: nextProfile, shipped, lift: raw.lift, gateDecision: raw.gateDecision, raw }
}
