import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverDurableSupervisionRun } from './supervision-discovery'

const fixtureDirs: string[] = []

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'durable-supervision-discovery-'))
  fixtureDirs.push(dir)
  return dir
}

describe('discoverDurableSupervisionRun', () => {
  it('discovers roots, run ids, owner ids, and legacy unscoped records', async () => {
    const dir = fixtureDir()
    writeFileSync(
      join(dir, 'spawn-journal.jsonl'),
      [
        JSON.stringify({ kind: 'begin', root: 'root-b', at: '2026-08-16T00:00:00Z' }),
        JSON.stringify({ kind: 'event', root: 'root-b', event: { kind: 'fixture' } }),
        JSON.stringify({ kind: 'begin', root: 'root-a', at: '2026-08-16T00:00:01Z' }),
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(dir, 'coordination-log.jsonl'),
      [
        JSON.stringify({ runId: 'run-b', ownerId: 'owner-2', event: { type: 'fixture' } }),
        JSON.stringify({ runId: 'run-a', ownerId: 'owner-1', event: { type: 'fixture' } }),
        JSON.stringify({ runId: 'run-b', ownerId: 'owner-1', event: { type: 'fixture' } }),
        JSON.stringify({ runId: 'run-b', event: { type: 'legacy-fixture' } }),
        '',
      ].join('\n'),
    )

    await expect(discoverDurableSupervisionRun(dir)).resolves.toEqual({
      runDir: resolve(dir),
      spawnJournalPath: join(resolve(dir), 'spawn-journal.jsonl'),
      coordinationLogPath: join(resolve(dir), 'coordination-log.jsonl'),
      roots: ['root-a', 'root-b'],
      coordinationStreams: [
        {
          runId: 'run-a',
          ownerIds: ['owner-1'],
          unscopedRecords: 0,
          recordCount: 1,
        },
        {
          runId: 'run-b',
          ownerIds: ['owner-1', 'owner-2'],
          unscopedRecords: 1,
          recordCount: 3,
        },
      ],
    })
  })

  it('returns an empty discovery for a valid directory with no durable files', async () => {
    const dir = fixtureDir()
    const result = await discoverDurableSupervisionRun(dir)
    expect(result.roots).toEqual([])
    expect(result.coordinationStreams).toEqual([])
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('refuses malformed committed identity records', async () => {
    const dir = fixtureDir()
    writeFileSync(
      join(dir, 'spawn-journal.jsonl'),
      `${JSON.stringify({ kind: 'begin', at: '2026-08-16T00:00:00Z' })}\n`,
    )

    await expect(discoverDurableSupervisionRun(dir)).rejects.toThrow(/root identity/)
  })
})
