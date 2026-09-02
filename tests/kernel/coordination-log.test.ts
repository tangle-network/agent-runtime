import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import type { ContinuationInstruction, CoordinationEvent } from '../../src/mcp/tools/coordination'
import { createCoordinationTools } from '../../src/mcp/tools/coordination'
import { FileCoordinationLog } from '../../src/runtime/supervise/coordination-log'
import type { BusRecord } from '../../src/runtime/supervise/event-bus'
import type { Agent, Scope } from '../../src/runtime/supervise/types'

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

function evidenceChain(
  receipt: ContinuationInstruction,
  outcome: 'delivered' | 'runtime-has-no-inbox',
): CoordinationEvent[] {
  return [
    { type: 'instruction', instruction: receipt },
    {
      type: 'delivery-attempt',
      attempt: {
        receiptId: receipt.receiptId,
        kind: receipt.kind,
        toWorker: receipt.toWorker,
        instructionDigest: receipt.instructionDigest,
        interrupt: receipt.interrupt,
      },
    },
    {
      type: 'steer',
      down: {
        receiptId: receipt.receiptId,
        toWorker: receipt.toWorker,
        instruction: receipt.instruction,
        instructionDigest: receipt.instructionDigest,
        delivered: outcome === 'delivered',
        outcome,
      },
    },
  ]
}

describe('FileCoordinationLog delivery evidence', () => {
  it('keeps complete success and refusal chains linked and isolated by stable owner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coordination-log-owner-'))
    try {
      const log = new FileCoordinationLog(join(dir, 'coordination.jsonl'))
      const accepted = instruction('accepted', 'continue A')
      const refused = instruction('refused', 'continue B')
      for (const [seq, event] of evidenceChain(accepted, 'delivered').entries()) {
        await log.append('run', stamped(seq, event), 'owner-A')
      }
      for (const [seq, event] of evidenceChain(refused, 'runtime-has-no-inbox').entries()) {
        await log.append('run', stamped(seq, event), 'owner-B')
      }

      const ownerA = await log.load('run', 'owner-A')
      const ownerB = await log.load('run', 'owner-B')
      expect(ownerA.continuations.map((entry) => entry.receiptId)).toEqual(['accepted'])
      expect(ownerA.deliveryEvidence.map((entry) => entry.type)).toEqual([
        'delivery-attempt',
        'steer',
      ])
      expect(ownerB.continuations.map((entry) => entry.receiptId)).toEqual(['refused'])
      expect(ownerB.deliveryEvidence.map((entry) => entry.type)).toEqual([
        'delivery-attempt',
        'steer',
      ])
      const acceptedOutcome = ownerA.deliveryEvidence.find((entry) => entry.type === 'steer')
      const refusedOutcome = ownerB.deliveryEvidence.find((entry) => entry.type === 'steer')
      expect(acceptedOutcome?.down).toMatchObject({ receiptId: 'accepted', outcome: 'delivered' })
      expect(refusedOutcome?.down).toMatchObject({
        receiptId: 'refused',
        outcome: 'runtime-has-no-inbox',
      })
      expect(ownerA.records.map(({ seq, at, priority }) => ({ seq, at, priority }))).toEqual([
        { seq: 0, at: 1000, priority: 0 },
        { seq: 1, at: 1001, priority: 0 },
        { seq: 2, at: 1002, priority: 0 },
      ])

      const raw = (await readFile(join(dir, 'coordination.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { ownerId?: string })
      expect(raw.map((record) => record.ownerId)).toEqual([
        'owner-A',
        'owner-A',
        'owner-A',
        'owner-B',
        'owner-B',
        'owner-B',
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves an attempted-but-unconfirmed delivery as unknown evidence without inventing an outcome', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coordination-log-crash-window-'))
    try {
      const log = new FileCoordinationLog(join(dir, 'coordination.jsonl'))
      const receipt = instruction('crashed', 'do not replay me')
      const [authorized, attempted] = evidenceChain(receipt, 'delivered')
      if (!authorized || !attempted) throw new Error('missing evidence fixture')
      await log.append('run', stamped(0, authorized), 'owner')
      await log.append('run', stamped(1, attempted), 'owner')

      const prior = await log.load('run', 'owner')
      expect(prior.continuations.map((entry) => entry.receiptId)).toEqual(['crashed'])
      expect(prior.deliveryEvidence).toEqual([attempted])
      expect(
        prior.deliveryEvidence.some((entry) => entry.type === 'steer' || entry.type === 'answer'),
      ).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

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

  it('serializes concurrent appends and replays the exact bus ordering metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coordination-log-concurrent-order-'))
    try {
      const log = new FileCoordinationLog(join(dir, 'coordination.jsonl'))
      const scope = {
        send: () => false,
        next: async () => null,
        get view() {
          return { root: 'run', nodes: [], inFlight: 0, waiting: 0 }
        },
        budget: {
          tokensLeft: 100,
          tokensKnown: true,
          usdLeft: 0,
          usdCapped: false,
          usdKnown: true,
          iterationsLeft: 10,
          deadlineMs: 0,
          reservedTokens: 0,
        },
        signal: new AbortController().signal,
      } as unknown as Scope<unknown>
      const coord = createCoordinationTools({
        scope,
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () =>
          ({ name: 'unused', act: async () => undefined }) as Agent<unknown, unknown>,
        perWorker: { maxIterations: 1, maxTokens: 10 },
        onEvent: (_event, record) => log.append('run', record, 'owner'),
      })
      const steer = coord.tools.find((tool) => tool.name === 'steer_agent')
      if (!steer) throw new Error('steer_agent tool missing')

      await Promise.all([
        steer.handler({ workerId: 'missing-A', instruction: 'continue A' }),
        steer.handler({ workerId: 'missing-B', instruction: 'continue B' }),
      ])

      const prior = await log.load('run', 'owner')
      expect(prior.records.map((record) => record.seq)).toEqual([0, 1, 2, 3, 4, 5])
      for (const receipt of prior.continuations) {
        const receiptSeq = prior.records.find(
          (record) =>
            record.event.type === 'instruction' &&
            record.event.instruction.receiptId === receipt.receiptId,
        )?.seq
        const attemptSeq = prior.records.find(
          (record) =>
            record.event.type === 'delivery-attempt' &&
            record.event.attempt.receiptId === receipt.receiptId,
        )?.seq
        const outcomeSeq = prior.records.find(
          (record) =>
            record.event.type === 'steer' && record.event.down.receiptId === receipt.receiptId,
        )?.seq
        expect(receiptSeq).toBeTypeOf('number')
        expect(attemptSeq).toBeGreaterThan(receiptSeq as number)
        expect(outcomeSeq).toBeGreaterThan(attemptSeq as number)
      }
      expect(prior.records.every((record) => record.priority === 0)).toBe(true)
      expect(prior.records.every((record) => Number.isFinite(record.at))).toBe(true)
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
})
