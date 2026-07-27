/**
 * The general agentic primitive — sequential (depth) and parallel (breadth) over a shared,
 * checkable artifact, driven through the keystone Supervisor as one recursive `Agent.act`.
 *
 * The domain lives behind ONE seam — `AgenticSurface` (open an artifact, list tools, call a tool,
 * score the artifact, close it). EnterpriseOps implements it (seed a gym DB, MCP tools, SQL
 * verifier); Commit0/AppWorld/terminal-bench implement it the same way (a repo workspace, shell
 * tools, the test suite). The drivers below are domain-blind: they run over any surface.
 *
 * Two shapes, the agent's POMDP rollout as the unit:
 *  - DEPTH   one persistent artifact carried across shots. Each shot the agent works the tool loop;
 *            between shots a trace-analyst (selector≠judge: reads the trajectory, never the score)
 *            steers the resumed session toward what's unfinished. shot n stands on shot n-1's
 *            artifact state + history. This is continuation — long-horizon, same artifact.
 *  - BREADTH K independent artifacts, each a fresh rollout, the deployable verifier picks the best.
 *
 * Both are an `Agent` whose `act` spawns leaf shots through `scope.spawn` and reacts via
 * `scope.next()` — so the conserved budget pool meters them (equal-k by construction), the journal
 * records the tree, and the same primitive nests. `runAgentic` runs the chosen driver through
 * `createSupervisor().run`. The leaf (one shot over a handle) is resolved per-spawn from a
 * surface-closed registry — the open `Executor` seam, not bespoke per-benchmark glue.
 */

import { createChatClient, estimateCost, isModelPriced } from '@tangle-network/agent-eval'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../durable/spawn-journal'
import type { RuntimeHooks } from '../runtime-hooks'
import { observe } from './observe'
import type { Outcome } from './personify/types'
import type { Corpus } from './personify/wave-types'
import { routerToolLoop } from './router-client'
import { withDriverExecutor } from './supervise/driver-executor'
import { createSupervisor } from './supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorContext,
  ExecutorFactory,
  ExecutorRegistry,
  ExecutorResult,
  Scope,
  Settled,
} from './supervise/types'

// ── The general surface seam (the only thing a new benchmark implements) ─────────

export interface AgenticTask {
  readonly id: string
  readonly systemPrompt: string
  readonly userPrompt: string
  /** Opaque domain payload the surface reads (EOPS: servers/verifiers/tools). Drivers never read it. */
  readonly meta?: Record<string, unknown>
}

export interface ArtifactHandle {
  readonly id: string
  readonly surface: string
  /** Opaque per-artifact context the surface stashes (EOPS: the seeded gym server + db id). */
  readonly ctx?: unknown
}

export interface AgenticTool {
  readonly type: 'function'
  readonly function: { name: string; description?: string; parameters: Record<string, unknown> }
}

export interface SurfaceScore {
  passes: number
  total: number
  /** Checks excluded as malformed (data defect, not the agent). `total === 0` ⇒ unscoreable. */
  errored: number
}

/** A stateful, checkable environment an agent operates over with tools. Open behind one interface. */
export interface AgenticSurface {
  readonly name: string
  open(task: AgenticTask): Promise<ArtifactHandle>
  tools(task: AgenticTask, handle: ArtifactHandle): Promise<AgenticTool[]>
  call(handle: ArtifactHandle, name: string, args: Record<string, unknown>): Promise<string>
  score(task: AgenticTask, handle: ArtifactHandle): Promise<SurfaceScore>
  close(handle: ArtifactHandle): Promise<void>
}

export interface AgenticOptions {
  routerBaseUrl: string
  routerKey: string
  model: string
  /** Optional completion transport (see `RouterConfig.complete`): when set, BOTH legs of an
   *  offline run use it instead of `fetch`-ing the router — the worker's tool loop (threaded into
   *  its `routerToolLoop` cfg) AND the analyst's critic (its `ChatClient` is bound to this same
   *  transport). One injected responder serves both, as a localhost mock endpoint would. Absent ⇒
   *  the live router fetch path (the default). */
  complete?: (body: Record<string, unknown>) => Promise<unknown>
  temperature?: number
  /** Completion cap per worker turn — REQUIRED for thinking models (they burn unbounded
   *  budgets on reasoning and return empty content without it). Omitted ⇒ provider default. */
  maxTokens?: number
  /** Turns the agent may take within ONE shot before the driver intervenes. */
  innerTurns?: number
  /** The depth STEERER's analyst instruction (observe()'s system prompt). The knob a
   *  prompt optimizer (GEPA) tunes — the analyst IS the steerer. Omitted ⇒ the default. */
  analystInstruction?: string
  /** The critic's model — lets the analyst be a stronger (or cheaper) model than the
   *  worker. Omitted ⇒ the worker's `model`. */
  analystModel?: string
  /** Across-run learning: when set, the analyst's observe() pass appends trace-derived
   *  facts here (the flywheel write side). Read-back is opt-in via `corpusReadback`
   *  because unconditional priming can pollute context on some domains. */
  corpus?: Corpus
  /** Tags written onto learned facts (and used by the caller's priming query). */
  corpusTags?: string[]
  /** In-context learning: when set, query `corpus` before each depth shot and inject
   *  the top trace-derived facts as guidance for the active run. No corpus means no read-back. */
  corpusReadback?: CorpusReadbackOptions
}

export interface CorpusReadbackOptions {
  /** Minimum confidence for a fact to be injected. Default 0.7. */
  minConfidence?: number
  /** Extra tags a fact must carry, in addition to `corpusTags`. */
  tags?: ReadonlyArray<string>
  /** Max facts injected per shot. Default 3. */
  maxFacts?: number
  /** Default false: only facts tagged `audience:agent` are injected into the worker. */
  includeOperatorFacts?: boolean
}

// ── The unit: one agentic shot (a bounded tool loop) over a handle ───────────────

/** One provider-neutral conversation record carried between strategy shots. */
export type StrategyMessage = Record<string, unknown>
interface ToolCall {
  id: string
  function: { name: string; arguments: string }
}

interface ShotTask {
  task: AgenticTask
  handle?: ArtifactHandle // present ⇒ DEPTH (shared artifact); absent ⇒ BREADTH (open own)
  messages?: StrategyMessage[] // carried conversation (depth); fresh when absent
  steer?: string // analyst-derived steer injected before this shot (depth)
  persona?: ShotPersona // role override — multi-agent loops give each shot its own hat
  tools?: string[] // restrict THIS shot to these domain tools (names); unknown names throw
  /** analyst leaf only: a RAW instruction — the analyst answers it over the trajectory
   *  directly (no findings schema). The verdict-capable channel. */
  rawInstruction?: string
}

interface ShotOut {
  messages: StrategyMessage[]
  completions: number
  toolCalls: number
  toolErrors: number
  /** Real router usage summed over the shot's turns; zeros only when the provider omits usage. */
  tokens: { input: number; output: number }
}

const taskNudge =
  'Use the available tools to bring the artifact to the required final state. Address EVERY distinct ' +
  'change the request implies. After each tool result, check what remains and continue. Re-read the ' +
  'values you set to confirm they took. Reply DONE only once every required change is made and verified.'

/** One shot: run the agent's tool loop (≤ innerTurns) over the handle, mutating the artifact via
 *  `surface.call`, carrying `messages`. Returns the updated conversation + counts. */
async function runShot(
  surface: AgenticSurface,
  _task: AgenticTask,
  handle: ArtifactHandle,
  tools: AgenticTool[],
  messages: StrategyMessage[],
  opts: AgenticOptions,
  modelOverride?: string,
): Promise<ShotOut> {
  // The canonical off-box tool loop (routerToolLoop) drives the turns; this shot supplies
  // the carried conversation (depth continuation, via initialMessages) and the tool dispatch
  // (surface.call). An ERROR:-prefixed result or a thrown call is a real tool outcome —
  // counted as a toolError and fed back to the model, never thrown to kill the shot.
  let toolErrors = 0
  const execute = async (name: string, args: Record<string, unknown>): Promise<string> => {
    try {
      const out = await surface.call(handle, name, args)
      if (out.startsWith('ERROR:')) toolErrors += 1
      return out
    } catch (e) {
      toolErrors += 1
      return `ERROR: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  const r = await routerToolLoop(
    {
      routerBaseUrl: opts.routerBaseUrl,
      routerKey: opts.routerKey,
      model: modelOverride ?? opts.model,
      ...(opts.complete ? { complete: opts.complete } : {}),
    },
    '',
    '',
    tools,
    execute,
    {
      maxTurns: opts.innerTurns ?? 4,
      temperature: opts.temperature ?? 0.7,
      initialMessages: messages,
      ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    },
  )
  return {
    messages: r.messages,
    completions: r.turns,
    toolCalls: r.toolCalls,
    toolErrors,
    tokens: r.usage,
  }
}

/** The trace-analyst (selector≠judge): reads ONLY the trajectory + task, never the score. */
/** The depth STEERER, on the CANONICAL analyst: agent-eval's `observe()` (makeFinding +
 *  ChatClient + the derived_from_judge firewall) reads the agent's tool-call trajectory
 *  (behavior, never the score) and returns findings; we steer on their recommended_actions.
 *  The trajectory (calls + RESULTS) rides in `output` so the analyst sees what actually
 *  happened, not just tool names. No actionable findings ⇒ COMPLETE (depth self-terminates). */
interface AnalyzeOut {
  steer: string
  tokens: { input: number; output: number }
}

/** The firewall's input shape: the trajectory as compacted text — calls, results,
 *  assistant text. NEVER scores, NEVER check internals. Shared by both analyst channels. */
function compactTrajectory(messages: StrategyMessage[]): string {
  return messages
    .filter((m) => m.role === 'assistant' || m.role === 'tool')
    .map((m) => {
      if (m.role === 'tool') return `RESULT ${String(m.content).slice(0, 280)}`
      const calls = (m.tool_calls as ToolCall[] | undefined)
        ?.map((c) => `${c.function.name}(${c.function.arguments})`)
        .join(', ')
      return calls ? `CALL ${calls}` : `SAY ${String(m.content).slice(0, 200)}`
    })
    .join('\n')
    .slice(0, 7000)
}

/** The analyst's chat seam: the live router by default, or — when a `complete` transport is
 *  injected — that SAME transport, so an offline run drives the critic with no network too (the
 *  worker and the analyst share the one injected responder, exactly as a localhost mock would
 *  serve both). The critic speaks the OpenAI request shape; we forward it to `complete` and lift
 *  the parsed `/chat/completions` JSON back into a `ChatResponse`. */
function analystChat(
  opts: AgenticOptions,
  defaultModel: string,
): ReturnType<typeof createChatClient> {
  if (!opts.complete) {
    return createChatClient({
      transport: 'router',
      apiKey: opts.routerKey,
      baseUrl: opts.routerBaseUrl,
      defaultModel,
    })
  }
  const complete = opts.complete
  return createChatClient({
    transport: 'mock',
    defaultModel,
    handler: async (req) => {
      const raw = (await complete({
        model: req.model ?? defaultModel,
        messages: req.messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      })) as {
        choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = raw.choices?.[0]?.message?.content ?? ''
      const promptTokens = raw.usage?.prompt_tokens ?? 0
      const completionTokens = raw.usage?.completion_tokens ?? 0
      return {
        content,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        costUsd: null,
        model: req.model ?? defaultModel,
        durationMs: 0,
        finishReason: raw.choices?.[0]?.finish_reason ?? null,
        contentEmpty: content.trim().length === 0,
        raw: raw as Record<string, unknown>,
      }
    },
  })
}

/** The RAW analyst channel: the firewalled critic answers `instruction` over the
 *  trajectory directly — no findings schema, no recommended-action extraction. The
 *  channel for verdict-shaped steering (budget controllers, calibrated predictions)
 *  whose output format the findings protocol would strip. Same firewall as analyze():
 *  trajectory in, never scores. */
async function consultAnalyst(
  task: AgenticTask,
  messages: StrategyMessage[],
  instruction: string,
  opts: AgenticOptions,
): Promise<AnalyzeOut> {
  const trajectory = compactTrajectory(messages)
  const analystModel = opts.analystModel ?? opts.model
  const chat = analystChat(opts, analystModel)
  // With a trajectory, the analyst framing (instruction as system, behavior as the user
  // turn) is the channel's shape. With NO trajectory (pre-task consults, e.g. authored
  // check generation), that framing breaks: the user turn is then just the task, which
  // reads as a solve request — measured on Llama-3-8B, the model ignores the system
  // instruction and answers the task (authored-assert yield 6/18 reps vs 18/18 with the
  // instruction and task fused into one user message, the proven rig shape).
  const consultMessages = trajectory
    ? [
        { role: 'system' as const, content: instruction },
        {
          role: 'user' as const,
          content: `TASK: ${task.userPrompt.slice(0, 1500)}\n\nTRAJECTORY:\n${trajectory}`,
        },
      ]
    : [
        {
          role: 'user' as const,
          content: `${instruction}\n\nTASK:\n${task.userPrompt.slice(0, 1500)}`,
        },
      ]
  const res = await chat.chat({
    model: analystModel,
    temperature: 0.2,
    maxTokens: 1024,
    messages: consultMessages,
  })
  const usage = (
    res as {
      usage?: {
        promptTokens?: number
        prompt_tokens?: number
        completionTokens?: number
        completion_tokens?: number
      }
    }
  ).usage
  return {
    steer: res.content.trim(),
    tokens: {
      input: usage?.promptTokens ?? usage?.prompt_tokens ?? 0,
      output: usage?.completionTokens ?? usage?.completion_tokens ?? 0,
    },
  }
}

async function analyze(
  task: AgenticTask,
  messages: StrategyMessage[],
  opts: AgenticOptions,
): Promise<AnalyzeOut> {
  const trajectory = compactTrajectory(messages)
  const analystModel = opts.analystModel ?? opts.model
  const inner = analystChat(opts, analystModel)
  // The critic's calls are REAL spend — capture usage so the cost vector bills them
  // (an unbilled critic makes every steering-vs-sampling cost comparison dishonest).
  const tokens = { input: 0, output: 0 }
  const chat: typeof inner = {
    ...inner,
    chat: async (req, callOpts) => {
      const res = await inner.chat(req, callOpts)
      const u = (
        res as {
          usage?: {
            promptTokens?: number
            completionTokens?: number
            prompt_tokens?: number
            completion_tokens?: number
          }
        }
      ).usage
      if (u) {
        tokens.input += u.promptTokens ?? u.prompt_tokens ?? 0
        tokens.output += u.completionTokens ?? u.completion_tokens ?? 0
      }
      return res
    },
  }
  const obs = await observe(
    {
      task: task.userPrompt,
      output: trajectory,
      trace: messages,
      outcome: 'failed',
      runId: task.id,
    },
    {
      chat,
      model: analystModel,
      ...(opts.analystInstruction ? { analystInstruction: opts.analystInstruction } : {}),
      ...(opts.corpus ? { corpus: opts.corpus, tags: opts.corpusTags ?? [] } : {}),
    },
  )
  // The steer = the analyst's recommended actions for the agent. Empty ⇒ nothing left to do.
  const steer = obs.findings
    .map((f) => f.recommended_action)
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    .join('\n')
    .trim()
  return { steer: steer || 'COMPLETE', tokens }
}

async function renderCorpusReadback(opts: AgenticOptions): Promise<string> {
  if (!opts.corpus || !opts.corpusReadback) return ''
  const maxFacts = opts.corpusReadback.maxFacts ?? 3
  if (!Number.isInteger(maxFacts) || maxFacts < 0) {
    throw new Error(`corpusReadback.maxFacts must be a non-negative integer, got ${maxFacts}`)
  }
  if (maxFacts === 0) return ''

  const tags = [
    ...(opts.corpusTags ?? []),
    ...(opts.corpusReadback.tags ?? []),
    ...(opts.corpusReadback.includeOperatorFacts ? [] : ['audience:agent']),
  ]
  const facts = await opts.corpus.query({
    ...(tags.length > 0 ? { tags } : {}),
    minConfidence: opts.corpusReadback.minConfidence ?? 0.7,
    limit: maxFacts,
  })
  if (facts.length === 0) return ''

  const rendered = facts.map((fact) =>
    fact.rationale ? `- ${fact.claim} (${fact.rationale})` : `- ${fact.claim}`,
  )
  return `Relevant learned facts from prior attempts:\n${rendered.join('\n')}`
}

// ── Leaf executors (one shot / one analyst), resolved per-spawn from the surface ──

/** Measured result of one strategy shot. */
export interface StrategyShotResult {
  messages: StrategyMessage[]
  score: number
  passes: number
  total: number
  completions: number
  toolErrors: number
}

/** Resolve a shot: if `handle` given, operate on the SHARED artifact (depth); else open+score+close
 *  an OWN artifact (breadth). Always scores the artifact's final state as the deployable verdict. */
function shotExecutor(surface: AgenticSurface, opts: AgenticOptions): Executor<unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'agentic-shot',
    async execute(task: unknown): Promise<ExecutorResult<unknown>> {
      const t = task as ShotTask
      const own = !t.handle
      const handle = t.handle ?? (await surface.open(t.task))
      try {
        const allTools = await surface.tools(t.task, handle)
        // Tool SELECTION is a strategy decision (which of the domain's tools this shot
        // sees) — restriction-only: a strategy can focus a shot, never grant a tool the
        // domain didn't offer. Unknown names fail loud (an authored typo must not
        // silently become an unrestricted shot).
        let tools = allTools
        if (t.tools) {
          const known = new Set(allTools.map((tool) => tool.function.name))
          const unknown = t.tools.filter((name) => !known.has(name))
          if (unknown.length > 0) {
            throw new Error(
              `shot tools: unknown tool name(s) ${unknown.join(', ')} — domain offers: ${[...known].join(', ')}`,
            )
          }
          const want = new Set(t.tools)
          tools = allTools.filter((tool) => want.has(tool.function.name))
        }
        // An EMPTY messages array means "fresh" too — an authored body passing
        // `messages: []` must not silently blank the worker's system/task prompt.
        const messages: StrategyMessage[] = t.messages?.length
          ? t.messages
          : [
              { role: 'system', content: t.persona?.systemPrompt ?? t.task.systemPrompt },
              { role: 'user', content: `${t.task.userPrompt}\n\n${taskNudge}` },
            ]
        // On a CARRIED conversation, a persona switch arrives as a role hand-off message.
        if (t.messages?.length && t.persona?.systemPrompt) {
          messages.push({
            role: 'user',
            content: `[hand-off] You are now acting as: ${t.persona.systemPrompt}`,
          })
        }
        if (t.steer) messages.push({ role: 'user', content: t.steer })
        const shot = await runShot(surface, t.task, handle, tools, messages, opts, t.persona?.model)
        const s = await surface.score(t.task, handle)
        const score = s.total > 0 ? s.passes / s.total : 0
        const out: StrategyShotResult = {
          messages: shot.messages,
          score,
          passes: s.passes,
          total: s.total,
          completions: shot.completions,
          toolErrors: shot.toolErrors,
        }
        artifact = {
          outRef: `shot:${handle.id}:${shot.completions}:${s.passes}/${s.total}`,
          out,
          verdict: { valid: s.total > 0 && s.passes === s.total, score },
          // Real usage to the conserved pool: tokens from the router responses; usd only
          // when the model is in the price table (never a fabricated number).
          spent: {
            iterations: shot.completions,
            tokens: shot.tokens,
            usd: isModelPriced(opts.model)
              ? estimateCost(shot.tokens.input, shot.tokens.output, opts.model)
              : 0,
            ms: 0,
          },
        }
        return artifact
      } finally {
        if (own) await surface.close(handle)
      }
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact() {
      if (!artifact) throw new Error('shotExecutor: resultArtifact before execute')
      return artifact
    },
  }
}

function analystExecutor(opts: AgenticOptions): Executor<unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'agentic-analyst',
    async execute(task: unknown): Promise<ExecutorResult<unknown>> {
      const t = task as { task: AgenticTask; messages: StrategyMessage[]; rawInstruction?: string }
      const { steer, tokens } = t.rawInstruction
        ? await consultAnalyst(t.task, t.messages, t.rawInstruction, opts)
        : await analyze(t.task, t.messages, opts)
      const analystModel = opts.analystModel ?? opts.model
      artifact = {
        outRef: `analyst:${steer.length}`,
        out: steer,
        spent: {
          iterations: 1,
          tokens,
          usd: isModelPriced(analystModel)
            ? estimateCost(tokens.input, tokens.output, analystModel)
            : 0,
          ms: 0,
        },
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact() {
      if (!artifact) throw new Error('analystExecutor: resultArtifact before execute')
      return artifact
    },
  }
}

/**
 * Registry dispatching on the child's role tag — fresh executor per spawn (no
 * shared-instance race). `withDriverExecutor` wraps it so a `role:'driver'` child resolves
 * to the recursive driver-executor (a child that drives its OWN children — agents drive
 * agents) before this leaf dispatch; `shot`/`analyst` children resolve to their leaf
 * executors here unchanged.
 */
function agenticRegistry(surface: AgenticSurface, opts: AgenticOptions): ExecutorRegistry {
  const leaves: ExecutorRegistry = {
    register() {
      throw new Error('agenticRegistry: register unsupported')
    },
    resolve<Out>(spec: AgentSpec) {
      const role = (spec.profile.metadata as { role?: string } | undefined)?.role
      const factory: ExecutorFactory<Out> = (_s: AgentSpec, _ctx: ExecutorContext) =>
        (role === 'analyst' ? analystExecutor(opts) : shotExecutor(surface, opts)) as Executor<Out>
      return { succeeded: true as const, value: factory }
    },
  }
  return withDriverExecutor(leaves)
}

function leaf(name: string, role: 'shot' | 'analyst'): Agent<unknown, Outcome<unknown>> {
  const agent = {
    name,
    executorSpec: { profile: { name, metadata: { role } }, harness: null } as unknown as AgentSpec,
    act(): Promise<Outcome<unknown>> {
      // SPAWNED, not run: its `executorSpec` (role shot/analyst) resolves a leaf executor
      // the scope drives. `act` is never called for a spawned child; it fails loud if
      // mis-used as a root. A `role:'driver'` child instead resolves to the recursive
      // driver-executor (agents drive agents) — see `withDriverExecutor`.
      throw new Error(`agentic: spawned child "${name}" was run directly (the executor drives it)`)
    },
  }
  return agent as Agent<unknown, Outcome<unknown>>
}

/** Drain exactly one settlement (the just-spawned child). */
async function drainOne(scope: Scope<Outcome<unknown>>): Promise<Settled<Outcome<unknown>>> {
  const s = await scope.next()
  if (!s) throw new Error('agentic: spawned child never settled')
  return s
}

// ── The result + the two drivers (domain-blind Agents run by the Supervisor) ─────

export interface AgenticRunResult {
  /** The strategy name (built-in 'depth'/'breadth' or a custom strategy's name). */
  mode: string
  score: number
  resolved: boolean
  completions: number
  /** DEPTH: score after each shot — the progress-over-rounds curve. BREADTH: best-so-far per rollout. */
  progression: number[]
  shots: number
  /** The cost vector, stamped by `runAgentic` from the Supervisor's conserved pool: real
   *  router tokens, priced usd (0 when the model is unpriced — never fabricated), wall ms. */
  usd: number
  ms: number
  tokens: { input: number; output: number }
}

const perChild = (innerTurns: number): Budget => ({
  maxIterations: innerTurns + 1,
  maxTokens: 1_000_000,
})

/** DEPTH: one persistent artifact, carried across analyst-steered shots. */
export function depthStrategy(
  surface: AgenticSurface,
  task: AgenticTask,
  opts: AgenticOptions,
  cfg: { maxShots: number },
): Agent<unknown, Outcome<unknown>> {
  const innerTurns = opts.innerTurns ?? 4
  let pendingSteer: string | undefined // analyst-derived steer carried between shots
  return {
    name: 'depth',
    async act(_t, scope): Promise<Outcome<unknown>> {
      const handle = await surface.open(task)
      const progression: number[] = []
      let messages: StrategyMessage[] | undefined
      let completions = 0
      let shots = 0
      try {
        for (shots = 0; shots < cfg.maxShots; shots += 1) {
          const child = leaf(`shot:${shots}`, 'shot')
          const memorySteer = await renderCorpusReadback(opts)
          const steer = [shots === 0 ? undefined : pendingSteer, memorySteer]
            .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
            .join('\n\n')
          const res = scope.spawn(child, { task, handle, messages, steer } as ShotTask, {
            budget: perChild(innerTurns),
            label: `shot:${shots}`,
          })
          if (!res.ok) break
          const settled = await drainOne(scope)
          if (settled.kind === 'down') break
          const out = settled.out as unknown as StrategyShotResult
          messages = out.messages
          completions += out.completions
          progression.push(out.score)
          if (out.score >= 1 || shots === cfg.maxShots - 1) break
          // Analyst reads the trajectory (firewalled) → steer the resumed session.
          const aChild = leaf(`analyst:${shots}`, 'analyst')
          const aRes = scope.spawn(
            aChild,
            { task, messages },
            { budget: perChild(1), label: `analyst:${shots}` },
          )
          if (!aRes.ok) break
          const aSettled = await drainOne(scope)
          completions += 1
          if (aSettled.kind === 'down') break
          const findings = aSettled.out as unknown as string
          if (/^\s*COMPLETE\b/i.test(findings)) break
          pendingSteer = `A reviewer flagged unfinished items:\n${findings}\n\nAddress each with the tools, verify they took, then continue.`
        }
        const final = await surface.score(task, handle)
        const score = final.total > 0 ? final.passes / final.total : 0
        return {
          kind: 'done',
          deliverable: {
            mode: 'depth',
            score,
            resolved: final.total > 0 && final.passes === final.total,
            completions,
            progression,
            shots: shots + 1,
          },
        }
      } finally {
        await surface.close(handle)
      }
    },
  }
}

/** BREADTH: K independent rollouts (each own artifact), verifier picks the best. */
export function breadthStrategy(
  _surface: AgenticSurface,
  task: AgenticTask,
  opts: AgenticOptions,
  cfg: { width: number },
): Agent<unknown, Outcome<unknown>> {
  const innerTurns = opts.innerTurns ?? 4
  return {
    name: 'breadth',
    async act(_t, scope): Promise<Outcome<unknown>> {
      let opened = 0
      for (let k = 0; k < cfg.width; k += 1) {
        const res = scope.spawn(leaf(`rollout:${k}`, 'shot'), { task } as ShotTask, {
          budget: perChild(innerTurns),
          label: `rollout:${k}`,
        })
        if (res.ok) opened += 1
      }
      if (opened === 0) return { kind: 'blocked', blockers: ['breadth: pool admitted no rollout'] }
      let best = -1
      let bestResolved = false
      let completions = 0
      const progression: number[] = []
      for (let s = await scope.next(); s !== null; s = await scope.next()) {
        if (s.kind === 'down') continue
        const out = s.out as unknown as StrategyShotResult
        completions += out.completions
        if (out.score > best) best = out.score
        if (out.total > 0 && out.passes === out.total) bestResolved = true
        progression.push(best)
      }
      if (best < 0) return { kind: 'blocked', blockers: ['breadth: every rollout went down'] }
      return {
        kind: 'done',
        deliverable: {
          mode: 'breadth',
          score: best,
          resolved: bestResolved,
          completions,
          progression,
          shots: opened,
        },
      }
    },
  }
}

/**
 * A Strategy is HOW you spend the compute budget to beat the Environment's check — it
 * builds the driver `Agent` the Supervisor runs. This is the OPEN extension point: a dev
 * authors their own by implementing `driver()` to return an Agent whose `act()` spawns
 * shots/analysts via `scope.spawn` / `scope.next` / `scope.send`. The two built-ins are
 * the reference implementations to copy:
 *   sample — K INDEPENDENT attempts, keep the best-verifying (best-of-N / resample).
 *   refine — attempt → observe() reads the trace → steer the next → repeat (iterate).
 * (A multi-agent "team" is just a Strategy whose driver spawns several different agents.)
 */
declare const strategyResult: unique symbol

export interface Strategy<Result extends StrategyResult = StrategyResult> {
  readonly name: string
  /** @internal Associates a strategy with its typed result without adding a runtime field. */
  readonly [strategyResult]?: Result
  driver(
    surface: AgenticSurface,
    task: AgenticTask,
    opts: AgenticOptions,
    budget: number,
  ): Agent<unknown, Outcome<unknown>>
}

/** Built-in `Strategy`: K independent attempts, keep the best-verifying (best-of-N / resample). */
export const sample: Strategy = {
  name: 'sample',
  driver: (surface, task, opts, budget) => breadthStrategy(surface, task, opts, { width: budget }),
}
/** Built-in `Strategy`: attempt → `observe()` reads the trace → steer the next attempt → repeat (deepen one lineage). */
export const refine: Strategy = {
  name: 'refine',
  driver: (surface, task, opts, budget) => depthStrategy(surface, task, opts, { maxShots: budget }),
}

// ── The composable LEGO: author a strategy in ~15 lines from two steps ───────────
//
// A strategy body gets `shot()` (run one worker attempt over an artifact) and
// `critique()` (the firewalled analyst reads the trace → a steer). Compose them — no
// Supervisor/Scope ceremony. This is the skillifiable unit: an agent can emit a
// `defineStrategy(name, body)` of a few step-calls; it can't reliably emit a 70-line
// driver. (depthStrategy/breadthStrategy are the hand-written reference impls; refine/sample
// stay on them — proven — while NEW strategies are authored compactly here.)

/** A role for one shot — multi-agent loops (researcher + engineer, a panel of k
 *  researchers) give each shot its own system prompt and optionally its own model. */
export interface ShotPersona {
  /** Replaces the task's systemPrompt for a FRESH shot; on a carried conversation it is
   *  injected as a hand-off message (the transcript's earlier roles stay intact). */
  systemPrompt?: string
  /** Per-shot model override (e.g. a stronger model for the engineer shot). */
  model?: string
}

export interface ShotSpec {
  /** present ⇒ continue this artifact (depth); absent ⇒ the shot opens a fresh one (sample/restart). */
  handle?: ArtifactHandle
  messages?: StrategyMessage[]
  steer?: string
  persona?: ShotPersona
  /** Restrict THIS shot to a subset of the domain's tools (by name) — focus a shot on
   *  the relevant capabilities. Restriction-only; unknown names throw. Omitted ⇒ all. */
  tools?: string[]
}
export interface StrategyResult {
  score: number
  resolved: boolean
  completions: number
  progression: number[]
  shots: number
}
/** Artifact lifecycle a strategy may manage itself — open/close ONLY. Raw `call`/`score`
 *  are withheld: scores reach the body solely through `shot()`'s StrategyShotResult (the
 *  harness-verified channel), so a body cannot peek the check or fabricate around it. */
export interface StrategyArtifacts {
  readonly name: string
  open(task: AgenticTask): Promise<ArtifactHandle>
  close(handle: ArtifactHandle): Promise<void>
}

/** What a strategy body composes with: the artifact lifecycle, the budget, and the two steps. */
export interface StrategyCtx {
  /** Open/close artifacts the body manages itself (e.g. one persistent handle for depth). */
  readonly surface: StrategyArtifacts
  readonly task: AgenticTask
  readonly opts: AgenticOptions
  readonly budget: number
  readonly scope: Scope<Outcome<unknown>>
  /** Run ONE worker shot; its harness-scored result, or null if it went down. */
  shot(spec?: ShotSpec): Promise<StrategyShotResult | null>
  /** The firewalled critic reads the trajectory → a steer string, or null on COMPLETE/down. */
  critique(messages: StrategyMessage[]): Promise<string | null>
  /** The RAW analyst channel: the firewalled critic answers `instruction` over the
   *  trajectory verbatim — no findings extraction, so verdict-shaped formats
   *  (CONTINUE/STOP decisions, calibrated predictions) survive. Same firewall:
   *  trajectory in, never scores. Null when the analyst went down. */
  consult(messages: StrategyMessage[], instruction: string): Promise<string | null>
  /** The tools THIS artifact's task actually offers (names + descriptions only — never
   *  the implementations). Tool sets vary per task on heterogeneous domains; a strategy
   *  that restricts shots MUST select from this list, never from hardcoded names. */
  listTools(handle: ArtifactHandle): Promise<Array<{ name: string; description?: string }>>
}

/** Author a Strategy from the composable steps — the open, compact way. */
export function defineStrategy<Result extends StrategyResult>(
  name: string,
  run: (ctx: StrategyCtx) => Promise<Result>,
): Strategy<Result> {
  return {
    name,
    driver: (surface, task, opts, budget) => ({
      name,
      async act(_t, scope): Promise<Outcome<unknown>> {
        let seq = 0
        const innerTurns = opts.innerTurns ?? 4
        // HARNESS-VERIFIED scoring: the deliverable score is computed HERE from the shots
        // the harness actually brokered + scored via surface.score() — NEVER the value the
        // (possibly authored / adversarial) body returns. An authored strategy cannot
        // fabricate a win; it can only report what its real shots achieved. Keep-best.
        let verifiedBest = 0
        let verifiedResolved = false
        // Close is IDEMPOTENT by construction for the body: authored code double-closes
        // (often as a floating promise inside a finally), and a second close must be a
        // no-op rather than a domain error that escapes as an unhandled rejection and
        // kills the whole benchmark run. A close failure on a LIVE handle still throws.
        const openHandles = new Set<string>()
        const ctx: StrategyCtx = {
          // Narrowed to open/close — the body gets no raw call()/score() access.
          surface: {
            name: surface.name,
            open: async (t) => {
              const h = await surface.open(t)
              openHandles.add(h.id)
              return h
            },
            close: async (h) => {
              if (!h || !openHandles.has(h.id)) return
              openHandles.delete(h.id)
              await surface.close(h)
            },
          },
          task,
          opts,
          budget,
          scope,
          async shot(spec) {
            const child = leaf(`shot:${seq}`, 'shot')
            seq += 1
            const res = scope.spawn(
              child,
              {
                task,
                handle: spec?.handle,
                messages: spec?.messages,
                steer: spec?.steer,
                persona: spec?.persona,
                tools: spec?.tools,
              } as ShotTask,
              { budget: perChild(innerTurns), label: child.name },
            )
            if (!res.ok) return null
            const settled = await drainOne(scope)
            if (settled.kind === 'down') return null
            const out = settled.out as unknown as StrategyShotResult
            if (out.score > verifiedBest) verifiedBest = out.score
            if (out.total > 0 && out.passes === out.total) verifiedResolved = true
            return out
          },
          async listTools(handle) {
            const tools = await surface.tools(task, handle)
            return tools.map((t) => ({
              name: t.function.name,
              ...(t.function.description ? { description: t.function.description } : {}),
            }))
          },
          async critique(messages) {
            const child = leaf(`analyst:${seq}`, 'analyst')
            seq += 1
            const res = scope.spawn(
              child,
              { task, messages },
              { budget: perChild(1), label: child.name },
            )
            if (!res.ok) return null
            const settled = await drainOne(scope)
            if (settled.kind === 'down') return null
            const findings = settled.out as unknown as string
            return /^\s*COMPLETE\b/i.test(findings) ? null : findings
          },
          async consult(messages, instruction) {
            const child = leaf(`analyst:${seq}`, 'analyst')
            seq += 1
            const res = scope.spawn(
              child,
              { task, messages, rawInstruction: instruction },
              { budget: perChild(1), label: child.name },
            )
            if (!res.ok) return null
            const settled = await drainOne(scope)
            if (settled.kind === 'down') return null
            return settled.out as unknown as string
          },
        }
        const r = await run(ctx)
        // Override the body's self-reported score/resolved with the harness-verified
        // values. The body's progression/completions/shots are advisory (display only) —
        // but NORMALIZED: an authored body that omits them must not poison downstream
        // consumers (losses tables, anytime curves) with undefined.
        return {
          kind: 'done',
          deliverable: {
            mode: name,
            ...r,
            progression: Array.isArray(r.progression) ? r.progression : [],
            completions: typeof r.completions === 'number' ? r.completions : 0,
            shots: typeof r.shots === 'number' ? r.shots : 0,
            score: verifiedBest,
            resolved: verifiedResolved,
          },
        }
      },
    }),
  }
}

/** A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot
 *  fails to improve the score it ABANDONS that line and restarts fresh (branch-when-stuck)
 *  — the widen/MCTS idea the depth-stuck failure motivated. Scored keep-best (the best
 *  checkpoint across all lines), the deployable metric. This is the "experts build BETTER
 *  optimizations" path: a new technique, compact, with zero Supervisor ceremony. */
export const adaptiveRefine = defineStrategy(
  'adaptiveRefine',
  async ({ surface, task, budget, shot, critique }) => {
    let handle = await surface.open(task)
    const progression: number[] = []
    let messages: StrategyMessage[] | undefined
    let steer: string | undefined
    let completions = 0
    let best = -1
    let shots = 0
    try {
      for (shots = 0; shots < budget; shots += 1) {
        const out = await shot({ handle, messages, steer })
        if (!out) break
        completions += out.completions
        progression.push(out.score)
        if (out.score >= 1) break
        if (out.score <= best) {
          // Stuck: steering isn't improving this line — abandon it, restart fresh.
          await surface.close(handle)
          handle = await surface.open(task)
          messages = undefined
          steer = undefined
          continue
        }
        best = out.score
        messages = out.messages
        const findings = await critique(out.messages)
        completions += 1
        if (!findings) break
        steer = `A reviewer flagged unfinished items:\n${findings}\n\nAddress each with the tools, verify they took, then continue.`
      }
      const score = progression.length ? Math.max(...progression) : 0
      return { score, resolved: score >= 1, completions, progression, shots }
    } finally {
      await surface.close(handle)
    }
  },
)

/** The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open),
 *  then refine the best-verifying line with the remaining budget. Sample's basin escape +
 *  refine's accumulation — the third built-in, authored from the public steps. */
export const sampleThenRefine = defineStrategy(
  'sampleThenRefine',
  async ({ surface, task, budget, shot, critique }) => {
    const explore = Math.max(1, Math.ceil(budget / 2))
    const open = new Set<ArtifactHandle>()
    const progression: number[] = []
    let completions = 0
    let shots = 0
    try {
      // Explore: independent lines on handles we own (kept open so the best can continue).
      let best: { handle: ArtifactHandle; out: StrategyShotResult } | undefined
      for (let i = 0; i < explore; i += 1) {
        const handle = await surface.open(task)
        open.add(handle)
        const out = await shot({ handle })
        if (!out) continue
        shots += 1
        completions += out.completions
        progression.push(out.score)
        if (!best || out.score > best.out.score) best = { handle, out }
        if (out.score >= 1) break
      }
      if (!best) return { score: 0, resolved: false, completions, progression, shots }
      // Exploit: close the losers, refine the winner with the remaining budget.
      for (const h of [...open]) {
        if (h !== best.handle) {
          await surface.close(h)
          open.delete(h)
        }
      }
      let messages = best.out.messages
      let topScore = best.out.score
      for (let i = explore; i < budget && topScore < 1; i += 1) {
        const findings = await critique(messages)
        completions += 1
        if (!findings) break
        const out = await shot({
          handle: best.handle,
          messages,
          steer: `A reviewer flagged unfinished items:\n${findings}\n\nAddress each with the tools, verify they took, then continue.`,
        })
        if (!out) break
        shots += 1
        completions += out.completions
        progression.push(out.score)
        messages = out.messages
        if (out.score > topScore) topScore = out.score
      }
      const score = progression.length ? Math.max(...progression) : 0
      return { score, resolved: score >= 1, completions, progression, shots }
    } finally {
      for (const h of open) await surface.close(h)
    }
  },
)

export interface RunAgenticOptions<Result extends StrategyResult = StrategyResult>
  extends AgenticOptions {
  surface: AgenticSurface
  task: AgenticTask
  /** Lifecycle observability — every spawn/settle (shots, analysts) streams here live.
   *  The seam online watchdogs/route-auditors subscribe to. */
  hooks?: RuntimeHooks
  /** A Strategy (the open way) — author/pass your own. Overrides `mode` when present. */
  strategy?: Strategy<Result>
  /** Built-in shorthand: 'depth'→refine, 'breadth'→sample. Default 'depth'. */
  mode?: 'depth' | 'breadth'
  /** budget: refine→max shots; sample→rollout width. */
  budget: number
  rootBudget?: Budget
}

/** Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope. */
export async function runAgentic<Result extends StrategyResult = StrategyResult>(
  opts: RunAgenticOptions<Result>,
): Promise<AgenticRunResult & Result> {
  const strategy: Strategy = opts.strategy ?? (opts.mode === 'breadth' ? sample : refine)
  const driver = strategy.driver(opts.surface, opts.task, opts, opts.budget)
  const supervisor = createSupervisor<unknown, Outcome<unknown>>()
  const root: Budget = opts.rootBudget ?? {
    maxIterations: opts.budget * ((opts.innerTurns ?? 4) + 2),
    maxTokens: 1_000_000_000,
  }
  const started = Date.now()
  const result = await supervisor.run(driver, undefined, {
    budget: root,
    runId: `agentic:${strategy.name}:${opts.task.id}`,
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    executors: agenticRegistry(opts.surface, opts),
    maxDepth: 3,
    ...(opts.hooks ? { hooks: opts.hooks } : {}),
  })
  if (result.kind !== 'winner' || result.out.kind !== 'done') {
    const reason =
      result.kind === 'winner'
        ? `blocked: ${(result.out as { blockers?: string[] }).blockers?.join('; ')}`
        : `no-winner: ${result.reason}`
    throw new Error(`runAgentic(${strategy.name}) produced no result — ${reason}`)
  }
  // Drivers deliver the strategy outcome; the cost vector is stamped here from `result.spentTotal`
  // (the journal aggregate: settled child work + metered driver inference) + wall clock.
  const core = result.out.deliverable as Omit<AgenticRunResult & Result, 'usd' | 'ms' | 'tokens'>
  return {
    ...core,
    usd: result.spentTotal.usd,
    tokens: result.spentTotal.tokens,
    ms: Date.now() - started,
  } as AgenticRunResult & Result
}
