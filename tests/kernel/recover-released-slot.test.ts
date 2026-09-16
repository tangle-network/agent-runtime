/**
 * The 0.233.0 crash window, healed on resume. The release sweep appends a node's
 * `environment-teardown` receipt and then its terminal record; a process that dies between the
 * two leaves an open cursor slot beside a destroyed environment, and the next process treated
 * that node as interrupted: it tried to recover an executor whose environment was gone, or left
 * it open forever and charged the ceiling.
 *
 * `healReleasedSlots` closes that slot with the sweep's own record. The `reconciled` record now
 * carries the settlement and the cursor seq the driver saw, so the heal writes the identical
 * bytes at the identical seq — nothing is invented. Every clause of the gate is exercised here on
 * hand-built journals, because each one is a way the heal could otherwise close a slot the live
 * sweep would have left open.
 */

import {
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { contentAddress, materializeTreeView } from '../../src/durable/spawn-journal'
import { RuntimeRunStateError } from '../../src/errors'
import type { RetainedRunAdmission } from '../../src/runtime/retained-run-types'
import {
  knownExecutionBindingReceipt,
  knownMaterializationReceipt,
} from '../../src/runtime/supervise/materialization'
import {
  healReleasedSlots,
  prepareScopeResume,
  sumSpendFromEvents,
} from '../../src/runtime/supervise/recover-executors'
import { createInMemoryRunContext } from '../../src/runtime/supervise/run-context'
import type { Executor, SpawnEvent, Spend } from '../../src/runtime/supervise/types'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'
import { testAgentProfile } from './test-agent-profile'

const at = '2026-09-15T10:00:00.000Z'
const later = '2026-09-15T10:00:05.000Z'
const budget = { maxIterations: 4, maxTokens: 4000 }
const profile = testAgentProfile('retained')
const profileRef = contentAddress(profile)
const task = 'retained task'
const taskRef = contentAddress(task)
const identity = {
  profileDigest: canonicalAgentProfileDigest(profile),
  taskDigest: canonicalCandidateDigest(task),
}
const trace = { status: 'unavailable', reason: 'execution-did-not-start' } as const
const reason = 'retained provider execution requires reconciliation before replacement'

function floor(input: number, output: number): Spend {
  return {
    iterations: 1,
    tokens: { input, output },
    usd: 0,
    ms: 5,
    tokensKnown: false,
    usdKnown: false,
  }
}

function spawned(
  id: string,
  seq: number,
  overrides: Partial<Extract<SpawnEvent, { kind: 'spawned' }>> = {},
): SpawnEvent {
  return {
    kind: 'spawned',
    id,
    parent: 'r',
    label: id,
    budget,
    runtime: 'router',
    profileRef,
    identity,
    seq,
    at,
    ...overrides,
  }
}

const intent = (id: string): RetainedRunAdmission => ({
  phase: 'intent',
  provider: 'provider',
  idempotencyKey: `${id}-key`,
  turnId: `${id}-turn`,
  sessionId: `${id}-session`,
  executionId: `${id}-execution`,
  runId: 'r',
  requestedProfileDigest: identity.profileDigest,
  requestDigest: canonicalCandidateDigest({ request: id }),
})
const environment = (id: string, environmentId: string): RetainedRunAdmission => ({
  phase: 'environment',
  provider: 'provider',
  environmentId,
  idempotencyKey: `${id}-key`,
  turnId: `${id}-turn`,
  sessionId: `${id}-session`,
  executionId: `${id}-execution`,
})
const dispatched = (id: string, environmentId: string): RetainedRunAdmission => ({
  phase: 'dispatched',
  idempotencyKey: `${id}-key`,
  turnId: `${id}-turn`,
  controlRef: {
    provider: 'provider',
    environmentId,
    sessionId: `${id}-session`,
    executionId: `${id}-execution`,
    runId: 'r',
    requestDigest: canonicalCandidateDigest({ request: `${id}-exact` }),
  },
})

/** The admission chain a leaf writes before its execution: input, intent, environment. */
function admitted(id: string, environmentId: string): SpawnEvent[] {
  return [
    { kind: 'execution-input', id, taskRef, seq: 0, at },
    { kind: 'execution-admitted', id, admission: intent(id), seq: 0, at },
    { kind: 'execution-admitted', id, admission: environment(id, environmentId), seq: 1, at },
  ]
}

function reconciled(
  id: string,
  seq: number,
  spent: Spend,
  extra: Partial<Extract<SpawnEvent, { kind: 'reconciled' }>> = {},
): SpawnEvent {
  return { kind: 'reconciled', id, spent, seq, at, ...extra }
}

/** The whole settlement beside the floor, as 0.234.0's settle path writes it. */
const settlement = (settledSeq: number) => ({ settledSeq, reason, infra: true, trace })

function receipt(id: string, seq: number, environmentId: string, destroyed = true): SpawnEvent {
  return {
    kind: 'environment-teardown',
    id,
    provider: 'provider',
    environmentId,
    destroyed,
    seq,
    at: later,
  }
}

const root: SpawnEvent = {
  kind: 'spawned',
  id: 'r',
  label: 'root',
  budget: { maxIterations: 100, maxTokens: 100_000 },
  runtime: 'inline',
  seq: 0,
  at,
}

async function journaled(events: ReadonlyArray<SpawnEvent>) {
  const context = createInMemoryRunContext()
  await context.journal.beginTree('r', at)
  for (const event of events) await context.journal.appendEvent('r', event)
  await context.blobs.put(profileRef, profile)
  await context.blobs.put(taskRef, task)
  return context
}

const neverExecutes: Executor<unknown> = {
  runtime: 'router',
  execute: () => {
    throw new Error('recovery must not execute in these cases')
  },
  teardown: async () => ({ destroyed: true }),
  resultArtifact: () => {
    throw new Error('no result')
  },
}

const terminalRecords = (events: ReadonlyArray<SpawnEvent>, id: string) =>
  events.filter(
    (event) => event.id === id && (event.kind === 'settled' || event.kind === 'cancelled'),
  )

async function resume(
  context: Awaited<ReturnType<typeof journaled>>,
  options: { recover?: boolean; hooks?: RuntimeHookEvent[] } = {},
) {
  const events = (await context.journal.loadTree('r')) ?? []
  return prepareScopeResume(
    {
      runId: 'r',
      journal: context.journal,
      blobs: context.blobs,
      ...(options.recover ? { recoverExecutor: () => neverExecutes } : {}),
      ...(options.hooks
        ? {
            hooks: {
              onEvent: (event: RuntimeHookEvent) => {
                options.hooks?.push(event)
              },
            },
          }
        : {}),
    },
    events,
    new AbortController().signal,
    () => 1_000,
  )
}

describe('healReleasedSlots on resume', () => {
  it('writes the released record from the reconciled record at the seq the driver saw', async () => {
    const spent = floor(7, 3)
    const harnessTranscript = { status: 'unavailable', reason: 'capture-unsupported' } as const
    const context = await journaled([
      root,
      spawned('r:s0', 0),
      ...admitted('r:s0', 'env-1'),
      reconciled('r:s0', 0, spent, { ...settlement(4), harnessTranscript }),
      receipt('r:s0', 0, 'env-1'),
    ])
    const before = (await context.journal.loadTree('r')) ?? []
    // The withheld contract: the open node's view carries the floor and no overspend or marker.
    expect(materializeTreeView(before).nodes.find((node) => node.id === 'r:s0')).toMatchObject({
      status: 'pending',
      spent,
    })
    const hooks: RuntimeHookEvent[] = []
    const restored = await resume(context, { recover: true, hooks })
    const events = (await context.journal.loadTree('r')) ?? []
    expect(events).toHaveLength(before.length + 1)
    const reconciledRecord = before.find((event) => event.kind === 'reconciled')!
    expect(terminalRecords(events, 'r:s0')).toEqual([
      {
        kind: 'settled',
        status: 'down',
        id: 'r:s0',
        spent,
        infra: true,
        reason,
        trace,
        harnessTranscript,
        retainedExecution: 'released',
        seq: 4,
        at: reconciledRecord.at,
      },
    ])
    // Never interrupted: no recovery against the destroyed environment, and the floor is charged
    // exactly once, now as the terminal record's spend.
    expect(restored.resumeFrom.recoveries).toEqual([])
    expect(restored.poolRestore.uncertainReservations).toEqual([])
    expect(sumSpendFromEvents(events).childWork.tokens).toMatchObject({ input: 7, output: 3 })
    expect(restored.resumeFrom.maxCursorSeq).toBe(4)
    expect(restored.resumeFrom.settled).toMatchObject([
      { kind: 'down', retainedExecution: 'released', seq: 4, harnessTranscript },
    ])
    expect(restored.resumeFrom.view.nodes.find((node) => node.id === 'r:s0')).toMatchObject({
      status: 'failed',
      retainedExecution: 'released',
      spent,
    })
    // The sweep's own `agent.child` on the resumed stream, so a projection flips the node.
    expect(hooks).toMatchObject([
      {
        id: 'r:s0:released',
        runId: 'r',
        target: 'agent.child',
        stepIndex: 4,
        parentId: 'r',
        timestamp: 1_000,
        payload: {
          childId: 'r:s0',
          status: 'down',
          retainedExecution: 'released',
          reason,
          infra: true,
          spent,
          runtime: 'router',
          startedAt: Date.parse(at),
          settledAt: Date.parse(reconciledRecord.at),
          releasedAt: Date.parse(later),
        },
      },
    ])
    expect(hooks[0]?.payload).not.toHaveProperty('metered')
  })

  it('keeps the cancelled kind and its source, and carries the withheld overspend', async () => {
    const spent = floor(900, 0)
    const budgetViolation = {
      overspent: [{ channel: 'tokens', reserved: 800, spent: 900 }],
    }
    const context = await journaled([
      root,
      spawned('r:s0', 0),
      ...admitted('r:s0', 'env-1'),
      reconciled('r:s0', 0, spent, {
        ...settlement(2),
        budgetViolation,
        cancellation: { source: 'signal' },
      }),
      receipt('r:s0', 0, 'env-1'),
    ])
    const before = (await context.journal.loadTree('r')) ?? []
    // The open-slot view withholds the overspend the pool committed.
    expect(materializeTreeView(before).nodes.find((node) => node.id === 'r:s0')).not.toHaveProperty(
      'budgetViolation',
    )
    await resume(context)
    const events = (await context.journal.loadTree('r')) ?? []
    expect(terminalRecords(events, 'r:s0')).toMatchObject([
      {
        kind: 'cancelled',
        source: 'signal',
        retainedExecution: 'released',
        spent,
        budgetViolation,
        seq: 2,
      },
    ])
    expect(materializeTreeView(events).nodes.find((node) => node.id === 'r:s0')).toMatchObject({
      status: 'cancelled',
      retainedExecution: 'released',
      budgetViolation,
    })
  })

  it('leaves a reconciled record written before settledSeq existed open, still interrupted', async () => {
    const context = await journaled([
      root,
      spawned('r:s0', 0),
      ...admitted('r:s0', 'env-1'),
      reconciled('r:s0', 0, floor(7, 3)),
      receipt('r:s0', 0, 'env-1'),
    ])
    const before = (await context.journal.loadTree('r')) ?? []
    const restored = await resume(context, { recover: true })
    expect(await context.journal.loadTree('r')).toEqual(before)
    expect(restored.resumeFrom.recoveries.map((recovery) => recovery.spawned.id)).toEqual(['r:s0'])
    expect(restored.resumeFrom.maxCursorSeq).toBe(-1)
    expect(sumSpendFromEvents(before).childWork.tokens).toMatchObject({ input: 7, output: 3 })
  })

  it('refuses to reuse a cursor seq another record already closes', async () => {
    const context = await journaled([
      root,
      spawned('r:s0', 0),
      spawned('r:s1', 1),
      ...admitted('r:s0', 'env-1'),
      reconciled('r:s0', 0, floor(7, 3), settlement(4)),
      receipt('r:s0', 0, 'env-1'),
      {
        kind: 'settled',
        id: 'r:s1',
        status: 'done',
        outRef: contentAddress('other'),
        spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
        trace,
        seq: 4,
        at,
      },
    ])
    const before = (await context.journal.loadTree('r')) ?? []
    await expect(resume(context)).rejects.toThrow(RuntimeRunStateError)
    await expect(resume(context)).rejects.toThrow(/'r:s0' cannot be released at cursor seq 4/)
    expect(await context.journal.loadTree('r')).toEqual(before)
  })

  it.each([
    {
      name: 'the receipt sits before the latest reconciled record',
      tail: [receipt('r:s0', 0, 'env-1'), reconciled('r:s0', 0, floor(7, 3), settlement(4))],
    },
    {
      name: 'one of two receipts is destroyed: false',
      tail: [
        reconciled('r:s0', 0, floor(7, 3), settlement(4)),
        receipt('r:s0', 0, 'env-1'),
        receipt('r:s0', 1, 'env-1b', false),
      ],
    },
    {
      name: 'the receipt names an environment the last admission does not',
      tail: [reconciled('r:s0', 0, floor(7, 3), settlement(4)), receipt('r:s0', 0, 'env-2')],
    },
    {
      name: 'there is no receipt at all',
      tail: [reconciled('r:s0', 0, floor(7, 3), settlement(7))],
    },
  ])('leaves the slot open when $name', async ({ tail }) => {
    const context = await journaled([
      root,
      spawned('r:s0', 0),
      ...admitted('r:s0', 'env-1'),
      ...tail,
    ])
    const before = (await context.journal.loadTree('r')) ?? []
    const restored = await resume(context, { recover: true })
    expect(await context.journal.loadTree('r')).toEqual(before)
    expect(terminalRecords(before, 'r:s0')).toEqual([])
    expect(restored.resumeFrom.recoveries.map((recovery) => recovery.spawned.id)).toEqual(['r:s0'])
  })

  it('reserves an open node’s settledSeq on the resumed cursor even when it is not healed', async () => {
    const context = await journaled([
      root,
      spawned('r:s0', 0),
      ...admitted('r:s0', 'env-1'),
      reconciled('r:s0', 0, floor(7, 3), settlement(7)),
    ])
    const restored = await resume(context)
    expect(restored.resumeFrom.maxCursorSeq).toBe(7)
  })

  it('leaves a node with a recorded result to the recorded-result branch', async () => {
    const context = await journaled([
      root,
      spawned('r:s0', 0),
      ...admitted('r:s0', 'env-1'),
      {
        kind: 'execution-admitted',
        id: 'r:s0',
        admission: dispatched('r:s0', 'env-1'),
        seq: 2,
        at,
      },
      reconciled('r:s0', 0, floor(7, 3), settlement(4)),
      receipt('r:s0', 0, 'env-1'),
      {
        kind: 'execution-result',
        id: 'r:s0',
        outRef: contentAddress('result'),
        spent: { iterations: 1, tokens: { input: 3, output: 2 }, usd: 0, ms: 1 },
        seq: 0,
        at: later,
      },
    ])
    const before = (await context.journal.loadTree('r')) ?? []
    expect(
      await healReleasedSlots(
        { runId: 'r', journal: context.journal, blobs: context.blobs },
        new AbortController().signal,
        () => 1_000,
      ),
    ).toBe(0)
    expect(await context.journal.loadTree('r')).toEqual(before)
  })

  it('settles a recorded result past an open node’s reserved settledSeq, never on it', async () => {
    // r:s0 is retained-pending with settledSeq 1 and no receipt, so it stays open. r:s1 has a
    // recorded result. Before the shared floor, the recorded-result branch minted seq 1 (one past
    // the last CLOSED record) and wrote r:s1's settlement on the seq r:s0 had reserved.
    const materialized = knownMaterializationReceipt({
      authoredProfileDigest: identity.profileDigest,
      runtime: 'router',
      declaration: {
        effectiveProfile: profile,
        backend: 'router',
        model: { status: 'known', id: 'test/model' },
        execution: { kind: 'request', id: 'r:s1-execution' },
        materializer: 'test-router',
        plan: { kind: 'completion', model: 'test/model' },
      },
    })
    const bound = knownExecutionBindingReceipt(materialized, {
      attemptId: 'r:s1:attempt:1',
      binding: { endpoint: 'https://router.example.test', executionId: 'r:s1-execution' },
      descriptor: { kind: 'router-request', transport: 'http' },
    })
    const context = await journaled([
      root,
      spawned('r:s0', 0),
      ...admitted('r:s0', 'env-1'),
      reconciled('r:s0', 0, floor(7, 3), settlement(1)),
      spawned('r:s1', 1),
      ...admitted('r:s1', 'env-2'),
      { kind: 'materialized', id: 'r:s1', receipt: materialized, seq: 0, at },
      { kind: 'execution-bound', id: 'r:s1', binding: bound, seq: 0, at },
      {
        kind: 'execution-admitted',
        id: 'r:s1',
        admission: dispatched('r:s1', 'env-2'),
        seq: 2,
        at,
      },
      {
        kind: 'execution-result',
        id: 'r:s1',
        outRef: contentAddress('result'),
        spent: { iterations: 1, tokens: { input: 3, output: 2 }, usd: 0, ms: 1 },
        seq: 0,
        at: later,
      },
    ])
    await context.blobs.put(contentAddress('result'), 'result')
    const restored = await resume(context)
    const events = (await context.journal.loadTree('r')) ?? []
    const s1 = terminalRecords(events, 'r:s1')
    expect(s1).toHaveLength(1)
    expect(s1[0]?.seq).toBe(2)
    expect(terminalRecords(events, 'r:s0')).toEqual([])
    expect(restored.resumeFrom.maxCursorSeq).toBe(2)
  })

  it('writes nothing twice: a released record already present is left alone', async () => {
    const context = await journaled([
      root,
      spawned('r:s0', 0),
      ...admitted('r:s0', 'env-1'),
      reconciled('r:s0', 0, floor(7, 3), settlement(4)),
      receipt('r:s0', 0, 'env-1'),
    ])
    await resume(context)
    const healed = (await context.journal.loadTree('r')) ?? []
    const hooks: RuntimeHookEvent[] = []
    await resume(context, { hooks })
    expect(await context.journal.loadTree('r')).toEqual(healed)
    expect(hooks).toEqual([])
  })

  it('takes the latest reconciled record: its settledSeq, spent and settlement', async () => {
    const first = floor(7, 3)
    const second = floor(9, 4)
    const context = await journaled([
      root,
      spawned('r:s0', 0),
      ...admitted('r:s0', 'env-1'),
      reconciled('r:s0', 0, first, settlement(1)),
      receipt('r:s0', 0, 'env-1'),
      reconciled('r:s0', 1, second, { ...settlement(3), reason: 'second failure' }),
      receipt('r:s0', 1, 'env-1'),
    ])
    await resume(context)
    const events = (await context.journal.loadTree('r')) ?? []
    expect(terminalRecords(events, 'r:s0')).toMatchObject([
      { spent: second, reason: 'second failure', seq: 3, retainedExecution: 'released' },
    ])
    expect(sumSpendFromEvents(events).childWork.tokens).toMatchObject({ input: 9, output: 4 })
  })
})
