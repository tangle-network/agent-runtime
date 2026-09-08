import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import type { RetainedRunAdmission } from '../../runtime/retained-run-types'
import type { SpawnEvent, SpawnJournal } from '../../runtime/supervise/types'
import {
  contentAddress,
  FileResultBlobStore,
  FileSpawnJournal,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../spawn-journal'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'spawn-integrity-'))
  dirs.push(dir)
  return dir
}
const at = '2026-09-07T00:00:00.000Z'
const spawned: SpawnEvent = {
  kind: 'spawned',
  id: 'worker',
  parent: 'root',
  label: 'worker',
  runtime: 'cli',
  budget: { maxIterations: 1, maxTokens: 10 },
  seq: 0,
  at,
}
const input: SpawnEvent = {
  kind: 'execution-input',
  id: 'worker',
  taskRef: contentAddress('task'),
  seq: 0,
  at,
}
const intent: RetainedRunAdmission = {
  phase: 'intent',
  provider: 'provider',
  idempotencyKey: 'key',
  turnId: 'turn',
  sessionId: 'session',
  executionId: 'execution',
  runId: 'run',
  requestedProfileDigest: canonicalCandidateDigest({ profile: 'worker' }),
  requestDigest: canonicalCandidateDigest({ request: 'turn' }),
}
const environment: RetainedRunAdmission = {
  phase: 'environment',
  provider: 'provider',
  environmentId: 'environment',
  idempotencyKey: 'key',
  turnId: 'turn',
  sessionId: 'session',
  executionId: 'execution',
}
const dispatched: RetainedRunAdmission = {
  phase: 'dispatched',
  idempotencyKey: 'key',
  turnId: 'turn',
  controlRef: {
    provider: 'provider',
    environmentId: 'environment',
    sessionId: 'session',
    executionId: 'execution',
    runId: 'run',
    requestDigest: canonicalCandidateDigest({ request: 'exact' }),
  },
}
const result: SpawnEvent = {
  kind: 'execution-result',
  id: 'worker',
  outRef: contentAddress('result'),
  spent: { iterations: 1, tokens: { input: 3, output: 2 }, usd: 0, ms: 1 },
  seq: 0,
  at,
}
function admitted(admission: RetainedRunAdmission): SpawnEvent {
  return { kind: 'execution-admitted', id: 'worker', admission, seq: 0, at }
}
async function prepare(journal: SpawnJournal) {
  await journal.beginTree('root', at)
  await journal.appendEvent('root', spawned)
}
describe('retained spawn journal integrity', () => {
  for (const kind of ['memory', 'file'] as const) {
    const journal = async (): Promise<SpawnJournal> =>
      kind === 'memory'
        ? new InMemorySpawnJournal()
        : new FileSpawnJournal(join(await directory(), 'journal.jsonl'))

    it(`${kind}: preserves legacy settlements without retained records`, async () => {
      const store = await journal()
      await prepare(store)
      await store.appendEvent('root', {
        kind: 'settled',
        id: 'worker',
        status: 'done',
        outRef: contentAddress('result'),
        spent: result.spent,
        seq: 0,
        at,
      })
      expect(await store.loadTree('root')).toHaveLength(2)
    })

    it(`${kind}: requires input, ordered matching admissions, and one result`, async () => {
      const store = await journal()
      await prepare(store)
      await expect(store.appendEvent('root', admitted(intent))).rejects.toThrow('precedes input')
      await expect(store.appendEvent('root', result)).rejects.toThrow('precedes dispatch')
      await store.appendEvent('root', input)
      await expect(store.appendEvent('root', input)).rejects.toThrow('duplicate input')
      await expect(store.appendEvent('root', admitted(environment))).rejects.toThrow(
        'precedes intent',
      )
      await store.appendEvent('root', admitted(intent))
      await expect(store.appendEvent('root', admitted(intent))).rejects.toThrow(
        'duplicate admission',
      )
      await expect(store.appendEvent('root', admitted(dispatched))).rejects.toThrow(
        'precedes environment',
      )
      await expect(
        store.appendEvent('root', admitted({ ...environment, executionId: 'other' })),
      ).rejects.toThrow('changes its admitted execution identity')
      await store.appendEvent('root', admitted(environment))
      await store.appendEvent('root', admitted(dispatched))
      await store.appendEvent('root', result)
      await expect(store.appendEvent('root', result)).rejects.toThrow('duplicate result')
      expect(await store.loadTree('root')).toHaveLength(6)
      await store.appendEvent('root', { ...input, seq: 1 })
      await store.appendEvent('root', admitted(intent))
      await expect(store.appendEvent('root', { ...input, seq: 2 })).rejects.toThrow(
        'unfinished invocation',
      )
    })
  }

  it('serializes duplicate admission validation with its durable append', async () => {
    const store = new FileSpawnJournal(join(await directory(), 'journal.jsonl'))
    await prepare(store)
    await store.appendEvent('root', input)
    const results = await Promise.allSettled([
      store.appendEvent('root', admitted(intent)),
      store.appendEvent('root', admitted(intent)),
    ])
    expect(results.map((entry) => entry.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await store.loadTree('root')).toHaveLength(3)
    await store.appendEvent('root', admitted(environment))
  })

  it('rejects an out-of-order retained record when loading durable bytes', async () => {
    const path = join(await directory(), 'journal.jsonl')
    await writeFile(
      path,
      `${[
        { kind: 'begin', root: 'root', at },
        { kind: 'event', root: 'root', event: spawned },
        { kind: 'event', root: 'root', event: result },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n')}\n`,
    )
    await expect(new FileSpawnJournal(path).loadTree('root')).rejects.toThrow('precedes dispatch')
  })
})

describe('result blob ownership', () => {
  for (const kind of ['memory', 'file'] as const) {
    it(`${kind}: retains one JSON representation for values sharing an address`, async () => {
      const store =
        kind === 'memory'
          ? new InMemoryResultBlobStore()
          : new FileResultBlobStore(join(await directory(), 'blobs'))
      const map = new Map([['value', 'not a JSON property']])
      const ref = contentAddress({})
      expect(contentAddress(map)).toBe(ref)
      await store.put(ref, map)
      expect(await store.get(ref)).toEqual({})
      await store.put(ref, {})
      expect(await store.get(ref)).toEqual({})
      await store.put(ref, new Set(['another value']))
      expect(await store.get(ref)).toEqual({})
    })

    it(`${kind}: refuses changed JSON addresses and undefined without publication`, async () => {
      const store =
        kind === 'memory'
          ? new InMemoryResultBlobStore()
          : new FileResultBlobStore(join(await directory(), 'blobs'))
      const date = new Date('2026-01-01T00:00:00.000Z')
      await expect(store.put(contentAddress(date), date)).rejects.toThrow('content hash')
      expect(await store.get(contentAddress(date))).toBeUndefined()
      await expect(store.put(contentAddress(undefined), undefined)).rejects.toThrow('contain JSON')
      expect(await store.get(contentAddress(undefined))).toBeUndefined()
      await store.put(contentAddress(null), null)
      expect(await store.get(contentAddress(null))).toBeNull()
    })

    it(`${kind}: preserves content when a caller mutates input or retrieved output`, async () => {
      const store =
        kind === 'memory'
          ? new InMemoryResultBlobStore()
          : new FileResultBlobStore(join(await directory(), 'blobs'))
      const artifact = { value: 'original' }
      const ref = contentAddress(artifact)
      await store.put(ref, artifact)
      artifact.value = 'changed input'
      const output = await store.get(ref)
      expect(output).toEqual({ value: 'original' })
      if (typeof output !== 'object' || output === null) throw new Error('missing stored output')
      Reflect.set(output, 'value', 'changed output')
      expect(await store.get(ref)).toEqual({ value: 'original' })
    })
  }
})

describe('content-addressed result blob publication', () => {
  it('keeps concurrent identical writes readable and refuses corrupt existing content', async () => {
    const dir = await directory()
    const store = new FileResultBlobStore(dir)
    const value = { result: 'original' }
    const ref = contentAddress(value)
    await Promise.all([store.put(ref, value), store.put(ref, value)])
    expect(await store.get(ref)).toEqual(value)
    const path = join(dir, `${ref.replace(':', '-')}.json`)
    await writeFile(path, JSON.stringify({ result: 'corrupt' }))
    await expect(store.get(ref)).rejects.toThrow('content hash')
    await expect(store.put(ref, value)).rejects.toThrow('content hash')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ result: 'corrupt' })
  })

  it('refuses blob and directory symlinks without touching their target', async () => {
    const dir = await directory()
    const outside = join(dir, 'outside')
    await mkdir(outside)
    const value = { secret: 'preserve' }
    const ref = contentAddress(value)
    const target = join(outside, 'target.json')
    await writeFile(target, JSON.stringify(value))
    const blobs = join(dir, 'blobs')
    await mkdir(blobs)
    await symlink(target, join(blobs, `${ref.replace(':', '-')}.json`))
    const store = new FileResultBlobStore(blobs)
    await expect(store.get(ref)).rejects.toThrow('symbolic link')
    await expect(store.put(ref, value)).rejects.toThrow('symbolic link')
    const linked = join(dir, 'linked-blobs')
    await symlink(outside, linked)
    await expect(new FileResultBlobStore(linked).put(ref, value)).rejects.toThrow('symbolic link')
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(value)
  })

  it('rejects references that escape the blob directory before reading', async () => {
    await expect(new FileResultBlobStore(await directory()).get('../target')).rejects.toThrow(
      'invalid',
    )
  })
})
