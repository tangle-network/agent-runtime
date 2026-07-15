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
 *   - `surface: 'memory'` → `memoryCurationProposer` curates a bounded durable
 *     lesson document supplied through `opts.memory`.
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

import { canonicalJson } from '@tangle-network/agent-eval'
import {
  gepaProposer,
  gitWorktreeAdapter,
  memoryCurationProposer,
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
import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { ConfigError } from '../errors'
import type { LocalHarness } from '../mcp/local-harness'
import { assertModelAllowed } from '../runtime/supervise/model-policy'
import { agenticGenerator, type Verifier } from './agentic-generator'
import {
  type CandidateGenerator,
  improvementDriver,
  type ManagedImprovementDriver,
} from './improvement-driver'
import { rawTraceDistiller } from './raw-trace-distiller'

/** The executable agent lever `improve` optimizes. Profile fields remain
 *  portable AgentProfile coordinates; implementation and orchestration files
 *  use the code surface so a winner can be sealed into an exact candidate. */
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

export type ImproveOptions<TScenario extends Scenario, TArtifact> = Omit<
  SelfImproveOptions<TScenario, TArtifact>,
  'analyzeGeneration' | 'baselineSurface' | 'findings' | 'gate' | 'proposer'
> & {
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
   *  DEFAULT: the built-in failure distiller — after each generation it turns the
   *  worst-scoring/errored cells into structured findings ({ scenario, composite,
   *  notes, error }) for the NEXT proposal round, so the proposer reasons over what
   *  actually failed instead of a static seed. Pass your own producer (e.g. a
   *  trace-analyst over the runDir's traces) to replace it; pass `null` to disable
   *  and keep the static `findings` all the way through. */
  analyzeGeneration?: SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration'] | null
  /** META-HARNESS mode: instead of the ~1500-char distilled findings, feed the
   *  proposer RAW-TRACE FILESYSTEM CONTEXT — the PATHS into the prior generation's
   *  real run traces under `runDir` (per-cell `spans.jsonl` event logs +
   *  `cached-result.json` scores + artifacts) plus a `grep`/`cat`-to-diagnose
   *  instruction — so the coding agent reads the actual failures itself rather than
   *  a pre-summary. Requires a REAL `runDir` (that is where the traces live).
   *  Ignored when `analyzeGeneration` is set explicitly (that wins) or is `null`
   *  (disabled). Equivalent to `analyzeGeneration: rawTraceDistiller()`; this flag
   *  is the one-line enable. Default `false` (the distiller stays the default). */
  rawTraceContext?: boolean
  /** CODE-surface wiring: name `surface: 'code'`, point at a repo, and the
   *  facade assembles the whole candidate pipeline — an isolated incumbent plus git worktrees
   *  (`gitWorktreeAdapter`) driven by `improvementDriver` with the full agentic
   *  generator (a real coding harness edits each candidate worktree; a `verify`
   *  hook gates candidates before they are ever measured). Ignored when
   *  `opts.generator` is supplied. Required for every code run because a real
   *  repository and base ref are necessary to measure the incumbent. */
  code?: ImproveCodeOptions
  /** SKILLS-surface wiring for real skill-DOCUMENT optimization. Without this,
   *  `surface: 'skills'` optimizes the profile's skills REFS array (file pointers)
   *  — which `skillOptProposer` (a document patcher) cannot meaningfully edit.
   *  Provide the document CONTENT to optimize + a `writeBack` to persist the
   *  shipped winner (the profile ref points at a file the caller owns). This is
   *  what makes skillOpt reachable through improve(). */
  skills?: ImproveSkillsOptions
  /** MEMORY-surface wiring for a curated durable memory document. The default
   *  deterministic proposer deduplicates and ranks lessons from findings, then
   *  replaces its managed block instead of growing memory without bound. */
  memory?: ImproveMemoryOptions
  /** Custom held-back-exam decision. The string `gate` above controls whether
   *  the exam runs; this callback controls how its evidence decides promotion. */
  promotionGate?: SelfImproveOptions<TScenario, TArtifact>['gate']
}

export interface ImproveSkillsOptions {
  /** The skill document's current text — the baseline `skillOptProposer` patches. */
  document: string
  /** Persist the shipped winner document (write the file the profile ref points at).
   *  Called only on a ship verdict. When omitted, the winner is still returned in
   *  `result.raw.winner.surface` for the caller to materialize. */
  writeBack?: (winnerDocument: string) => void | Promise<void>
}

export interface ImproveMemoryOptions {
  /** Current durable memory text used as the measured baseline. */
  document: string
  /** Persist the promoted memory document. Never called on hold or error. */
  writeBack?: (winnerDocument: string) => void | Promise<void>
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
  /** Full `selfImprove` result for advanced inspection. For code runs,
   *  `raw.winner.surface.worktreeRef` remains live after return whether the
   *  candidate shipped or held; call `dispose()` after consuming it. */
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
  memory?: ImproveMemoryOptions,
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
    case 'subagents':
      return JSON.stringify(profile.subagents ?? {})
    case 'agent-profile':
      return canonicalJson(profile)
    case 'memory':
      if (!memory) {
        throw new ConfigError("improve(): surface 'memory' requires opts.memory.document")
      }
      return memory.document
    case 'code':
      throw new ConfigError(
        'improve(): code requires the isolated baseline created from opts.code.repoRoot',
      )
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
        // 1500 chars keeps a real traceback / failing assertion intact — the old
        // 400 clipped executable-judge notes down to a stub, leaving the proposer
        // trace-blind. Errors stay tighter (they are usually one-line).
        const notes = judgeScores
          .map((j) => j.notes)
          .filter((n): n is string => typeof n === 'string' && n.length > 0)
          .join('; ')
          .slice(0, 1500)
        const claim = notes || (error ? `Scenario ${scenario} failed: ${error.slice(0, 500)}` : '')
        failures.push({
          scenario,
          composite: Number(composite.toFixed(3)),
          notes,
          ...(claim ? { claim } : {}),
          ...(error ? { error: error.slice(0, 500) } : {}),
        })
      }
    }
    if (failures.length === 0) return staticFindings
    failures.sort((a, b) => a.composite - b.composite)
    return failures.slice(0, CAP)
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

interface PreparedCodeRun {
  baseline: CodeSurface
  proposer: SurfaceProposer
  cleanup(retainedWinner?: MutableSurface): Promise<void>
}

/** Preserve the primary failure while making two best-effort cleanup attempts.
 * A failed first attempt is retained in the thrown AggregateError even when the
 * retry succeeds, so callers can diagnose degraded cleanup without losing the
 * error that caused cleanup to run. */
async function rethrowAfterCleanup(
  cause: unknown,
  cleanup: () => Promise<void>,
  message: string,
): Promise<never> {
  const cleanupErrors: unknown[] = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await cleanup()
    } catch (cleanupCause) {
      cleanupErrors.push(cleanupCause)
      continue
    }
    if (cleanupErrors.length === 0) throw cause
    throw new AggregateError([cause, ...cleanupErrors], `${message}; the cleanup retry succeeded`)
  }
  throw new AggregateError([cause, ...cleanupErrors], message)
}

async function discardPreparedBaseline(
  worktree: WorktreeAdapter,
  baselineWorktree: Worktree,
  cause: unknown,
): Promise<never> {
  return rethrowAfterCleanup(
    cause,
    () => worktree.discard(baselineWorktree),
    'improve(): code preparation failed and its baseline worktree could not be cleaned',
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

/** Parse a JSON winner surface (`tools`/`mcp`/`hooks`/`subagents`/`agent-profile`) with a typed,
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
export function applyImprovementWinnerToProfile(
  profile: AgentProfile,
  surface: ImproveSurface,
  winner: MutableSurface,
): AgentProfile {
  // Only string surfaces map cleanly back onto a profile field. A `CodeSurface`
  // winner (the `code` lever) is a worktree ref, not a profile value — the
  // caller materializes it from `raw.winner.surface`; the returned profile is
  // unchanged for that lever.
  if (typeof winner !== 'string') return profile
  let candidate: AgentProfile
  switch (surface) {
    case 'prompt':
      candidate = { ...profile, prompt: { ...profile.prompt, systemPrompt: winner } }
      break
    case 'skills':
      candidate = {
        ...profile,
        resources: { ...profile.resources, skills: parseWinnerJson(winner, surface) },
      }
      break
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
      return profile
    case 'code':
      return profile
  }
  const parsed = agentProfileSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new ConfigError(
      `improve(): the shipped '${surface}' winner does not produce a valid AgentProfile: ${parsed.error.message}`,
    )
  }
  return parsed.data
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
  const {
    surface = 'prompt',
    gate = 'holdout',
    generator,
    allowedModels,
    rawTraceContext,
    code,
    skills,
    memory,
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
  if (surface === 'skills' && !generator && !skills) {
    throw new ConfigError(
      'improve(): the default skills optimizer requires opts.skills.document; pass the skill text or an explicit generator that understands resource refs',
    )
  }
  if (surface === 'memory' && !memory) {
    throw new ConfigError("improve(): surface 'memory' requires opts.memory.document")
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

  let raw: SelfImproveResult<TScenario, TArtifact>
  try {
    raw = await selfImprove<TScenario, TArtifact>({
      ...sharedOptions,
      baselineSurface:
        preparedCode?.baseline ?? baselineSurfaceFor(profile, surface, skills, memory),
      proposer,
      budget,
      findings,
      ...(promotionGate !== undefined ? { gate: promotionGate } : {}),
      ...(analyzeGeneration === null
        ? {}
        : {
            analyzeGeneration:
              analyzeGeneration ??
              (rawTraceContext
                ? rawTraceDistiller<TScenario, TArtifact>({ fallbackFindings: findings })
                : surface === 'memory'
                  ? memoryGenerationDistiller<TScenario, TArtifact>(findings)
                  : generationFailureDistiller<TScenario, TArtifact>(findings)),
          }),
    })
  } catch (cause) {
    if (!preparedCode) throw cause
    return rethrowAfterCleanup(
      cause,
      () => preparedCode.cleanup(),
      'improve(): code improvement failed and its worktrees could not be cleaned',
    )
  }

  const shipped = raw.gateDecision === 'ship'
  const winnerSurface = raw.winner.surface
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
  // When a skill DOCUMENT was optimized, the winner is document text — persist it
  // via writeBack (the profile ref points at the caller's file, unchanged) rather
  // than parsing it as a refs array. Otherwise use the standard field write-back.
  const externalDocument =
    surface === 'skills' && skills ? skills : surface === 'memory' && memory ? memory : undefined
  if (shipped && externalDocument) {
    if (typeof winnerSurface !== 'string') {
      throw new ConfigError(
        `improve(): the shipped '${surface}' winner must be text before it can be persisted`,
      )
    }
    await externalDocument.writeBack?.(winnerSurface)
  }
  const nextProfile =
    shipped && !externalDocument
      ? applyImprovementWinnerToProfile(profile, surface, winnerSurface)
      : profile

  return {
    profile: nextProfile,
    shipped,
    lift: raw.lift,
    gateDecision: raw.gateDecision,
    raw,
    dispose,
  }
}
