/**
 * BenchmarkAdapter — the seam every external benchmark implements so the
 * agent-runtime loop can be A/B'd (blind vs steering vs steering+memory) against
 * a REAL, DETERMINISTIC judge. The worker produces an `artifact` (a patch, a
 * command transcript, a final state); the benchmark's own harness scores it.
 *
 * The point: no self-authored judge, no invented score noise. The number comes
 * from the benchmark's published evaluation harness.
 */

import type { OutputAdapter } from '@tangle-network/agent-runtime/loops'

export interface BenchTask {
  /** Stable benchmark instance id. */
  id: string
  /** The task statement handed to the worker agent. */
  prompt: string
  split?: string
  /** Benchmark-specific fields the worker/judge need (repo, base_commit, gold, …). */
  metadata?: Record<string, unknown>
}

export interface BenchScore {
  /** Did the deterministic judge pass (tests resolved / state correct)? */
  resolved: boolean
  /** 0..1 — 1 = fully resolved; partial credit where the harness supports it. */
  score: number
  detail?: string
}

export interface LoadOptions {
  limit?: number
  split?: string
  ids?: string[]
}

export interface BenchmarkAdapter {
  readonly name: string
  /** Throw with actionable guidance when the harness/judge isn't installed/runnable. */
  preflight(): Promise<void>
  loadTasks(opts?: LoadOptions): Promise<BenchTask[]>
  /** DETERMINISTIC judge: score the worker's produced artifact for a task. */
  judge(task: BenchTask, artifact: string): Promise<BenchScore>
  /** Gold/oracle artifact — lets us self-verify the judge before spending model tokens. */
  goldArtifact(task: BenchTask): Promise<string | undefined>
  /** How to extract the judged artifact from a run's event stream. Optional —
   *  defaults to the agent's final answer text (the research/QA case). SWE sets
   *  it to a patch parser. This is `benchmark = adapter` owning its deliverable,
   *  so the one flow (`runExperiment`) needs no per-benchmark branching. */
  output?: OutputAdapter<string>
  /** Benchmark-owned worker leaf. Set when the benchmark's native protocol IS the
   *  worker (e.g. AppWorld's interactive ReAct episode runs inside the engine,
   *  not as a chat completion) — the experiment uses this instead of the
   *  BACKEND-selected client; the steer still flows through the per-round prompt.
   *  Typed loosely to avoid a runtime import cycle; the harness casts it. */
  leafClient?: (cfg: { model: string; routerBaseUrl: string; routerKey: string }) => unknown
}
