import { $a as RuntimeStreamEvent, Yi as AgentRunSpec, ba as SandboxClient, va as OutputAdapter } from "./types-D56jQad-.js";
import { a as createSurfaceImprovementProposer, c as SurfaceValidationIssue, d as validateSurfaces, i as SurfaceImprovementEdit, l as renderSurfaceIssues, n as DraftPatchInput, o as AgentSurfaces, r as DraftPatchOutput, s as ResolvedSurface, t as CreateSurfaceImprovementProposerOptions, u as resolveSubjectPath } from "./improvement-adapter-D5gwwoXQ.js";
import { $h as ProfileMaterializationIssue, Jh as AssertProfileMaterializationOptions, Kh as AGENT_PROFILE_MATERIALIZATION_AXES, Qh as ProfileMaterializationContract, Xh as DefineProfileMaterializationContractOptions, Yh as CanonicalAgentProfileMaterializationAxis, Zh as KnownAgentProfileMaterializationAxis, ag as profileMaterializationAxes, cg as promptOnlyProfileMaterialization, dg as sandboxActProfileMaterialization, eg as ValidateProfileMaterializationOptions, fg as validateProfileMaterialization, ig as fullProfileMaterialization, lg as promptResourceProfileMaterialization, ng as controlProfileMaterialization, og as promptControlProfileMaterialization, pg as worktreeCliProfileMaterialization, qh as AgentProfileMaterializationAxis, rg as defineProfileMaterializationContract, sg as promptModelProfileMaterialization, tg as assertProfileMaterialization, ug as renderProfileMaterializationIssues } from "./index-Dm8SHDGW.js";
import { AgentProfile, AgentProfileFileMount, AgentProfileMcpServer } from "@tangle-network/agent-interface";
import { TraceAnalystDefinition } from "@tangle-network/agent-eval";
import { SandboxEvent } from "@tangle-network/sandbox";
//#region src/agent/define-agent.d.ts
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
interface AgentManifest<TPersona = unknown, TRunOutput = unknown> {
  /**
   * Stable identifier — used as `projectId` in traces, as the analyst
   * loop's `runId` prefix, and as the namespace under which findings
   * are persisted. MUST match the agent's repo name to keep
   * cross-repo telemetry joinable.
   */
  id: string;
  /**
   * Filesystem root the substrate resolves surface paths against.
   * Typically `process.cwd()` or a fixed absolute path. Use an
   * absolute path when the agent's tests may run from subdirectories
   * (vitest sometimes shifts cwd).
   */
  repoRoot: string;
  /**
   * Map of mutable surfaces the self-improvement loop can edit. See
   * `AgentSurfaces` — required: `systemPrompt`, `tools`, `rubric`,
   * `knowledge`, `personas`. Optional: `scaffolding`, `memory`, `rag`,
   * `outputSchema`.
   *
   * Every required path is validated at `defineAgent` time. Missing
   * paths throw with the full list of offenders.
   */
  surfaces: AgentSurfaces;
  /**
   * Rubric the substrate uses to score each run. Dimensions × weights
   * × judges. The substrate computes the weighted composite and
   * stamps it into the RunRecord.
   */
  rubric: AgentRubric<TRunOutput>;
  /**
   * Runtime adapter — how the substrate INVOKES the agent against a
   * persona. The `act` function takes a persona + a context (with the
   * tracer the substrate threads through for span emission) and
   * returns the run output the rubric will score.
   *
   * The agent's existing production runtime goes in here; the
   * substrate is intentionally thin around it.
   */
  runtime: AgentRuntime<TPersona, TRunOutput>;
  /**
   * Persona discovery — the substrate loads personas via this function
   * at eval start. Can read from `surfaces.personas`, an API, or be
   * hardcoded. The substrate calls it once per `runAgentEval` call;
   * persona ordering is preserved.
   */
  personas: () => Promise<ReadonlyArray<TPersona>>;
  /**
   * Analyst kinds the substrate runs against each persona's trace.
   * Defaults to `DEFAULT_TRACE_ANALYST_KINDS` from agent-eval. Per-agent
   * authors can prune (e.g. skip `knowledge-poisoning` when there's no
   * knowledge base) or extend (custom domain kinds).
   *
   * Empty array disables the loop — useful for `pnpm eval --no-analyst`.
   */
  analystKinds: ReadonlyArray<TraceAnalystDefinition>;
  /**
   * Analyst LLM configuration. The substrate uses these for all four
   * kinds (override per-kind via `analystKinds` if needed).
   */
  analyst: AnalystConfig;
}
interface AgentRubric<TRunOutput> {
  /** Dimensions composing the weighted score. Weights sum to 1.0 by convention. */
  dimensions: ReadonlyArray<RubricDimension<TRunOutput>>;
  /**
   * Optional judges layered on top of deterministic dimensions. Each
   * judge returns a score per dimension; the substrate averages judges
   * (mean by default) for the LLM contribution.
   */
  judges?: ReadonlyArray<JudgeConfig<TRunOutput>>;
}
interface RubricDimension<TRunOutput> {
  /** Unique identifier — appears in finding subjects (`rubric:<id>`). */
  id: string;
  /** 0..1 — weight in the composite. */
  weight: number;
  /**
   * Deterministic scorer: given the persona + run output, returns a
   * 0..1 score. The substrate sums weight × score across dimensions
   * for the deterministic composite; judges supplement subjective dims.
   */
  score: (input: {
    persona: unknown;
    output: TRunOutput;
  }) => number;
  /** Optional human-readable label for reports. */
  label?: string;
}
interface JudgeConfig<TRunOutput> {
  /** Judge identifier — appears in trace spans + manifest. */
  id: string;
  /** Model snapshot to invoke. Pin the snapshot (`claude-sonnet-4-6@2025-04-15`); the validator rejects bare aliases. */
  model: string;
  /** Dimensions this judge scores. */
  dimensions: ReadonlyArray<string>;
  /**
   * Optional rubric anchors — text examples the judge sees as a
   * few-shot prompt to calibrate. STRONGLY recommended for subjective
   * dimensions; required by the calibration gate (Pearson ≥0.7).
   */
  anchors?: ReadonlyArray<{
    input: string;
    output: TRunOutput;
    expected: Record<string, number>;
  }>;
}
interface AgentRuntime<TPersona, TRunOutput> {
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
  act: (persona: TPersona, ctx: AgentRunContext) => AgentRunInvocation<TRunOutput>;
}
interface AgentRunInvocation<TRunOutput> {
  /** Live stream of typed runtime events. Consumed by chat UX directly. */
  events: AsyncIterable<RuntimeStreamEvent>;
  /** Final structured output the rubric scores. Resolves after `events` drains. */
  output: Promise<TRunOutput>;
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
declare function unimplementedAgentRun<TRunOutput = unknown>(reason?: string): AgentRunInvocation<TRunOutput>;
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
declare function collectAgentRun<TRunOutput>(invocation: AgentRunInvocation<TRunOutput>): Promise<{
  events: ReadonlyArray<RuntimeStreamEvent>;
  output: TRunOutput;
}>;
interface AgentRunContext {
  /** Substrate-managed trace emitter. */
  emitter: import('@tangle-network/agent-eval').TraceEmitter;
  /** Stable run id for this persona × variant cell. */
  runId: string;
  /** Variant the runtime is exercising (e.g. `'baseline'`, `'source-grounded'`). */
  variantId?: string;
  /** Wall-clock deadline (epoch ms). The runtime SHOULD honour for graceful cancel. */
  deadlineMs?: number;
  /** Optional abort signal. */
  signal?: AbortSignal;
}
interface AnalystConfig {
  /** Model the analyst kinds use. Override per-kind via `analystKinds[i].cost.models`. */
  model: string;
  /** Optional total budget across all kinds for one run. Substrate enforces via `BudgetGuard`. */
  budgetUsd?: number;
  /** Backend hint for the AxAIService factory — same shape every kind uses. */
  backend?: {
    name?: 'openai' | 'router';
    apiKey?: string;
    baseUrl?: string;
  };
}
/** Thrown when `defineAgent` finds a required surface missing on disk. */
declare class AgentManifestError extends Error {
  readonly agentId: string;
  readonly issues: ReadonlyArray<unknown>;
  constructor(message: string, agentId: string, issues?: ReadonlyArray<unknown>);
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
declare function defineAgent<TPersona = unknown, TRunOutput = unknown>(manifest: AgentManifest<TPersona, TRunOutput>): AgentManifest<TPersona, TRunOutput>;
//#endregion
//#region src/agent/sandbox-act.d.ts
/** Per-persona profile-merge slots applied over the base profile (§1.5: the caller authors the
 *  per-persona profile). Each slot overlays the base; an absent slot leaves the base untouched. */
interface SandboxActComposeOverrides {
  /** Replace the base profile's system prompt (e.g. a workspace-augmented prompt). */
  systemPrompt?: string;
  /** Extra file mounts layered after the base profile's `resources.files`. */
  extraFiles?: AgentProfileFileMount[];
  /** Override the profile `name`. Defaults to the base profile's name. */
  name?: string;
  /** Box built-in tool ON/OFF flags merged over the base profile's `tools` (overlay wins per key). */
  tools?: Record<string, boolean>;
  /** MCP connections merged over the base profile's `mcp` (overlay wins per key). */
  mcpConnections?: Record<string, AgentProfileMcpServer>;
}
interface CreateSandboxActOptions<TPersona, TRunOutput> {
  /** Canonical agent profile — the same one the prod chat turn uses. */
  baseProfile: AgentProfile;
  /** Sandbox client used to boot the per-run sandbox. */
  sandboxClient: SandboxClient;
  /** Persona → prompt. Pure; the eval cell's input. */
  buildPrompt: (persona: TPersona) => string;
  /** Sandbox event stream → typed output the rubric scores. */
  output: OutputAdapter<TRunOutput>;
  /**
   * Per-persona profile overrides (workspace-augmented system prompt, extra
   * file mounts, tool flags, MCP connections). Overlaid onto `baseProfile`.
   */
  compose?: (persona: TPersona) => SandboxActComposeOverrides;
  /** Sandbox-SDK overrides forwarded to `createSandboxForSpec`. */
  sandboxOverrides?: AgentRunSpec<unknown>['sandboxOverrides'];
  /** Optional changed axes the caller expects this path to carry. */
  requiredProfileAxes?: readonly AgentProfileMaterializationAxis[];
  /** Stable run name surfaced in mapped `llm_call` events. */
  name?: string;
  /** Override the `SandboxEvent → RuntimeStreamEvent` mapper. */
  mapEvent?: (event: SandboxEvent, opts: {
    agentRunName?: string;
  }) => RuntimeStreamEvent | undefined;
}
/**
 * Build an `AgentRuntime.act` implementation backed by a single prod-profile
 * sandbox run. The returned function honours the `act` contract: it returns
 * synchronously with a live `events` iterator and an `output` promise that
 * resolves only after the iterator drains.
 */
declare function createSandboxAct<TPersona, TRunOutput>(options: CreateSandboxActOptions<TPersona, TRunOutput>): (persona: TPersona, ctx: AgentRunContext) => AgentRunInvocation<TRunOutput>;
//#endregion
export { AGENT_PROFILE_MATERIALIZATION_AXES, type AgentManifest, AgentManifestError, type AgentProfileMaterializationAxis, type AgentRubric, type AgentRunContext, type AgentRunInvocation, type AgentRuntime, type AgentSurfaces, type AnalystConfig, type AssertProfileMaterializationOptions, type CanonicalAgentProfileMaterializationAxis, type CreateSandboxActOptions, type CreateSurfaceImprovementProposerOptions, type DefineProfileMaterializationContractOptions, type DraftPatchInput, type DraftPatchOutput, type JudgeConfig, type KnownAgentProfileMaterializationAxis, type ProfileMaterializationContract, type ProfileMaterializationIssue, type ResolvedSurface, type RubricDimension, type SandboxActComposeOverrides, type SurfaceImprovementEdit, type SurfaceValidationIssue, type ValidateProfileMaterializationOptions, assertProfileMaterialization, collectAgentRun, controlProfileMaterialization, createSandboxAct, createSurfaceImprovementProposer, defineAgent, defineProfileMaterializationContract, fullProfileMaterialization, profileMaterializationAxes, promptControlProfileMaterialization, promptModelProfileMaterialization, promptOnlyProfileMaterialization, promptResourceProfileMaterialization, renderProfileMaterializationIssues, renderSurfaceIssues, resolveSubjectPath, sandboxActProfileMaterialization, unimplementedAgentRun, validateProfileMaterialization, validateSurfaces, worktreeCliProfileMaterialization };
//# sourceMappingURL=agent.d.ts.map