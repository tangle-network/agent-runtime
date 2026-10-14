import { spawn } from 'node:child_process'
import * as syncFs from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGraph } from '../../src/runtime/supervise/graph'
import {
  digestOfGraph,
  type GraphRunRecord,
  graphRegistry,
  listGraphRuns,
  recordGraphRun,
} from '../../src/runtime/supervise/graph-registry'
import {
  type ProfileRunRecord,
  profileRegistry,
  profileRunsForName,
  recordProfileRun,
} from '../../src/runtime/supervise/profile-registry'

vi.mock('node:fs/promises', async (load) => {
  const actual = await load<typeof fs>()
  return { ...actual, readFile: vi.fn(actual.readFile), writeFile: vi.fn(actual.writeFile) }
})

vi.mock('node:fs', async (load) => {
  const actual = await load<typeof syncFs>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

type Kind = 'graph' | 'profile'
type RunRecord = GraphRunRecord | ProfileRunRecord
const profile = { name: 'worker', prompt: { systemPrompt: 'Complete the task.' } }
const graph: AgentGraph = {
  nodes: [{ id: 'root', profile }],
  edges: [],
  budget: { maxIterations: 10, maxTokens: 1000 },
  deliverable: { check: () => true, describe: 'The finished work.' },
}

function fixture(kind: Kind, root: string) {
  return {
    path: join(root, kind === 'graph' ? 'records.jsonl' : 'profile-records.jsonl'),
    revisionPath: join(
      root,
      kind === 'graph' ? 'graphs' : 'profiles',
      `${kind === 'graph' ? digestOfGraph(graph) : canonicalAgentProfileDigest(profile)}.json`,
    ),
    record(index: number): RunRecord {
      const common = {
        startedAt: new Date(index * 1000).toISOString(),
        finishedAt: new Date(index * 1000 + 500).toISOString(),
        outcome: { kind: 'delivered' as const },
        cost: { tokens: index + 1 },
      }
      return kind === 'graph'
        ? { ...common, graphDigest: digestOfGraph(graph), taskDigest: 'task', traversals: 1 }
        : { ...common, name: profile.name, profileDigest: canonicalAgentProfileDigest(profile) }
    },
    async append(record: RunRecord) {
      if ('graphDigest' in record) await recordGraphRun(graphRegistry(root), graph, record)
      else await recordProfileRun(profileRegistry(root), profile, record)
    },
    async list(): Promise<RunRecord[]> {
      return kind === 'graph'
        ? listGraphRuns(graphRegistry(root))
        : profileRunsForName(profileRegistry(root), profile.name)
    },
  }
}

let root: string
beforeEach(async () => {
  const actual = await vi.importActual<typeof fs>('node:fs/promises')
  const actualSync = await vi.importActual<typeof syncFs>('node:fs')
  vi.mocked(syncFs.renameSync).mockImplementation(actualSync.renameSync)
  vi.mocked(fs.readFile).mockImplementation(actual.readFile)
  vi.mocked(fs.writeFile).mockImplementation(actual.writeFile)
  vi.clearAllMocks()
  root = await fs.mkdtemp(join(tmpdir(), 'run-registry-persistence-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

function writer(kind: Kind, root: string, records: RunRecord[]) {
  const graphModule = new URL('../../src/runtime/supervise/graph-registry.ts', import.meta.url).href
  const profileModule = new URL('../../src/runtime/supervise/profile-registry.ts', import.meta.url)
    .href
  const source = `
    import { recordGraphRun, graphRegistry } from ${JSON.stringify(graphModule)}
    import { recordProfileRun, profileRegistry } from ${JSON.stringify(profileModule)}
    const [kind, root, raw] = process.argv.slice(1)
    const profile = ${JSON.stringify(profile)}
    const graph = { ...${JSON.stringify(graph)}, deliverable: { check: () => true, describe: 'The finished work.' } }
    process.once('message', async () => {
      try {
        for (const record of JSON.parse(raw)) {
          if (kind === 'graph') await recordGraphRun(graphRegistry(root), graph, record)
          else await recordProfileRun(profileRegistry(root), profile, record)
        }
        process.exit(0)
      } catch (error) {
        console.error(error)
        process.exit(1)
      }
    })
    process.send('ready')
  `
  const child = spawn(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      '--input-type=module',
      '-e',
      source,
      kind,
      root,
      JSON.stringify(records),
    ],
    { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  )
  let errors = ''
  child.stderr?.on('data', (value) => {
    errors += String(value)
  })
  const ready = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('message', (message) => {
      if (message === 'ready') resolve()
      else reject(new Error(`unexpected readiness: ${JSON.stringify(message)}`))
    })
    child.once('exit', () => reject(new Error(`writer exited before readiness: ${errors}`)))
  })
  const completed = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`writer exited ${code}: ${errors}`))
    })
  })
  return { child, ready, completed }
}

describe.each(['graph', 'profile'] as const)('%s registry shared persistence', (kind) => {
  it('replays old snapshot files and moves replacement keys to the newest position', async () => {
    const f = fixture(kind, root)
    const first = f.record(1)
    const second = f.record(2)
    await fs.writeFile(f.path, `${[first, second].map((row) => JSON.stringify(row)).join('\n')}\n`)
    const replacement = { ...first, cost: { tokens: 99 } }
    await f.append(replacement)
    expect(await f.list()).toEqual([second, replacement])
    // Replacements preserve the bounded snapshot format and the exact last-update order.
    expect(await fs.readFile(f.path, 'utf8')).toBe(
      `${[second, replacement].map((row) => JSON.stringify(row)).join('\n')}\n`,
    )
  })

  it('preserves old registry files with whitespace-only separators', async () => {
    const f = fixture(kind, root)
    const first = f.record(1)
    await fs.writeFile(f.path, ` \t\r\n${JSON.stringify(first)}\n   \n\t`)
    expect(await f.list()).toEqual([first])
    await f.append(f.record(2))
    expect(await f.list()).toEqual([first, f.record(2)])
  })

  it('keeps the last committed receipt when recovering a torn append', async () => {
    const f = fixture(kind, root)
    const first = f.record(1)
    await fs.writeFile(f.path, `${JSON.stringify(first)}\n{"unfinished":`)
    expect(await f.list()).toEqual([first])
    const second = f.record(2)
    await f.append(second)
    expect(await f.list()).toEqual([first, second])
    expect(await fs.readFile(f.path, 'utf8')).toBe(
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
    )
  })

  it('reports committed corruption and I/O errors instead of an empty registry', async () => {
    const f = fixture(kind, root)
    await fs.writeFile(f.path, 'BAD\n')
    await expect(f.list()).rejects.toThrow(/malformed JSONL/)
    await expect(f.append(f.record(1))).rejects.toThrow(/malformed JSONL/)
    expect(await fs.readFile(f.path, 'utf8')).toBe('BAD\n')
    await expect(f.list()).rejects.toThrow(/malformed JSONL/)
    await fs.rm(f.path)
    await fs.mkdir(f.path)
    await expect(f.list()).rejects.toThrow()
  })

  it('streams existing rows and publishes through the shared atomic writer', async () => {
    const f = fixture(kind, root)
    await f.append(f.record(1))
    const actual = await vi.importActual<typeof fs>('node:fs/promises')
    vi.mocked(fs.readFile).mockImplementation(async (...args) => {
      if (String(args[0]) === f.path) throw new Error('whole history read')
      return actual.readFile(...args)
    })
    vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
      if (String(args[0]) === f.path) throw new Error('whole history rewrite')
      return actual.writeFile(...args)
    })
    await f.append(f.record(2))
    expect(await f.list()).toEqual([f.record(1), f.record(2)])
  })

  it('preserves the old snapshot on failed publication and releases the lock for retry', async () => {
    const f = fixture(kind, root)
    const first = f.record(1)
    await f.append(first)
    const prior = await fs.readFile(f.path, 'utf8')
    const actual = await vi.importActual<typeof syncFs>('node:fs')
    const failure = new Error('publication failed')
    vi.mocked(syncFs.renameSync).mockImplementation((source, destination) => {
      if (String(destination) === f.path) throw failure
      return actual.renameSync(source, destination)
    })
    await expect(f.append(f.record(2))).rejects.toBe(failure)
    expect(await fs.readFile(f.path, 'utf8')).toBe(prior)
    expect(await f.list()).toEqual([first])
    vi.mocked(syncFs.renameSync).mockImplementation(actual.renameSync)
    await f.append(f.record(2))
    expect(await f.list()).toEqual([first, f.record(2)])
    expect(
      (await fs.readdir(root)).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock')),
    ).toEqual([])
  })

  it('never exposes a partial snapshot to concurrent readers', async () => {
    const f = fixture(kind, root)
    const initial = f.record(1)
    await f.append(initial)
    const operations = await Promise.allSettled([
      (async () => {
        for (let update = 0; update < 25; update += 1) {
          await f.append({ ...initial, cost: { tokens: update } })
        }
      })(),
      (async () => {
        for (let read = 0; read < 50; read += 1) {
          const records = await f.list()
          expect(records).toHaveLength(1)
          expect(records[0]?.startedAt).toBe(initial.startedAt)
        }
      })(),
    ])
    // Let the writer finish before cleanup even when a reader observes a regression.
    for (const operation of operations) {
      if (operation.status === 'rejected') throw operation.reason
    }
  })

  it('preserves existing file permissions and keeps the creation umask', async () => {
    const f = fixture(kind, root)
    await f.append(f.record(1))
    if (process.platform === 'win32') return
    const defaultMode = 0o666 & ~process.umask()
    expect((await fs.stat(f.path)).mode & 0o777).toBe(defaultMode)
    expect((await fs.stat(f.revisionPath)).mode & 0o777).toBe(defaultMode)
    await fs.chmod(f.path, 0o640)
    await fs.chmod(f.revisionPath, 0o664)
    await f.append(f.record(2))
    expect((await fs.stat(f.path)).mode & 0o777).toBe(0o640)
    expect((await fs.stat(f.revisionPath)).mode & 0o777).toBe(0o664)
  })

  it('keeps one physical row after repeated updates to the same key', async () => {
    const f = fixture(kind, root)
    const initial = f.record(1)
    for (let update = 0; update < 50; update += 1) {
      await f.append({ ...initial, cost: { tokens: update } })
    }
    const expected = { ...initial, cost: { tokens: 49 } }
    expect(await f.list()).toEqual([expected])
    expect(await fs.readFile(f.path, 'utf8')).toBe(`${JSON.stringify(expected)}\n`)
  })

  it('retains concurrent process writes through two aliases of the same registry', async () => {
    const real = join(root, 'real')
    const alias = join(root, 'alias')
    await fs.mkdir(real)
    await fs.symlink(real, alias, 'dir')
    const f = fixture(kind, real)
    const rows = Array.from({ length: 40 }, (_, index) => f.record(index))
    const children = Array.from({ length: 4 }, (_, index) =>
      writer(kind, index % 2 === 0 ? real : alias, rows.slice(index * 10, index * 10 + 10)),
    )
    try {
      await Promise.all(children.map((child) => child.ready))
      for (const child of children) child.child.send('append')
      await Promise.all(children.map((child) => child.completed))
      const saved = await f.list()
      expect(saved).toHaveLength(rows.length)
      expect(saved.sort((a, b) => a.startedAt.localeCompare(b.startedAt))).toEqual(rows)
      expect((await fs.readFile(f.path, 'utf8')).trim().split('\n')).toHaveLength(rows.length)
    } finally {
      for (const child of children) child.child.kill()
    }
  }, 30_000)
})
