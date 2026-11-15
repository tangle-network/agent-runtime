/**
 * The durable writer thread's entry (durable-writer.ts): it runs each named operation it receives,
 * in the order received, under the claim the caller held, with the same synchronous fence and
 * fsync the caller's thread used to run. A synchronous caller is answered on its own port and woken
 * through the shared signal; an asynchronous one through the thread's message port.
 *
 * @internal
 */
import { type MessagePort, parentPort, workerData } from 'node:worker_threads'
import {
  appendDurableFenced,
  appendRunLinesFenced,
  publishExclusiveFenced,
  writeAtomicFenced,
} from '../runtime/supervise/durable-file'
import {
  openStreamFileFenced,
  syncStreamFileFenced,
  writeStreamLinesFenced,
} from '../runtime/supervise/root-stream'
import {
  becomeDurableWriter,
  type DurableOperation,
  type DurableWriterReply,
  type DurableWriterRequest,
} from './durable-writer'
import { appendCommittedLine } from './jsonl-append'
import { prepareJsonlTailFenced } from './jsonl-file'
import { runWithWriteClaim } from './run-fence'
import { acquireRunLockFenced, releaseRunLockFenced } from './run-lock'
import { makeRunDirectoryFenced, reopenSettleFenced } from './run-reopen'

// Every operation a caller may send by name. Each takes its own fence; none takes a callback.
const OPERATIONS: Readonly<Record<string, (...args: never[]) => unknown>> = {
  acquireRunLock: acquireRunLockFenced,
  appendCommittedLine,
  appendDurableFile: appendDurableFenced,
  appendRunLines: appendRunLinesFenced,
  makeRunDirectory: makeRunDirectoryFenced,
  openStreamFile: openStreamFileFenced,
  prepareJsonlAppend: prepareJsonlTailFenced,
  publishExclusiveDurableFile: publishExclusiveFenced,
  releaseRunLock: releaseRunLockFenced,
  reopenSettle: reopenSettleFenced,
  syncStreamFile: syncStreamFileFenced,
  writeAtomicDurableFile: writeAtomicFenced,
  writeStreamLines: writeStreamLinesFenced,
}

function perform(operation: DurableOperation): unknown {
  const run = OPERATIONS[operation.name]
  if (run === undefined) throw new Error(`durable writer has no operation named ${operation.name}`)
  return (run as (...args: readonly unknown[]) => unknown)(...operation.args)
}

becomeDurableWriter(perform)

const { syncReplies, signal } = workerData as { syncReplies: MessagePort; signal: Int32Array }

parentPort!.on('message', (request: DurableWriterRequest) => {
  let reply: DurableWriterReply
  try {
    const value =
      request.claim === undefined
        ? perform(request)
        : runWithWriteClaim(request.claim, () => perform(request))
    reply = { id: request.id, ok: true, value }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    reply = {
      id: request.id,
      ok: false,
      error: {
        message: failure.message,
        name: failure.name,
        ...(typeof Reflect.get(failure, 'code') === 'string'
          ? { code: Reflect.get(failure, 'code') as string }
          : {}),
        ...(failure.stack === undefined ? {} : { stack: failure.stack }),
      },
    }
  }
  if (request.sync) {
    syncReplies.postMessage(reply)
    Atomics.store(signal, 0, 1)
    Atomics.notify(signal, 0)
  } else parentPort!.postMessage(reply)
})
