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
 * surface-closed registry — the open `LeafExecutor` seam, not bespoke per-benchmark glue.
 */

import {
  createSupervisor,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '@tangle-network/agent-runtime/loops'
import type {
  Agent,
  AgentSpec,
  Budget,
  ExecutorContext,
  ExecutorRegistry,
  LeafExecutor,
  LeafExecutorFactory,
  LeafResult,
  Outcome,
  Scope,
  Settled,
  Spend,
} from '@tangle-network/agent-runtime/loops'

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
  temperature?: number
  /** Turns the agent may take within ONE shot before the driver intervenes. */
  innerTurns?: number
}

// ── The unit: one agentic shot (a bounded tool loop) over a handle ───────────────

type Msg = Record<string, unknown>
interface ToolCall {
  id: string
  function: { name: string; arguments: string }
}

interface ShotTask {
  task: AgenticTask
  handle?: ArtifactHandle // present ⇒ DEPTH (shared artifact); absent ⇒ BREADTH (open own)
  messages?: Msg[] // carried conversation (depth); fresh when absent
  steer?: string // analyst-derived steer injected before this shot (depth)
}

interface ShotOut {
  messages: Msg[]
  completions: number
  toolCalls: number
  toolErrors: number
}

const taskNudge =
  'Use the available tools to bring the artifact to the required final state. Address EVERY distinct ' +
  'change the request implies. After each tool result, check what remains and continue. Re-read the ' +
  'values you set to confirm they took. Reply DONE only once every required change is made and verified.'

/** One shot: run the agent's tool loop (≤ innerTurns) over the handle, mutating the artifact via
 *  `surface.call`, carrying `messages`. Returns the updated conversation + counts. */
async function runShot(
  surface: AgenticSurface,
  task: AgenticTask,
  handle: ArtifactHandle,
  tools: AgenticTool[],
  messages: Msg[],
  opts: AgenticOptions,
): Promise<ShotOut> {
  const innerTurns = opts.innerTurns ?? 4
  let completions = 0
  let toolCalls = 0
  let toolErrors = 0
  for (let t = 0; t < innerTurns; t += 1) {
    const res = await fetch(`${opts.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.routerKey}` },
      body: JSON.stringify({ model: opts.model, messages, tools, tool_choice: 'auto', temperature: opts.temperature ?? 0.7 }),
    })
    if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
    completions += 1
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }> }
    const msg = data.choices?.[0]?.message
    if (!msg) break
    const calls = msg.tool_calls ?? []
    messages.push({ role: 'assistant', content: msg.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) })
    if (calls.length === 0) break
    for (const call of calls) {
      toolCalls += 1
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch {
        toolErrors += 1
      }
      let out: string
      try {
        out = await surface.call(handle, call.function.name, args)
        if (out.startsWith('ERROR:')) toolErrors += 1
      } catch (e) {
        toolErrors += 1
        out = `ERROR: ${e instanceof Error ? e.message : String(e)}`
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: out })
    }
  }
  return { messages, completions, toolCalls, toolErrors }
}

/** The trace-analyst (selector≠judge): reads ONLY the trajectory + task, never the score. */
async function analyze(task: AgenticTask, messages: Msg[], opts: AgenticOptions): Promise<string> {
  const trace = messages
    .filter((m) => m.role === 'assistant' || m.role === 'tool')
    .map((m) => {
      if (m.role === 'tool') return `RESULT ${String(m.content).slice(0, 280)}`
      const calls = (m.tool_calls as ToolCall[] | undefined)?.map((c) => `${c.function.name}(${c.function.arguments})`).join(', ')
      return calls ? `CALL ${calls}` : `SAY ${String(m.content).slice(0, 200)}`
    })
    .join('\n')
    .slice(0, 7000)
  const sys =
    "You audit an agent's work. From ONLY the task and the agent's tool-call trajectory, list every " +
    'required change that does NOT yet appear done or verified (judge from observed RESULTS, not ' +
    'intent). Be specific. If everything required appears done and verified, reply exactly COMPLETE.'
  const res = await fetch(`${opts.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.routerKey}` },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `TASK:\n${task.userPrompt}\n\nTRAJECTORY:\n${trace}\n\nWhat required work is still unfinished?` },
      ],
      temperature: 0.3,
    }),
  })
  if (!res.ok) throw new Error(`analyst router ${res.status}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Leaf executors (one shot / one analyst), resolved per-spawn from the surface ──

interface ShotResult {
  messages: Msg[]
  score: number
  passes: number
  total: number
  completions: number
  toolErrors: number
}

const spend = (iterations: number): Spend => ({ iterations, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })

/** Resolve a shot: if `handle` given, operate on the SHARED artifact (depth); else open+score+close
 *  an OWN artifact (breadth). Always scores the artifact's final state as the deployable verdict. */
function shotExecutor(surface: AgenticSurface, opts: AgenticOptions): LeafExecutor<unknown> {
  let artifact: LeafResult<unknown> | undefined
  return {
    runtime: 'agentic-shot',
    async execute(task): Promise<LeafResult<unknown>> {
      const t = task as ShotTask
      const own = !t.handle
      const handle = t.handle ?? (await surface.open(t.task))
      try {
        const tools = await surface.tools(t.task, handle)
        const messages: Msg[] = t.messages ?? [
          { role: 'system', content: t.task.systemPrompt },
          { role: 'user', content: `${t.task.userPrompt}\n\n${taskNudge}` },
        ]
        if (t.steer) messages.push({ role: 'user', content: t.steer })
        const shot = await runShot(surface, t.task, handle, tools, messages, opts)
        const s = await surface.score(t.task, handle)
        const score = s.total > 0 ? s.passes / s.total : 0
        const out: ShotResult = { messages: shot.messages, score, passes: s.passes, total: s.total, completions: shot.completions, toolErrors: shot.toolErrors }
        artifact = {
          outRef: `shot:${handle.id}:${shot.completions}:${s.passes}/${s.total}`,
          out,
          verdict: { valid: s.total > 0 && s.passes === s.total, score },
          spent: spend(shot.completions),
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

function analystExecutor(opts: AgenticOptions): LeafExecutor<unknown> {
  let artifact: LeafResult<unknown> | undefined
  return {
    runtime: 'agentic-analyst',
    async execute(task): Promise<LeafResult<unknown>> {
      const t = task as { task: AgenticTask; messages: Msg[] }
      const findings = await analyze(t.task, t.messages, opts)
      artifact = { outRef: `analyst:${findings.length}`, out: findings, spent: spend(1) }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact() {
      if (!artifact) throw new Error('analystExecutor: resultArtifact before execute')
      return artifact
    },
  }
}

/** Registry dispatching on the child's role tag — fresh executor per spawn (no shared-instance race). */
function agenticRegistry(surface: AgenticSurface, opts: AgenticOptions): ExecutorRegistry {
  return {
    register() {
      throw new Error('agenticRegistry: register unsupported')
    },
    resolve<Out>(spec: AgentSpec) {
      const role = (spec.profile.metadata as { role?: string } | undefined)?.role
      const factory: LeafExecutorFactory<Out> = (_s: AgentSpec, _ctx: ExecutorContext) =>
        (role === 'analyst' ? analystExecutor(opts) : shotExecutor(surface, opts)) as LeafExecutor<Out>
      return { succeeded: true as const, value: factory }
    },
  }
}

function leaf(name: string, role: 'shot' | 'analyst'): Agent<unknown, Outcome<unknown>> {
  const agent = {
    name,
    executorSpec: { profile: { name, metadata: { role } }, harness: null } as unknown as AgentSpec,
    act(): Promise<Outcome<unknown>> {
      throw new Error(`agentic: spawned leaf "${name}" run as a driver`)
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
  mode: 'depth' | 'breadth'
  score: number
  resolved: boolean
  completions: number
  /** DEPTH: score after each shot — the progress-over-rounds curve. BREADTH: best-so-far per rollout. */
  progression: number[]
  shots: number
}

const perChild = (innerTurns: number): Budget => ({ maxIterations: innerTurns + 1, maxTokens: 1_000_000 })

/** DEPTH: one persistent artifact, carried across analyst-steered shots. */
function depthDriver(surface: AgenticSurface, task: AgenticTask, opts: AgenticOptions, cfg: { maxShots: number }): Agent<unknown, Outcome<unknown>> {
  const innerTurns = opts.innerTurns ?? 4
  let pendingSteer: string | undefined // analyst-derived steer carried between shots
  return {
    name: 'depth',
    async act(_t, scope): Promise<Outcome<unknown>> {
      const handle = await surface.open(task)
      const progression: number[] = []
      let messages: Msg[] | undefined
      let completions = 0
      let shots = 0
      try {
        for (shots = 0; shots < cfg.maxShots; shots += 1) {
          const child = leaf(`shot:${shots}`, 'shot')
          const steer = shots === 0 ? undefined : pendingSteer
          const res = scope.spawn(child, { task, handle, messages, steer } as ShotTask, { budget: perChild(innerTurns), label: `shot:${shots}` })
          if (!res.ok) break
          const settled = await drainOne(scope)
          if (settled.kind === 'down') break
          const out = settled.out as unknown as ShotResult
          messages = out.messages
          completions += out.completions
          progression.push(out.score)
          if (out.score >= 1 || shots === cfg.maxShots - 1) break
          // Analyst reads the trajectory (firewalled) → steer the resumed session.
          const aChild = leaf(`analyst:${shots}`, 'analyst')
          const aRes = scope.spawn(aChild, { task, messages }, { budget: perChild(1), label: `analyst:${shots}` })
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
        return { kind: 'done', deliverable: { mode: 'depth', score, resolved: final.total > 0 && final.passes === final.total, completions, progression, shots: shots + 1 } }
      } finally {
        await surface.close(handle)
      }
    },
  }
}

/** BREADTH: K independent rollouts (each own artifact), verifier picks the best. */
function breadthDriver(surface: AgenticSurface, task: AgenticTask, opts: AgenticOptions, cfg: { width: number }): Agent<unknown, Outcome<unknown>> {
  const innerTurns = opts.innerTurns ?? 4
  return {
    name: 'breadth',
    async act(_t, scope): Promise<Outcome<unknown>> {
      let opened = 0
      for (let k = 0; k < cfg.width; k += 1) {
        const res = scope.spawn(leaf(`rollout:${k}`, 'shot'), { task } as ShotTask, { budget: perChild(innerTurns), label: `rollout:${k}` })
        if (res.ok) opened += 1
      }
      if (opened === 0) return { kind: 'blocked', blockers: ['breadth: pool admitted no rollout'] }
      let best = -1
      let bestResolved = false
      let completions = 0
      const progression: number[] = []
      for (let s = await scope.next(); s !== null; s = await scope.next()) {
        if (s.kind === 'down') continue
        const out = s.out as unknown as ShotResult
        completions += out.completions
        if (out.score > best) best = out.score
        if (out.total > 0 && out.passes === out.total) bestResolved = true
        progression.push(best)
      }
      if (best < 0) return { kind: 'blocked', blockers: ['breadth: every rollout went down'] }
      return { kind: 'done', deliverable: { mode: 'breadth', score: best, resolved: bestResolved, completions, progression, shots: opened } }
    },
  }
}

export interface RunAgenticOptions extends AgenticOptions {
  surface: AgenticSurface
  task: AgenticTask
  mode: 'depth' | 'breadth'
  /** depth: max shots; breadth: rollout width. */
  budget: number
  rootBudget?: Budget
}

/** Run the chosen driver through the keystone Supervisor — `Agent.act` over a conserved-budget Scope. */
export async function runAgentic(opts: RunAgenticOptions): Promise<AgenticRunResult> {
  const driver =
    opts.mode === 'depth'
      ? depthDriver(opts.surface, opts.task, opts, { maxShots: opts.budget })
      : breadthDriver(opts.surface, opts.task, opts, { width: opts.budget })
  const supervisor = createSupervisor<unknown, Outcome<unknown>>()
  const root: Budget = opts.rootBudget ?? { maxIterations: opts.budget * ((opts.innerTurns ?? 4) + 2), maxTokens: 1_000_000_000 }
  const result = await supervisor.run(driver, undefined, {
    budget: root,
    runId: `agentic:${opts.mode}:${opts.task.id}`,
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    executors: agenticRegistry(opts.surface, opts),
    maxDepth: 3,
  })
  if (result.kind !== 'winner' || result.out.kind !== 'done') {
    const reason = result.kind === 'winner' ? `blocked: ${(result.out as { blockers?: string[] }).blockers?.join('; ')}` : `no-winner: ${result.reason}`
    throw new Error(`runAgentic(${opts.mode}) produced no result — ${reason}`)
  }
  return result.out.deliverable as AgenticRunResult
}
