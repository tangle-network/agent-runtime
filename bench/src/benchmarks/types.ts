/**
 * BenchmarkAdapter — the seam every external benchmark implements so the
 * agent-runtime loop can be A/B'd (blind vs steering vs steering+memory) against
 * a REAL, DETERMINISTIC judge. The worker produces an `artifact` (a patch, a
 * command transcript, a final state); the benchmark's own harness scores it.
 *
 * The point: no self-authored judge, no invented score noise. The number comes
 * from the benchmark's published evaluation harness.
 */

import type { OutputAdapter } from '@tangle-network/agent-runtime/kernel'

export interface BenchTask {
  /** Stable benchmark instance id. */
  id: string
  /** The task statement handed to the worker agent. */
  prompt: string
  split?: string
  /** Benchmark-specific fields the worker/judge need (repo, base_commit, gold, …). */
  metadata?: Record<string, unknown>
}

export interface JudgeArtifactFileReceipt {
  /** POSIX path relative to the capture directory. */
  path: string
  /** Exact byte length of the retained file or symbolic-link target. */
  byteLength: number
  /** SHA-256 over the retained file bytes or UTF-8 symbolic-link target. */
  sha256: `sha256:${string}`
  kind: 'file' | 'symlink'
}

/** Durable evidence written before a staged evaluator's temporary directory is removed. */
export interface JudgeArtifactReceipt {
  schema: 'agent-bench/judge-artifacts/v1'
  /** Absolute directory containing `evaluator/`, `process/`, and `receipt.json`. */
  directory: string
  /** Exact copy of the evaluator working directory. */
  evaluatorDirectory: string
  manifestPath: string
  evaluatorSucceeded: boolean
  files: JudgeArtifactFileReceipt[]
  fileCount: number
  byteLength: number
  /** SHA-256 over every sorted path, kind, byte length, and content hash. */
  treeSha256: `sha256:${string}`
}

export interface BenchScore {
  /** Did the deterministic judge pass (tests resolved / state correct)? */
  resolved: boolean
  /** 0..1 — 1 = fully resolved; partial credit where the harness supports it. */
  score: number
  detail?: string
  /** Present only when the caller explicitly requested durable judge evidence. */
  judgeArtifacts?: JudgeArtifactReceipt
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
   *  so the gate runner (`runGate` / `runBenchmark`) needs no
   *  per-benchmark branching. */
  output?: OutputAdapter<string>
  /** Post-shot deliverable extraction from the box FILESYSTEM, not the event stream.
   *  When set, the shot runner execs `command` in the STILL-ALIVE box after the agent
   *  turn drains and uses its stdout as the judged artifact — the durable way to capture
   *  a git diff of the agent's in-box edits (standard SWE-bench practice: SWE-agent /
   *  OpenHands read the diff from repo STATE), instead of hoping the model printed a
   *  fenced diff in its reply. Empty stdout ⇒ the runner falls back to `output` (the
   *  event-stream parse). `cwd` defaults to the box root. */
  boxExtract?(task: BenchTask): { command: string; cwd?: string }
  /** Optional workspace pre-stage run in the box BEFORE the agent shot (same
   *  session as `boxExtract`). For repo-state benchmarks (SWE-bench) this clones
   *  the instance repo at `base_commit` into a fixed path so the agent only edits
   *  — the harness owns the checkout, not the (stochastic) model. A non-zero exit
   *  fails the shot loud rather than letting the agent run against an empty box. */
  boxSetup?(task: BenchTask): { command: string; cwd?: string }
  /** Benchmark-owned worker leaf. Set when the benchmark's native protocol IS the
   *  worker (e.g. AppWorld's interactive ReAct episode runs inside the engine,
   *  not as a chat completion) — the experiment uses this instead of the
   *  BACKEND-selected client; the steer still flows through the per-round prompt.
   *  Typed loosely to avoid a runtime import cycle; the harness casts it. */
  leafClient?: (cfg: { model: string; routerBaseUrl: string; routerKey: string }) => unknown
}
