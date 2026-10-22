import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverDurableSupervisionRun } from '../../src/durable'
import { FileSpawnJournal, type SpawnEvent, supervisorRunDir } from '../../src/runtime'
import { loadTopSnapshot } from '../../src/tui/top-snapshot'

const dirs: string[] = []
const at = '2026-10-22T00:00:00.000Z'
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function journalFile() {
  const dir = await mkdtemp(join(tmpdir(), 'file-journal-group-'))
  dirs.push(dir)
  return join(dir, 'spawn-journal.jsonl')
}
const root: SpawnEvent = {
  kind: 'spawned',
  id: 'root',
  label: 'root',
  runtime: 'inline',
  budget: { maxIterations: 5, maxTokens: 100 },
  seq: 0,
  at,
}
const input = (id: string): SpawnEvent => ({
  kind: 'execution-input',
  id,
  taskRef: `sha256:${'a'.repeat(64)}`,
  seq: 0,
  at,
})

describe('file journal atomic publication and cold replay', () => {
  it('discovers nested ownership and displays workers published in a group', async () => {
    const workspaceDir = dirname(await journalFile())
    const dir = supervisorRunDir(workspaceDir, 'grouped-view')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'state.json'),
      JSON.stringify({ id: 'root', status: 'running', task: 'grouped', workspaceDir, budget: 1 }),
    )
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    await journal.beginTree('root', at)
    await journal.appendEvents('root', [
      root,
      { ...root, id: 'root:s0', parent: 'root', label: 'worker', ownedTreeRoot: 'root/root:s0' },
    ])
    await journal.beginTree('root/root:s0', at)
    expect((await discoverDurableSupervisionRun(dir)).roots).toEqual(['root'])
    expect(
      loadTopSnapshot(workspaceDir).supervisors[0]?.workers.map((worker) => worker.id),
    ).toEqual(['root:s0'])
  })

  it('publishes no valid prefix of an invalid group and preserves historical event records', async () => {
    const path = await journalFile()
    const journal = new FileSpawnJournal(path)
    await journal.beginTree('root', at)
    const before = await readFile(path, 'utf8')
    await expect(journal.appendEvents('root', [root, input('missing')])).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(await new FileSpawnJournal(path).loadTree('root')).toEqual([])
    await journal.appendEvent('root', root)
    await journal.appendEvents('root', [input('root')])
    const restarted = new FileSpawnJournal(path)
    expect(await restarted.loadTree('root')).toEqual([root, input('root')])
    await expect(restarted.appendEvents('root', [input('root')])).rejects.toThrow()
    expect(await restarted.loadTree('root')).toEqual([root, input('root')])
  })

  it('discards an entire torn group before appending and replaying a complete group', async () => {
    const path = await journalFile()
    const journal = new FileSpawnJournal(path)
    await journal.beginTree('root', at)
    const group = [root, input('root')]
    const envelope = JSON.stringify({ kind: 'events', root: 'root', events: group })
    await appendFile(path, envelope.slice(0, -8))
    const restarted = new FileSpawnJournal(path)
    expect(await restarted.loadTree('root')).toEqual([])
    await restarted.appendEvents('root', group)
    expect(await new FileSpawnJournal(path).loadTree('root')).toEqual(group)
    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!)).toEqual({ kind: 'events', root: 'root', events: group })
  })
})
