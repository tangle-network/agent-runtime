import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAllBytes } from '../../src/durable/jsonl-file'
import { FileSpawnJournal } from '../../src/durable/spawn-journal'
import type { CoordinationEvent } from '../../src/mcp/tools/coordination'
import { FileCoordinationLog } from '../../src/runtime/supervise/coordination-log'

describe('durable append-only JSONL', () => {
  it('finishes short writes instead of acknowledging a truncated record', async () => {
    const chunks: Buffer[] = []
    const handle = {
      async write(buffer: Uint8Array, offset: number, length: number) {
        const written = Math.min(3, length)
        chunks.push(Buffer.from(buffer.subarray(offset, offset + written)))
        return { bytesWritten: written, buffer }
      },
    }

    await writeAllBytes(handle, 'abcdefgh')

    expect(Buffer.concat(chunks).toString('utf8')).toBe('abcdefgh')
    expect(chunks.map((chunk) => chunk.length)).toEqual([3, 3, 2])
  })

  it('recovers only an invalid unterminated final spawn-journal record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spawn-jsonl-tail-'))
    try {
      const path = join(dir, 'spawn.jsonl')
      const journal = new FileSpawnJournal(path)
      await journal.beginTree('run', '2026-07-29T00:00:00.000Z')
      await appendFile(path, '{"kind":"event"')

      await expect(journal.loadTree('run')).resolves.toEqual([])
      await journal.beginTree('after-recovery', '2026-07-29T00:00:01.000Z')
      await expect(journal.loadTree('run')).resolves.toEqual([])
      await expect(journal.loadTree('after-recovery')).resolves.toEqual([])

      await writeFile(
        path,
        '{"kind":"begin","root":"run","at":"2026-07-29T00:00:00.000Z"}\n{bad}\n',
      )
      await expect(journal.loadTree('run')).rejects.toThrow(/malformed JSONL record at line 2/)

      await writeFile(
        path,
        '{bad}\n{"kind":"begin","root":"run","at":"2026-07-29T00:00:00.000Z"}\n',
      )
      await expect(journal.loadTree('run')).rejects.toThrow(/malformed JSONL record at line 1/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('recovers only an invalid unterminated final coordination-log record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coordination-jsonl-tail-'))
    try {
      const path = join(dir, 'coordination.jsonl')
      const log = new FileCoordinationLog(path)
      const question: CoordinationEvent = {
        type: 'question',
        question: {
          id: 'worker:q0',
          from: 'worker',
          level: 'worker',
          question: 'Continue?',
          reason: 'blocked',
          urgency: 'blocks-run',
          status: 'open',
          openedAt: 0,
        },
      }
      await log.append('run', { seq: 0, at: 0, priority: 20, event: question }, 'owner')
      await appendFile(path, '{"runId":"run"')

      await expect(log.load('run', 'owner')).resolves.toMatchObject({
        questions: [{ id: 'worker:q0', status: 'open' }],
      })
      await log.append(
        'run',
        {
          seq: 1,
          at: 1,
          priority: 20,
          event: {
            ...question,
            question: { ...question.question, id: 'worker:q1', question: 'Still continue?' },
          },
        },
        'owner',
      )
      await expect(log.load('run', 'owner')).resolves.toMatchObject({
        questions: [
          { id: 'worker:q0', status: 'open' },
          { id: 'worker:q1', status: 'open' },
        ],
      })

      await writeFile(path, '{bad}\n')
      await expect(log.load('run', 'owner')).rejects.toThrow(/malformed JSONL record at line 1/)

      await writeFile(path, '{bad}\n{}\n')
      await expect(log.load('run', 'owner')).rejects.toThrow(/malformed JSONL record at line 1/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
