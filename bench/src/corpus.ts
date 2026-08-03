/**
 * The learning-flywheel corpus (docs/learning-flywheel.md).
 *
 * Every bench run persists the FULL tuple per attempt — not a boolean. Boolean
 * scorecards delete the fuel the flywheel needs; this captures state · steer ·
 * trace · output · verdict · cost so the accumulated corpus can drive
 * cross-benchmark controller learning later (offline replay / GEPA / meta-harness).
 *
 * One JSONL line per condition-run (a controller steering a worker over k attempts).
 * Append-only, durable, queryable. The trace is summarized (event count + types +
 * tail) to stay bounded while keeping the failure signal — store more if a
 * trace-aware optimizer needs it.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hashContent, type RunSplitTag, validateRunRecord } from '@tangle-network/agent-eval'
import type { CorpusRecord } from '@tangle-network/agent-eval/rl'
import type { Iteration } from '@tangle-network/agent-runtime/kernel'
import type { BenchRuntimeDecisionPoint, BenchRuntimeHookEvent } from './runtime-hook-recorder'

/** One attempt within a condition-run: the prompt/steer sent, the output, the
 *  verdict, the measured economics, and a bounded trace summary.
 *
 *  `costUsd`/`tokensIn`/`tokensOut`/`wallMs` are OPTIONAL on purpose: they are
 *  present only when the worker actually reported them (the `runAgentRounds`/kernel
 *  path). A worker that reports no usage (e.g. a raw opencode-stdout shot)
 *  OMITS them — it never writes a fabricated `0`. Absence means "unmeasured",
 *  which is honest and lets the canonical bridge below refuse to forge a
 *  RunRecord with phantom economics. (no-fallback: a silent `0` cost reads as a
 *  free run downstream, which is a lie the gate would then act on.) */
export interface AttemptRecord {
  round: number
  prompt: string
  output?: string
  valid?: boolean
  score?: number
  /** Measured USD cost of this attempt. Absent ⇒ the worker reported none. */
  costUsd?: number
  /** Measured input/output tokens. Absent ⇒ the worker reported none. */
  tokensIn?: number
  tokensOut?: number
  /** Measured wall time (endedAt − startedAt). Absent ⇒ not timed. */
  wallMs?: number
  eventCount: number
  eventTypes: Record<string, number>
  traceTail?: string
  error?: string
}

/** One controller-run over a single benchmark instance under one condition. */
export interface RunRecord {
  ts: string
  benchmark: string
  instanceId: string
  /** Condition / controller label (random@k, refineHand@k, refineGepa@k, …). */
  condition: string
  model: string
  /** iteration[0] verdict — the blind (1-attempt) outcome. */
  blindResolved: boolean
  /** winner verdict — the condition's k-attempt outcome. */
  resolved: boolean
  attempts: AttemptRecord[]
  infraError: boolean
  /** Canonical-pairing provenance (optional; writers set when known). These are
   *  what let a bench record project onto the substrate's `RunRecord` so it can
   *  pair across sweeps and feed `analyzeRuns`/`HeldOutGate`/the RL exporters. */
  seed?: number
  splitTag?: RunSplitTag
  commitSha?: string
  /** Passive runtime hook evidence captured during the run. Optional and bounded by producers. */
  runtimeEvents?: BenchRuntimeHookEvent[]
  /** Semantic runtime decision points captured during the run. Optional and producer-defined. */
  runtimeDecisionPoints?: BenchRuntimeDecisionPoint[]
}

const TRACE_TAIL_MAX = 600

function summarizeAttempt<Task, Output>(iter: Iteration<Task, Output>): AttemptRecord {
  const types: Record<string, number> = {}
  let tail: string | undefined
  for (const ev of iter.events) {
    const t = String((ev as { type?: unknown }).type ?? 'unknown')
    types[t] = (types[t] ?? 0) + 1
    const d = (ev as { data?: Record<string, unknown> }).data
    const txt = d?.finalText ?? d?.text ?? d?.result
    if (typeof txt === 'string' && txt.length > 0) tail = txt
  }
  // The kernel measures these for every Iteration — carry them verbatim. A
  // kernel-reported 0 (e.g. a loop that made no priced LLM call) is an honest
  // measurement, NOT the fabricated 0 the raw-stdout path used to write.
  return {
    round: iter.index,
    prompt: typeof iter.task === 'string' ? iter.task : JSON.stringify(iter.task),
    output: iter.output !== undefined ? (typeof iter.output === 'string' ? iter.output : JSON.stringify(iter.output)) : undefined,
    valid: iter.verdict?.valid,
    score: iter.verdict?.score,
    costUsd: iter.costUsd,
    tokensIn: iter.tokenUsage.input,
    tokensOut: iter.tokenUsage.output,
    wallMs: Math.max(0, iter.endedAt - iter.startedAt),
    eventCount: iter.events.length,
    eventTypes: types,
    traceTail: tail ? tail.slice(-TRACE_TAIL_MAX) : undefined,
    error: iter.error?.message,
  }
}

/** Build a RunRecord from a runAgentRounds result. `now` injected for determinism in tests. */
export function buildRunRecord<Task, Output>(args: {
  benchmark: string
  instanceId: string
  condition: string
  model: string
  iterations: ReadonlyArray<Iteration<Task, Output>>
  resolved: boolean
  infraError: boolean
  now?: () => Date
  /** Canonical-pairing provenance — set when the caller knows it, so the
   *  record projects cleanly onto the substrate without the bridge guessing. */
  seed?: number
  splitTag?: RunSplitTag
  commitSha?: string
  runtimeEvents?: BenchRuntimeHookEvent[]
  runtimeDecisionPoints?: BenchRuntimeDecisionPoint[]
}): RunRecord {
  const attempts = args.iterations.map(summarizeAttempt)
  return {
    ts: (args.now ? args.now() : new Date()).toISOString(),
    benchmark: args.benchmark,
    instanceId: args.instanceId,
    condition: args.condition,
    model: args.model,
    blindResolved: args.iterations[0]?.verdict?.valid === true,
    resolved: args.resolved,
    attempts,
    infraError: args.infraError,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    ...(args.splitTag !== undefined ? { splitTag: args.splitTag } : {}),
    ...(args.commitSha !== undefined ? { commitSha: args.commitSha } : {}),
    ...(args.runtimeEvents !== undefined && args.runtimeEvents.length > 0
      ? { runtimeEvents: args.runtimeEvents }
      : {}),
    ...(args.runtimeDecisionPoints !== undefined && args.runtimeDecisionPoints.length > 0
      ? { runtimeDecisionPoints: args.runtimeDecisionPoints }
      : {}),
  }
}

/**
 * Build a RunRecord from a hand-assembled `AttemptRecord[]` (the gate runners'
 * shape — they score attempts directly rather than carrying `Iteration`s).
 *
 * The three run-level verdicts derive from the attempts by default:
 *   - `blindResolved = attempts[0]?.valid === true`         (the 1-attempt outcome)
 *   - `resolved      = attempts.some(a => a.valid === true)`  (the k-attempt outcome)
 *   - `infraError    = no attempt is scored AND none is valid` (the whole run errored)
 * A gate whose recorded value differs from a derivation (e.g. a binary-pass gate
 * that reads `blindResolved` off `score === 1`, or one that pins `infraError`)
 * passes that field explicitly to preserve its exact recorded value. `now` is
 * injected for determinism in tests (mirrors `buildRunRecord`).
 */
export function buildRunRecordFromAttempts(
  attempts: AttemptRecord[],
  meta: {
    benchmark: string
    instanceId: string
    condition: string
    model: string
    blindResolved?: boolean
    resolved?: boolean
    infraError?: boolean
    now?: () => Date
    seed?: number
    splitTag?: RunSplitTag
    commitSha?: string
    runtimeEvents?: BenchRuntimeHookEvent[]
    runtimeDecisionPoints?: BenchRuntimeDecisionPoint[]
  },
): RunRecord {
  const anyScored = attempts.some((a) => a.score !== undefined)
  const anyValid = attempts.some((a) => a.valid !== undefined)
  return {
    ts: (meta.now ? meta.now() : new Date()).toISOString(),
    benchmark: meta.benchmark,
    instanceId: meta.instanceId,
    condition: meta.condition,
    model: meta.model,
    blindResolved: meta.blindResolved ?? attempts[0]?.valid === true,
    resolved: meta.resolved ?? attempts.some((a) => a.valid === true),
    attempts,
    infraError: meta.infraError ?? (!anyScored && !anyValid),
    ...(meta.seed !== undefined ? { seed: meta.seed } : {}),
    ...(meta.splitTag !== undefined ? { splitTag: meta.splitTag } : {}),
    ...(meta.commitSha !== undefined ? { commitSha: meta.commitSha } : {}),
    ...(meta.runtimeEvents !== undefined && meta.runtimeEvents.length > 0
      ? { runtimeEvents: meta.runtimeEvents }
      : {}),
    ...(meta.runtimeDecisionPoints !== undefined && meta.runtimeDecisionPoints.length > 0
      ? { runtimeDecisionPoints: meta.runtimeDecisionPoints }
      : {}),
  }
}

/** Run-level provenance the caller asserts when projecting a bench record onto
 *  the substrate. `commitSha` is required: a canonical `RunRecord` is a
 *  reproducibility artifact and must name the code that produced it — the
 *  bridge will not invent one. */
export interface CorpusProjectionOpts {
  commitSha: string
  /** Defaults to the record's `benchmark`. */
  experimentId?: string
  /** Overrides the record's `seed`; falls back to the attempt ordinal. */
  seed?: number
  /** Which split these attempts belong to. Defaults to the record's `splitTag`,
   *  else `'search'`. */
  splitTag?: RunSplitTag
  /** Snapshot-pinned model id (`name@YYYY-MM-DD` / `name-YYYYMMDD`) the caller
   *  resolved for this run. `validateRunRecord` REJECTS bare aliases (`gpt-5`),
   *  so a record whose `model` is unpinned — and that has no override here —
   *  lands in `unmappable` rather than being forged with a guessed snapshot.
   *  (Bench writers should record the resolved snapshot so this is unneeded.) */
  model?: string
}

/** One attempt that could not become a canonical record, with the reason. */
export interface UnmappableAttempt {
  round: number
  reason: string
}

export interface CorpusProjection {
  records: CorpusRecord[]
  /** Attempts dropped because they lacked the canonical-mandatory signal
   *  (measured economics / an output). The caller decides whether a non-empty
   *  list is acceptable — it is surfaced, never silently swallowed. */
  unmappable: UnmappableAttempt[]
}

/**
 * Project a bench condition-run onto the substrate's canonical `CorpusRecord[]`
 * (one record per ATTEMPT — the rollout granularity the RL/replay/gate layers
 * pair on). This is the bridge that turns the bench's experiment-shaped corpus
 * into substrate fuel WITHOUT rewriting the bench readers.
 *
 * Fail-loud, never fabricate: an attempt missing the canonical-mandatory signal
 * (`costUsd`/`tokensIn`/`tokensOut`/`wallMs`/`output`) is reported in
 * `unmappable` rather than backfilled with phantom zeros. This is WHY the local
 * raw-stdout path (which omits economics) cannot feed the gate — only the
 * measured `runAgentRounds`/sandbox path can, which is the correct, honest constraint.
 */
export async function benchRecordToCorpusRecords(
  rec: RunRecord,
  opts: CorpusProjectionOpts,
): Promise<CorpusProjection> {
  const records: CorpusRecord[] = []
  const unmappable: UnmappableAttempt[] = []
  const experimentId = opts.experimentId ?? rec.benchmark
  const splitTag: RunSplitTag = opts.splitTag ?? rec.splitTag ?? 'search'
  const configHash = await hashContent(`${rec.condition}|${rec.model}`)

  for (const a of rec.attempts) {
    const missing: string[] = []
    if (typeof a.output !== 'string' || a.output.length === 0) missing.push('output')
    if (a.costUsd === undefined) missing.push('costUsd')
    if (a.tokensIn === undefined) missing.push('tokensIn')
    if (a.tokensOut === undefined) missing.push('tokensOut')
    if (a.wallMs === undefined) missing.push('wallMs')
    if (missing.length > 0) {
      unmappable.push({ round: a.round, reason: `unmeasured: ${missing.join(', ')}` })
      continue
    }

    const score = a.score ?? (a.valid === true ? 1 : 0)
    const promptHash = await hashContent(a.prompt)
    const candidate: CorpusRecord = {
      runId: `${rec.benchmark}:${rec.instanceId}:${rec.condition}:r${a.round}`,
      experimentId,
      candidateId: rec.condition,
      // Each attempt needs a DISTINCT seed: the RL/preference layer pairs by
      // (scenarioId, seed), so identical seeds across a run's k attempts would
      // collapse them into one cell. A run-level seed is a BASE; the attempt
      // ordinal offsets it. (rec.seed/ordinal fallbacks keep the same property.)
      seed: opts.seed !== undefined ? opts.seed + a.round : (rec.seed ?? a.round),
      model: opts.model ?? rec.model,
      promptHash,
      configHash,
      commitSha: opts.commitSha,
      wallMs: a.wallMs as number,
      costUsd: a.costUsd as number,
      // Attempt costs are present only when the worker reported them. Missing
      // costs exited above rather than becoming a made-up zero.
      costProvenance: { kind: 'observed', usd: a.costUsd as number },
      tokenUsage: { input: a.tokensIn as number, output: a.tokensOut as number },
      terminalOutcome: a.error === undefined ? 'succeeded' : 'failed',
      outcome: {
        ...(splitTag === 'holdout' ? { holdoutScore: score } : { searchScore: score }),
        raw: { valid: a.valid === true ? 1 : 0, score },
      },
      splitTag,
      scenarioId: rec.instanceId,
      prompt: a.prompt,
      completion: a.output as string,
    }
    try {
      // Validate for the assertion (throws on a malformed record) but keep the
      // CorpusRecord superset — the validator returns a RunRecord and may drop
      // the `prompt`/`completion` extras the RL exporters want.
      validateRunRecord(candidate)
      records.push(candidate)
    } catch (err) {
      unmappable.push({
        round: a.round,
        reason: `invalid RunRecord: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  return { records, unmappable }
}

/** Append one RunRecord to the durable corpus (creating the dir if needed). */
export async function appendRunRecord(corpusPath: string, record: RunRecord): Promise<void> {
  // Fail loud on a real mkdir failure (EACCES, disk-full): recursive:true is
  // idempotent when the dir already exists, so this throws ONLY on genuine errors
  // — a silent swallow just made the append fail later with a confusing message.
  await mkdir(dirname(corpusPath), { recursive: true })
  await appendFile(corpusPath, `${JSON.stringify(record)}\n`)
}
