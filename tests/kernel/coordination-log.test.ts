import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CoordinationEvent, QuestionRecord } from '../../src/mcp/tools/coordination'
import { FileCoordinationLog } from '../../src/runtime/supervise/coordination-log'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function logPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'coordination-log-'))
  dirs.push(dir)
  return join(dir, 'coordination.jsonl')
}

function question(id: string, from: string): QuestionRecord {
  return {
    id,
    from,
    question: `question ${id}`,
    reason: 'test',
    status: 'open',
    openedAt: 1,
  }
}

describe('full-tree coordination log', () => {
  it('keeps every event in order with exact source while root resume excludes descendants', async () => {
    const log = new FileCoordinationLog(await logPath())
    const runId = 'run'
    const root = { nodeId: runId, profileName: 'root' }
    const child = { nodeId: 'run:s0', profileName: 'child' }
    const events: Array<{
      source: typeof root
      event: CoordinationEvent
    }> = [
      { source: root, event: { type: 'question', question: question('root:q0', runId) } },
      {
        source: child,
        event: { type: 'question', question: question('run:s0:q0', 'run:s0') },
      },
      {
        source: child,
        event: {
          type: 'finding',
          finding: { fromWorker: 'run:s0:s0', analyst: 'trace', findings: { stuck: true } },
        },
      },
      {
        source: child,
        event: {
          type: 'steer',
          down: {
            messageId: 'steer-1',
            toWorker: 'run:s0:s0',
            instruction: 'change course',
            deliveryMode: 'queued',
          },
        },
      },
      {
        source: root,
        event: {
          type: 'answer',
          questionId: 'root:q0',
          answer: { text: 'answer', by: 'prior-run' },
        },
      },
    ]

    for (let index = 0; index < events.length; index += 1) {
      const row = events[index]!
      await log.append(runId, row.source, {
        seq: index,
        at: index,
        priority: 0,
        event: row.event,
      })
    }

    const records = await log.records(runId)
    expect(
      records.map((record) => ({
        version: record.version,
        source: record.source,
        type: record.record.event.type,
      })),
    ).toEqual(
      events.map((row) => ({
        version: 3,
        source: row.source,
        type: row.event.type,
      })),
    )

    const resumed = await log.load(runId, runId)
    expect(resumed.findings).toEqual([])
    expect(resumed.questions).toEqual([
      expect.objectContaining({
        id: 'root:q0',
        status: 'answered',
        answer: { text: 'answer', by: 'prior-run' },
      }),
    ])
  })

  it('normalizes a version-one row to root source with unknown profile name', async () => {
    const path = await logPath()
    const event: CoordinationEvent = {
      type: 'finding',
      finding: { fromWorker: 'worker', analyst: 'legacy', findings: ['fact'] },
    }
    await writeFile(
      path,
      `${JSON.stringify({
        runId: 'legacy-run',
        at: '2025-01-01T00:00:00.000Z',
        event,
      })}\n`,
    )

    const records = await new FileCoordinationLog(path).records('legacy-run')
    expect(records).toEqual([
      {
        version: 3,
        runId: 'legacy-run',
        source: { nodeId: 'legacy-run', profileName: null },
        record: {
          seq: 0,
          at: Date.parse('2025-01-01T00:00:00.000Z'),
          priority: 0,
          event,
        },
      },
    ])
  })
})
