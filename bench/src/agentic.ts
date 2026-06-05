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


/** Registry dispatching on the child's role tag — fresh executor per spawn (no shared-instance race). */
export function agenticRegistry(surface: AgenticSurface, opts: AgenticOptions): ExecutorRegistry {
  return {
    register() {
      throw new Error('agenticRegistry: register unsupported')
    },
    resolve<Out>(_spec: AgentSpec) {
      // One leaf: a surface shot. (Diagnosis is the operator's own brain / createScopeAnalyst, not
      // a spawned analyst leaf.) The combinators (fanout/loopUntil/widen) spawn these as their workers.
      const factory: LeafExecutorFactory<Out> = (_s: AgentSpec, _ctx: ExecutorContext) =>
        shotExecutor(surface, opts) as LeafExecutor<Out>
      return { succeeded: true as const, value: factory }
    },
  }
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


// ── The result + the two drivers (domain-blind Agents run by the Supervisor) ─────

export interface AgenticRunResult {
  mode: 'operator'
  score: number
  resolved: boolean
  completions: number
  /** DEPTH: score after each shot — the progress-over-rounds curve. BREADTH: best-so-far per rollout. */
  progression: number[]
  shots: number
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
  /** Max operator rounds. (Breadth lives in agentic-personify.ts via `fanout`.) */
  budget: number
  rootBudget?: Budget
}

/**
 * Run the OPERATOR through the keystone Supervisor — `Agent.act` over a conserved-budget Scope.
 * breadth/depth/mix were redundant: breadth IS `fanout` (agentic-personify.ts), and depth/mix are
 * the operator with a steer-only / branch-when-stuck lean. The operator is the one driver.
 */
export async function runAgentic(opts: RunAgenticOptions): Promise<AgenticRunResult> {
  const driver = operatorDriver(opts.surface, opts.task, opts, { maxRounds: opts.budget })
  const supervisor = createSupervisor<unknown, Outcome<unknown>>()
  const root: Budget = opts.rootBudget ?? { maxIterations: opts.budget * ((opts.innerTurns ?? 4) + 2), maxTokens: 1_000_000_000 }
  const result = await supervisor.run(driver, undefined, {
    budget: root,
    runId: `operator:${opts.task.id}`,
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    executors: agenticRegistry(opts.surface, opts),
    maxDepth: 3,
  })
  if (result.kind !== 'winner' || result.out.kind !== 'done') {
    const reason = result.kind === 'winner' ? `blocked: ${(result.out as { blockers?: string[] }).blockers?.join('; ')}` : `no-winner: ${result.reason}`
    throw new Error(`runAgentic(operator) produced no result — ${reason}`)
  }
  return result.out.deliverable as AgenticRunResult
}
