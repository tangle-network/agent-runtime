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
  /** Operator trace hook — emits the full content of each driver step (steer in, tool calls,
   *  score, analyst findings) so a human can SEE whether the steering is any good. */
  onTrace?: (ev: AgenticTraceEvent) => void
}

/** One driver step's full content — the thing to actually read, not just the score. */
export interface AgenticTraceEvent {
  shot: number
  /** The prompt the driver injected into this (resumed) shot — undefined on shot 0. */
  steer?: string
  /** What the agent actually did this shot: tool calls + their observations. */
  toolCalls: Array<{ name: string; args: string; result: string }>
  /** Score after this shot (cumulative artifact state). */
  score: number
  /** The trace-analyst's verdict after this shot (what it told the driver). */
  findings?: string
}

// ── The unit: one agentic shot (a bounded tool loop) over a handle ───────────────

type Msg = Record<string, unknown>
interface ToolCall {
  id: string
  function: { name: string; arguments: string }
}

export interface ShotTask {
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
  maxTurns?: number,
): Promise<ShotOut> {
  const innerTurns = maxTurns ?? opts.innerTurns ?? 4
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

export interface ShotResult {
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
export function shotExecutor(surface: AgenticSurface, opts: AgenticOptions): LeafExecutor<unknown> {
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
export function agenticRegistry(surface: AgenticSurface, opts: AgenticOptions): ExecutorRegistry {
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

/** Extract the (call → observation) pairs from a slice of the conversation, for the trace hook. */
function extractToolCalls(slice: Msg[]): Array<{ name: string; args: string; result: string }> {
  const results = new Map<string, string>()
  for (const m of slice) {
    if (m.role === 'tool') results.set(String(m.tool_call_id), String(m.content))
  }
  const out: Array<{ name: string; args: string; result: string }> = []
  for (const m of slice) {
    if (m.role !== 'assistant') continue
    for (const c of (m.tool_calls as ToolCall[] | undefined) ?? []) {
      out.push({ name: c.function.name, args: c.function.arguments, result: results.get(c.id) ?? '' })
    }
  }
  return out
}

/** Drain exactly one settlement (the just-spawned child). */
async function drainOne(scope: Scope<Outcome<unknown>>): Promise<Settled<Outcome<unknown>>> {
  const s = await scope.next()
  if (!s) throw new Error('agentic: spawned child never settled')
  return s
}

// ── The result + the two drivers (domain-blind Agents run by the Supervisor) ─────

export interface AgenticRunResult {
  mode: 'depth' | 'breadth' | 'mix' | 'operator'
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
          const prevLen = messages?.length ?? 0
          const res = scope.spawn(child, { task, handle, messages, steer } as ShotTask, { budget: perChild(innerTurns), label: `shot:${shots}` })
          if (!res.ok) break
          const settled = await drainOne(scope)
          if (settled.kind === 'down') break
          const out = settled.out as unknown as ShotResult
          const toolCalls = extractToolCalls(out.messages.slice(prevLen))
          messages = out.messages
          completions += out.completions
          progression.push(out.score)
          const done = out.score >= 1 || shots === cfg.maxShots - 1
          // Analyst reads the trajectory (firewalled) → steer the resumed session.
          let findings: string | undefined
          if (!done) {
            const aRes = scope.spawn(leaf(`analyst:${shots}`, 'analyst'), { task, messages }, { budget: perChild(1), label: `analyst:${shots}` })
            if (aRes.ok) {
              const aSettled = await drainOne(scope)
              completions += 1
              if (aSettled.kind === 'done') findings = aSettled.out as unknown as string
            }
          }
          opts.onTrace?.({ shot: shots, steer, toolCalls, score: out.score, ...(findings !== undefined ? { findings } : {}) })
          if (done) break
          if (findings === undefined || /^\s*COMPLETE\b/i.test(findings)) break
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

/**
 * MIX: the dynamic breadth/depth choice (MCTS-PW shape over the artifact). Refine a persistent main
 * line while it PROGRESSES (analyst-steered, like depth); when a line STALLS, branch a FRESH
 * exploration on a new artifact (like breadth) and ADOPT it if it beats the stuck line — keep the
 * best, continue. This is the structure the traces motivated: depth refines (29→71→100), breadth
 * hedges the variance whiff (0%), the mix gets both.
 */
function mixDriver(
  surface: AgenticSurface,
  task: AgenticTask,
  opts: AgenticOptions,
  cfg: { maxRounds: number; stallThreshold: number },
): Agent<unknown, Outcome<unknown>> {
  const innerTurns = opts.innerTurns ?? 4
  let pendingSteer: string | undefined
  return {
    name: 'mix',
    async act(_t, scope): Promise<Outcome<unknown>> {
      const open: ArtifactHandle[] = []
      let mainHandle = await surface.open(task)
      open.push(mainHandle)
      let mainMessages: Msg[] | undefined
      let bestScore = -1
      let stalls = 0
      let completions = 0
      const progression: number[] = []
      try {
        for (let round = 0; round < cfg.maxRounds; round += 1) {
          const steer = round === 0 ? undefined : pendingSteer
          const prevLen = mainMessages?.length ?? 0
          const res = scope.spawn(leaf(`shot:${round}`, 'shot'), { task, handle: mainHandle, messages: mainMessages, steer } as ShotTask, { budget: perChild(innerTurns), label: `shot:${round}` })
          pendingSteer = undefined
          if (!res.ok) break
          const s = await drainOne(scope)
          if (s.kind === 'down') break
          const out = s.out as unknown as ShotResult
          const toolCalls = extractToolCalls(out.messages.slice(prevLen))
          completions += out.completions
          mainMessages = out.messages
          if (out.score > bestScore) {
            bestScore = out.score
            stalls = 0
          } else {
            stalls += 1
          }
          progression.push(bestScore)
          if (bestScore >= 1 || round === cfg.maxRounds - 1) {
            opts.onTrace?.({ shot: round, steer, toolCalls, score: bestScore })
            break
          }
          if (stalls >= cfg.stallThreshold) {
            // Stuck: branch a fresh exploration on a NEW artifact; adopt it if it beats the stuck line.
            const bHandle = await surface.open(task)
            open.push(bHandle)
            const bres = scope.spawn(leaf(`branch:${round}`, 'shot'), { task, handle: bHandle } as ShotTask, { budget: perChild(innerTurns), label: `branch:${round}` })
            let adopted = false
            if (bres.ok) {
              const bs = await drainOne(scope)
              if (bs.kind === 'done') {
                const bout = bs.out as unknown as ShotResult
                completions += bout.completions
                if (bout.score > bestScore) {
                  bestScore = bout.score
                  mainHandle = bHandle
                  mainMessages = bout.messages
                  adopted = true
                }
              }
            }
            stalls = 0
            opts.onTrace?.({ shot: round, steer, toolCalls, score: bestScore, findings: `BRANCH fresh exploration (adopted=${adopted})` })
          } else {
            // Progressing: analyst-steer the resumed main line (depth refinement).
            let findings: string | undefined
            const aRes = scope.spawn(leaf(`analyst:${round}`, 'analyst'), { task, messages: mainMessages }, { budget: perChild(1), label: `analyst:${round}` })
            if (aRes.ok) {
              const as = await drainOne(scope)
              completions += 1
              if (as.kind === 'done') findings = as.out as unknown as string
            }
            opts.onTrace?.({ shot: round, steer, toolCalls, score: bestScore, ...(findings !== undefined ? { findings } : {}) })
            if (findings && /^\s*COMPLETE\b/i.test(findings)) break
            if (findings) pendingSteer = `A reviewer flagged unfinished items:\n${findings}\n\nAddress each with the tools, verify they took, then continue.`
          }
        }
        const final = await surface.score(task, mainHandle)
        const score = final.total > 0 ? final.passes / final.total : 0
        return { kind: 'done', deliverable: { mode: 'mix', score, resolved: final.total > 0 && final.passes === final.total, completions, progression, shots: progression.length } }
      } finally {
        for (const h of open) await surface.close(h)
      }
    },
  }
}

// ── The OPERATOR atom: one agent that reads the trace, judges, and either steers a worker, does a
//    decisive turn itself, branches, or stops — over the shared artifact. Driver + analyst + IC fused. ──

type OperatorMove = { move: 'steer' | 'work' | 'branch' | 'done'; instruction: string; rationale: string }

/** The operator's brain: read ONLY the task + the work-so-far trace (firewall — never the score),
 *  judge, and choose the next move. One LLM call. This fuses the analyst (diagnose) and the driver
 *  (decide + author) into a single operator that leads with judgment. */
async function operatorDecide(
  task: AgenticTask,
  messages: Msg[],
  round: number,
  maxRounds: number,
  opts: AgenticOptions,
): Promise<OperatorMove> {
  const trace = messages
    .filter((m) => m.role === 'assistant' || m.role === 'tool')
    .map((m) => {
      if (m.role === 'tool') return `RESULT ${String(m.content).slice(0, 260)}`
      const calls = (m.tool_calls as ToolCall[] | undefined)?.map((c) => `${c.function.name}(${c.function.arguments})`).join(', ')
      return calls ? `CALL ${calls}` : `SAY ${String(m.content).slice(0, 160)}`
    })
    .join('\n')
    .slice(0, 7000)
  const sys =
    'You are the OPERATOR leading work on a task. You have a worker you can delegate to AND tools you ' +
    'can run yourself. Read the task and the work-so-far (tool calls + their RESULTS) and pick the ONE ' +
    'best next move:\n' +
    '- "steer": delegate the next chunk to the worker, with a specific instruction of what to do next.\n' +
    '- "work": do ONE decisive action yourself now (when it is crucial and you should not delegate).\n' +
    '- "branch": this line is stuck or wrong — start a fresh attempt (instruction = the new approach).\n' +
    '- "done": every required change is made AND confirmed in the tool results.\n' +
    'Judge ONLY from what the tools actually returned, never from intent. Emit exactly one fenced ' +
    '```json block: {"move":"steer|work|branch|done","instruction":"...","rationale":"..."}'
  const user = `TASK:\n${task.userPrompt}\n\nWORK SO FAR:\n${trace || '(nothing yet)'}\n\nRound ${round + 1}/${maxRounds}. Your move?`
  const res = await fetch(`${opts.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.routerKey}` },
    body: JSON.stringify({ model: opts.model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.4 }),
  })
  if (!res.ok) throw new Error(`operator router ${res.status}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content ?? ''
  const m = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  try {
    const parsed = JSON.parse((m?.[1] ?? content).trim()) as Partial<OperatorMove>
    const move = (['steer', 'work', 'branch', 'done'] as const).includes(parsed.move as never) ? (parsed.move as OperatorMove['move']) : 'steer'
    return { move, instruction: String(parsed.instruction ?? 'Continue addressing any remaining required changes.'), rationale: String(parsed.rationale ?? '') }
  } catch {
    return { move: 'steer', instruction: 'Continue addressing any remaining required changes, verifying each.', rationale: 'unparseable operator output' }
  }
}

/**
 * OPERATOR: the working-manager atom. Each round its brain reads the trace and judges the next move;
 * it then either delegates a worker shot (`steer`), does one decisive turn itself (`work`), starts a
 * fresh line and adopts it if better (`branch`), or stops (`done`) — all over the SHARED artifact.
 * One self-similar agent that analyzes, leads, AND contributes; how it leans is the AgentProfile.
 */
function operatorDriver(surface: AgenticSurface, task: AgenticTask, opts: AgenticOptions, cfg: { maxRounds: number }): Agent<unknown, Outcome<unknown>> {
  const innerTurns = opts.innerTurns ?? 4
  return {
    name: 'operator',
    async act(_t, _scope): Promise<Outcome<unknown>> {
      const open: ArtifactHandle[] = []
      let handle = await surface.open(task)
      open.push(handle)
      let messages: Msg[] = [
        { role: 'system', content: task.systemPrompt },
        { role: 'user', content: `${task.userPrompt}\n\n${taskNudge}` },
      ]
      let tools = await surface.tools(task, handle)
      let completions = 0
      const progression: number[] = []
      const scoreOf = async (h: ArtifactHandle) => {
        const s = await surface.score(task, h)
        return s.total > 0 ? s.passes / s.total : 0
      }
      try {
        for (let round = 0; round < cfg.maxRounds; round += 1) {
          const decision = await operatorDecide(task, messages, round, cfg.maxRounds, opts)
          completions += 1
          if (decision.move === 'done') {
            opts.onTrace?.({ shot: round, steer: `[done] ${decision.instruction}`, toolCalls: [], score: progression.at(-1) ?? (await scoreOf(handle)), findings: decision.rationale })
            break
          }
          if (decision.move === 'branch') {
            const bHandle = await surface.open(task)
            open.push(bHandle)
            const bMessages: Msg[] = [
              { role: 'system', content: task.systemPrompt },
              { role: 'user', content: `${task.userPrompt}\n\nApproach: ${decision.instruction}\n\n${taskNudge}` },
            ]
            const bShot = await runShot(surface, task, bHandle, await surface.tools(task, bHandle), bMessages, opts, innerTurns)
            completions += bShot.completions
            const [bScore, cScore] = [await scoreOf(bHandle), await scoreOf(handle)]
            opts.onTrace?.({ shot: round, steer: `[branch] ${decision.instruction}`, toolCalls: extractToolCalls(bShot.messages.slice(2)), score: Math.max(bScore, cScore), findings: decision.rationale })
            if (bScore > cScore) {
              handle = bHandle
              messages = bShot.messages
              tools = await surface.tools(task, handle)
            }
            progression.push(Math.max(bScore, cScore))
            continue
          }
          // steer = delegate a full worker shot; work = the operator's own single decisive turn.
          const turns = decision.move === 'work' ? 1 : innerTurns
          const prevLen = messages.length
          messages.push({ role: 'user', content: decision.instruction })
          const shot = await runShot(surface, task, handle, tools, messages, opts, turns)
          completions += shot.completions
          messages = shot.messages
          const score = await scoreOf(handle)
          progression.push(score)
          opts.onTrace?.({ shot: round, steer: `[${decision.move}] ${decision.instruction}`, toolCalls: extractToolCalls(messages.slice(prevLen)), score, findings: decision.rationale })
          if (score >= 1) break
        }
        const score = await scoreOf(handle)
        const final = await surface.score(task, handle)
        return { kind: 'done', deliverable: { mode: 'operator', score, resolved: final.total > 0 && final.passes === final.total, completions, progression, shots: progression.length } }
      } finally {
        for (const h of open) await surface.close(h)
      }
    },
  }
}

export interface RunAgenticOptions extends AgenticOptions {
  surface: AgenticSurface
  task: AgenticTask
  mode: 'depth' | 'breadth' | 'mix' | 'operator'
  /** depth: max shots; breadth: rollout width; mix/operator: max rounds. */
  budget: number
  /** mix only: branch a fresh exploration after this many non-improving shots. Default 1. */
  stallThreshold?: number
  rootBudget?: Budget
}

/** Run the chosen driver through the keystone Supervisor — `Agent.act` over a conserved-budget Scope. */
export async function runAgentic(opts: RunAgenticOptions): Promise<AgenticRunResult> {
  const driver =
    opts.mode === 'depth'
      ? depthDriver(opts.surface, opts.task, opts, { maxShots: opts.budget })
      : opts.mode === 'operator'
        ? operatorDriver(opts.surface, opts.task, opts, { maxRounds: opts.budget })
        : opts.mode === 'mix'
          ? mixDriver(opts.surface, opts.task, opts, { maxRounds: opts.budget, stallThreshold: opts.stallThreshold ?? 1 })
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
