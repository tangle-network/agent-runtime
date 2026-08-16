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

  it('returns only top-level roots when spawned drivers own nested journal trees', async () => {
    const dir = fixtureDir()
    const nestedRoot = 'root-main/root-main:s0'
    writeFileSync(
      join(dir, 'spawn-journal.jsonl'),
      [
        JSON.stringify({ kind: 'begin', root: 'root-main', at: '2026-08-16T00:00:00Z' }),
        JSON.stringify({
          kind: 'event',
          root: 'root-main',
          event: {
            kind: 'spawned',
            id: 'root-main:s0',
            label: 'nested driver',
            runtime: 'driver',
            ownedTreeRoot: nestedRoot,
          },
        }),
        JSON.stringify({ kind: 'begin', root: nestedRoot, at: '2026-08-16T00:00:01Z' }),
        JSON.stringify({
          kind: 'event',
          root: nestedRoot,
          event: { kind: 'spawned', id: `${nestedRoot}:s0`, label: 'leaf', runtime: 'router' },
        }),
        '',
      ].join('\n'),
    )

    const result = await discoverDurableSupervisionRun(dir)

    expect(result.roots).toEqual(['root-main'])
  })

  it('returns an empty discovery for a valid directory with no durable files', async () => {
    const dir = fixtureDir()
    const result = await discoverDurableSupervisionRun(dir)
    expect(result.roots).toEqual([])
    expect(result.coordinationStreams).toEqual([])
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('ignores torn unacknowledged tails while retaining committed identities', async () => {
    const dir = fixtureDir()
    writeFileSync(
      join(dir, 'spawn-journal.jsonl'),
      `${JSON.stringify({ kind: 'begin', root: 'root-a' })}\n{"kind":"begin"`,
    )
    writeFileSync(
      join(dir, 'coordination-log.jsonl'),
      `${JSON.stringify({ runId: 'run-a', ownerId: 'owner-a' })}\n{"runId":`,
    )

    await expect(discoverDurableSupervisionRun(dir)).resolves.toMatchObject({
      roots: ['root-a'],
      coordinationStreams: [
        { runId: 'run-a', ownerIds: ['owner-a'], unscopedRecords: 0, recordCount: 1 },
      ],
    })
  })

  it('refuses an empty run directory identity', async () => {
    await expect(discoverDurableSupervisionRun('  ')).rejects.toThrow(/non-empty string/)
  })

  it('refuses malformed committed spawn identities', async () => {
    const missingRoot = fixtureDir()
    writeFileSync(
      join(missingRoot, 'spawn-journal.jsonl'),
      `${JSON.stringify({ kind: 'begin', at: '2026-08-16T00:00:00Z' })}\n`,
    )
    await expect(discoverDurableSupervisionRun(missingRoot)).rejects.toThrow(/root identity/)

    const malformedOwnedRoot = fixtureDir()
    writeFileSync(
      join(malformedOwnedRoot, 'spawn-journal.jsonl'),
      [
        JSON.stringify({ kind: 'begin', root: 'root-a' }),
        JSON.stringify({
          kind: 'event',
          root: 'root-a',
          event: { kind: 'spawned', id: 'root-a:s0', ownedTreeRoot: '' },
        }),
        '',
      ].join('\n'),
    )
    await expect(discoverDurableSupervisionRun(malformedOwnedRoot)).rejects.toThrow(
      /ownedTreeRoot/,
    )
  })

  it('refuses malformed committed coordination identities', async () => {
    const missingRunId = fixtureDir()
    writeFileSync(
      join(missingRunId, 'coordination-log.jsonl'),
      `${JSON.stringify({ ownerId: 'owner-a', event: { type: 'fixture' } })}\n`,
    )
    await expect(discoverDurableSupervisionRun(missingRunId)).rejects.toThrow(/runId identity/)

    const malformedOwner = fixtureDir()
    writeFileSync(
      join(malformedOwner, 'coordination-log.jsonl'),
      `${JSON.stringify({ runId: 'run-a', ownerId: '', event: { type: 'fixture' } })}\n`,
    )
    await expect(discoverDurableSupervisionRun(malformedOwner)).rejects.toThrow(/ownerId/)
  })
})
