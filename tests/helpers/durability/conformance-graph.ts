/**
 * The kill-and-resume conformance graph: one driver plus three delegate workers, a keyed
 * side-effect tool on the driver, and instrumentation at every step boundary and mid-step point.
 *
 * Shape (all offline, deterministic — the machinery under test is the REAL runGraph path):
 *
 *   conductor (root driver, brain = the planner below)
 *     ├─ delegates→ surveyor   (key step:surveyor)
 *     ├─ delegates→ builder    (key step:builder)
 *     └─ delegates→ verifier   (key step:verifier)
 *   driver tool: commit_artifact (idempotency key artifact:conductor:final)
 *   termination:  submit_result gated by the graph deliverable
 *
 * The planner brain is RESUME-BLIND by design: it replays the same plan (spawn each node under
 * its semantic key, wait for the live ones, commit, submit) in every process. Durability is the
 * runtime's job — completed keys must come back `resumed: "completed"` with their committed
 * result, an in-doubt key (the process died with the worker in flight) is escalated once to a
 * replacement key exactly the way the spawn_worker contract tells a driver to — so a resumed run
 * that re-executes committed work, loses a step, or mints a new side-effect key FAILS a case.
 */

import { appendFileSync, readFileSync } from 'node:fs'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { FileSpawnJournal } from '../../../src/durable/spawn-journal'
import { type AgentGraph, runGraph } from '../../../src/runtime/supervise/graph'
import { promptHandle } from '../../../src/runtime/supervise/prompt-registry'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  MakeWorkerAgent,
  SpawnEvent,
} from '../../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../../src/runtime/tool-loop'
import { armKillSwitch, type KillSwitch, readLabels } from './kill-switch'
import {
  openSideEffectSite,
  SIDE_EFFECT_TOOL_NAME,
  type SideEffectSite,
  sideEffectToolSpec,
} from './side-effect'

export const RUN_ID = 'conformance'
export const WORKER_NODES = ['surveyor', 'builder', 'verifier'] as const
export type WorkerNode = (typeof WORKER_NODES)[number]
export const ARTIFACT_KEY = 'artifact:conductor:final'
export const EXPECTED_OUT = {
  artifactKey: ARTIFACT_KEY,
  nodes: [...WORKER_NODES],
} as const

export function workerKey(node: WorkerNode): string {
  return `step:${node}`
}

export function workerReplacementKey(node: WorkerNode): string {
  return `step:${node}#2`
}

function offlineProfile(name: string, systemPrompt: string): AgentProfile {
  return {
    name,
    harness: 'cli-base',
    model: { provider: 'offline', default: `offline/${name}` },
    prompt: { systemPrompt },
  }
}

export function conformanceGraph(): AgentGraph {
  return {
    nodes: [
      {
        id: 'conductor',
        profile: {
          ...offlineProfile('conductor', 'Drive the workers to the committed artifact.'),
          tools: {
            agent_runtime_coordination_spawn_worker: true,
            agent_runtime_coordination_await_event: true,
            agent_runtime_coordination_submit_result: true,
            agent_runtime_coordination_commit_artifact: true,
          },
        },
      },
      { id: 'surveyor', profile: offlineProfile('surveyor', 'Survey the ground.') },
      { id: 'builder', profile: offlineProfile('builder', 'Build the thing.') },
      { id: 'verifier', profile: offlineProfile('verifier', 'Verify the thing.') },
    ],
    edges: WORKER_NODES.map((to) => ({
      kind: 'delegates' as const,
      from: 'conductor',
      to,
      directive: promptHandle('delegates/worker-brief/v1'),
    })),
    deliverable: {
      describe: 'the committed artifact receipt naming all three worker nodes',
      check: (out: unknown) => {
        const o = out as { artifactKey?: string; nodes?: unknown } | null
        return (
          o?.artifactKey === ARTIFACT_KEY &&
          Array.isArray(o.nodes) &&
          o.nodes.length === WORKER_NODES.length &&
          WORKER_NODES.every((n, i) => o.nodes?.[i] === n)
        )
      },
    },
    // Large on purpose: a resumed run re-reserves replacements for every in-doubt key WHILE the
    // killed attempts' uncertain reservations stay charged (the pool's sound conservative charge),
    // so the ceiling must cover ~2x the worker set plus the driver.
    budget: { maxIterations: 400, maxTokens: 10_000_000 },
  }
}

// ── The instrumented leaf seam ─────────────────────────────────────────────────

export interface LeafSeamOptions {
  readonly dir: string
  readonly phase: string
  readonly kill: KillSwitch
}

/** Which worker-node executions RAN in one phase — the "no step lost / no step repeated" proof. */
export function execLogPath(dir: string, phase: string): string {
  return `${dir}/exec-phase-${phase}.log`
}

export function readExecLog(dir: string, phase: string): string[] {
  try {
    return readFileSync(execLogPath(dir, phase), 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
  } catch {
    return []
  }
}

/**
 * A leaf executor per node with kill points at its three intra-step instants. `before` = admitted
 * but nothing computed; `mid` = computed, nothing committed; `after` = artifact ready, settlement
 * (blob + journal) not yet written. Settlements are only ever journaled after `execute()` returns,
 * so a kill at any of the three leaves the node uncommitted on disk. The runtime tag is `inline` —
 * the truthful tag for an in-process executor — which also carries the durability meaning: an
 * interrupted inline keyed spawn provably died with the process, so a resume retries it under its
 * own key (`resumed: "retried"`) rather than refusing it in-doubt.
 */
export function instrumentedLeafSeam(opts: LeafSeamOptions): MakeWorkerAgent {
  const { dir, phase, kill } = opts
  const attempts = new Map<string, number>()
  return (profile) => {
    const name = (profile.name ?? 'leaf') as WorkerNode
    const attempt = (attempts.get(name) ?? 0) + 1
    attempts.set(name, attempt)
    let artifact: ExecutorResult<unknown> | undefined
    const executor: Executor<unknown> = {
      runtime: 'inline',
      async execute() {
        appendFileSync(execLogPath(dir, phase), `${name}\n`)
        kill(`worker:${name}:before`)
        // Give the fire-and-forget `spawned` journal append a moment to fsync, so `mid`/`after`
        // kills land with the spawn durably on disk (the in-doubt resume path) rather than racing
        // the write. `before` deliberately stays on the admission side of that race.
        await delay(25)
        kill(`worker:${name}:mid`)
        await delay(25)
        kill(`worker:${name}:after`)
        artifact = {
          outRef: `conf:${name}:${attempt}`,
          out: { node: name, built: true },
          verdict: { valid: true, score: 1 },
          spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
        }
        return artifact
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: () => {
        if (!artifact) throw new Error(`leaf ${name}: no terminal artifact`)
        return artifact
      },
    }
    const spec: AgentSpec = { profile, harness: null, executor }
    return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
}

// ── The resume-aware planner brain ─────────────────────────────────────────────

interface NodePlanState {
  readonly node: WorkerNode
  key: string
  status: 'pending' | 'spawned' | 'done'
  workerId?: string
  unknownWorker?: boolean
  escalated: boolean
}

interface PendingCall {
  readonly id: string
  readonly tool: 'spawn_worker' | 'await_event' | 'commit' | 'submit'
  readonly node?: WorkerNode
}

export interface PlannerReport {
  readonly escalations: ReadonlyArray<{ node: string; from: string; to: string }>
  readonly turns: number
  readonly submitted: boolean
  readonly fatal?: string
}

/**
 * The conductor's deterministic plan: spawn every node (batched, under its semantic key), wait for
 * each spawned worker's settle (matched by worker id — never inferred from `idle`), commit the
 * artifact under the stable idempotency key, submit. Every decision folds ONLY from tool results
 * in the message history (correlated by tool_call_id), so the same planner drives a fresh run, a
 * resumed run whose keys completed (they come back `resumed: "completed"`), and a resumed run that
 * must escalate in-doubt keys (`error: "in-doubt"`) to replacements exactly the way the
 * spawn_worker contract tells a driver to.
 */
export class ConductorPlanner {
  private readonly nodes: NodePlanState[]
  private readonly pending: PendingCall[] = []
  private readonly seenResults = new Set<string>()
  private readonly escalations: Array<{ node: string; from: string; to: string }> = []
  private committed = false
  private submitted = false
  private fatal: string | undefined
  private idleStreak = 0
  private replayedCompletions = false
  private drainedIdle = false
  turns = 0

  constructor() {
    this.nodes = WORKER_NODES.map((node) => ({ node, key: workerKey(node), status: 'pending' }))
  }

  private fold(messages: ReadonlyArray<Record<string, unknown>>): void {
    const callById = new Map<string, PendingCall>()
    for (const m of messages) {
      const calls = m.tool_calls
      if (!Array.isArray(calls)) continue
      for (const tc of calls as Array<{ id?: string; function?: { name?: string } }>) {
        if (typeof tc.id !== 'string') continue
        const name = tc.function?.name ?? ''
        const known = this.pending.find((p) => p.id === tc.id)
        callById.set(
          tc.id,
          known ?? { id: tc.id, tool: name as PendingCall['tool'], node: undefined },
        )
      }
    }
    for (const m of messages) {
      if (m.role !== 'tool' || typeof m.tool_call_id !== 'string') continue
      if (this.seenResults.has(m.tool_call_id)) continue
      this.seenResults.add(m.tool_call_id)
      let r: Record<string, unknown>
      try {
        r = JSON.parse(String(m.content)) as Record<string, unknown>
      } catch {
        continue
      }
      const call = callById.get(m.tool_call_id)
      if (call === undefined) continue
      if (call.tool === 'spawn_worker' && call.node !== undefined) {
        this.foldSpawn(call.node, r)
      } else if (call.tool === 'await_event') {
        this.foldAwait(r)
      } else if (call.tool === 'commit') {
        this.committed = true
      } else if (call.tool === 'submit') {
        if (r.accepted === true) this.submitted = true
        else if (this.fatal === undefined) {
          this.fatal = `submit_result refused: ${JSON.stringify(r).slice(0, 200)}`
        }
      }
    }
  }

  private foldSpawn(node: WorkerNode, r: Record<string, unknown>): void {
    const state = this.nodes.find((n) => n.node === node)
    if (state === undefined) return
    const error = typeof r.error === 'string' ? r.error : undefined
    if (error !== undefined) {
      if (error.includes('in-doubt')) {
        if (state.escalated) {
          this.fatal ??= `spawn of ${node} refused in-doubt twice (${state.key})`
          return
        }
        const from = state.key
        state.key = workerReplacementKey(node)
        state.escalated = true
        state.status = 'pending'
        this.escalations.push({ node, from, to: state.key })
        return
      }
      if (error.includes('duplicate-key')) {
        // The worker is ALREADY LIVE under this key — a resumed run's recovery adopted it before
        // this process drove anything. Wait for its settle like any live worker.
        state.status = 'spawned'
        state.unknownWorker = true
        return
      }
      this.fatal ??= `spawn of ${node} refused: ${error}`
      return
    }
    if (r.resumed === 'completed') {
      state.status = 'done'
      // The resumed ledger re-publishes committed settlements as waiting events; the driver must
      // drain them (await until idle) before submit_result will accept (`open-work` refusal).
      this.replayedCompletions = true
      return
    }
    if (typeof r.workerId === 'string') {
      state.workerId = r.workerId
      state.status = 'spawned'
      return
    }
    this.fatal ??= `spawn of ${node} returned neither a worker nor a refusal: ${JSON.stringify(r).slice(0, 200)}`
  }

  private foldAwait(r: Record<string, unknown>): void {
    if (r.type === 'settled') {
      this.idleStreak = 0
      const id = typeof r.settled === 'string' ? r.settled : undefined
      if (r.status === 'done') {
        const byId = this.nodes.find((n) => n.workerId !== undefined && n.workerId === id)
        if (byId !== undefined) {
          byId.status = 'done'
          return
        }
        // A settle for a worker this process never learned the id of (replayed from the prior
        // process, or recovered by the resume before the driver drove anything — the
        // `duplicate-key` adoption). Charge it to the oldest spawned node with an unknown worker.
        const unknown = this.nodes.find((n) => n.status === 'spawned' && n.unknownWorker === true)
        if (unknown !== undefined) unknown.status = 'done'
      } else if (this.fatal === undefined) {
        this.fatal = `worker ${id ?? '?'} settled down: ${JSON.stringify(r).slice(0, 200)}`
      }
      return
    }
    if (r.idle === true || r.pending === true) {
      const live = Array.isArray(r.live) ? (r.live as unknown[]).length : 0
      if (r.pending === true && live > 0) {
        this.idleStreak = 0
        return
      }
      // `idle` can fire while an executor is still STARTING UP (not yet registered live), so it is
      // never read as "settled" — only as a signal to re-ask, bounded by idleStreak. During a
      // post-resume drain it is the completion signal: nothing waiting, nothing live.
      this.idleStreak += 1
      this.drainedIdle = true
      if (this.idleStreak >= 8) {
        this.fatal ??= 'await_event repeatedly idle while spawned workers never settled'
      }
      return
    }
  }

  nextTurn(messages: ReadonlyArray<Record<string, unknown>>): {
    content?: string
    toolCalls?: Array<{ id: string; name: string; arguments: string }>
  } {
    this.turns += 1
    this.fold(messages)
    if (this.fatal !== undefined) return { content: `planner-fatal: ${this.fatal}` }
    const pending = this.nodes.filter((n) => n.status === 'pending')
    if (pending.length > 0) {
      const turn = this.turns
      const calls = pending.map((p, j) => {
        const id = `call-${turn}-${j}`
        this.pending.push({ id, tool: 'spawn_worker', node: p.node })
        return {
          id,
          name: 'spawn_worker',
          arguments: JSON.stringify({
            profile: { name: p.node },
            task: `Perform the ${p.node} step of the conformance plan.`,
            label: p.node,
            key: p.key,
          }),
        }
      })
      return { toolCalls: calls }
    }
    if (this.nodes.some((n) => n.status === 'spawned')) {
      const id = `call-${this.turns}-0`
      this.pending.push({ id, tool: 'await_event' })
      return {
        toolCalls: [
          {
            id,
            name: 'await_event',
            arguments: JSON.stringify({ kinds: ['settled'] }),
          },
        ],
      }
    }
    // A resumed run that folded replayed completions must DRAIN the re-published settles before
    // submitting — the completion gate refuses `open-work` while events wait unread.
    if (this.replayedCompletions && !this.drainedIdle) {
      const id = `call-${this.turns}-0`
      this.pending.push({ id, tool: 'await_event' })
      return {
        toolCalls: [
          {
            id,
            name: 'await_event',
            arguments: JSON.stringify({}),
          },
        ],
      }
    }
    if (!this.committed) {
      const id = `call-${this.turns}-0`
      this.pending.push({ id, tool: 'commit' })
      return {
        toolCalls: [
          {
            id,
            name: SIDE_EFFECT_TOOL_NAME,
            arguments: JSON.stringify({
              idempotencyKey: ARTIFACT_KEY,
              payload: { nodes: [...WORKER_NODES] },
            }),
          },
        ],
      }
    }
    if (!this.submitted) {
      const id = `call-${this.turns}-0`
      this.pending.push({ id, tool: 'submit' })
      return {
        toolCalls: [
          {
            id,
            name: 'submit_result',
            arguments: JSON.stringify({ result: EXPECTED_OUT }),
          },
        ],
      }
    }
    return { content: 'done' }
  }

  report(): PlannerReport {
    return {
      escalations: this.escalations,
      turns: this.turns,
      submitted: this.submitted,
      ...(this.fatal === undefined ? {} : { fatal: this.fatal }),
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── The child-phase runner ─────────────────────────────────────────────────────

export interface GraphChildReport {
  readonly phase: string
  readonly kind: string
  readonly out: unknown
  readonly exec: string[]
  readonly escalations: ReadonlyArray<{ node: string; from: string; to: string }>
  readonly committedEffects: string[]
  readonly effectInvocations: Array<{ key: string; at: string }>
  readonly driverTurns: number
  readonly fatal?: string
}

/** One phase of the conformance graph run, in THIS process. Phase 1 may SIGKILL itself at
 * `killAt`; phase 2 (killAt undefined) prints its JSON report on stdout. */
export async function runGraphPhase(dir: string, phase: string, killAt?: string): Promise<void> {
  const kill = armKillSwitch({
    ...(killAt === undefined ? {} : { killAt }),
    labelsFile: `${dir}/labels-phase-${phase}.log`,
    killedFile: `${dir}/killed.log`,
  })
  const site: SideEffectSite = openSideEffectSite(dir)
  const planner = new ConductorPlanner()
  let brainCalls = 0
  const brain: ToolLoopChat = async (messages) => {
    brainCalls += 1
    kill(`driver:turn:${brainCalls}:before`)
    const turn = planner.nextTurn(messages as ReadonlyArray<Record<string, unknown>>)
    kill(`driver:turn:${brainCalls}:after`)
    return turn
  }
  const result = await runGraph(conformanceGraph(), {
    runId: RUN_ID,
    runDir: dir,
    workerSlots: 3,
    maxTurns: 24,
    perWorker: { maxIterations: 60, maxTokens: 500_000 },
    brain,
    makeLeafAgent: instrumentedLeafSeam({ dir, phase, kill }),
    extraTools: [sideEffectToolSpec()],
    executeExtraTool: async (name, args) => {
      if (name !== SIDE_EFFECT_TOOL_NAME) return null
      kill('tool:commit:before')
      const receipt = site.commit(String(args.idempotencyKey), args.payload)
      kill('tool:commit:after-effect')
      return JSON.stringify(receipt)
    },
  })
  const report: GraphChildReport = {
    phase,
    kind: result.result.kind,
    ...(result.result.kind === 'winner' ? { out: result.result.out } : { out: null }),
    exec: readExecLog(dir, phase),
    escalations: planner.report().escalations,
    committedEffects: site.committedKeys(),
    effectInvocations: site.invocations(),
    driverTurns: planner.report().turns,
    ...('fatal' in planner.report() ? { fatal: planner.report().fatal } : {}),
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

// ── The spawn-journal audit (the 2026-08-11 defect signature) ─────────────────

export interface JournalAudit {
  readonly rootSpawned: number
  readonly rootMaterialized: number
  readonly rootBoundAttemptIds: string[]
  readonly settledDoneByLabel: Record<string, number>
  /** Every DISTINCT `SpawnOpts.key` each node label spawned under, across all processes — the
   * "same key never reminted" evidence: a retry may spawn a label twice, but always under one key. */
  readonly spawnedKeysByLabel: Record<string, string[]>
  readonly duplicateCursorSeqs: number[]
  readonly edgeEvents: number
  readonly events: SpawnEvent[]
}

/**
 * Read the durable tree a (possibly killed-and-resumed) run left on disk and surface the counts
 * the resume contract fixes: ONE root `spawned`, at most ONE root `materialized`, root
 * `execution-bound` receipts under DISTINCT attempt ids, unique cursor seqs, and exactly one
 * done-settlement per worker node label. The 2026-08-11 autopsy (runtime-glm-recursion-smoke,
 * fixed in 0.132.7) was this audit's `duplicate` arm firing in the wild.
 */
export async function auditSpawnJournal(dir: string, runId: string): Promise<JournalAudit> {
  const journal = new FileSpawnJournal(`${dir}/spawn-journal.jsonl`)
  const events = (await journal.loadTree(runId)) ?? []
  return projectJournalAudit(events, runId)
}

/** Audit a run whose durable tree lives in a SQL spawn journal (see `sql-child.ts`). */
export async function auditSpawnJournalAt(
  dir: string,
  runId: string,
  sqlitePath: string,
): Promise<JournalAudit> {
  const { DatabaseSync } = await import('node:sqlite')
  const { SqlSpawnJournal } = await import('../../../src/durable/spawn-journal-sql')
  const db = new DatabaseSync(sqlitePath)
  try {
    const journal = new SqlSpawnJournal({
      async exec(sql, params = []) {
        const res = db.prepare(sql).run(...(params as never[]))
        return { rowsAffected: Number(res?.changes ?? 0) }
      },
      async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<TRow[]> {
        return db.prepare(sql).all(...(params as never[])) as TRow[]
      },
    })
    const events = (await journal.loadTree(runId)) ?? []
    return projectJournalAudit(events, runId)
  } finally {
    db.close()
  }
}

function projectJournalAudit(events: SpawnEvent[], runId: string): JournalAudit {
  const labelById = new Map<string, string>()
  for (const e of events) {
    if (e.kind === 'spawned' && e.parent !== undefined) labelById.set(e.id, e.label)
  }
  const settledDoneByLabel: Record<string, number> = {}
  const spawnedKeysByLabel: Record<string, string[]> = {}
  const cursors: number[] = []
  for (const e of events) {
    if (e.kind === 'spawned' && e.parent !== undefined && e.key !== undefined) {
      const keys = (spawnedKeysByLabel[e.label] ??= [])
      if (!keys.includes(e.key)) keys.push(e.key)
    }
    if (e.kind === 'settled' || e.kind === 'cancelled') {
      cursors.push(e.seq)
      if (e.kind === 'settled' && e.status === 'done') {
        const label = labelById.get(e.id) ?? e.id
        settledDoneByLabel[label] = (settledDoneByLabel[label] ?? 0) + 1
      }
    }
  }
  const dup = cursors.filter((s, i) => cursors.indexOf(s) !== i)
  return {
    rootSpawned: events.filter((e) => e.kind === 'spawned' && e.parent === undefined).length,
    rootMaterialized: events.filter((e) => e.kind === 'materialized' && e.id === runId).length,
    rootBoundAttemptIds: events
      .filter((e) => e.kind === 'execution-bound' && e.id === runId)
      .map((e) => (e.kind === 'execution-bound' ? e.binding.attemptId : '')),
    settledDoneByLabel,
    spawnedKeysByLabel,
    duplicateCursorSeqs: [...new Set(dup)],
    edgeEvents: events.filter((e) => e.kind === 'edge').length,
    events,
  }
}

/** Ordered kill labels a full no-kill run passes through — the case matrix. */
export function referenceLabels(dir: string, phase: string): string[] {
  return readLabels(`${dir}/labels-phase-${phase}.log`)
}
