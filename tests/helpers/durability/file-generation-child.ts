import { join } from 'node:path'
import { tryAcquireAtomicFileLock } from '@tangle-network/agent-eval/ledger-core'
import { acquireRunDirectoryLock, FileObserverJournal } from '../../../src/durable/index'
import {
  cancelRun,
  contentAddress,
  FileResultBlobStore,
  FileSpawnJournal,
} from '../../../src/runtime/index'

const [dir, mode] = process.argv.slice(2)
if (!dir || !mode) throw new Error('expected directory and mode')
const lock = await acquireRunDirectoryLock(dir, 'generation-test')
const stores = lock.run(() => ({
  journal: new FileSpawnJournal(join(dir, 'spawn-journal.jsonl')),
  observer: new FileObserverJournal(join(dir, 'observer.jsonl'), 'generation-test'),
  blobs: new FileResultBlobStore(join(dir, 'blobs')),
}))
const event = {
  id: mode,
  pursuitId: 'generation-test',
  runId: 'generation-test',
  target: 'agent.run' as const,
  phase: 'before' as const,
  timestamp: Date.now(),
}
await lock.run(async () => {
  await stores.journal.beginTree('generation-test', '2026-10-22T00:00:00.000Z')
  await stores.observer.appendEvent(event)
})
if (mode === 'hold-mutation') {
  const mutation = tryAcquireAtomicFileLock({ lockPath: `${lock.path}.mutation` })
  if (!mutation.acquired) throw new Error('could not hold mutation for crash proof')
}
process.send?.({ type: 'acquired', generation: lock.generation })

// Register outside lock.run deliberately: a store must retain its admission when an external
// event emitter invokes it, rather than falling back to an unclaimed standalone write.
process.on('message', async (message: string) => {
  try {
    if (message === 'release') {
      await lock.release()
      process.send?.({ type: 'released' })
    } else if (message === 'write') {
      const outcomes: Record<string, string> = {}
      for (const [name, write] of Object.entries({
        journal: () => stores.journal.beginTree('stale-tree', '2026-10-22T00:00:00.000Z'),
        observer: () => stores.observer.appendEvent({ ...event, id: 'stale' }),
        blob: () => stores.blobs.put(contentAddress({ stale: true }), { stale: true }),
        record: () =>
          lock.run(() =>
            cancelRun(dir, 'record-generation-test', {
              operator: 'integration-test',
              source: 'integration-test',
              reason: 'generation fencing proof',
            }),
          ),
      })) {
        try {
          await write()
          outcomes[name] = 'WRITTEN'
        } catch (error) {
          outcomes[name] = String(error)
        }
      }
      process.send?.({ type: 'writes', outcomes })
    } else if (message === 'exit') {
      await lock.release()
      process.disconnect()
    }
  } catch (error) {
    process.send?.({ type: 'error', error: String(error) })
    process.exitCode = 1
    process.disconnect()
  }
})
