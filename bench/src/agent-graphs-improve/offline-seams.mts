/**
 * Offline execution inputs for the agent-graphs skill improvement runner, copied from
 * `examples/graphs/shared.ts` (the same two seams the kernel's own graph tests use), with the
 * imports rewritten to the worktree's own src so the bench runs against the in-repo kernel
 * without a dist build:
 *
 *   • `scriptedBrain` — a `ToolLoopChat` that plays a fixed sequence of driver turns.
 *   • `leafSeam` — a `MakeWorkerAgent` whose leaf executors settle instantly.
 *
 * Only the leaf `act` and the driver brain are scripted; the graph machinery around them
 * (node pinning, directive delivery, edge ledger, journal twin) is the real shipped path.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type Agent,
  type AgentSpec,
  createPushTraceSource,
  type Executor,
  type ExecutorResult,
  type MakeWorkerAgent,
  type ToolLoopChat,
  type TraceSource,
} from '../../../src/runtime/index.ts'

// ── The scripted driver brain ──────────────────────────────────────────────────

/** A scripted driver turn in the easy-to-write form (parsed tool args). */
export interface ScriptedTurn {
  content?: string
  toolCalls?: Array<{ id?: string; name: string; arguments: Record<string, unknown> }>
}

/** Build a scripted `ToolLoopChat` brain from a fixed turn sequence. */
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
  /** Expose a live tool-trace source so settle-time analysts have evidence to read. */
  withTrace?: boolean
  /** Per-spawn scripts for this node (last entry repeats). Omit for a generic valid settle. */
  shots?: ReadonlyArray<LeafShot>
}

/** A leaf-agent factory keyed by node name; every spawned profile is captured into `received`. */
export function leafSeam(
  received: AgentProfile[],
  optsByNode: Record<string, LeafOptions> = {},
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
      ...(trace ? { traceSource: (): TraceSource => trace.source } : {}),
      async execute() {
        if (trace) {
          trace.record({ toolName: 'write_file', args: { path: `${name}.ts` }, status: 'ok' })
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
