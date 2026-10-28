import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalCandidateDigest, canonicalCandidateJson } from '@tangle-network/agent-interface'
import {
  publishExclusiveDurableFile,
  writeAtomicDurableFile,
} from '../runtime/supervise/durable-file'
import type { RootStreamReceipt, SupervisedResult } from '../runtime/supervise/types'
import { isNoEntError } from './jsonl-file'

/** Terminal evidence has one result per segment. Reopen archives that result byte for byte;
 * a failed attempt may resume because failure.json records only the latest throw.
 * Serialization, exclusive publication and validation stay with the record operations below.
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
  /** The root's retained provider stream at the time of the throw, when the directory holds one:
   *  a root that died mid-turn keeps what it had streamed, and this names it. */
  readonly rootStream?: RootStreamReceipt
}

/** The directory already holds a settle record, so the run it records must not be re-entered. */
export class SettledRunDirectoryError extends Error {
  readonly path: string
  /** The root of the recorded run, which is its `runId`. */
  readonly recordedRunId: string

  constructor(path: string, recordedRunId: string, requestedRunId: string) {
    super(
      recordedRunId === requestedRunId
        ? `supervisePursuit: ${path} records that run '${recordedRunId}' already settled; a settled run is not re-entered unless the call passes reopen: { operator, reason, operationId }`
        : `supervisePursuit: ${path} records that run '${recordedRunId}' already settled in this directory; a directory holds one settle record, so run '${requestedRunId}' needs its own runDir`,
    )
    this.name = 'SettledRunDirectoryError'
    this.path = path
    this.recordedRunId = recordedRunId
  }
}

/** A result member whose JSON form would misstate it. */
class UnrecordableSettleValueError extends TypeError {
  readonly path: string

  constructor(path: string, kind: string) {
    super(
      `supervisePursuit: result${path} is a ${kind}, which JSON cannot record faithfully; a settle record holds plain data only`,
    )
    this.name = 'UnrecordableSettleValueError'
    this.path = path
  }
}

const PLAIN_PROTOTYPES = new Set<unknown>([Object.prototype, Array.prototype, null])

/**
 * The JSON value of a result, or a throw naming the first member JSON would misstate. An
 * `undefined` member and a function are dropped, exactly as any JSON consumer drops them; a Map,
 * a Set, a Date, a typed array, or a class instance would be rewritten to `{}` or a string and
 * so is refused.
 */
function jsonValue(result: unknown): unknown {
  const seen: unknown[] = []
  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return
    if (value instanceof Map) throw new UnrecordableSettleValueError(path, 'Map')
    if (value instanceof Set) throw new UnrecordableSettleValueError(path, 'Set')
    if (value instanceof Date) throw new UnrecordableSettleValueError(path, 'Date')
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      throw new UnrecordableSettleValueError(path, 'binary buffer')
    }
    if (!PLAIN_PROTOTYPES.has(Object.getPrototypeOf(value))) {
      throw new UnrecordableSettleValueError(path, 'class instance')
    }
    if (seen.includes(value)) throw new UnrecordableSettleValueError(path, 'cycle')
    seen.push(value)
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) visit(item, `${path}[${index}]`)
    } else {
      for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`)
    }
    seen.pop()
  }
  visit(result, '')
  return JSON.parse(JSON.stringify(result))
}

/**
 * The exact bytes `result.json` holds for a result: its JSON value serialized as RFC 8785
 * canonical JSON. Throws `UnrecordableSettleValueError` before any byte is written when the
 * result carries a value JSON would misstate.
 */
export function settleRecordJson(result: unknown): string {
  return canonicalCandidateJson(jsonValue(result))
}

/** The digest the settle record's bytes hash to: the candidate digest of the result's JSON value. */
export function settleRecordDigest(result: unknown): string {
  return canonicalCandidateDigest(jsonValue(result))
}

/** Publish `result.json` in the run directory once. Throws when a record is already there. */
export async function writeSettleRecord(runDir: string, result: unknown): Promise<string> {
  const path = resolve(runDir, SETTLE_RECORD_FILE)
  if (!publishExclusiveDurableFile(path, settleRecordJson(result))) {
    throw new Error(`supervisePursuit: ${path} already exists; a settle record is written once`)
  }
  return path
}

/** Replace `failure.json` in the run directory with the most recent throw. */
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
  return readTerminalFile(runDir, SETTLE_RECORD_FILE, parseSettleRecord)
}

async function readTerminalFile<T>(
  runDir: string,
  file: string,
  parse: (text: string, path: string) => T,
): Promise<T | undefined> {
  const path = resolve(runDir, file)
  try {
    return parse(await readFile(path, 'utf8'), path)
  } catch (error) {
    if (isNoEntError(error)) return undefined
    throw error
  }
}

function parseTerminalJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new Error(`supervisePursuit: ${path} is not valid JSON`, { cause })
  }
}

/** Parse settle-record bytes already read, so a caller hashes and parses the same bytes. */
export function parseSettleRecord(text: string, path: string): SupervisedResult<unknown> {
  const parsed = parseTerminalJson(text, path)
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
  return readTerminalFile(runDir, FAILURE_RECORD_FILE, (text, path) => {
    const parsed = parseTerminalJson(text, path)
    const record = parsed as Partial<DurableFailureRecord>
    if (
      typeof record !== 'object' ||
      record === null ||
      typeof record.runId !== 'string' ||
      typeof record.pursuitId !== 'string' ||
      typeof record.at !== 'string' ||
      typeof record.error?.name !== 'string' ||
      typeof record.error.message !== 'string' ||
      (record.rootStream !== undefined &&
        (typeof record.rootStream.ref !== 'string' || typeof record.rootStream.events !== 'number'))
    ) {
      throw new Error(`supervisePursuit: ${path} is not a failure record`)
    }
    return parsed as DurableFailureRecord
  })
}
