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
import type { Iteration } from '@tangle-network/agent-runtime/loops'

/** One attempt within a condition-run: the prompt/steer sent, the output, the
 *  verdict, the cost, and a bounded trace summary. */
export interface AttemptRecord {
  round: number
  prompt: string
  output?: string
  valid?: boolean
  score?: number
  costUsd: number
  tokensIn: number
  tokensOut: number
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
  return {
    round: iter.index,
    prompt: typeof iter.task === 'string' ? iter.task : JSON.stringify(iter.task),
    output: iter.output !== undefined ? (typeof iter.output === 'string' ? iter.output : JSON.stringify(iter.output)) : undefined,
    valid: iter.verdict?.valid,
    score: iter.verdict?.score,
    costUsd: iter.costUsd,
    tokensIn: iter.tokenUsage?.input ?? 0,
    tokensOut: iter.tokenUsage?.output ?? 0,
    eventCount: iter.events.length,
    eventTypes: types,
    traceTail: tail ? tail.slice(-TRACE_TAIL_MAX) : undefined,
    error: iter.error?.message,
  }
}

/** Build a RunRecord from a runLoop result. `now` injected for determinism in tests. */
export function buildRunRecord<Task, Output>(args: {
  benchmark: string
  instanceId: string
  condition: string
  model: string
  iterations: ReadonlyArray<Iteration<Task, Output>>
  resolved: boolean
  infraError: boolean
  now?: () => Date
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
  }
}

/** Append one RunRecord to the durable corpus (creating the dir if needed). */
export async function appendRunRecord(corpusPath: string, record: RunRecord): Promise<void> {
  // Fail loud on a real mkdir failure (EACCES, disk-full): recursive:true is
  // idempotent when the dir already exists, so this throws ONLY on genuine errors
  // — a silent swallow just made the append fail later with a confusing message.
  await mkdir(dirname(corpusPath), { recursive: true })
  await appendFile(corpusPath, `${JSON.stringify(record)}\n`)
}
