import { describe, expect, it } from 'vitest'
import { type ObserverRecord, observerRecordDigest } from '../observer-journal'
import { projectPursuit } from '../observer-projection'

function record(
  sequence: number,
  input: Omit<ObserverRecord, 'schemaVersion' | 'pursuitId' | 'sequence' | 'observedAt' | 'digest'>,
  previousDigest?: string,
): ObserverRecord {
  const unsigned = {
    schemaVersion: 1 as const,
    pursuitId: 'pursuit:test',
    sequence,
    observedAt: sequence * 10,
    ...(previousDigest ? { previousDigest } : {}),
    ...input,
  }
  return { ...unsigned, digest: observerRecordDigest(unsigned) }
}

/** Chain a list of unsigned observations into one verifiable journal. */
function chain(
  inputs: ReadonlyArray<
    Omit<ObserverRecord, 'schemaVersion' | 'pursuitId' | 'sequence' | 'observedAt' | 'digest'>
  >,
): ObserverRecord[] {
  const out: ObserverRecord[] = []
  for (const [index, input] of inputs.entries()) {
    out.push(record(index + 1, input, out.at(-1)?.digest))
  }
  return out
}

function spawn(
  runId: string,
  childId: string,
  parentId: string,
  label: string,
): Parameters<typeof chain>[0][number] {
  return {
    kind: 'event',
    event: {
      id: `spawn:${childId}`,
      pursuitId: 'pursuit:test',
      runId,
      target: 'agent.spawn',
      phase: 'after',
      timestamp: 1,
      parentId,
      payload: { childId, label, runtime: 'sandbox' },
    },
  }
}

function settle(
  runId: string,
  childId: string,
  parentId: string,
  spent: Record<string, unknown>,
): Parameters<typeof chain>[0][number] {
  return {
    kind: 'event',
    event: {
      id: `settle:${childId}`,
      pursuitId: 'pursuit:test',
      runId,
      target: 'agent.child',
      phase: 'after',
      timestamp: 2,
      parentId,
      payload: { childId, status: 'done', spent },
    },
  }
}

function spend(
  input: number,
  output: number,
  usd: number,
  flags: Record<string, unknown> = {},
): Record<string, unknown> {
  return { iterations: 1, tokens: { input, output }, usd, ms: 10, ...flags }
}

describe('projectPursuit', () => {
  it('keeps run lifecycle and recursive terminal truth isolated per Runtime run', () => {
    const first = record(1, {
      kind: 'event',
      event: {
        id: 'run-a-before',
        pursuitId: 'pursuit:test',
        runId: 'run:1',
        target: 'agent.run',
        phase: 'before',
        timestamp: 1,
      },
    })
    const second = record(
      2,
      {
        kind: 'event',
        event: {
          id: 'spawn-a',
          pursuitId: 'pursuit:test',
          runId: 'run:1',
          target: 'agent.spawn',
          phase: 'after',
          timestamp: 2,
          parentId: 'root',
          payload: {
            childId: 'root:s0',
            label: 'researcher',
            runtime: 'sandbox',
            depth: 0,
            identity: { candidateDigest: 'sha256:a' },
          },
        },
      },
      first.digest,
    )
    const third = record(
      3,
      {
        kind: 'decision',
        decision: {
          id: 'decision-a',
          pursuitId: 'pursuit:test',
          runId: 'run:1',
          stepIndex: 0,
          kind: 'continue',
          candidateActions: ['continue'],
          evidence: [],
        },
      },
      second.digest,
    )
    const fourth = record(
      4,
      {
        kind: 'event',
        event: {
          id: 'run-b-before',
          pursuitId: 'pursuit:test',
          runId: 'run:2',
          target: 'agent.run',
          phase: 'before',
          timestamp: 4,
        },
      },
      third.digest,
    )
    // A different top-level Runtime run may legitimately mint the same local node id.
    const fifth = record(
      5,
      {
        kind: 'event',
        event: {
          id: 'spawn-b',
          pursuitId: 'pursuit:test',
          runId: 'run:2',
          target: 'agent.spawn',
          phase: 'after',
          timestamp: 5,
          parentId: 'root',
          payload: {
            childId: 'root:s0',
            label: 'critic',
            runtime: 'bridge',
            depth: 0,
          },
        },
      },
      fourth.digest,
    )
    const sixth = record(
      6,
      {
        kind: 'event',
        event: {
          id: 'settle-b',
          pursuitId: 'pursuit:test',
          runId: 'run:2',
          target: 'agent.child',
          phase: 'after',
          timestamp: 6,
          parentId: 'root',
          payload: {
            childId: 'root:s0',
            status: 'done',
            outRef: 'sha256:out',
            score: 0.9,
            valid: true,
            spent: {
              iterations: 1,
              tokens: { input: 100, output: 23 },
              usd: 0.004,
              ms: 900,
            },
          },
        },
      },
      fifth.digest,
    )
    const seventh = record(
      7,
      {
        kind: 'event',
        event: {
          id: 'run-b-after',
          pursuitId: 'pursuit:test',
          runId: 'run:2',
          target: 'agent.run',
          phase: 'after',
          timestamp: 7,
          payload: { status: 'done' },
        },
      },
      sixth.digest,
    )

    const view = projectPursuit([first, second, third, fourth, fifth, sixth, seventh])
    expect(view.pursuitId).toBe('pursuit:test')
    expect(view.sequence).toBe(7)
    expect(view.chainTip).toBe(seventh.digest)
    expect(view.runs.map((run) => [run.runId, run.status])).toEqual([
      ['run:1', 'running'],
      ['run:2', 'done'],
    ])
    expect(view.runs[0]?.decisions.continue).toBe(1)
    expect(view.runs[1]?.settledAt).toBe(70)
    expect(view.nodes.map((node) => [node.runId, node.id, node.parentId])).toEqual([
      ['run:1', 'root:s0', 'root'],
      ['run:2', 'root:s0', 'root'],
    ])
    expect(view.nodes[0]?.status).toBe('running')
    expect(view.nodes[1]).toMatchObject({
      status: 'done',
      settledAt: 60,
      outRef: 'sha256:out',
      score: 0.9,
      valid: true,
      spent: { iterations: 1, tokens: { input: 100, output: 23 }, usd: 0.004, ms: 900 },
      usage: { input: 100, output: 23, tokensKnown: true },
      cost: { usd: 0.004, usdKnown: true, provenance: 'reported' },
    })
  })

  it('projects an authoritative root failure without treating a child as the pursuit verdict', () => {
    const first = record(1, {
      kind: 'event',
      event: {
        id: 'before',
        pursuitId: 'pursuit:test',
        runId: 'run:failed',
        target: 'agent.run',
        phase: 'before',
        timestamp: 1,
      },
    })
    const second = record(
      2,
      {
        kind: 'event',
        event: {
          id: 'error',
          pursuitId: 'pursuit:test',
          runId: 'run:failed',
          target: 'agent.run',
          phase: 'error',
          timestamp: 2,
          payload: { status: 'failed', error: 'driver crashed' },
        },
      },
      first.digest,
    )

    expect(projectPursuit([first, second]).runs[0]).toMatchObject({
      runId: 'run:failed',
      status: 'failed',
      settledAt: 20,
      error: 'driver crashed',
    })
  })

  it('refuses mixed or tampered observer history before projecting it', () => {
    const first = record(1, {
      kind: 'event',
      event: {
        id: 'a',
        pursuitId: 'pursuit:test',
        runId: 'run:1',
        target: 'agent.run',
        phase: 'event',
        timestamp: 1,
      },
    })
    const secondUnsigned = {
      schemaVersion: 1 as const,
      pursuitId: 'pursuit:other',
      sequence: 2,
      observedAt: 20,
      previousDigest: first.digest,
      kind: 'event' as const,
      event: {
        id: 'b',
        pursuitId: 'pursuit:other',
        runId: 'run:2',
        target: 'agent.run' as const,
        phase: 'event' as const,
        timestamp: 2,
      },
    }
    const second: ObserverRecord = {
      ...secondUnsigned,
      digest: observerRecordDigest(secondUnsigned),
    }
    expect(() => projectPursuit([first, second])).toThrow(/pursuit/i)

    const tampered: ObserverRecord = {
      ...first,
      event: { ...first.event!, runId: 'run:forged' },
    }
    expect(() => projectPursuit([tampered])).toThrow(/digest mismatch/)
  })

  it('charges a parent only its own share and never invents a zero for an unaccounted node', () => {
    // `worker` is a driver: its settlement already reports the child work `nested` did, so summing
    // every node would bill that work twice. `stalled` never settles at all.
    const view = projectPursuit(
      chain([
        spawn('run:tree', 'root:s0', 'run:tree', 'worker'),
        spawn('run:tree', 'root:s0:s0', 'root:s0', 'nested'),
        spawn('run:tree', 'root:s1', 'run:tree', 'stalled'),
        settle('run:tree', 'root:s0:s0', 'root:s0', spend(40, 10, 0.002)),
        settle('run:tree', 'root:s0', 'run:tree', spend(140, 60, 0.009)),
      ]),
    )

    const run = view.runs[0]!
    expect(run.totals.inclusive.tokens).toMatchObject({ input: 140, output: 60 })
    expect(run.totals.inclusive.usd).toBeCloseTo(0.009, 10)
    expect(run.totals.exclusiveByNode['root:s0']).toMatchObject({
      tokens: { input: 100, output: 50 },
    })
    expect(run.totals.exclusiveByNode['root:s0:s0']).toMatchObject({
      tokens: { input: 40, output: 10 },
    })
    const exclusive = Object.values(run.totals.exclusiveByNode)
    expect(exclusive.reduce((sum, share) => sum + share.tokens.input, 0)).toBe(140)
    expect(exclusive.reduce((sum, share) => sum + share.usd, 0)).toBeCloseTo(0.009, 10)

    const stalled = view.nodes.find((node) => node.label === 'stalled')
    expect(stalled?.usage).toBeUndefined()
    expect(stalled?.cost).toBeUndefined()
    expect(stalled).not.toHaveProperty('spent')
    expect(run.totals.exclusiveByNode).not.toHaveProperty('root:s1')
    expect(run.spendGaps).toEqual([
      { id: 'root:s1', label: 'stalled', kind: 'never-settled', channels: ['tokens', 'usd'] },
    ])
  })

  it('keeps a reported, estimated, partly-priced and unpriced cost distinguishable', () => {
    const view = projectPursuit(
      chain([
        spawn('run:cost', 'root:s0', 'run:cost', 'billed'),
        spawn('run:cost', 'root:s1', 'run:cost', 'priced'),
        spawn('run:cost', 'run:cost:s2', 'run:cost', 'mixed'),
        spawn('run:cost', 'root:s3', 'run:cost', 'silent'),
        settle('run:cost', 'root:s0', 'run:cost', spend(10, 5, 0.004)),
        settle(
          'run:cost',
          'root:s1',
          'run:cost',
          spend(10, 5, 0.004, { usdKnown: false, usdEstimated: 0.004 }),
        ),
        settle(
          'run:cost',
          'run:cost:s2',
          'run:cost',
          spend(10, 5, 0.01, { usdKnown: false, usdEstimated: 0.003 }),
        ),
        settle(
          'run:cost',
          'root:s3',
          'run:cost',
          spend(10, 5, 0, { usdKnown: false, tokensKnown: false }),
        ),
      ]),
    )

    expect(
      view.nodes.map((node) => [node.label, node.cost?.provenance, node.usage?.tokensKnown]),
    ).toEqual([
      ['billed', 'reported', true],
      ['priced', 'estimated', true],
      ['mixed', 'partial', true],
      ['silent', 'unknown', false],
    ])
    expect(view.runs[0]?.spendGaps).toEqual([
      { id: 'root:s1', label: 'priced', kind: 'unreported', channels: ['usd'] },
      { id: 'run:cost:s2', label: 'mixed', kind: 'unreported', channels: ['usd'] },
      { id: 'root:s3', label: 'silent', kind: 'unreported', channels: ['tokens', 'usd'] },
    ])
  })

  it('folds a metered turn onto the node that drove it, keeping reasoning tokens and call identity', () => {
    const turn = (nodeId: string, callId: string, reasoning: number) => ({
      kind: 'event' as const,
      event: {
        id: `turn:${callId}`,
        pursuitId: 'pursuit:test',
        runId: 'run:turn',
        target: 'agent.turn' as const,
        phase: 'after' as const,
        timestamp: 3,
        parentId: nodeId,
        payload: {
          spend: spend(30, 12, 0.005),
          reasoningTokens: reasoning,
          callId,
          model: 'offline/reasoner',
        },
      },
    })
    const view = projectPursuit(
      chain([
        spawn('run:turn', 'root:s0', 'run:turn', 'driver'),
        turn('root:s0', 'call-1', 90),
        turn('root:s0', 'call-2', 60),
        // A duplicate call id must not be counted twice.
        turn('root:s0', 'call-2', 0),
        settle('run:turn', 'root:s0', 'run:turn', spend(10, 4, 0.001)),
      ]),
    )

    const driver = view.nodes[0]!
    expect(driver.modelCalls).toEqual(['call-1', 'call-2'])
    expect(driver.model).toBe('offline/reasoner')
    expect(driver.turnCount).toBe(3)
    expect(driver.usage).toMatchObject({ input: 100, output: 40, reasoning: 150 })
    expect(driver.cost?.usd).toBeCloseTo(0.016, 10)
    expect(driver.timing?.firstOutputAt).toBe(20)
    expect(driver.timing?.firstTokenAt).toBeUndefined()
    expect(view.runs[0]?.totals.inclusive.tokens).toMatchObject({ input: 100, output: 40 })
  })
})
