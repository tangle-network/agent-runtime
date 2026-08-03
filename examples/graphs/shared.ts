/**
 * Shared OFFLINE seams for the graph examples — the same two seams the kernel's own graph tests
 * use (`tests/kernel/graph.test.ts`):
 *
 *   • `scriptedBrain` — a `ToolLoopChat` that plays a fixed sequence of driver turns, so the
 *     driver's tool calls (spawn / steer / await) are deterministic and cost $0.
 *   • `leafSeam` — a `MakeWorkerAgent` whose leaf executors settle instantly with configurable
 *     per-shot outputs and verdicts, optionally block until a steer arrives (`awaitSteer`), and
 *     optionally expose a live tool trace (`withTrace` / `storm`) for analysts and detectors.
 *
 * Only the leaf `act` and the driver brain are scripted. The graph machinery AROUND them — node
 * pinning, directive delivery, the edge ledger, the journal twin — is the real shipped path
 * (`runGraph` → `supervise()`), which is what makes every example an offline proof, not a mock
 * of the system.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type Agent,
  type AgentSpec,
  createPushTraceSource,
  type Executor,
  type ExecutorResult,
  type GraphResult,
  type MakeWorkerAgent,
  type ToolLoopChat,
  type TraceSource,
} from '@tangle-network/agent-runtime/kernel'

// ── The scripted driver brain ──────────────────────────────────────────────────

/** A scripted driver turn in the easy-to-write form (parsed tool args). */
export interface ScriptedTurn {
  content?: string
  toolCalls?: Array<{ id?: string; name: string; arguments: Record<string, unknown> }>
}

/** Build a scripted `ToolLoopChat` brain from a fixed turn sequence: converts parsed tool args to
 *  the raw-string form the canonical tool loop parses and advances through the turns (repeating
 *  the last). */
export function scriptedBrain(turns: ScriptedTurn[]): ToolLoopChat {
  let i = 0
  return async () => {
    const turn = turns[Math.min(i, turns.length - 1)] ?? {}
    i += 1
    return {
      ...(turn.content !== undefined ? { content: turn.content } : {}),
      toolCalls: (turn.toolCalls ?? []).map((tc, j) => ({
        id: tc.id ?? `call-${i}-${j}`,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
    }
  }
}

// ── The leaf seam ──────────────────────────────────────────────────────────────

/** What one settle of a node should produce (per spawn ordinal; the last entry repeats). */
export interface LeafShot {
  out: unknown
  valid: boolean
  score?: number
}

export interface LeafOptions {
  /** Block settlement until a deliver() arrives — so a steer can reach a LIVE worker. */
  awaitSteer?: boolean
  /** Expose a live tool-trace source, so settle-time analysts and online detectors have
   *  evidence to read. */
  withTrace?: boolean
  /** Record this many IDENTICAL failing tool calls into the live trace at execute start — the
   *  stuck-loop storm the online detector panel fires on. Implies nothing without `withTrace`. */
  storm?: number
  /** Per-spawn scripts for this node: spawn k settles with `shots[k]` (last entry repeats).
   *  Omit for a generic valid settle. */
  shots?: ReadonlyArray<LeafShot>
}

export interface LeafSeamHooks {
  /** Called with each spawned node's live trace source (when `withTrace`), so an example can
   *  wire `watchTrace` over it — the online-watchdog seam. */
  onTraceSource?: (nodeId: string, source: TraceSource) => void
}

/** A leaf-agent factory keyed by node name. Every spawned profile (what the graph pinned + the
 *  edge directive) is captured into `received` for inspection. */
export function leafSeam(
  received: AgentProfile[],
  optsByNode: Record<string, LeafOptions> = {},
  hooks: LeafSeamHooks = {},
): MakeWorkerAgent {
  const attempts = new Map<string, number>()
  return (profile) => {
    received.push(profile)
    const name = profile.name ?? 'leaf'
    const opts = optsByNode[name] ?? {}
    const attempt = (attempts.get(name) ?? 0) + 1
    attempts.set(name, attempt)
    const shot = opts.shots?.[Math.min(attempt - 1, opts.shots.length - 1)]
    let release: (() => void) | undefined
    const gate = opts.awaitSteer
      ? new Promise<void>((resolve) => {
          release = resolve
        })
      : undefined
    const trace = opts.withTrace
      ? createPushTraceSource({ runId: `leaf-${name}-${attempt}` })
      : undefined
    if (trace) hooks.onTraceSource?.(name, trace.source)
    let artifact: ExecutorResult<unknown> | undefined
    const ex: Executor<unknown> = {
      runtime: 'router',
      ...(opts.awaitSteer
        ? {
            deliver: () => {
              release?.()
              return true
            },
          }
        : {}),
      ...(trace ? { traceSource: () => trace.source } : {}),
      async execute() {
        if (trace) {
          trace.record({ toolName: 'write_file', args: { path: `${name}.ts` }, status: 'ok' })
          for (let i = 0; i < (opts.storm ?? 0); i += 1) {
            trace.record({
              toolName: 'bash',
              args: { cmd: 'pnpm test' },
              status: 'error',
              error: '1 failing',
            })
          }
        }
        if (gate) await gate
        const valid = shot ? shot.valid : true
        artifact = {
          outRef: `w:${name}:${attempt}`,
          out: shot ? shot.out : { built: name, attempt },
          verdict: { valid, score: shot?.score ?? (valid ? 1 : 0) },
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
    const spec: AgentSpec = { profile, harness: null, executor: ex }
    return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
}

// ── The proof artifact ─────────────────────────────────────────────────────────

/** Print the EDGE LEDGER — every traversal, in occurrence order. This is each example's proof:
 *  who spawned whom, what crossed each edge, and what actually got delivered. */
export function printLedger(tag: string, res: GraphResult): void {
  console.log(`\n${tag} — result: ${res.result.kind} (runId: ${res.runId})`)
  if (res.result.kind === 'winner') console.log(`winner out: ${JSON.stringify(res.result.out)}`)
  console.log('EDGE LEDGER:')
  for (const row of res.ledger) {
    const worker = row.workerId !== undefined ? ` -> ${row.workerId}` : ''
    const reason = row.reason !== undefined ? `  (${row.reason})` : ''
    console.log(`  #${row.traversal} ${row.edge} [${row.outcome}] ${row.bytes}B${worker}${reason}`)
  }
  if (res.exhaustedEdges.length > 0) {
    console.log(`exhausted edges: ${res.exhaustedEdges.join(', ')}`)
  }
}
