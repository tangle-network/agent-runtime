import { appendFile, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpawnEvent } from '../../runtime/supervise/types'
import type { RuntimeHookEvent } from '../../runtime-hooks'
import { composeRuntimeHooks } from '../../runtime-hooks'
import { FileObserverJournal } from '../observer-journal'
import { FileSpawnJournal } from '../spawn-journal'

const io = vi.hoisted(() => ({ reads: 0, failSync: false }))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (args[1] === 'a' && io.failSync) {
        io.failSync = false
        handle.sync = async () => {
          throw new Error('injected fsync failure')
        }
      }
      return handle
    },
    readFile: (...args: Parameters<typeof fs.readFile>) => {
      io.reads++
      return fs.readFile(...args)
    },
  }
})
const dirs: string[] = []
afterEach(async () => {
  io.failSync = false
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function file(name = 'journal.jsonl') {
  const dir = await mkdtemp(join(tmpdir(), 'long-journal-'))
  dirs.push(dir)
  return join(dir, name)
}
const at = '2026-09-16T00:00:00.000Z'
const progress = (seq: number): SpawnEvent => ({
  kind: 'progress',
  id: 'worker',
  seq,
  at,
  spend: { iterations: seq, tokens: { input: seq, output: 0 }, usd: 0, ms: seq },
})
const cancelled = (seq: number): SpawnEvent => ({
  kind: 'cancelled',
  id: `worker-${seq}`,
  reason: 'test',
  seq,
  at,
  spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
})

describe('long-lived spawn journal', () => {
  it('does not reread the whole history for every owned append', async () => {
    const journal = new FileSpawnJournal(await file())
    await journal.beginTree('root', at)
    io.reads = 0
    for (let seq = 0; seq < 100; seq++) await journal.appendEvent('root', progress(seq))
    expect(io.reads).toBeLessThanOrEqual(1)
    expect(await journal.loadTree('root')).toHaveLength(100)
  })

  it('rebuilds validation on restart and rejects already committed cursor positions', async () => {
    const path = await file()
    const journal = new FileSpawnJournal(path)
    await journal.beginTree('root', at)
    await journal.appendEvent('root', cancelled(1))
    const restarted = new FileSpawnJournal(path)
    await expect(restarted.appendEvent('root', cancelled(1))).rejects.toThrow('duplicate cursor')
    await restarted.appendEvent('root', cancelled(2))
    expect(await restarted.loadTree('root')).toHaveLength(2)
  })

  it('notices sequential writes by another journal instance', async () => {
    const path = await file()
    const first = new FileSpawnJournal(path)
    await first.beginTree('root', at)
    const second = new FileSpawnJournal(path)
    await second.appendEvent('root', cancelled(1))
    await expect(first.appendEvent('root', cancelled(1))).rejects.toThrow('duplicate cursor')
    await first.appendEvent('root', cancelled(2))
    expect(await second.loadTree('root')).toHaveLength(2)
  })

  it('invalidates a warm index when its file is replaced with equal-sized bytes', async () => {
    const path = await file()
    const journal = new FileSpawnJournal(path)
    await journal.beginTree('aaaa', at)
    const text = await readFile(path, 'utf8')
    await writeFile(`${path}.new`, text.replace('aaaa', 'bbbb'))
    expect((await stat(path)).size).toBe((await stat(`${path}.new`)).size)
    await rename(`${path}.new`, path)
    await expect(journal.appendEvent('aaaa', progress(0))).rejects.toThrow('unknown spawn tree')
    await journal.appendEvent('bbbb', progress(0))
    expect(await journal.loadTree('bbbb')).toHaveLength(1)
  })

  it('detects an equal-sized in-place rewrite without relying on inode replacement', async () => {
    const path = await file()
    const journal = new FileSpawnJournal(path)
    await journal.beginTree('aaaa', at)
    const before = await stat(path, { bigint: true })
    await writeFile(path, (await readFile(path, 'utf8')).replace('aaaa', 'bbbb'))
    const after = await stat(path, { bigint: true })
    expect(after.ino).toBe(before.ino)
    expect(after.size).toBe(before.size)
    await expect(journal.appendEvent('aaaa', progress(0))).rejects.toThrow('unknown spawn tree')
    await journal.appendEvent('bbbb', progress(0))
    expect(await journal.loadTree('bbbb')).toHaveLength(1)
  })

  it('rebuilds after a failed fsync instead of forgetting bytes already written', async () => {
    const path = await file()
    const journal = new FileSpawnJournal(path)
    await journal.beginTree('root', at)
    io.failSync = true
    await expect(journal.appendEvent('root', cancelled(1))).rejects.toThrow('injected fsync')
    // The append was not acknowledged, but its bytes are present. Re-read instead of admitting
    // a duplicate cursor based on the pre-write index or inventing that the write never happened.
    await expect(journal.appendEvent('root', cancelled(1))).rejects.toThrow('duplicate cursor')
    await journal.appendEvent('root', cancelled(2))
    expect(await journal.loadTree('root')).toHaveLength(2)
  })

  it('invalidates a warm index on truncation and does not resurrect its old tree', async () => {
    const path = await file()
    const journal = new FileSpawnJournal(path)
    await journal.beginTree('root', at)
    await writeFile(path, '')
    await expect(journal.appendEvent('root', progress(0))).rejects.toThrow('unknown spawn tree')
    await journal.beginTree('fresh', at)
    expect(await journal.loadTree('root')).toBeUndefined()
  })

  it('recovers a torn tail without forgetting cursor uniqueness or another tree', async () => {
    const path = await file()
    const journal = new FileSpawnJournal(path)
    await journal.beginTree('root', at)
    await journal.beginTree('other', at)
    await journal.appendEvent('root', cancelled(1))
    await appendFile(path, '{"kind":"event"')
    await journal.appendEvent('other', cancelled(1))
    await expect(journal.appendEvent('root', cancelled(1))).rejects.toThrow('duplicate cursor')
    expect(await journal.loadTree('root')).toHaveLength(1)
    expect(await journal.loadTree('other')).toHaveLength(1)
  })

  it('still refuses committed corruption after its append index is warm', async () => {
    const path = await file()
    const journal = new FileSpawnJournal(path)
    await journal.beginTree('root', at)
    await appendFile(path, '{bad}\n')
    await expect(journal.appendEvent('root', progress(0))).rejects.toThrow('malformed JSONL')
  })

  it('serializes validation with append and accepts only one duplicate cursor', async () => {
    const journal = new FileSpawnJournal(await file())
    await journal.beginTree('root', at)
    const results = await Promise.allSettled([
      journal.appendEvent('root', cancelled(1)),
      journal.appendEvent('root', cancelled(1)),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await journal.loadTree('root')).toHaveLength(1)
  })
})

describe('observer input ownership', () => {
  const event = (): RuntimeHookEvent => ({
    id: 'event',
    pursuitId: 'pursuit',
    runId: 'run',
    target: 'agent.child',
    phase: 'event',
    timestamp: 0,
    payload: { outcome: { text: 'original' } },
  })
  it('snapshots an event before yielding to the append queue', async () => {
    const journal = new FileObserverJournal(await file('observer.jsonl'), 'pursuit')
    const input = event()
    const pending = journal.appendEvent(input)
    ;(input.payload as { outcome: { text: string } }).outcome.text = 'mutated'
    await pending
    expect((await journal.read())[0]?.event?.payload).toEqual({ outcome: { text: 'original' } })
  })

  it('isolates the journal from another hook that mutates the shared event', async () => {
    const journal = new FileObserverJournal(await file('observer.jsonl'), 'pursuit')
    const hooks = composeRuntimeHooks(journal.hooks(), {
      onEvent: (input) => {
        ;(input.payload as { outcome: { text: string } }).outcome.text = 'rewritten'
      },
    })
    await hooks.onEvent!(event(), {})
    expect((await journal.read())[0]?.event?.payload).toEqual({ outcome: { text: 'original' } })
  })

  it('retains the original decision when a caller reuses its input objects', async () => {
    const journal = new FileObserverJournal(await file('observer.jsonl'), 'pursuit')
    const input = {
      id: 'decision',
      pursuitId: 'pursuit',
      runId: 'run',
      stepIndex: 0,
      kind: 'continue' as const,
      candidateActions: ['continue'],
      evidence: [],
    }
    const pending = journal.appendDecision(input)
    input.candidateActions[0] = 'stop'
    await pending
    expect((await journal.read())[0]?.decision?.candidateActions).toEqual(['continue'])
  })
})
