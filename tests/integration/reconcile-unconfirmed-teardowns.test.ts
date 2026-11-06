import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type EnvironmentDeletion,
  type EnvironmentPresence,
  type EnvironmentTarget,
  NoSettleRecordError,
  reconcileUnconfirmedTeardowns,
} from '../../src/durable/reconcile-unconfirmed-teardowns'
import {
  acquireRunDirectoryLock,
  RunDirectoryLockedError,
  runDirectoryHolderIsLive,
} from '../../src/durable/run-lock'
import { writeSettleRecord } from '../../src/durable/settle-record'

const PROVIDER = 'tangle-sandbox'
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function runDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'reconcile-unconfirmed-'))
  dirs.push(dir)
  return dir
}

function target(environmentId: string): EnvironmentTarget {
  return { provider: PROVIDER, environmentId }
}

function node(id: string, environments?: readonly Record<string, string>[]) {
  return {
    id,
    label: id,
    runtime: 'sandbox',
    status: 'down',
    ...(environments === undefined ? {} : { environments }),
  }
}

/** An in-memory provider. Each id is read and deleted directly; nothing lists the fleet. */
function fixturePort(present: readonly string[]) {
  const held = new Set(present)
  const reads: string[] = []
  const deletes: string[] = []
  const port = {
    reads,
    deletes,
    held,
    async read(item: EnvironmentTarget): Promise<EnvironmentPresence> {
      reads.push(item.environmentId)
      if (item.environmentId === 'env-unread') return { state: 'unknown', detail: 'timeout' }
      if (item.environmentId === 'env-throws') throw new Error('socket reset')
      return { state: held.has(item.environmentId) ? 'present' : 'absent' }
    },
    async delete(item: EnvironmentTarget): Promise<EnvironmentDeletion> {
      deletes.push(item.environmentId)
      if (item.environmentId === 'env-stuck')
        return { state: 'unknown', detail: 'delete answered 409' }
      held.delete(item.environmentId)
      return { state: 'deleted' }
    },
  }
  return port
}

describe('reconcileUnconfirmedTeardowns', () => {
  it('refuses a live directory lock and does not read any environment', async () => {
    const dir = await runDir()
    await writeSettleRecord(dir, {
      kind: 'no-winner',
      tree: { root: 'root' },
      teardownUnconfirmed: [node('live', [target('env-live')])],
    })
    const lock = await acquireRunDirectoryLock(dir, 'root')
    const port = fixturePort(['env-live'])
    await expect(reconcileUnconfirmedTeardowns(dir, port)).rejects.toBeInstanceOf(
      RunDirectoryLockedError,
    )
    expect(port.reads).toEqual([])
    expect(port.deletes).toEqual([])
    expect(port.held.has('env-live')).toBe(true)
    await lock.release()
  })

  it('refuses a directory with no settle record and does not read any environment', async () => {
    const dir = await runDir()
    const port = fixturePort(['env-live'])
    await expect(reconcileUnconfirmedTeardowns(dir, port)).rejects.toBeInstanceOf(
      NoSettleRecordError,
    )
    expect(port.reads).toEqual([])
    expect(port.deletes).toEqual([])
  })

  it('reads each unconfirmed id, deletes only what the provider still holds, and releases the lock', async () => {
    const dir = await runDir()
    await writeSettleRecord(dir, {
      kind: 'no-winner',
      tree: { root: 'root' },
      teardownUnconfirmed: [
        node('gone', [target('env-gone')]),
        node('live', [target('env-live')]),
        node('same', [target('env-live')]),
        node('unread', [target('env-unread')]),
        node('stuck', [target('env-stuck')]),
        node('throws', [target('env-throws')]),
        {
          id: 'kept',
          label: 'kept',
          runtime: 'sandbox',
          status: 'down',
          kept: [{ ...target('env-kept'), keptFor: 'evidence' }],
        },
        {
          id: 'both',
          label: 'both',
          runtime: 'sandbox',
          status: 'down',
          environments: [target('env-both')],
          kept: [{ ...target('env-both'), keptFor: 'resume' }],
        },
        node('intent'),
      ],
    })
    const port = fixturePort(['env-live', 'env-stuck', 'env-kept', 'env-both'])
    const first = await reconcileUnconfirmedTeardowns(dir, port)
    expect(first.confirmed).toEqual([{ nodeId: 'gone', ...target('env-gone') }])
    expect(first.deleted).toEqual([
      { nodeId: 'live', ...target('env-live') },
      { nodeId: 'same', ...target('env-live') },
    ])
    expect(first.unknown).toEqual([
      { nodeId: 'unread', ...target('env-unread'), detail: 'timeout' },
      { nodeId: 'stuck', ...target('env-stuck'), detail: 'delete answered 409' },
      { nodeId: 'throws', ...target('env-throws'), detail: 'socket reset' },
      { nodeId: 'intent', detail: 'no environment id' },
    ])
    expect(port.reads).toEqual(['env-gone', 'env-live', 'env-unread', 'env-stuck', 'env-throws'])
    expect(port.deletes).toEqual(['env-live', 'env-stuck'])
    expect(port.held.has('env-kept')).toBe(true)
    expect(port.held.has('env-both')).toBe(true)
    expect(port.held.has('env-live')).toBe(false)
    expect((await runDirectoryHolderIsLive(dir)).live).toBe(false)

    const second = await reconcileUnconfirmedTeardowns(dir, port)
    expect(second.confirmed.map((row) => row.nodeId)).toEqual(['gone', 'live', 'same'])
    expect(second.deleted).toEqual([])
    expect(port.deletes).toEqual(['env-live', 'env-stuck', 'env-stuck'])
  })

  it('does not delete when the settle record is corrupt', async () => {
    const dir = await runDir()
    await writeFile(join(dir, 'result.json'), '{"kind":"no-winner"}\n')
    const port = fixturePort(['env-live'])
    await expect(reconcileUnconfirmedTeardowns(dir, port)).rejects.toThrow(/not a settle record/)
    expect(port.reads).toEqual([])
    expect(port.deletes).toEqual([])
    expect((await runDirectoryHolderIsLive(dir)).live).toBe(false)
  })
})
