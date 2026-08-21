import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileConversationJournal } from '../../src/conversation/journal'
import { writeAllBytes } from '../../src/durable/jsonl-file'
import { FileSpawnJournal } from '../../src/durable/spawn-journal'
import type { CoordinationEvent } from '../../src/mcp/tools/coordination'
import { FileCorpus } from '../../src/runtime/personify/corpus'
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
  it('recovers only an invalid unterminated final conversation record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conversation-jsonl-tail-'))
    try {
      const path = join(dir, 'conversation.jsonl')
      const journal = new FileConversationJournal(path)
      await journal.beginRun('run', '2026-08-21T00:00:00.000Z')
      await journal.appendTurn('run', {
        turnId: 'run:0:agent',
        index: 0,
        speaker: 'agent',
        content: 'hello',
      })
      await appendFile(path, '{"kind":"turn","runId":"run"')

      // The uncommitted tail is skipped, not fatal: a crash mid-append must not make every later
      // read of an acknowledged transcript throw.
      await expect(journal.loadRun('run')).resolves.toMatchObject({
        runId: 'run',
        turns: [{ turnId: 'run:0:agent' }],
      })
      await journal.appendTurn('run', {
        turnId: 'run:1:user',
        index: 1,
        speaker: 'user',
        content: 'again',
      })
      const resumed = await journal.loadRun('run')
      expect(resumed?.turns.map((turn) => turn.turnId)).toEqual(['run:0:agent', 'run:1:user'])

      await writeFile(path, '{bad}\n')
      await expect(journal.loadRun('run')).rejects.toThrow(/malformed JSONL record at line 1/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('recovers only an invalid unterminated final corpus record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'corpus-jsonl-tail-'))
    try {
      const path = join(dir, 'corpus.jsonl')
      const corpus = new FileCorpus(path)
      const fact = {
        schemaVersion: '1.0.0' as const,
        id: 'f0',
        runId: 'run',
        producedAt: '2026-08-21T00:00:00.000Z',
        area: 'tooling',
        claim: 'check state before acting',
        tags: ['x'],
        confidence: 0.9,
      }
      expect(await corpus.append(fact)).toEqual({ succeeded: true })
      await appendFile(path, '{"id":"f1"')

      await expect(corpus.query({})).resolves.toMatchObject([{ id: 'f0' }])
      expect(await corpus.append({ ...fact, id: 'f1', claim: 'read the failure first' })).toEqual({
        succeeded: true,
      })
      const stored = await corpus.query({})
      expect(stored.map((record) => record.id).sort()).toEqual(['f0', 'f1'])

      await writeFile(path, '{bad}\n')
      await expect(corpus.query({})).rejects.toThrow(/malformed JSONL record at line 1/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
