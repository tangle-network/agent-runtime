/**
 * The root manager's own provider stream, retained where Runtime owns it.
 *
 * Measured motive (agent-runtime#1233, 2026-09-15): a CHILD's full event stream — reasoning, text,
 * and tool parts, 28k to 76k reasoning characters per child — is retained in the blob its
 * `settled` record names as `outRef`. The ROOT's stream reached nobody: `driveHarnessFromBackend`
 * drained the root executor for accounting and discarded every `progress` event, and on a
 * `winner` run `result.outRef` is the SELECTED CHILD's artifact, not the root's. A root that died
 * at its join barrier (fourier-e, 63 children) left a 607-byte `failure.json` and nothing it
 * thought; the Lab's only transcript of a root was a post-hoc scrape of the harness's own
 * database.
 *
 * `<runDir>/root-stream.jsonl` is the record: one JSONL line per `ExecutorProgressEvent`, written
 * AS IT ARRIVES, so a root whose process is killed mid-turn keeps every line already written. The
 * file itself is the evidence; the receipt (`ref`, the content address of the file's bytes, and
 * `events`, its committed line count) is what `result.json` and `failure.json` carry. The winner's
 * `outRef` keeps its meaning; this is a separate reference.
 *
 * Durability boundary: each line is written synchronously to an `O_APPEND` descriptor before the
 * next event is drained, and the file is fsynced at every drive-attempt boundary and at close, not
 * per line. Measured 2026-09-15 on this host's APFS: an fsync per line cost 7.1 ms per event over
 * 1,000 events and 8.1 ms over 5,000 (~80 s for a root emitting ten thousand text deltas, all of
 * it serialized inside the drain loop that also meters the budget); an async `FileHandle.write`
 * still cost 0.9 to 1.1 ms per line in the thread pool the children's journal writes share; a
 * `writeSync` costs 6 µs. A process kill loses nothing written; only a kernel crash or power
 * loss can drop lines written since the last fsync, and the reader's torn-tail rule keeps such a
 * file readable.
 *
 * The bridge wire carries text and tool calls only: cli-bridge's SSE frames decode
 * `delta.content` and `delta.tool_calls`, never a reasoning delta. A bridge-placed root's retained
 * stream is therefore text plus tool calls; reasoning arrives only on the provider/sandbox path,
 * which projects `message.part.updated` reasoning parts to `reasoning_delta`.
 */

import { createHash } from 'node:crypto'
import { closeSync, constants as fsConstants, fsyncSync, openSync, writeSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isNoEntError, parseCommittedJsonLines, prepareJsonlAppend } from '../../durable/jsonl-file'
import { assertNoSymlinkDescendant } from './durable-file'
import type { ExecutorProgressEvent, RootStreamReceipt } from './types'

export type { RootStreamReceipt } from './types'

/** The root stream: one JSONL line per progress event the root's executor observed. */
export const ROOT_STREAM_FILE = 'root-stream.jsonl'

/** One line of `root-stream.jsonl`. */
export type RootStreamRecord = {
  /** 1-based position in the file, continuing across drive attempts and across processes. */
  readonly seq: number
  /** ISO instant the line was appended, from the run's own clock. */
  readonly at: string
  /** The 1-based drive attempt of the root that produced it: a driver retry or re-prompt
   *  re-enters the harness and continues the same file with the next attempt number. */
  readonly attempt: number
} & (
  | { readonly event: ExecutorProgressEvent }
  | {
      /** The event could not be written as JSON; its kind and the reason stand in so the gap
       *  is recorded in the file itself instead of silently narrowing the stream. */
      readonly dropped: { readonly kind: ExecutorProgressEvent['kind']; readonly reason: string }
    }
)

/** The append-only writer one root drive holds. */
export interface RootStreamSink {
  /** Mark the next drive attempt; opens the file on the first call. */
  beginAttempt(): Promise<void>
  /** Append one event; the line is in the kernel when this returns. */
  append(event: ExecutorProgressEvent): void
  /** Fsync, close the writer, and return the receipt, or `undefined` when no attempt ever began. */
  close(): Promise<RootStreamReceipt | undefined>
}

/** Create the writer for `<runDir>/root-stream.jsonl`. Nothing touches disk until the first
 *  `beginAttempt`, so a run whose root never drives leaves no file and no receipt. */
export function createRootStreamSink(runDir: string, now: () => number): RootStreamSink {
  const dir = resolve(runDir)
  const path = resolve(dir, ROOT_STREAM_FILE)
  let fd: number | undefined
  let attempt = 0
  let seq = 0
  let closed = false

  const openOnce = async (): Promise<void> => {
    if (fd !== undefined) return
    await mkdir(dir, { recursive: true })
    assertNoSymlinkDescendant(dir, path, 'root stream')
    // A resumed run continues the same file. Recovery scans the tail once, so a torn line from a
    // process that died mid-write is truncated rather than followed by a record it would corrupt.
    const needsSeparator = await prepareJsonlAppend(path)
    seq = ((await readRootStream(dir)) ?? []).length
    fd = openSync(
      path,
      fsConstants.O_APPEND |
        fsConstants.O_CREAT |
        fsConstants.O_WRONLY |
        (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0),
      0o600,
    )
    if (needsSeparator) writeLine(fd, '')
  }

  return {
    async beginAttempt() {
      if (closed) throw new Error('root stream: beginAttempt after close')
      attempt += 1
      // A retry re-enters the harness after the previous attempt's lines; make them durable
      // before the next attempt appends after them.
      if (fd !== undefined) fsyncSync(fd)
      await openOnce()
    },
    append(event) {
      if (closed) throw new Error('root stream: append after close')
      if (fd === undefined) throw new Error('root stream: append before beginAttempt')
      const at = new Date(now()).toISOString()
      const record = { seq: seq + 1, at, attempt, event }
      // A progress payload is JSON the wire already parsed, so this branch is a guard, not a
      // path: a value JSON cannot encode (a BigInt, a cycle, a hostile `toJSON`) is recorded as
      // a dropped line so the turn continues and the file still says something was lost.
      let line: string | undefined
      try {
        line = JSON.stringify(record)
      } catch (error) {
        line = JSON.stringify({
          seq: seq + 1,
          at,
          attempt,
          dropped: { kind: event.kind, reason: errorMessage(error) },
        })
      }
      if (line === undefined) {
        line = JSON.stringify({
          seq: seq + 1,
          at,
          attempt,
          dropped: { kind: event.kind, reason: 'event serialized to nothing' },
        })
      }
      writeLine(fd, line)
      seq += 1
    },
    async close() {
      if (closed) throw new Error('root stream: closed twice')
      closed = true
      if (fd === undefined) return undefined
      try {
        fsyncSync(fd)
      } finally {
        closeSync(fd)
        fd = undefined
      }
      return readRootStreamReceipt(dir)
    },
  }
}

/** `writeSync` may legally make a short write; loop until the whole line and its newline land. */
function writeLine(fd: number, line: string): void {
  const bytes = Buffer.from(`${line}\n`, 'utf8')
  let offset = 0
  while (offset < bytes.byteLength) {
    const written = writeSync(fd, bytes, offset, bytes.byteLength - offset)
    if (written <= 0) throw new Error(`root stream: append made no progress at byte ${offset}`)
    offset += written
  }
}

/**
 * The receipt for the root stream a run directory holds, recomputed from the file's bytes, or
 * `undefined` when the directory holds none. This is what a run that never settled — a root that
 * died mid-turn — gets on its failure record, and it equals what `close()` returned for a run
 * that did.
 */
export async function readRootStreamReceipt(
  runDir: string,
): Promise<RootStreamReceipt | undefined> {
  const path = resolve(runDir, ROOT_STREAM_FILE)
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    if (isNoEntError(error)) return undefined
    throw error
  }
  return Object.freeze({
    ref: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    events: parseCommittedJsonLines<RootStreamRecord>(bytes.toString('utf8'), path).length,
  })
}

/** Every committed line of the root stream, in order, or `undefined` when there is no file. A
 *  torn final line from a process that died mid-write is not a record and is left out. */
export async function readRootStream(runDir: string): Promise<RootStreamRecord[] | undefined> {
  const path = resolve(runDir, ROOT_STREAM_FILE)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNoEntError(error)) return undefined
    throw error
  }
  return parseCommittedJsonLines<RootStreamRecord>(text, path)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
