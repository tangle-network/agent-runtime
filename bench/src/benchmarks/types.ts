/**
 * agent-bench's benchmarks are agent-eval `BenchmarkAdapter`s, the one benchmark contract, each with the
 * `runtime` hooks an agent-runtime worker needs: the prompt, the deliverable parser, the in-box workspace
 * setup and extraction, and, where the benchmark's own protocol is the worker, that worker.
 *
 * The point: no self-authored judge, no invented score noise. `evaluate` is the benchmark's published
 * evaluation harness, run on the artifact the worker produced.
 *
 * A public benchmark reports every task, so each one also has `loadAll`, a loader that ignores agent-eval's
 * search/dev/holdout splits, as agent-eval's own Harbor adapter has. `loadDataset(split)` serves the same
 * tasks by agent-eval's deterministic split.
 */

import {
  type BenchmarkAdapter,
  type BenchmarkDatasetItem,
  type BenchmarkEvaluation,
  type BenchmarkLoadOptions,
  type BenchmarkRuntimeHooks,
  deterministicSplit,
  selectBenchmarkItems,
} from '@tangle-network/agent-eval/benchmarks'
import type { RunSplitTag } from '@tangle-network/agent-eval'
import type { AgentTurnUsage } from '@tangle-network/agent-runtime/kernel'
import type { SandboxEvent } from '@tangle-network/sandbox'

/** What the worker is handed, and the publisher's subset (domain, category, language, dataset version) the task is in. */
export interface BenchPayload {
  prompt: string
  subset?: string
}

/** One benchmark instance. `metadata` carries the fields the worker and judge need (repo, base_commit, gold, …). */
export type BenchTask = BenchmarkDatasetItem<BenchPayload>

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

/** agent-eval's verdict (`passed`: the judge passed; `score` 0..1 with partial credit where the harness has it;
 *  `notes`), plus the evidence agent-bench's judges keep. */
export interface BenchEvaluation extends BenchmarkEvaluation {
  /** Present only when the caller explicitly requested durable judge evidence. */
  judgeArtifacts?: JudgeArtifactReceipt
  /** The judge model turn's exact Runtime usage record, present only when the
   *  adapter's judge is itself a model call. `usdKnown: false` and
   *  `tokensKnown: false` survive verbatim — an unknown judge cost stays
   *  unknown instead of reading as zero. Deterministic judges never set it. */
  judgeUsage?: AgentTurnUsage
}

/** agent-eval's load options (`limit`, `ids`), plus the publisher's subset. */
export interface LoadOptions extends BenchmarkLoadOptions {
  subset?: string
}

/** The runtime hooks over agent-runtime's sandbox events. `workspaceSetup` runs in the box before the agent
 *  shot (a non-zero exit fails the shot); `workspaceExtract` runs in the still-alive box after it, and its
 *  stdout is the judged artifact (empty stdout falls back to `output`, then the final answer text). */
export type BenchRuntime = BenchmarkRuntimeHooks<BenchPayload, string, SandboxEvent>

/** An agent-eval `BenchmarkAdapter` an agent-runtime worker runs. */
export interface RuntimeBenchmark extends BenchmarkAdapter<BenchTask, BenchPayload, string, SandboxEvent> {
  readonly id: string
  readonly runtime: BenchRuntime
  /** Every task in the publisher's order, ignoring agent-eval's splits. */
  loadAll(options?: LoadOptions): Promise<BenchTask[]>
  /** The benchmark's own judge on the worker's artifact. */
  evaluate(item: BenchTask, artifact: string): Promise<BenchEvaluation>
}

export type RuntimeBenchmarkSpec = Omit<RuntimeBenchmark, 'loadDataset' | 'assignSplit' | 'runtime'> & {
  assignSplit?: RuntimeBenchmark['assignSplit']
  /** `prompt` defaults to the task's `payload.prompt`. */
  runtime?: Omit<BenchRuntime, 'prompt'> & Partial<Pick<BenchRuntime, 'prompt'>>
}

/** Build a `RuntimeBenchmark`: splits default to agent-eval's `deterministicSplit` over `<id>::<task id>`. */
export function runtimeBenchmark(spec: RuntimeBenchmarkSpec): RuntimeBenchmark {
  const assignSplit =
    spec.assignSplit ?? ((itemId: string): RunSplitTag => deterministicSplit(`${spec.id}::${itemId}`))
  return {
    ...spec,
    runtime: { prompt: (task) => task.payload.prompt, ...spec.runtime },
    assignSplit,
    async loadDataset(split, options) {
      const tasks = await spec.loadAll(options?.ids?.length ? { ids: options.ids } : {})
      const inSplit = tasks
        .map((task) => ({ ...task, split: task.split ?? assignSplit(task.id) }))
        .filter((task) => task.split === split)
      return selectBenchmarkItems(inSplit, options)
    },
  }
}
