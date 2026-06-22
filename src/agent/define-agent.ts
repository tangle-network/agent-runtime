/**
 * `defineAgent` — typed, validated manifest API for declarative agent
 * configuration. The substrate consumes this manifest to wire the
 * canonical eval pattern + analyst self-improvement loop without any
 * per-vertical glue.
 *
 * Design goal: scale to 1000s of vertical agents. Every agent declares
 * its surfaces, rubric, runtime, and analyst configuration in ~50 lines.
 * No per-vertical `ImprovementAdapter`. No per-vertical CLI. No
 * fabricated paths.
 *
 * Validation: `defineAgent` runs `validateSurfaces` synchronously and
 * throws a structured error if any required surface is missing on
 * disk. The cost is one filesystem stat per surface (cheap); the
 * benefit is a manifest that can't ship broken.
 */

import type { TraceAnalystKindSpec } from '@tangle-network/agent-eval'
import type { PromotionGate } from '../lifecycle/gate'
import type { CandidateGenerator } from '../lifecycle/generator'
import type { ArtifactKind } from '../lifecycle/types'
import type { RuntimeStreamEvent } from '../types'
import { type AgentSurfaces, renderSurfaceIssues, validateSurfaces } from './surfaces'

// ── manifest ─────────────────────────────────────────────────────────

/**
 * The full agent manifest. Each agent ships ONE of these.
 *
 * Generics:
 *   `TPersona` — the agent's persona shape (loaded from
 *     `surfaces.personas`). Defaults to `unknown` so the substrate's
 *     persona discovery (`loadPersonas`) can accept anything; per-agent
 *     code re-narrows when it matters.
 *   `TRunOutput` — the shape `runtime.act` returns. Used by the rubric
 *     scorers and emitted into the trace.
 */
export interface AgentManifest<TPersona = unknown, TRunOutput = unknown> {
  /**
   * Stable identifier — used as `projectId` in traces, as the analyst
   * loop's `runId` prefix, and as the namespace under which findings
   * are persisted. MUST match the agent's repo name to keep
   * cross-repo telemetry joinable.
   */
  id: string

  /**
   * Filesystem root the substrate resolves surface paths against.
   * Typically `process.cwd()` or a fixed absolute path. Use an
   * absolute path when the agent's tests may run from subdirectories
   * (vitest sometimes shifts cwd).
   */
  repoRoot: string

  /**
   * Map of mutable surfaces the self-improvement loop can edit. See
   * `AgentSurfaces` — required: `systemPrompt`, `tools`, `rubric`,
   * `knowledge`, `personas`. Optional: `scaffolding`, `memory`, `rag`,
   * `outputSchema`.
   *
   * Every required path is validated at `defineAgent` time. Missing
   * paths throw with the full list of offenders.
   */
  surfaces: AgentSurfaces

  /**
   * Rubric the substrate uses to score each run. Dimensions × weights
   * × judges. The substrate computes the weighted composite and
   * stamps it into the RunRecord.
   */
  rubric: AgentRubric<TRunOutput>

  /**
   * Runtime adapter — how the substrate INVOKES the agent against a
   * persona. The `act` function takes a persona + a context (with the
   * tracer the substrate threads through for span emission) and
   * returns the run output the rubric will score.
   *
   * The agent's existing production runtime goes in here; the
   * substrate is intentionally thin around it.
   */
  runtime: AgentRuntime<TPersona, TRunOutput>

  /**
   * Persona discovery — the substrate loads personas via this function
   * at eval start. Can read from `surfaces.personas`, an API, or be
   * hardcoded. The substrate calls it once per `runAgentEval` call;
   * persona ordering is preserved.
   */
  personas: () => Promise<ReadonlyArray<TPersona>>

  /**
   * Analyst kinds the substrate runs against each persona's trace.
   * Defaults to `DEFAULT_TRACE_ANALYST_KINDS` from agent-eval. Per-agent
   * authors can prune (e.g. skip `knowledge-poisoning` when there's no
   * knowledge base) or extend (custom domain kinds).
   *
   * Empty array disables the loop — useful for `pnpm eval --no-analyst`.
   */
  analystKinds: ReadonlyArray<TraceAnalystKindSpec>

  /**
   * Analyst LLM configuration. The substrate uses these for all four
   * kinds (override per-kind via `analystKinds` if needed).
   */
  analyst: AnalystConfig

  /**
   * Auto-apply policy. Knowledge / improvement edits land only when
   * `enabled === true` AND the source finding's confidence meets the
   * threshold. `mode` controls how applies happen: `'write'` mutates
   * files in-place; `'open-pr'` writes to a branch and opens a PR.
   *
   * Default: knowledge auto-applies at confidence ≥0.85 in `'write'`
   * mode (wiki edits are git-reversible); improvement stays at
   * `enabled: false` until the agent author has measured precision.
   */
  autoApply?: AutoApplyPolicy

  /**
   * Declarative per-surface artifact-lifecycle config the closed loop reads.
   *
   * Each entry names a profile surface (`skill` / `tool` / `prompt` / `mcp` /
   * `hook` / `subagent`) and supplies the `CandidateGenerator` that grows it +
   * the `PromotionGate` (the held-back exam) that decides promotion. `runLifecycle`
   * consumes these: it pools the generators, measures each candidate's marginal
   * lift on the held-back split, gates it, and stores the winners in an
   * `ArtifactRegistry` — then `composeProfile` folds the top-`k` active artifacts
   * back into this agent's profile.
   *
   * Optional — agents that don't self-improve their profile omit it. An empty or
   * absent map means "no lifecycle"; the manifest is otherwise unchanged.
   */
  lifecycles?: ReadonlyArray<SurfaceLifecycle>
}

/**
 * One profile surface's artifact-lifecycle wiring — the declarative config a
 * `defineAgent` manifest carries and `runLifecycle` reads. It is config, not
 * execution: it names the generator + gate; the loop runs them.
 */
export interface SurfaceLifecycle {
  /** The profile surface this lifecycle grows. */
  surface: ArtifactKind
  /** Produces fresh candidate artifacts for `surface` from the agent's history. */
  generator: CandidateGenerator
  /** The held-back exam that decides promotion of a measured candidate. */
  gate: PromotionGate
  /** Top-`k` budget for `composeProfile` when folding this surface's promoted
   *  artifacts back in. Omit to fold in every active artifact. */
  composeK?: number
}

export interface AgentRubric<TRunOutput> {
  /** Dimensions composing the weighted score. Weights sum to 1.0 by convention. */
  dimensions: ReadonlyArray<RubricDimension<TRunOutput>>
  /**
   * Optional judges layered on top of deterministic dimensions. Each
   * judge returns a score per dimension; the substrate averages judges
   * (mean by default) for the LLM contribution.
   */
  judges?: ReadonlyArray<JudgeConfig<TRunOutput>>
}

export interface RubricDimension<TRunOutput> {
  /** Unique identifier — appears in finding subjects (`rubric:<id>`). */
  id: string
  /** 0..1 — weight in the composite. */
  weight: number
  /**
   * Deterministic scorer: given the persona + run output, returns a
   * 0..1 score. The substrate sums weight × score across dimensions
   * for the deterministic composite; judges supplement subjective dims.
   */
  score: (input: { persona: unknown; output: TRunOutput }) => number
  /** Optional human-readable label for reports. */
  label?: string
}

export interface JudgeConfig<TRunOutput> {
  /** Judge identifier — appears in trace spans + manifest. */
  id: string
  /** Model snapshot to invoke. Pin the snapshot (`claude-sonnet-4-6@2025-04-15`); the validator rejects bare aliases. */
  model: string
  /** Dimensions this judge scores. */
  dimensions: ReadonlyArray<string>
  /**
   * Optional rubric anchors — text examples the judge sees as a
   * few-shot prompt to calibrate. STRONGLY recommended for subjective
   * dimensions; required by the calibration gate (Pearson ≥0.7).
   */
  anchors?: ReadonlyArray<{ input: string; output: TRunOutput; expected: Record<string, number> }>
}

export interface AgentRuntime<TPersona, TRunOutput> {
  /**
   * Invoke the agent against one persona. Returns BOTH:
   *   - `events`: an `AsyncIterable<RuntimeStreamEvent>` the chat-centric
   *     product consumes verbatim (SSE / WebSocket / inline render).
   *     **Streaming is mandatory — never collapse this to a single Promise.**
   *     The agent's existing `runChatTurn` (or equivalent async generator)
   *     plugs in here directly.
   *   - `output`: a `Promise<TRunOutput>` resolved AFTER the event stream
   *     drains. The eval substrate awaits this for rubric scoring; chat
   *     products usually ignore it (they already rendered incrementally).
   *
   * Implementation contract:
   *   1. `act` MUST return immediately (synchronous construction of the
   *      `events` iterator + the `output` promise).
   *   2. Iterating `events` drives the underlying LLM/tool calls — the
   *      caller chooses when to consume.
   *   3. `output` resolves only after the iterator yields its terminal
   *      event (typically `task_end`); see `collectAgentRun` helper.
   *
   * `ctx.emitter` is the substrate-threaded `TraceEmitter` — runtimes
   * SHOULD record LLM/tool spans through it for capture integrity.
   * `ctx.deadlineMs` is wall-clock; the runtime SHOULD honour for graceful
   * cancel. `ctx.signal` is the standard abort signal.
   */
  act: (persona: TPersona, ctx: AgentRunContext) => AgentRunInvocation<TRunOutput>
}

export interface AgentRunInvocation<TRunOutput> {
  /** Live stream of typed runtime events. Consumed by chat UX directly. */
  events: AsyncIterable<RuntimeStreamEvent>
  /** Final structured output the rubric scores. Resolves after `events` drains. */
  output: Promise<TRunOutput>
}

/**
 * Stub for agents whose `runtime.act` is not yet wired to the substrate's
 * eval path. Preserves the streaming contract (empty event stream + a
 * rejected `output` promise that tells the caller exactly what to fix).
 *
 * Per-vertical manifests usually start with this stub and replace it with
 * the agent's real streaming runtime (`runChatTurn` or equivalent) once
 * the eval path consumes the manifest end-to-end.
 */
export function unimplementedAgentRun<TRunOutput = unknown>(
  reason = 'AgentRuntime.act is not yet wired for this manifest',
): AgentRunInvocation<TRunOutput> {
  return {
    events: (async function* empty(): AsyncIterable<RuntimeStreamEvent> {})(),
    output: Promise.reject(new Error(reason)),
  }
}

/**
 * Drain `act`'s `events` into an array AND await its `output`. Useful for
 * eval / outcome-measurement code paths that don't care about live
 * rendering. The events array is preserved so the substrate can inspect
 * tool calls / readiness / questions retrospectively.
 *
 * IMPORTANT: chat-centric UX MUST NOT call this — it defeats streaming
 * (no incremental render). Use `for await (const ev of invocation.events)`
 * directly in the chat surface.
 */
export async function collectAgentRun<TRunOutput>(
  invocation: AgentRunInvocation<TRunOutput>,
): Promise<{ events: ReadonlyArray<RuntimeStreamEvent>; output: TRunOutput }> {
  const events: RuntimeStreamEvent[] = []
  for await (const ev of invocation.events) events.push(ev)
  const output = await invocation.output
  return { events, output }
}

export interface AgentRunContext {
  /** Substrate-managed trace emitter. */
  emitter: import('@tangle-network/agent-eval').TraceEmitter
  /** Stable run id for this persona × variant cell. */
  runId: string
  /** Variant the runtime is exercising (e.g. `'baseline'`, `'source-grounded'`). */
  variantId?: string
  /** Wall-clock deadline (epoch ms). The runtime SHOULD honour for graceful cancel. */
  deadlineMs?: number
  /** Optional abort signal. */
  signal?: AbortSignal
}

export interface AnalystConfig {
  /** Model the analyst kinds use. Override per-kind via `analystKinds[i].cost.models`. */
  model: string
  /** Optional total budget across all kinds for one run. Substrate enforces via `BudgetGuard`. */
  budgetUsd?: number
  /** Backend hint for the AxAIService factory — same shape every kind uses. */
  backend?: {
    name?: 'openai' | 'router'
    apiKey?: string
    baseUrl?: string
  }
}

export interface AutoApplyPolicy {
  knowledge?: {
    enabled: boolean
    confidenceThreshold?: number
    mode?: 'write' | 'open-pr'
  }
  improvement?: {
    enabled: boolean
    confidenceThreshold?: number
    mode?: 'write' | 'open-pr'
  }
}

// ── factory + validation ─────────────────────────────────────────────

export class AgentManifestError extends Error {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly issues: ReadonlyArray<unknown> = [],
  ) {
    super(message)
    this.name = 'AgentManifestError'
  }
}

/**
 * Construct a validated agent manifest. Throws `AgentManifestError`
 * if any required surface is missing on disk.
 *
 * Generics: pass your persona / output types if you want narrowed
 * `runtime.act` signatures:
 *   `defineAgent<TaxPersona, TaxRunOutput>({ ... })`
 *
 * Most callers don't need the generics — the substrate operates on
 * `unknown` payloads internally and the manifest's `score` /
 * `runtime.act` see the typed shapes via TypeScript inference at
 * the call site.
 */
export function defineAgent<TPersona = unknown, TRunOutput = unknown>(
  manifest: AgentManifest<TPersona, TRunOutput>,
): AgentManifest<TPersona, TRunOutput> {
  if (!manifest.id || manifest.id.trim().length === 0) {
    throw new AgentManifestError('defineAgent: `id` is required', manifest.id ?? '')
  }
  if (!manifest.repoRoot || manifest.repoRoot.trim().length === 0) {
    throw new AgentManifestError('defineAgent: `repoRoot` is required', manifest.id)
  }
  const issues = validateSurfaces(manifest.surfaces, manifest.repoRoot)
  if (issues.length > 0) {
    throw new AgentManifestError(
      renderSurfaceIssues(issues, manifest.repoRoot),
      manifest.id,
      issues,
    )
  }
  // Lightweight rubric sanity: weights sum to ~1.0 (no hard requirement —
  // the substrate normalizes — but flag wildly miscalibrated weights).
  const total = manifest.rubric.dimensions.reduce((acc, d) => acc + d.weight, 0)
  if (manifest.rubric.dimensions.length > 0 && (total < 0.5 || total > 1.5)) {
    throw new AgentManifestError(
      `defineAgent(${manifest.id}): rubric dimension weights sum to ${total.toFixed(3)} — should be ~1.0`,
      manifest.id,
    )
  }
  return manifest
}
