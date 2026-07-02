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

import { gepaProposer, skillOptProposer } from '@tangle-network/agent-eval/campaign'
import {
  type DispatchContext,
  type JudgeConfig,
  type MutableSurface,
  type Scenario,
  type SelfImproveBudget,
  type SelfImproveLlm,
  type SelfImproveResult,
  type SurfaceProposer,
  selfImprove,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../errors'
import { assertModelAllowed } from '../runtime/supervise/model-policy'

/** The agent-profile lever `improve` optimizes. Mirrors the AgentProfile-law
 *  profile levers; `code` is the implementation-tier surface. */
export type ImproveSurface = 'prompt' | 'skills' | 'tools' | 'mcp' | 'hooks' | 'code'

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
    default:
      return undefined
  }
}

/** Extract the baseline surface a driver mutates from the profile field that
 *  backs `surface`. `prompt`/`skills` are string surfaces; the config surfaces
 *  serialize the matching profile record. */
function baselineSurfaceFor(profile: AgentProfile, surface: ImproveSurface): MutableSurface {
  switch (surface) {
    case 'prompt':
      return profile.prompt?.systemPrompt ?? ''
    case 'skills':
      return JSON.stringify(profile.resources?.skills ?? [])
    case 'tools':
      return JSON.stringify(profile.tools ?? {})
    case 'mcp':
      return JSON.stringify(profile.mcp ?? {})
    case 'hooks':
      return JSON.stringify(profile.hooks ?? {})
    case 'code':
      // A code surface is produced by the caller's generator from a worktree;
      // the facade has no worktree ref to seed, so the baseline is the empty
      // string (the driver opens its own worktree off `baseRef`).
      return ''
  }
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

  const proposer = opts.generator ?? defaultGeneratorFor(surface, opts.llm)
  if (!proposer) {
    throw new ConfigError(
      `improve(): surface '${surface}' has no default generator — pass opts.generator (a SurfaceProposer) explicitly`,
    )
  }

  const budget: SelfImproveBudget =
    gate === 'none' ? { ...opts.budget, generations: 0 } : { ...opts.budget }

  const raw = await selfImprove<TScenario, TArtifact>({
    agent: opts.agent,
    scenarios: opts.scenarios,
    judge: opts.judge,
    baselineSurface: baselineSurfaceFor(profile, surface),
    proposer,
    budget,
    llm: opts.llm,
    findings,
  })

  const shipped = raw.gateDecision === 'ship'
  const nextProfile = shipped ? applyWinnerToProfile(profile, surface, raw.winner.surface) : profile

  return { profile: nextProfile, shipped, lift: raw.lift, gateDecision: raw.gateDecision, raw }
}
