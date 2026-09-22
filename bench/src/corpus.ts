/**
 * Every benchmark run persists the full tuple per attempt, not a boolean. Boolean
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
import {
  hashContent,
  type RunCostProvenance,
  type RunSplitTag,
  type RunTerminalOutcome,
  validateRunRecord,
} from '@tangle-network/agent-eval'
import type { CorpusRecord } from '@tangle-network/agent-eval/rl'
import type { Iteration } from '@tangle-network/agent-runtime/loops'
import type { BenchRuntimeDecisionPoint, BenchRuntimeHookEvent } from './runtime-hook-recorder'

/** One attempt within a condition-run: the prompt/steer sent, the output, the
 *  verdict, the measured economics, and a bounded trace summary.
 *
 *  `costUsd`/`tokensIn`/`tokensOut`/`wallMs` are OPTIONAL on purpose: they are
 *  present only when the worker actually reported them (the `runAgentRounds` kernel
 *  path). A worker that reports no usage (e.g. a raw opencode-stdout shot)
 *  omits them. Absence means "unmeasured"; an explicit `null` cost with
 *  `uncaptured` provenance means the run was measured but its price is unknown. */
export interface AttemptRecord {
  round: number
  prompt: string
  output?: string
  valid?: boolean
  score?: number
  /** USD cost of this attempt. Null means explicitly uncaptured. */
  costUsd?: number | null
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

/**
 * An attempt with enough explicit evidence to become a canonical corpus row.
 * Projection accepts only this shape and never derives these fields from
 * validity, attempt order, errors, or missing measurements.
 */
export interface CorpusAttemptRecord extends AttemptRecord {
  runId: string
  seed: number
  output: string
  score: number
  costUsd: number | null
  costProvenance: RunCostProvenance
  tokensIn: number
  tokensOut: number
  wallMs: number
  terminalOutcome: RunTerminalOutcome
  terminalFailureReason?: string
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
  /** Optional provenance retained in the native bench log. */
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

/** Explicit canonical identity for every projected attempt in one condition run. */
export interface CorpusProjectionIdentity {
  commitSha: string
  experimentId: string
  candidateId: string
  scenarioId: string
  splitTag: RunSplitTag
  model: string
  configHash: string
}

/**
 * Project one canonical corpus row per attempt.
 * Any missing or contradictory evidence rejects the whole projection.
 */
export async function projectCorpusAttempts(
  attempts: readonly CorpusAttemptRecord[],
  identity: CorpusProjectionIdentity,
): Promise<CorpusRecord[]> {
  if (attempts.length === 0) {
    throw new Error('bench corpus projection requires at least one attempt')
  }

  const records: CorpusRecord[] = []
  const runIds = new Set<string>()
  const seeds = new Set<number>()

  for (const a of attempts) {
    if (typeof a.output !== 'string') {
      throw new Error(`bench corpus attempt ${a.round} is missing output`)
    }
    if (runIds.has(a.runId)) {
      throw new Error(`bench corpus projection has duplicate runId ${a.runId}`)
    }
    if (seeds.has(a.seed)) {
      throw new Error(`bench corpus projection has duplicate seed ${a.seed}`)
    }
    runIds.add(a.runId)
    seeds.add(a.seed)

    const promptHash = await hashContent(a.prompt)
    const candidate: CorpusRecord = {
      runId: a.runId,
      experimentId: identity.experimentId,
      candidateId: identity.candidateId,
      seed: a.seed,
      model: identity.model,
      promptHash,
      configHash: identity.configHash,
      commitSha: identity.commitSha,
      wallMs: a.wallMs,
      costUsd: a.costUsd,
      costProvenance: a.costProvenance,
      tokenUsage: { input: a.tokensIn, output: a.tokensOut },
      terminalOutcome: a.terminalOutcome,
      ...(a.terminalFailureReason ? { terminalFailureReason: a.terminalFailureReason } : {}),
      outcome: {
        ...(identity.splitTag === 'holdout'
          ? { holdoutScore: a.score }
          : { searchScore: a.score }),
        raw: {
          score: a.score,
          ...(a.valid === undefined ? {} : { valid: a.valid ? 1 : 0 }),
        },
      },
      splitTag: identity.splitTag,
      scenarioId: identity.scenarioId,
      prompt: a.prompt,
      completion: a.output,
    }
    validateRunRecord(candidate)
    records.push(candidate)
  }

  return records
}

/** Append one RunRecord to the durable corpus (creating the dir if needed). */
export async function appendRunRecord(corpusPath: string, record: RunRecord): Promise<void> {
  // Fail loud on a real mkdir failure (EACCES, disk-full): recursive:true is
  // idempotent when the dir already exists, so this throws ONLY on genuine errors
  // — a silent swallow just made the append fail later with a confusing message.
  await mkdir(dirname(corpusPath), { recursive: true })
  await appendFile(corpusPath, `${JSON.stringify(record)}\n`)
}
