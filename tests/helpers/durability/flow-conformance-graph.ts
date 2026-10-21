/**
 * The flow-graph kill-and-resume conformance graph: no brain, no root node. Runtime starts the
 * entry and walks the graph's own edges, so a resumed run must be replayed from the spawn journal
 * by the route walker itself.
 *
 *   entry → surveyor
 *   surveyor ─maps /areas (2 items)→ scout ×2 ─join→ collate      (surveyor → builder, joined)
 *   collate → builder → review
 *   review → builder   when /verdict equals 'concerns'  (maxTraversals 1, continuity resume)
 *   review → gate ship (approve | reject)
 *   ship: approve → verifier (with review as evidence), reject → stop
 *
 * Every leaf is deterministic in its task, so the reference run and every resumed run settle the
 * same results: the first build draws `concerns`, the authored repair (the one second traversal of
 * builder and review) draws `approve`, and the gate reads its choice from `decision.json` in the
 * run directory, appending one line per call to `gate-calls.jsonl`.
 *
 * Kill labels name each execution by a tag that is stable across processes (`scout:north`,
 * `builder:2`): `worker:<tag>:mid` is a mid-step instant, with the spawn on disk and nothing
 * settled; `settled:<tag>` is a settle boundary, right after the done settlement is journaled;
 * `gate:ship:asked` is inside the caller's decision, before it is journaled.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { superviseGraphPursuit } from '../../../src/durable/supervise-pursuit'
import type { MakeWorkerAgent } from '../../../src/mcp/tools/coordination-contracts'
import type { GateRequest } from '../../../src/mcp/tools/coordination-route-contracts'
import type { AgentGraph } from '../../../src/runtime/supervise/graph'
import { promptHandle } from '../../../src/runtime/supervise/prompt-registry'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
} from '../../../src/runtime/supervise/types'
import { armKillSwitch, type KillSwitch, readLabels } from './kill-switch'

export const FLOW_RUN_ID = 'flow-conformance'
export const AREAS = ['north', 'south'] as const
/** Every execution of the reference run, by tag: each settles done exactly once. */
export const FLOW_TAGS = [
  'surveyor',
  'scout:north',
  'scout:south',
  'collate',
  'builder:1',
  'review:1',
  'builder:2',
  'review:2',
  'verifier',
] as const
/** Done settles per journal label: map items are labelled `<node>#<index>`, and builder and
 *  review settle twice only because of the authored repair. */
export const FLOW_SETTLES_BY_LABEL = {
  surveyor: 1,
  'scout#0': 1,
  'scout#1': 1,
  collate: 1,
  builder: 2,
  review: 2,
  verifier: 1,
}
export const FLOW_OUT = { verifier: { verified: true, build: 2 } }

const brief = promptHandle('delegates/worker-brief/v1')

function offlineProfile(name: string): AgentProfile {
  return {
    name,
    harness: 'cli-base',
    model: { provider: 'offline', default: `offline/${name}` },
    prompt: { systemPrompt: `You are the ${name} of the flow conformance graph.` },
  }
}

export function flowConformanceGraph(): AgentGraph {
  return {
    nodes: ['surveyor', 'scout', 'collate', 'builder', 'review', 'verifier'].map((id) => ({
      id,
      profile: offlineProfile(id),
    })),
    entry: [{ node: 'surveyor', task: 'Survey the ground and name the areas to scout.' }],
    gates: [{ id: 'ship', question: 'Ship the reviewed build?', choices: ['approve', 'reject'] }],
    edges: [
      {
        kind: 'maps',
        from: 'surveyor',
        pointer: '/areas',
        to: 'scout',
        join: 'collate',
        directive: brief,
        maxItems: 4,
        concurrency: 2,
        onItemFailure: 'all-or-refuse',
      },
      { kind: 'routes', from: 'collate', to: 'builder', directive: brief },
      { kind: 'routes', from: 'builder', to: 'review', directive: brief },
      {
        kind: 'routes',
        from: 'review',
        to: 'builder',
        when: { pointer: '/verdict', equals: 'concerns' },
        maxTraversals: 1,
        continuity: 'resume',
        directive: brief,
      },
      { kind: 'routes', from: 'review', to: 'ship', directive: brief },
      {
        kind: 'routes',
        from: 'ship',
        to: 'verifier',
        when: { pointer: '/choice', equals: 'approve' },
        evidence: ['review'],
        directive: brief,
      },
      {
        kind: 'routes',
        from: 'ship',
        to: { stop: 'rejected at the ship gate' },
        when: { pointer: '/choice', equals: 'reject' },
        directive: brief,
      },
    ],
    deliverable: {
      describe: 'the verified second build',
      check: (out: unknown) =>
        (out as { verifier?: { verified?: unknown; build?: unknown } } | null)?.verifier
          ?.verified === true,
    },
    budget: { maxIterations: 400, maxTokens: 10_000_000 },
  }
}

interface RouteTask {
  readonly from: { readonly node: string; readonly result: Record<string, unknown> }
}

/** The stable tag and the settle of one execution, both read from its node and task alone. */
function leafStep(name: string, task: unknown): { readonly tag: string; readonly out: unknown } {
  const from = (task as RouteTask | undefined)?.from
  switch (name) {
    case 'surveyor':
      return { tag: name, out: { areas: [...AREAS] } }
    case 'scout':
      return { tag: `scout:${String(task)}`, out: { area: task, scouted: true } }
    case 'collate': {
      const results = (task as { results: Array<{ result: { area: string } }> }).results
      return { tag: name, out: { collated: results.map((entry) => entry.result.area) } }
    }
    case 'builder': {
      const build = from?.node === 'review' ? 2 : 1
      return { tag: `builder:${build}`, out: { build } }
    }
    case 'review': {
      const build = from?.result.build as number
      return {
        tag: `review:${build}`,
        out: { build, verdict: build === 1 ? 'concerns' : 'approve' },
      }
    }
    case 'verifier': {
      // The gate's decision fired this edge; the build it approved rides as evidence.
      const review = (task as { evidence: { review: { build: number } } }).evidence.review
      return { tag: name, out: { verified: true, build: review.build } }
    }
    default:
      throw new Error(`flow conformance graph has no node '${name}'`)
  }
}

export function flowExecLogPath(dir: string, phase: string): string {
  return `${dir}/flow-exec-phase-${phase}.log`
}

/** One execution that ran: its stable tag and the spawn key it ran under. */
export interface FlowExec {
  readonly tag: string
  readonly key: string
}

/** A leaf per node whose executions log their tag and key and die at the armed mid-step instant.
 *  `tagByKey` records the tag of every spawn the factory prepares, a committed one included. */
function flowLeafSeam(
  dir: string,
  phase: string,
  kill: KillSwitch,
  tagByKey: Map<string, string>,
): MakeWorkerAgent {
  return (profile, context) => {
    const name = profile.name ?? 'leaf'
    const step = leafStep(name, context?.task)
    const key = context?.key ?? ''
    tagByKey.set(key, step.tag)
    let artifact: ExecutorResult<unknown> | undefined
    const executor: Executor<unknown> = {
      runtime: 'inline',
      async execute() {
        appendFileSync(
          flowExecLogPath(dir, phase),
          `${JSON.stringify({ tag: step.tag, key } satisfies FlowExec)}\n`,
        )
        // Let the fire-and-forget `spawned` append reach the disk, so a mid-step kill leaves the
        // spawn journaled and the step uncommitted.
        await delay(25)
        kill(`worker:${step.tag}:mid`)
        await delay(5)
        artifact = {
          outRef: `flow:${step.tag}`,
          out: step.out,
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

export interface GateCall {
  readonly phase: string
  readonly visit: number
}

export function readGateCalls(dir: string): GateCall[] {
  return readLabels(`${dir}/gate-calls.jsonl`).map((line) => JSON.parse(line) as GateCall)
}

export function readFlowExecLog(dir: string, phase: string): FlowExec[] {
  return readLabels(flowExecLogPath(dir, phase)).map((line) => JSON.parse(line) as FlowExec)
}

export interface FlowChildReport {
  readonly phase: string
  readonly kind: string
  readonly out: unknown
  readonly stopped?: string
  readonly exec: FlowExec[]
  /** Gate decision rows on this process's result ledger, replayed ones included. */
  readonly decisionRows: number
}

/** One phase of the flow conformance run, in THIS process. Phase 1 may SIGKILL itself at
 *  `killAt`; every phase that returns prints its JSON report on stdout. */
export async function runFlowGraphPhase(
  dir: string,
  phase: string,
  killAt?: string,
): Promise<void> {
  const kill = armKillSwitch({
    ...(killAt === undefined ? {} : { killAt }),
    labelsFile: `${dir}/labels-phase-${phase}.log`,
    killedFile: `${dir}/killed.log`,
  })
  const decisionFile = `${dir}/decision.json`
  if (!existsSync(decisionFile)) {
    writeFileSync(decisionFile, JSON.stringify({ kind: 'choose', choice: 'approve', by: 'drew' }))
  }
  const tagByKey = new Map<string, string>()
  const tagByChild = new Map<string, string>()
  const { result } = await superviseGraphPursuit(flowConformanceGraph(), {
    pursuitId: 'flow-graph-conformance',
    runId: FLOW_RUN_ID,
    runDir: dir,
    workerSlots: 3,
    perWorker: { maxIterations: 60, maxTokens: 500_000 },
    makeLeafAgent: flowLeafSeam(dir, phase, kill, tagByKey),
    decideGate: async (request: GateRequest) => {
      appendFileSync(
        `${dir}/gate-calls.jsonl`,
        `${JSON.stringify({ phase, visit: request.visit } satisfies GateCall)}\n`,
      )
      kill(`gate:${request.gate}:asked`)
      return JSON.parse(readFileSync(decisionFile, 'utf8'))
    },
    hooks: {
      // The child hook fires once the done settlement is journaled: the settle boundary.
      onEvent: (event) => {
        if (event.phase !== 'after') return
        const payload = event.payload as
          | { childId?: unknown; key?: unknown; status?: unknown }
          | undefined
        const child = String(payload?.childId)
        const tag = tagByKey.get(String(payload?.key))
        if (event.target === 'agent.spawn' && tag !== undefined) tagByChild.set(child, tag)
        if (event.target !== 'agent.child' || payload?.status !== 'done') return
        if (tagByChild.has(child)) kill(`settled:${tagByChild.get(child)}`)
      },
    },
  })
  const report: FlowChildReport = {
    phase,
    kind: result.result.kind,
    out: result.result.kind === 'winner' ? result.result.out : null,
    ...(result.stopped === undefined ? {} : { stopped: result.stopped.reason }),
    exec: readFlowExecLog(dir, phase),
    decisionRows: result.ledger.filter((row) => row.gate !== undefined).length,
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
