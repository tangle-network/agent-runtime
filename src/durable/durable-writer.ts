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
 * - A call the writer does not answer within `DURABLE_WRITER_DEADLINE_MS` fails, and the writer
 *   keeps running. A writer that errors or exits fails every waiting and later call and is never
 *   replaced. Nothing falls back to writing on the calling thread.
 *
 * @internal
 */

import { existsSync } from 'node:fs'
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
      readonly error: {
        message: string
        name?: string
        code?: string
        stack?: string
        fields?: Record<string, unknown>
      }
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
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >
}

let writer: Writer | undefined
// Set when the writer errors or exits. It is never replaced: it may have died inside a fence
// holding the run's mutation lock under this live pid, and a new writer could only spin on that
// lock. Every later routed write fails at once with this cause.
let writerDeath: Error | undefined
let nextId = 0

// Errors an operation throws are rebuilt on the caller's thread as their own class, with their
// own fields, so `instanceof` and fields such as a lock holder survive the thread boundary.
const errorClasses = new Map<string, { prototype: Error }>()

/** Rebuild errors named `name` thrown on the writer as instances of `errorClass`. @internal */
export function registerDurableErrorClass(name: string, errorClass: { prototype: Error }): void {
  errorClasses.set(name, errorClass)
}

/**
 * The writer's entry beside this module: TypeScript in a source checkout, JavaScript in a built
 * package. A tool that bundles Runtime again must emit `src/durable/durable-writer-thread.ts` as
 * `durable-writer-thread.js` (or `.mjs`) beside the bundle; without it, writes fail with this cause.
 */
function threadUrl(): URL {
  const here = import.meta.url
  if (here.endsWith('.ts')) return new URL('./durable-writer-thread.ts', here)
  for (const name of ['./durable-writer-thread.js', './durable-writer-thread.mjs']) {
    const candidate = new URL(name, here)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `durable writer entry durable-writer-thread.js is not beside ${fileURLToPath(here)}; a bundle of Runtime must emit it there`,
  )
}

function start(): Writer {
  const url = threadUrl()
  // Source checkouts (tests) load the TypeScript entry through tsx; a built package ships JavaScript.
  // Only what the entry needs: some of the parent's flags (--expose-gc) are refused in a worker.
  const execArgv = url.pathname.endsWith('.ts')
    ? ['--import', createRequire(import.meta.url).resolve('tsx')]
    : []
  const syncReplies = new MessageChannel()
  const signal = new Int32Array(new SharedArrayBuffer(4))
  const worker = new Worker(fileURLToPath(url), {
    execArgv,
    workerData: { syncReplies: syncReplies.port2, signal },
    transferList: [syncReplies.port2],
  })
  worker.unref()
  const state: Writer = { worker, syncReplies, signal, pending: new Map() }
  const die = (error: Error) => {
    writerDeath ??= error
    for (const waiting of state.pending.values()) {
      clearTimeout(waiting.timer)
      waiting.reject(writerDeath)
    }
    state.pending.clear()
  }
  worker.on('message', (reply: Reply) => {
    const waiting = state.pending.get(reply.id)
    // A reply whose caller already gave up at its deadline has nobody to answer.
    if (!waiting) return
    state.pending.delete(reply.id)
    clearTimeout(waiting.timer)
    if (state.pending.size === 0) worker.unref()
    if (reply.ok) waiting.resolve(reply.value)
    else waiting.reject(revive(reply.error))
  })
  worker.on('error', (error: Error) =>
    die(new Error(`durable writer failed: ${error.message}`, { cause: error })),
  )
  worker.on('exit', (code) => die(new Error(`durable writer exited with code ${code}`)))
  return state
}

function current(): Writer {
  if (writerDeath !== undefined) throw writerDeath
  writer ??= start()
  return writer
}

function revive(error: Extract<Reply, { ok: false }>['error']): Error {
  const errorClass = error.name === undefined ? undefined : errorClasses.get(error.name)
  const revived: Error = errorClass ? Object.create(errorClass.prototype) : new Error(error.message)
  return Object.assign(revived, error.fields ?? {}, {
    message: error.message,
    name: error.name ?? 'Error',
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  })
}

function overdue(operation: DurableOperation): Error {
  // The writer keeps running: stopping it inside a fence would leave the run's mutation lock held.
  return new Error(
    `durable writer did not answer ${operation.name} within ${DURABLE_WRITER_DEADLINE_MS} ms; the writer is still running`,
  )
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
  const deadline = performance.now() + DURABLE_WRITER_DEADLINE_MS
  Atomics.store(state.signal, 0, 0)
  state.worker.postMessage(sent)
  // The writer's exit and error events need this loop, which waits here; the deadline catches a
  // writer killed without a reply (out of memory, native abort) and a backlog that never drains.
  for (;;) {
    for (
      let received = receiveMessageOnPort(state.syncReplies.port1);
      received;
      received = receiveMessageOnPort(state.syncReplies.port1)
    ) {
      const reply = received.message as Reply
      // An older id is the late answer to a call that already failed at its deadline.
      if (reply.id !== sent.id) continue
      if (!reply.ok) throw revive(reply.error)
      return reply.value as T
    }
    const remaining = deadline - performance.now()
    if (remaining <= 0) throw overdue(operation)
    Atomics.wait(state.signal, 0, 0, remaining)
    Atomics.store(state.signal, 0, 0)
  }
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
  let state: Writer
  try {
    state = current()
  } catch (error) {
    return Promise.reject(error)
  }
  const sent = request(operation, false)
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(sent.id)
      if (state.pending.size === 0) state.worker.unref()
      reject(overdue(operation))
    }, DURABLE_WRITER_DEADLINE_MS)
    timer.unref()
    state.pending.set(sent.id, { resolve: resolve as (value: unknown) => void, reject, timer })
    state.worker.ref()
    state.worker.postMessage(sent)
  })
}

export type { Reply as DurableWriterReply, Request as DurableWriterRequest }
