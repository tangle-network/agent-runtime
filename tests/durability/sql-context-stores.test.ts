import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CoordinationEvent } from '../../src/mcp/tools/coordination'
import { runGraph } from '../../src/runtime/supervise/graph'
import { createFencedSqlRunContext } from '../../src/runtime/supervise/sql-run-context'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { conformanceGraph } from '../helpers/durability/conformance-graph'
import { openSql } from '../helpers/durability/sql-adapter'

const paths: string[] = []
async function database() {
  const dir = await mkdtemp(join(tmpdir(), 'sql-context-stores-'))
  paths.push(dir)
  return openSql(join(dir, 'run.sqlite'))
}
afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('SQL context store invariants', () => {
  it('rejects an invalid atomic group without exposing its valid prefix, and aborts its owner', async () => {
    const db = await database()
    try {
      const context = await createFencedSqlRunContext(db.adapter, 'r')
      const lease = await context.acquire()
      await lease.context.journal.beginTree('r', '2026-09-24T00:00:00.000Z')
      const root: SpawnEvent = {
        kind: 'spawned',
        id: 'r',
        label: 'root',
        runtime: 'inline',
        budget: { maxIterations: 5, maxTokens: 100 },
        seq: 0,
        at: '2026-09-24T00:00:00.000Z',
      }
      await expect(
        lease.context.journal.appendEvents!('r', [
          root,
          {
            kind: 'execution-input',
            id: 'missing-child',
            taskRef: 'sha256:missing',
            seq: 0,
            at: root.at,
          },
        ]),
      ).rejects.toThrow()
      expect(lease.signal.aborted).toBe(true)
      await lease.release()
      expect(await context.journal.loadTree('r')).toEqual([])
      const next = await context.acquire()
      try {
        await next.context.journal.appendEvents!('r', [root])
        expect(await next.context.journal.loadTree('r')).toEqual([root])
      } finally {
        await next.release()
      }
    } finally {
      db.database.close()
    }
  })

  it('replays owner-scoped coordination with original bus stamps and no invented delivery outcome', async () => {
    const db = await database()
    try {
      const first = await createFencedSqlRunContext(db.adapter, 'r')
      const lease = await first.acquire()
      const instruction = {
        receiptId: 'receipt',
        kind: 'steer' as const,
        toWorker: 'w',
        instruction: 'retain this evidence',
        instructionDigest: `sha256:${'a'.repeat(64)}`,
        interrupt: false,
      }
      const events: CoordinationEvent[] = [
        { type: 'instruction', instruction },
        {
          type: 'delivery-attempt',
          attempt: {
            receiptId: instruction.receiptId,
            kind: instruction.kind,
            toWorker: instruction.toWorker,
            instructionDigest: instruction.instructionDigest,
            interrupt: false,
          },
        },
      ]
      for (const [seq, event] of events.entries()) {
        await lease.context.coordinationLog!.append(
          'r',
          { seq, at: 1000 + seq, priority: 0, event },
          'root-owner',
        )
      }
      await lease.context.coordinationLog!.append(
        'r',
        { seq: 0, at: 9000, priority: 2, event: events[0]! },
        'nested-owner',
      )
      await lease.release()
      const second = await createFencedSqlRunContext(db.adapter, 'r')
      const prior = await second.coordinationLog!.load('r', 'root-owner')
      expect(prior.continuations).toEqual([instruction])
      expect(prior.deliveryEvidence).toEqual([events[1]])
      expect(prior.records.map(({ seq, at }) => ({ seq, at }))).toEqual([
        { seq: 0, at: 1000 },
        { seq: 1, at: 1001 },
      ])
      expect((await second.coordinationLog!.load('r', 'nested-owner')).records).toHaveLength(1)
      expect((await second.coordinationLog!.load('another-run')).records).toEqual([])
    } finally {
      db.database.close()
    }
  })

  it('refuses a non-retained custom executor before running a graph', async () => {
    const db = await database()
    let called = false
    try {
      const context = await createFencedSqlRunContext(db.adapter, 'r')
      await expect(
        runGraph(conformanceGraph(), {
          runContext: context,
          makeLeafAgent: () => {
            called = true
            throw new Error('must not execute')
          },
          brain: async () => {
            called = true
            throw new Error('must not execute')
          },
        }),
      ).rejects.toThrow(/retained|provider|SQL/)
      expect(called).toBe(false)
      expect(await context.journal.loadTree('r')).toBeUndefined()
    } finally {
      db.database.close()
    }
  })
})
