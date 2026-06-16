/**
 * harvestCorpus — production traces → corpus, the G2 bridge (the playbook's step 6).
 * The flywheel's write side, batched: run the firewalled `observe()` analyst over a
 * stream of completed runs (yesterday's production traces, a benchmark's rollouts, a
 * fleet's day) and accrete the trace-derived facts into the durable corpus.
 *
 * Store-agnostic by design: the caller maps its trace store's rows (a
 * `ProductionTraceSink` ndjson, OTLP spans, RunRecords) to `ObserveInput` — task text,
 * final output, the event trace, terminal outcome. The analyst reads BEHAVIOR only
 * (the firewall is structural: the input carries no judge verdict), and corpus appends
 * are idempotent on (claim + tags), so re-harvesting the same window is safe.
 *
 * The nightly product job is then three lines:
 *   const runs = mapSinkRowsToObserveInputs(await readSink(yesterday))
 *   const report = await harvestCorpus({ runs, chat, corpus, tags: ['gtm-agent'] })
 *   log(report)   // runsObserved / findings / learned / failures
 *
 * NOTE on the read side: harvesting is safe and cheap; *injecting* facts back into runs
 * is the measured danger zone — naive unconditional priming tested NEGATIVE (−11.6pp,
 * context pollution; result now in .evolve/current.json + memory). Gate any priming design on its
 * own A/B; the corpus's first consumers are operators and optimizers, not prompts.
 */

import type { ChatClient } from '@tangle-network/agent-eval'
import { type Observation, type ObserveInput, observe } from './observe'
import type { Corpus } from './personify/wave-types'

export interface HarvestCorpusOptions {
  /** The completed runs to analyze — map your store's rows to `ObserveInput`. */
  runs: AsyncIterable<ObserveInput> | Iterable<ObserveInput>
  /** The model-call seam (agent-eval `createChatClient`). */
  chat: ChatClient
  model?: string
  /** The durable corpus the facts accrete into. */
  corpus: Corpus
  /** Tags written onto learned facts (the product/domain key the read side queries by). */
  tags?: ReadonlyArray<string>
  /** Override the analyst instruction (the GEPA-tunable knob). */
  analystInstruction?: string
  /** Runs analyzed in parallel. Default 4. */
  concurrency?: number
  /** Hard cap on runs consumed from the stream (a cost guard for unbounded stores). */
  maxRuns?: number
  signal?: AbortSignal
}

export interface HarvestFailure {
  runId: string
  error: string
}

export interface HarvestReport {
  runsObserved: number
  /** Total findings the analyst produced (including ones already known). */
  findings: number
  /** NEW facts actually appended (idempotent dedup excludes re-learned ones). */
  learned: number
  /** Per-run analysis failures — reported, never silently dropped. */
  failures: HarvestFailure[]
}

export async function harvestCorpus(opts: HarvestCorpusOptions): Promise<HarvestReport> {
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const report: HarvestReport = { runsObserved: 0, findings: 0, learned: 0, failures: [] }

  // Normalize to an async iterator and pull cooperatively from N workers.
  const iterator = (
    Symbol.asyncIterator in Object(opts.runs)
      ? (opts.runs as AsyncIterable<ObserveInput>)[Symbol.asyncIterator]()
      : (async function* () {
          yield* opts.runs as Iterable<ObserveInput>
        })()
  ) as AsyncIterator<ObserveInput>

  let consumed = 0
  let done = false
  const next = async (): Promise<ObserveInput | null> => {
    if (done || (opts.maxRuns !== undefined && consumed >= opts.maxRuns)) return null
    const r = await iterator.next()
    if (r.done) {
      done = true
      return null
    }
    consumed += 1
    return r.value
  }

  const workers = Array.from({ length: concurrency }, async () => {
    for (let input = await next(); input !== null; input = await next()) {
      if (opts.signal?.aborted) return
      try {
        const obs: Observation = await observe(input, {
          chat: opts.chat,
          ...(opts.model ? { model: opts.model } : {}),
          corpus: opts.corpus,
          tags: opts.tags ?? [],
          ...(opts.analystInstruction ? { analystInstruction: opts.analystInstruction } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
        })
        report.runsObserved += 1
        report.findings += obs.findings.length
        report.learned += obs.learned.length
      } catch (e) {
        report.failures.push({
          runId: input.runId ?? `run-${consumed}`,
          error: e instanceof Error ? e.message.slice(0, 300) : String(e),
        })
      }
    }
  })
  await Promise.all(workers)

  // Fail loud when the whole batch failed — that's an infra problem, not a quiet no-op.
  if (report.runsObserved === 0 && report.failures.length > 0) {
    throw new Error(
      `harvestCorpus: every run failed analysis (${report.failures.length}) — first: ${report.failures[0]?.error}`,
    )
  }
  return report
}
