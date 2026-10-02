import { RuntimeRunStateError } from '../../errors'
import type { ResultBlobStore, SpawnJournal } from './types'

/** One failed store operation revokes this controller's writes, never its retained executions. */
export function guardRunPersistence(
  journal: SpawnJournal,
  blobs: ResultBlobStore,
  interrupt: (error: Error) => void,
) {
  let failure: RuntimeRunStateError | undefined
  const pending = new Set<Promise<unknown>>()
  const operation = <T>(perform: () => Promise<T>): Promise<T> => {
    const result = Promise.resolve().then(async () => {
      if (failure !== undefined) throw failure
      try {
        return await perform()
      } catch (cause) {
        if (failure === undefined) {
          failure = new RuntimeRunStateError(
            `supervisor: durable state unavailable; restore storage and resume the same run (${cause instanceof Error ? cause.message : String(cause)})`,
            { cause },
          )
          interrupt(failure)
        }
        throw failure
      }
    })
    pending.add(result)
    void result.then(
      () => pending.delete(result),
      () => pending.delete(result),
    )
    return result
  }
  return {
    journal: {
      loadTree: (root) => operation(() => journal.loadTree(root)),
      beginTree: (root, at) => operation(() => journal.beginTree(root, at)),
      appendEvent: (root, event) => operation(() => journal.appendEvent(root, event)),
      ...(journal.appendEvents === undefined
        ? {}
        : {
            appendEvents: (root, events) => operation(() => journal.appendEvents!(root, events)),
          }),
    } satisfies SpawnJournal,
    blobs: {
      get: (ref) => operation(() => blobs.get(ref)),
      put: (ref, artifact) => operation(() => blobs.put(ref, artifact)),
    } satisfies ResultBlobStore,
    get failed() {
      return failure !== undefined
    },
    async drain() {
      await Promise.allSettled([...pending])
    },
    assertAvailable() {
      if (failure !== undefined) throw failure
    },
  }
}
