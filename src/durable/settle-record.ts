import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalCandidateJson } from '@tangle-network/agent-interface'
import {
  publishExclusiveDurableFile,
  writeAtomicDurableFile,
} from '../runtime/supervise/durable-file'
import type { SupervisedResult } from '../runtime/supervise/types'
import { isNoEntError } from './jsonl-file'

/*
 * The terminal records `supervisePursuit` leaves in a run directory.
 *
 * Measured motive (discovery-lab recursive smoke r1, 2026-09-06): Runtime settled `no-winner`
 * at 06:27:51Z with a terminal `agent.run` event and returned the result to the caller, and the
 * directory held no terminal record. agent-eval's supervisor-run reader names `result.json` as
 * Runtime's own terminal record and reported `supStatus: unavailable` for that run and for every
 * run on that path. The Lab's re-entry guard checked `result.json`, so it never fired, and a
 * second `run` or `resume` on the settled directory re-entered `supervise` and spent again.
 *
 * `result.json` is the `SupervisedResult` the call returned, as canonical JSON (RFC 8785, stable
 * key order), so its bytes hash to `canonicalCandidateDigest(result)`. It is written once with
 * `O_EXCL`, fsynced, and never replaced: a second settle in the same directory is refused before
 * any compute. `failure.json` records the most recent throw and is replaced by a later throw; the
 * history of every attempt stays in `observer.jsonl`. A failure record alone never blocks
 * re-entry, because r1's first attempt threw on a caller input error before any spawn and the
 * corrected attempt on the same directory produced all of the run's evidence.
 */

/** The settle record: the returned `SupervisedResult` as canonical JSON, written once. */
export const SETTLE_RECORD_FILE = 'result.json'
/** The failure record: the most recent throw, replaced by a later throw. */
export const FAILURE_RECORD_FILE = 'failure.json'

/** What `failure.json` records about the most recent throw. */
export interface DurableFailureRecord {
  readonly runId: string
  readonly pursuitId: string
  /** ISO instant the throw was recorded. */
  readonly at: string
  readonly error: { readonly name: string; readonly message: string }
}

/** The directory already holds a settle record, so the run it records must not be re-entered. */
export class SettledRunDirectoryError extends Error {
  readonly path: string
  /** The root of the recorded run, which is its `runId`. */
  readonly recordedRunId: string

  constructor(path: string, recordedRunId: string, requestedRunId: string) {
    super(
      recordedRunId === requestedRunId
        ? `supervisePursuit: ${path} records that run '${recordedRunId}' already settled; a settled run is not re-entered`
        : `supervisePursuit: ${path} records that run '${recordedRunId}' already settled in this directory; a directory holds one settle record, so run '${requestedRunId}' needs its own runDir`,
    )
    this.name = 'SettledRunDirectoryError'
    this.path = path
    this.recordedRunId = recordedRunId
  }
}

/**
 * The exact bytes `result.json` holds for a result: the JSON-observable value of the result,
 * serialized as RFC 8785 canonical JSON. The JSON hop is the boundary `SupervisedResult` is
 * designed to cross, so a field JSON cannot carry (an `undefined` member, a function) is dropped
 * here exactly as any JSON consumer would drop it.
 */
export function settleRecordJson(result: unknown): string {
  return canonicalCandidateJson(JSON.parse(JSON.stringify(result)))
}

/** Publish `runDir/result.json` once. Throws when a record is already there. */
export async function writeSettleRecord(runDir: string, result: unknown): Promise<string> {
  const path = resolve(runDir, SETTLE_RECORD_FILE)
  if (!publishExclusiveDurableFile(path, settleRecordJson(result))) {
    throw new Error(`supervisePursuit: ${path} already exists; a settle record is written once`)
  }
  return path
}

/** Replace `runDir/failure.json` with the most recent throw. */
export async function writeFailureRecord(
  runDir: string,
  record: DurableFailureRecord,
): Promise<string> {
  const path = resolve(runDir, FAILURE_RECORD_FILE)
  writeAtomicDurableFile(path, `${JSON.stringify(record, null, 2)}\n`)
  return path
}

/**
 * Read the settle record a run directory holds, or `undefined` when it holds none. A file that
 * is present but is not a settle record is corruption and fails loud.
 */
export async function readSettleRecord(
  runDir: string,
): Promise<SupervisedResult<unknown> | undefined> {
  const path = resolve(runDir, SETTLE_RECORD_FILE)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNoEntError(error)) return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error(`supervisePursuit: ${path} is not valid JSON`, { cause })
  }
  const record = parsed as { kind?: unknown; tree?: { root?: unknown } }
  if (
    typeof record !== 'object' ||
    record === null ||
    typeof record.kind !== 'string' ||
    typeof record.tree !== 'object' ||
    record.tree === null ||
    typeof record.tree.root !== 'string'
  ) {
    throw new Error(`supervisePursuit: ${path} is not a settle record (no kind or tree.root)`)
  }
  return parsed as SupervisedResult<unknown>
}

/** Read the most recent failure record, or `undefined` when the directory holds none. */
export async function readFailureRecord(runDir: string): Promise<DurableFailureRecord | undefined> {
  const path = resolve(runDir, FAILURE_RECORD_FILE)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNoEntError(error)) return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error(`supervisePursuit: ${path} is not valid JSON`, { cause })
  }
  const record = parsed as Partial<DurableFailureRecord>
  if (
    typeof record !== 'object' ||
    record === null ||
    typeof record.runId !== 'string' ||
    typeof record.pursuitId !== 'string' ||
    typeof record.at !== 'string' ||
    typeof record.error?.name !== 'string' ||
    typeof record.error.message !== 'string'
  ) {
    throw new Error(`supervisePursuit: ${path} is not a failure record`)
  }
  return parsed as DurableFailureRecord
}
