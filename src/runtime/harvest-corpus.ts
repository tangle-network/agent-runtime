/**
 * Analyze completed runs through the selected observer and retain findings in a corpus.
 *
 * Store-agnostic by design: the caller maps its trace store's rows (a
 * `ProductionTraceSink` ndjson, OTLP spans, RunRecords) to `ObserveInput` — task text,
 * final output, the event trace, terminal outcome.
 * The default observer reads execution evidence; an injected analysis owns its admitted sources.
 *
 * The nightly product job is then three lines:
 *   const runs = mapSinkRowsToObserveInputs(await readSink(yesterday))
 *   const report = await harvestCorpus({ runs, profile, executor, corpus })
 *   log(report)   // runsObserved / findings / learned / failures
 *
 * Consumers choose how retained findings inform later work and how to assess their value.
 */

import {
  type Observation,
  ObservationError,
  type ObserveInput,
  type ObserveOptions,
  observe,
} from './observe'
import type { Corpus } from './personify/wave-types'

export type HarvestCorpusOptions = ObserveOptions & {
  /** The completed runs to analyze — map your store's rows to `ObserveInput`. */
  runs: AsyncIterable<ObserveInput> | Iterable<ObserveInput>
  /** The durable corpus the facts accrete into. */
  corpus: Corpus
  /** Tags written onto learned facts (the product/domain key the read side queries by). */
  tags?: ReadonlyArray<string>
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
  /** Measured analyst tokens; a failed or unmetered analysis leaves the subtotal incomplete. */
  usage: Observation['usage']
}

/** The completed batch evidence remains available even when every analysis failed. */
export class HarvestError extends Error {
  constructor(readonly report: HarvestReport) {
    super(
      `harvestCorpus: every run failed analysis (${report.failures.length}) — first: ${report.failures[0]?.error}`,
    )
    this.name = 'HarvestError'
  }
}

/** Batch the selected observation implementation over completed runs and retain its findings. */
export async function harvestCorpus(opts: HarvestCorpusOptions): Promise<HarvestReport> {
  const concurrency = opts.concurrency ?? 4
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    (opts.maxRuns !== undefined && (!Number.isSafeInteger(opts.maxRuns) || opts.maxRuns < 0))
  ) {
    throw new TypeError(
      'harvest limits require positive integer concurrency and nonnegative integer maxRuns',
    )
  }
  const report: HarvestReport = {
    runsObserved: 0,
    findings: 0,
    learned: 0,
    failures: [],
    usage: { input: 0, output: 0, known: true },
  }

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
  const next = async (): Promise<{ input: ObserveInput; sequence: number } | null> => {
    if (done || opts.signal?.aborted || (opts.maxRuns !== undefined && consumed >= opts.maxRuns))
      return null
    // Reserve before awaiting so concurrent workers cannot exceed the requested cap.
    const sequence = ++consumed
    let r: IteratorResult<ObserveInput>
    try {
      r = await iterator.next()
    } catch (error) {
      done = true
      report.failures.push({
        runId: `source-${sequence}`,
        error: `trace source: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`,
      })
      return null
    }
    if (r.done) {
      done = true
      return null
    }
    return { input: r.value, sequence }
  }

  const workers = Array.from({ length: concurrency }, async () => {
    for (let run = await next(); run !== null; run = await next()) {
      const { input, sequence } = run
      if (opts.signal?.aborted) return
      try {
        const obs: Observation = await observe(input, opts)
        report.runsObserved += 1
        report.findings += obs.findings.length
        report.learned += obs.learned.length
        report.usage.input += obs.usage.input
        report.usage.output += obs.usage.output
        report.usage.known &&= obs.usage.known
      } catch (e) {
        report.usage.known &&= e instanceof ObservationError && e.usage.known
        if (e instanceof ObservationError) {
          report.usage.input += e.usage.input
          report.usage.output += e.usage.output
        }
        report.failures.push({
          runId: input.runId ?? `run-${sequence}`,
          error: e instanceof Error ? e.message.slice(0, 300) : String(e),
        })
      }
    }
  })
  await Promise.all(workers)

  // Fail loud when the whole batch failed — that's an infra problem, not a quiet no-op.
  if (report.runsObserved === 0 && report.failures.length > 0) {
    throw new HarvestError(report)
  }
  return report
}
