import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DownMessageEvent } from '../../src/mcp/tools/coordination-messages'
import {
  createCancelAcknowledger,
  createSteerAcknowledger,
} from '../../src/runtime/supervise/driver-control-acknowledgers'
import {
  cancelWorker,
  readWorkerCancellation,
  readWorkerSteerAcknowledgement,
  writeWorkerSteer,
} from '../../src/runtime/supervise/run-layout'
import type { Scope } from '../../src/runtime/supervise/types'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('control poll reads new bytes only (#2430)', () => {
  it('a later pass keeps a consumed journal death after that prefix and the inbox are destroyed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'control-poll-'))
    dirs.push(dir)
    const journal = join(dir, 'spawn-journal.jsonl')
    const line = (id: string, at: string) =>
      `${JSON.stringify({ kind: 'event', root: 'run', event: { kind: 'settled', id, status: 'down', at } })}\n`
    writeFileSync(journal, line('run:s0:s1', '2026-11-07T00:00:02.000Z'))
    const scope = {
      view: { root: 'run', nodes: [{ id: 'run:s0', label: 'lead', status: 'cancelled' }] },
    } as Scope<unknown>
    const ack = createCancelAcknowledger({
      dir,
      scope,
      now: () => Date.parse('2026-11-07T00:00:01.000Z'),
      ownerId: 'run',
      controlScope: 'run',
      coord: {
        settled: () => [],
        abortWorker: (ref) => (ref === 'run:s0' ? { id: 'run:s0', label: 'lead' } : undefined),
      },
    })
    ack.pass('turn')
    writeFileSync(journal, Buffer.alloc(readFileSync(journal).length, 0x78))
    cancelWorker(dir, 'run:s0', 'op-1', { source: 'test' })
    ack.pass('turn')
    const inbox = readFileSync(join(dir, 'cancellations', 'requests.ndjson'))
    writeFileSync(join(dir, 'cancellations', 'requests.ndjson'), Buffer.alloc(inbox.length, 0x78))
    ack.pass('turn')
    expect(readWorkerCancellation(dir, 'op-1')?.terminated).toEqual(['run:s0', 'run:s0:s1'])
    writeFileSync(
      journal,
      Buffer.concat([
        readFileSync(journal),
        Buffer.from(line('run:s0:s2', '2026-11-07T00:00:03.000Z')),
      ]),
    )
    ack.pass('turn')
    expect(readWorkerCancellation(dir, 'op-1')?.terminated).toEqual([
      'run:s0',
      'run:s0:s1',
      'run:s0:s2',
    ])
  })

  it('a boundary pass leaves a new worker steer for the next turn, including one admitted during delivery', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'control-poll-steer-'))
    dirs.push(dir)
    const delivered: string[] = []
    const deliveredTo = (workerId: string, instruction: string): DownMessageEvent => ({
      receiptId: 'r',
      toWorker: workerId,
      instruction,
      instructionDigest: 'd',
      delivered: true,
      outcome: 'delivered',
    })
    const ack = createSteerAcknowledger({
      dir,
      now: () => Date.parse('2026-11-07T00:00:01.000Z'),
      ownerId: 'run',
      coord: {
        steerWorker: async (workerId, instruction) => {
          delivered.push(workerId)
          if (workerId === 'run:s0') {
            writeWorkerSteer('', '', 'run:s1', {
              operationId: 'op-b',
              message: 'later',
              source: 'test',
              eventDir: dir,
            })
            await ack.pass('boundary')
          }
          return deliveredTo(workerId, instruction)
        },
      },
    })
    await ack.pass('turn')
    writeWorkerSteer('', '', 'run:s0', {
      operationId: 'op-a',
      message: 'first',
      source: 'test',
      eventDir: dir,
    })
    await ack.pass('boundary')
    expect(delivered).toEqual([])
    await ack.pass('turn')
    expect(delivered).toEqual(['run:s0'])
    expect(readWorkerSteerAcknowledgement(dir, 'op-b')).toBeUndefined()
    await ack.pass('turn')
    expect(delivered).toEqual(['run:s0', 'run:s1'])
    expect(readWorkerSteerAcknowledgement(dir, 'op-b')?.effect).toBe('delivered')
  })

  it('a boundary pass leaves a root steer unseen until the inbox is ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'control-poll-root-'))
    dirs.push(dir)
    let ready = false
    const got: string[] = []
    const ack = createSteerAcknowledger({
      dir,
      now: () => Date.parse('2026-11-07T00:00:01.000Z'),
      ownerId: 'run',
      deliverRoot: (message) => {
        got.push(message.steer)
        return true
      },
      deliverRootReady: () => ready,
      coord: {
        steerWorker: async () => {
          throw new Error('root steer must not go to a worker')
        },
      },
    })
    await ack.pass('turn')
    writeWorkerSteer('', '', 'run', {
      operationId: 'op-root',
      message: 'pause',
      source: 'test',
      eventDir: dir,
    })
    await ack.pass('boundary')
    expect(got).toEqual([])
    await ack.pass('turn')
    expect(got).toEqual([])
    ready = true
    await ack.pass('turn')
    expect(got).toEqual(['pause'])
  })
})
