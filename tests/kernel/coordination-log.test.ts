import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CoordinationEvent } from '../../src/mcp/tools/coordination-events'
import type { ContinuationInstruction } from '../../src/mcp/tools/coordination-messages'
import { FileCoordinationLog } from '../../src/runtime/supervise/coordination-log'
import type { BusRecord } from '../../src/runtime/supervise/event-bus'

function stamped(seq: number, event: CoordinationEvent): BusRecord<CoordinationEvent> {
  return { seq, at: 1_000 + seq, priority: event.type === 'question' ? 20 : 0, event }
}

function instruction(receiptId: string, text: string): ContinuationInstruction {
  return {
    receiptId,
    kind: 'steer',
    toWorker: 'worker-1',
    instruction: text,
    instructionDigest: `sha256:${receiptId.padEnd(64, '0').slice(0, 64)}`,
    interrupt: false,
  }
}

describe('FileCoordinationLog delivery evidence', () => {
  it('keeps a question blocking after a refused answer delivery across restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coordination-log-refused-answer-'))
    try {
      const log = new FileCoordinationLog(join(dir, 'coordination.jsonl'))
      const questionId = 'worker-1:q0'
      const receipt: ContinuationInstruction = {
        ...instruction('answer-refused', 'choose B'),
        kind: 'answer',
        questionId,
      }
      const question: CoordinationEvent = {
        type: 'question',
        question: {
          id: questionId,
          from: 'worker-1',
          level: 'worker',
          question: 'Which target?',
          reason: 'the experiment cannot continue without a target',
          urgency: 'blocks-run',
          status: 'open',
          openedAt: 0,
        },
      }
      const attempt: CoordinationEvent = {
        type: 'delivery-attempt',
        attempt: {
          receiptId: receipt.receiptId,
          kind: 'answer',
          toWorker: receipt.toWorker,
          instructionDigest: receipt.instructionDigest,
          interrupt: false,
          questionId,
        },
      }
      const refused: CoordinationEvent = {
        type: 'answer',
        questionId,
        down: {
          receiptId: receipt.receiptId,
          toWorker: receipt.toWorker,
          instruction: receipt.instruction,
          instructionDigest: receipt.instructionDigest,
          delivered: false,
          outcome: 'runtime-has-no-inbox',
        },
      }
      for (const [seq, event] of [
        question,
        { type: 'instruction', instruction: receipt },
        attempt,
        refused,
      ].entries() as ArrayIterator<[number, CoordinationEvent]>) {
        await log.append('run', stamped(seq, event), 'owner')
      }

      const prior = await log.load('run', 'owner')
      expect(prior.questions).toMatchObject([{ id: questionId, status: 'open' }])
      expect(prior.deliveryEvidence.at(-1)).toMatchObject({
        type: 'answer',
        down: { receiptId: receipt.receiptId, delivered: false },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('retains an unheard escalation across processes, so a resuming operator still sees it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coordination-log-escalation-'))
    try {
      const log = new FileCoordinationLog(join(dir, 'coordination.jsonl'))
      const unheard = {
        questionId: 'w0:q0',
        from: 'w0',
        urgency: 'blocks-run',
        delivered: false,
        reason:
          'this manager has no parent inbox in this run, so nothing above it can receive the question',
        at: 1_700_000_000_000,
      } as const
      const heard = {
        questionId: 'w1:q0',
        from: 'w1',
        urgency: 'blocks-step',
        delivered: true,
        to: 'the run operator',
        at: 1_700_000_000_100,
      } as const

      await log.append('run-1', stamped(0, { type: 'escalation', escalation: unheard }), 'owner-1')
      await log.append('run-1', stamped(1, { type: 'escalation', escalation: heard }), 'owner-1')
      await log.append(
        'run-1',
        stamped(2, { type: 'escalation', escalation: { ...unheard, from: 'other' } }),
        'owner-2',
      )

      const prior = await log.load('run-1', 'owner-1')
      expect(prior.escalations).toEqual([unheard, heard])
      expect(prior.escalations.filter((record) => !record.delivered)).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('retains an authored analyst definition across processes, exact bytes and digest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coordination-log-analyst-'))
    try {
      const log = new FileCoordinationLog(join(dir, 'coordination.jsonl'))
      const record = {
        definition: {
          id: 'handoff-loss',
          description: 'Did a worker lose context the parent had already established?',
          area: 'coordination',
          question: 'Where did a child re-derive a fact its parent had already given it?',
          instructions: 'Read every tool span. Cite the span that shows the re-derivation.',
          toolGroup: 'discoveryAndRead',
        },
        kind: {
          id: 'handoff-loss',
          description: 'Did a worker lose context the parent had already established?',
          area: 'coordination',
        },
        digest: `sha256:${'a'.repeat(64)}`,
        definedAt: 1_700_000_000_000,
      } as const

      await log.append('run-1', stamped(0, { type: 'analyst-defined', analyst: record }), 'owner-1')
      // Another owner's definition must not leak into this owner's replay.
      await log.append(
        'run-1',
        stamped(1, {
          type: 'analyst-defined',
          analyst: { ...record, kind: { ...record.kind, id: 'other-owner-lens' } },
        }),
        'owner-2',
      )

      const prior = await log.load('run-1', 'owner-1')
      expect(prior.analystDefinitions).toHaveLength(1)
      expect(prior.analystDefinitions[0]).toEqual(record)
      expect(prior.analystDefinitions[0]?.definition.instructions).toBe(
        record.definition.instructions,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
