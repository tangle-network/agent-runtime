/**
 * @experimental
 *
 * `optimizePrompt` — identity-gated optimization for any TEXT prompt surface
 * (system prompt, planner prompt, judge rubric, skill doc).
 *
 * The text-surface sibling to this module's `improvementDriver` (the
 * CODE-surface / worktree path). Both feed agent-eval's `runImprovementLoop`;
 * this one defaults the driver to agent-eval's `gepaDriver` (reflective text
 * mutator) and the gate to `heldOutGate`.
 *
 * IDENTITY-GATED BY CONSTRUCTION — the whole point. The loop runs evals,
 * collects per-scenario signal, proposes candidates, and the gate compares
 * candidate-vs-baseline ON THE HELDOUT. `result.prompt` is the baseline
 * (identity) UNLESS the gate decided `'ship'`. So wiring a surface up is safe:
 * a surface with no beneficial mutation simply keeps its baseline. You never
 * regress by registering a prompt — you only ever improve when the held-out
 * data earns it.
 *
 * Generic over the runtime: `runWithPrompt` is the only domain seam — given a
 * candidate prompt + scenario, run it however the surface runs (sandbox
 * `streamPrompt`, a `runLoop`, a direct model call) and return the artifact the
 * judges score. The optimizer never assumes how a prompt is executed.
 */

import type { LlmClientOptions } from '@tangle-network/agent-eval'
import type {
  CampaignResult,
  CampaignStorage,
  DispatchContext,
  Gate,
  GateResult,
  ImprovementDriver,
  JudgeConfig,
  RunImprovementLoopResult,
  Scenario,
} from '@tangle-network/agent-eval/campaign'
import { gepaDriver, heldOutGate, runImprovementLoop } from '@tangle-network/agent-eval/campaign'
import { ConfigError } from '../errors'

/** Reflection config for the default `gepaDriver`. Omit when passing a custom
 *  `driver`. */
export interface OptimizePromptReflection {
  /** Router transport for the reflection model. */
  llm: LlmClientOptions
  /** Model that performs the reflective rewrite. */
  model: string
  /** What is being optimized — orients the reflection prompt. Default
   *  `'system prompt'`. */
  target?: string
  /** Surface-specific mutation levers offered to the reflector. */
  mutationPrimitives?: string[]
  /** H2 (`## Foo`) headings that MUST survive every candidate. gepaDriver's
   *  only structural guard — load-bearing sections of the prompt should be
   *  `##` headings so a rewrite cannot drop them. */
  preserveSections?: string[]
  /** Max sentence-level edits per candidate vs the parent (a textual learning
   *  rate). Caps a rewrite from wiping prior rules in one generation. */
  maxSentenceEdits?: number
}

/** @experimental */
export interface OptimizePromptOptions<TScenario extends Scenario, TArtifact> {
  /** The prompt being optimized — the identity baseline the gate protects. */
  baselinePrompt: string
  /** Domain seam: run a candidate prompt against a scenario → artifact the
   *  judges score. The optimizer is agnostic to HOW the prompt runs. */
  runWithPrompt: (prompt: string, scenario: TScenario, ctx: DispatchContext) => Promise<TArtifact>
  /** Training pool — scored each generation to rank candidates. */
  scenarios: TScenario[]
  /** Held out of training — scored ONLY for the gate's baseline-vs-winner
   *  delta. Disjoint from `scenarios`; this is what makes promotion measure
   *  generalization, not memorization. */
  holdoutScenarios: TScenario[]
  /** Scorers — deterministic checks or LLM judges. */
  judges: JudgeConfig<TArtifact, TScenario>[]
  /** Where artifacts + traces land (opaque key under in-memory storage). */
  runDir: string
  /** Default driver = `gepaDriver` built from this. Required UNLESS `driver`
   *  is supplied. */
  reflection?: OptimizePromptReflection
  /** Override the improvement strategy (custom driver / deterministic tests). */
  driver?: ImprovementDriver
  /** Override the promotion gate. Default `heldOutGate` over `holdoutScenarios`
   *  — zero extra LLM. Wrap `defaultProductionGate` for red-team/reward-hacking
   *  hardening on production wiring. */
  gate?: Gate<TArtifact, TScenario>
  /** Minimum held-out composite lift to ship, forwarded to the default
   *  `heldOutGate`. When omitted the gate uses its own default. */
  deltaThreshold?: number
  /** Candidates proposed per generation. Default 4. */
  populationSize?: number
  /** Generations to run. Default 3. */
  maxGenerations?: number
  /** Candidates carried to the next generation. Default 2. */
  promoteTopK?: number
  /** Storage backend. Pass `inMemoryCampaignStorage()` for filesystem-less /
   *  test runs. Default: Node filesystem. */
  storage?: CampaignStorage
  /** Reproducibility seed. Default 42. */
  seed?: number
  /** Per-scenario replicates for CI bands. Default 1. */
  reps?: number
  /** Max concurrent cells. Default 2. */
  maxConcurrency?: number
  /** Test seam — override the wall clock. */
  now?: () => Date
  /** On a shipped gate: `'pr'` opens a PR, `'none'` just reports. Default
   *  `'none'`. */
  autoOnPromote?: 'pr' | 'none'
  ghOwner?: string
  ghRepo?: string
}

/** @experimental */
export interface OptimizePromptResult<TArtifact, TScenario extends Scenario> {
  /** The prompt to USE. Identity (the baseline) unless the gate shipped a
   *  winner — so a caller can always assign `result.prompt` unconditionally. */
  prompt: string
  /** True only when the gate promoted a candidate over baseline on holdout. */
  improved: boolean
  /** The gate's verdict (`'ship' | 'hold' | 'need_more_work' | ...`). */
  decision: GateResult['decision']
  /** Human-readable reasons the gate gave. */
  reasons: string[]
  /** Mean held-out composite of the baseline. */
  baselineComposite: number
  /** Mean held-out composite of the winner candidate. */
  winnerComposite: number
  /** Held-out lift (winner − baseline); the gate's `delta` when it reported one. */
  delta: number
  /** Why the winner was proposed — present when a shipped winner carried a
   *  driver rationale. */
  rationale?: string
  /** Unified baseline→winner diff (empty when the winner is the baseline). */
  diff: string
  /** The full loop result for callers that need generations / campaigns. */
  raw: RunImprovementLoopResult<TArtifact, TScenario>
}

/** @experimental */
export async function optimizePrompt<TScenario extends Scenario, TArtifact>(
  opts: OptimizePromptOptions<TScenario, TArtifact>,
): Promise<OptimizePromptResult<TArtifact, TScenario>> {
  if (!opts.driver && !opts.reflection) {
    throw new ConfigError(
      'optimizePrompt: pass `reflection` (builds the default gepaDriver) or a custom `driver`',
    )
  }
  if (opts.scenarios.length === 0) {
    throw new ConfigError('optimizePrompt: `scenarios` must be non-empty')
  }
  if (opts.holdoutScenarios.length === 0) {
    throw new ConfigError(
      'optimizePrompt: `holdoutScenarios` must be non-empty (the gate needs it)',
    )
  }

  const driver =
    opts.driver ??
    gepaDriver({
      llm: opts.reflection!.llm,
      model: opts.reflection!.model,
      target: opts.reflection!.target ?? 'system prompt',
      mutationPrimitives: opts.reflection!.mutationPrimitives,
      constraints:
        opts.reflection!.preserveSections || opts.reflection!.maxSentenceEdits !== undefined
          ? {
              preserveSections: opts.reflection!.preserveSections,
              maxSentenceEdits: opts.reflection!.maxSentenceEdits,
            }
          : undefined,
    })

  const gate =
    opts.gate ??
    heldOutGate<TArtifact, TScenario>({
      scenarios: opts.holdoutScenarios,
      ...(opts.deltaThreshold !== undefined ? { deltaThreshold: opts.deltaThreshold } : {}),
    })

  const result = await runImprovementLoop<TScenario, TArtifact>({
    baselineSurface: opts.baselinePrompt,
    dispatchWithSurface: (surface, scenario, ctx) => {
      if (typeof surface !== 'string') {
        // optimizePrompt is the TEXT-surface entry point; a CodeSurface means
        // the caller wired the wrong driver. Fail loud — don't silently run the
        // baseline and report a phantom score.
        throw new ConfigError(
          'optimizePrompt: received a CodeSurface — this entry point optimizes string prompts only',
        )
      }
      return opts.runWithPrompt(surface, scenario, ctx)
    },
    driver,
    populationSize: opts.populationSize ?? 4,
    maxGenerations: opts.maxGenerations ?? 3,
    ...(opts.promoteTopK !== undefined ? { promoteTopK: opts.promoteTopK } : {}),
    scenarios: opts.scenarios,
    holdoutScenarios: opts.holdoutScenarios,
    judges: opts.judges,
    gate,
    autoOnPromote: opts.autoOnPromote ?? 'none',
    ...(opts.ghOwner !== undefined ? { ghOwner: opts.ghOwner } : {}),
    ...(opts.ghRepo !== undefined ? { ghRepo: opts.ghRepo } : {}),
    runDir: opts.runDir,
    ...(opts.storage !== undefined ? { storage: opts.storage } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.reps !== undefined ? { reps: opts.reps } : {}),
    ...(opts.maxConcurrency !== undefined ? { maxConcurrency: opts.maxConcurrency } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })

  const improved = result.gateResult.decision === 'ship'
  const winnerSurface =
    typeof result.winnerSurface === 'string' ? result.winnerSurface : opts.baselinePrompt
  const baselineComposite = meanComposite(result.baselineOnHoldout)
  const winnerComposite = meanComposite(result.winnerOnHoldout)

  return {
    prompt: improved ? winnerSurface : opts.baselinePrompt,
    improved,
    decision: result.gateResult.decision,
    reasons: result.gateResult.reasons,
    baselineComposite,
    winnerComposite,
    delta: result.gateResult.delta ?? winnerComposite - baselineComposite,
    ...(improved && result.winnerRationale ? { rationale: result.winnerRationale } : {}),
    diff: result.promotedDiff,
    raw: result,
  }
}

/** Mean composite over a campaign's per-scenario aggregates. The held-out
 *  campaigns score one surface across `holdoutScenarios`; averaging the
 *  per-scenario means gives the single number the gate's delta is built from. */
function meanComposite(campaign: CampaignResult<unknown, Scenario>): number {
  const scenarios = Object.values(campaign.aggregates.byScenario)
  if (scenarios.length === 0) return 0
  const sum = scenarios.reduce((acc, s) => acc + s.meanComposite, 0)
  return sum / scenarios.length
}
