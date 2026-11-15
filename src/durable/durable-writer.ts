/**
 * The durable writer: one thread per process that performs every claimed run-directory write.
 *
 * A fenced write is synchronous by contract (lock, claim check, mutation and fsync with no await
 * between them), and on a saturated disk its open, link and fsync calls wait on the filesystem
 * journal: a coordinator whose event loop ran them was measured blocked 20 to 70 s at a time.
 * Here the same synchronous code runs on its own thread. Only that thread takes a run directory's
 * mutation lock in this process, so a caller never spins on a lock this process holds.
 *
 * - `durableCall` blocks the calling thread until the writer answers, exactly as the inline write
 *   did, for callers whose contract is synchronous.
 * - `durableCallAsync` resolves with the writer's answer and leaves the event loop free.
 * - On the writer thread both run the operation inline, so a fenced helper may call another.
 * - Operations run in the order they were sent, sync and async alike.
 * - A writer that fails, exits or does not answer within `DURABLE_WRITER_DEADLINE_MS` fails every
 *   call waiting on it; nothing falls back to writing on the calling thread.
 *
 * @internal
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isMainThread, MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads'
import {
  currentRunWriteClaim,
  markDurableWriterThread,
  onDurableWriterThread,
  type RunWriteClaim,
} from './run-fence'

/** Longer than the worst fsync measured on a saturated disk (70 s), so only a dead writer trips it. */
export const DURABLE_WRITER_DEADLINE_MS = 180_000

/** A named operation and its JSON arguments; names resolve in `durable-writer-thread.ts`. */
export interface DurableOperation {
  readonly name: string
  readonly args: readonly unknown[]
}

interface Request extends DurableOperation {
  readonly id: number
  readonly claim: RunWriteClaim | undefined
  readonly sync: boolean
}

type Reply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | {
      readonly id: number
      readonly ok: false
      readonly error: { message: string; name?: string; code?: string; stack?: string }
    }

let runInline: ((operation: DurableOperation) => unknown) | undefined

/** Called by the writer thread's entry: operations sent from this thread now run inline. */
export function becomeDurableWriter(inline: (operation: DurableOperation) => unknown): void {
  markDurableWriterThread()
  runInline = inline
}

/**
 * Whether a write goes to the writer: a claimed write made by the main thread, or with `always`,
 * any write the main thread makes (run-directory acquisition and release take the same lock before
 * a claim exists). Unclaimed writes keep their caller-owned single-writer contract and run inline,
 * and other worker threads never start a second writer that would contend for the same lock.
 */
export function routesToDurableWriter(always = false): boolean {
  return (
    !onDurableWriterThread() && isMainThread && (always || currentRunWriteClaim() !== undefined)
  )
}

/**
 * Run the fenced operation `fn(...args)`: inline when the write is not routed, otherwise on the
 * writer under the caller's claim, blocking this thread until it answers. `fn` takes its own fence
 * (`fenceRunWrite` or `mutateRunClaim`) and is registered under `name` in durable-writer-thread.ts;
 * arguments and the result cross the thread as structured clones.
 */
export function runFenced<A extends unknown[], T>(
  name: string,
  fn: (...args: A) => T,
  ...args: A
): T {
  return routesToDurableWriter() ? durableCall<T>({ name, args }) : fn(...args)
}

/** `runFenced` without blocking: the event loop stays free while the writer works. */
export function runFencedAsync<A extends unknown[], T>(
  name: string,
  fn: (...args: A) => T,
  ...args: A
): Promise<T> {
  if (routesToDurableWriter()) return durableCallAsync<T>({ name, args })
  try {
    return Promise.resolve(fn(...args))
  } catch (error) {
    return Promise.reject(error)
  }
}

/** `runFencedAsync` for run-directory acquisition and release, routed from the main thread even
 *  before a claim exists, since they take the same mutation lock the writer holds. */
export function runFencedAlways<A extends unknown[], T>(
  name: string,
  fn: (...args: A) => T,
  ...args: A
): Promise<T> {
  if (routesToDurableWriter(true)) return durableCallAsync<T>({ name, args })
  try {
    return Promise.resolve(fn(...args))
  } catch (error) {
    return Promise.reject(error)
  }
}

interface Writer {
  readonly worker: Worker
  readonly syncReplies: MessageChannel
  readonly signal: Int32Array
  readonly pending: Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >
  failure: Error | undefined
}

let writer: Writer | undefined
let nextId = 0

function threadUrl(): URL {
  const here = import.meta.url
  return new URL(
    here.endsWith('.ts') ? './durable-writer-thread.ts' : './durable-writer-thread.js',
    here,
  )
}

function start(): Writer {
  const url = threadUrl()
  // Source checkouts (tests) load the TypeScript entry through tsx; a built package ships JavaScript.
  const execArgv = url.pathname.endsWith('.ts')
    ? [...process.execArgv, '--import', createRequire(import.meta.url).resolve('tsx')]
    : process.execArgv
  const syncReplies = new MessageChannel()
  const signal = new Int32Array(new SharedArrayBuffer(4))
  const worker = new Worker(fileURLToPath(url), {
    execArgv,
    workerData: { syncReplies: syncReplies.port2, signal },
    transferList: [syncReplies.port2],
  })
  worker.unref()
  const state: Writer = { worker, syncReplies, signal, pending: new Map(), failure: undefined }
  const fail = (error: Error) => {
    state.failure ??= error
    if (writer === state) writer = undefined
    for (const waiting of state.pending.values()) waiting.reject(state.failure)
    state.pending.clear()
  }
  worker.on('message', (reply: Reply) => {
    const waiting = state.pending.get(reply.id)
    if (!waiting) return
    state.pending.delete(reply.id)
    if (state.pending.size === 0) worker.unref()
    if (reply.ok) waiting.resolve(reply.value)
    else waiting.reject(revive(reply.error))
  })
  worker.on('error', (error) =>
    fail(new Error(`durable writer failed: ${error.message}`, { cause: error })),
  )
  worker.on('exit', (code) => fail(new Error(`durable writer exited with code ${code}`)))
  return state
}

function current(): Writer {
  writer ??= start()
  return writer
}

function revive(error: Extract<Reply, { ok: false }>['error']): Error {
  return Object.assign(new Error(error.message), {
    name: error.name ?? 'Error',
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  })
}

function request(operation: DurableOperation, sync: boolean): Request {
  return {
    id: ++nextId,
    name: operation.name,
    args: operation.args,
    claim: currentRunWriteClaim(),
    sync,
  }
}

/** Perform `operation` on the writer and wait for it, blocking this thread as the inline write did. */
export function durableCall<T>(operation: DurableOperation): T {
  if (onDurableWriterThread()) return runInline!(operation) as T
  const state = current()
  const sent = request(operation, true)
  Atomics.store(state.signal, 0, 0)
  state.worker.postMessage(sent)
  // The writer's exit and error events need this loop, which waits here; the deadline catches a
  // writer killed without a reply (out of memory, native abort).
  const woke = Atomics.wait(state.signal, 0, 0, DURABLE_WRITER_DEADLINE_MS)
  const reply = receiveMessageOnPort(state.syncReplies.port1)?.message as Reply | undefined
  if (woke === 'timed-out' || reply === undefined || reply.id !== sent.id) {
    const error = new Error(
      woke === 'timed-out'
        ? `durable writer did not answer ${operation.name} within ${DURABLE_WRITER_DEADLINE_MS} ms`
        : `durable writer answered ${operation.name} out of order`,
    )
    state.failure ??= error
    writer = undefined
    void state.worker.terminate().catch(() => undefined)
    throw error
  }
  if (!reply.ok) throw revive(reply.error)
  return reply.value as T
}

/** Perform `operation` on the writer without blocking this thread. */
export function durableCallAsync<T>(operation: DurableOperation): Promise<T> {
  if (onDurableWriterThread()) {
    try {
      return Promise.resolve(runInline!(operation) as T)
    } catch (error) {
      return Promise.reject(error)
    }
  }
  const state = current()
  const sent = request(operation, false)
  return new Promise<T>((resolve, reject) => {
    state.pending.set(sent.id, { resolve: resolve as (value: unknown) => void, reject })
    state.worker.ref()
    state.worker.postMessage(sent)
  })
}

export type { Reply as DurableWriterReply, Request as DurableWriterRequest }
