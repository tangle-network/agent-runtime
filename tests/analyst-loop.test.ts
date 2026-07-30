import {
  type AnalystFinding,
  AnalystRegistry,
  type AnalystRunEvent,
  type AnalystRunInputs,
  type AnalystRunResult,
} from '@tangle-network/agent-eval'
import { describe, expect, it, vi } from 'vitest'
import type {
  AnalystLoopEvent,
  AnalystRegistryLike,
  AnalystRegistryStreamingLike,
  FindingsStoreLike,
  ImprovementProposalSource,
  KnowledgeProposalSource,
} from '../src/analyst-loop'
import { runAnalystLoop } from '../src/analyst-loop'

function f(id: string, analystId: string, partial: Partial<AnalystFinding> = {}): AnalystFinding {
  return {
    schema_version: '1.0.0',
    finding_id: id,
    analyst_id: analystId,
    produced_at: '2026-05-19T00:00:00Z',
    area: analystId,
    severity: 'high',
    claim: `${id}-claim`,
    confidence: 0.9,
    evidence_refs: [],
    ...partial,
  }
}

function inMemoryStore(): FindingsStoreLike & {
  rows: Array<AnalystFinding & { run_id: string }>
} {
  const rows: Array<AnalystFinding & { run_id: string }> = []
  return {
    rows,
    loadAll: () => rows,
    loadRun: (runId) => rows.filter((r) => r.run_id === runId),
    append: async (runId, findings) => {
      for (const f of findings) rows.push({ ...f, run_id: runId })
    },
  }
}

function stubRegistry(
  result: Pick<AnalystRunResult, 'findings'> & Partial<AnalystRunResult>,
  ids: string[],
): AnalystRegistryLike & { lastOpts: unknown } {
  const stub = {
    lastOpts: undefined as unknown,
    list: () => ids.map((id) => ({ id })),
    run: vi.fn(async (runId: string, _inputs: AnalystRunInputs, opts?: unknown) => {
      stub.lastOpts = opts
      return {
        run_id: runId,
        correlation_id: 'corr',
        started_at: '2026-05-19T00:00:00Z',
        ended_at: '2026-05-19T00:00:01Z',
        per_analyst: ids.map((id) => ({
          analyst_id: id,
          status: 'ok' as const,
          findings_count: result.findings.filter((x) => x.analyst_id === id).length,
          latency_ms: 1,
          cost_usd: 0,
        })),
        total_cost_usd: 0,
        total_cost_provenance: { kind: 'observed' as const, usd: 0 },
        ...result,
      }
    }),
  }
  return stub as AnalystRegistryLike & { lastOpts: unknown }
}

async function captureSameRunUpstreamFindings(
  chainFindings?: boolean,
  streaming = false,
): Promise<{
  seen: ReadonlyArray<AnalystFinding> | undefined
  emittedEvents: number
}> {
  let seen: ReadonlyArray<AnalystFinding> | undefined
  let emittedEvents = 0
  const registry = new AnalystRegistry()
  registry.register({
    id: 'first',
    description: 'Produces the first diagnosis.',
    inputKind: 'custom',
    cost: { kind: 'deterministic' },
    version: '1',
    async analyze() {
      return [f('first-finding', 'first')]
    },
  })
  registry.register({
    id: 'second',
    description: 'Consumes an earlier diagnosis when chaining is enabled.',
    inputKind: 'custom',
    cost: { kind: 'deterministic' },
    version: '1',
    async analyze(_input, context) {
      seen = context.upstreamFindings
      return []
    },
  })

  await runAnalystLoop({
    runId: 'run-cur',
    registry,
    inputs: { custom: { first: true, second: true } },
    findingsStore: null,
    chainFindings,
    ...(streaming
      ? {
          onEvent: () => {
            emittedEvents++
          },
        }
      : {}),
    log: () => {},
  })

  return { seen, emittedEvents }
}

describe('runAnalystLoop', () => {
  it('returns the full loop duration', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(10).mockReturnValueOnce(35)
    try {
      const out = await runAnalystLoop({
        runId: 'timed-run',
        registry: stubRegistry({ findings: [] }, []),
        inputs: {},
        findingsStore: null,
        log: () => {},
      })
      expect(out.durationMs).toBe(25)
    } finally {
      now.mockRestore()
    }
  })

  it('runs registry → persists findings → diffs against the auto-picked baseline', async () => {
    const store = inMemoryStore()
    await store.append('run-prev', [f('f-old', 'failure-mode')])
    const registry = stubRegistry(
      { findings: [f('f-new', 'failure-mode'), f('f-old', 'failure-mode')] },
      ['failure-mode'],
    )

    const out = await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: store,
      log: () => {},
    })

    expect(out.baselineRunId).toBe('run-prev')
    expect(out.diff?.appeared.map((d) => d.finding_id)).toEqual(['f-new'])
    expect(out.diff?.persisted.map((d) => d.finding_id)).toEqual(['f-old'])
    expect(
      store
        .loadRun('run-cur')
        .map((r) => r.finding_id)
        .sort(),
    ).toEqual(['f-new', 'f-old'])
  })

  it('forwards prior findings via per-kind strategy by default', async () => {
    const store = inMemoryStore()
    await store.append('run-prev', [f('f-old', 'failure-mode'), f('g-old', 'knowledge-gap')])
    const registry = stubRegistry({ findings: [] }, ['failure-mode', 'knowledge-gap'])

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: store,
      log: () => {},
    })

    const opts = registry.lastOpts as { priorFindings: ReadonlyArray<AnalystFinding> }
    expect(opts.priorFindings.map((f) => f.finding_id).sort()).toEqual(['f-old', 'g-old'])
  })

  it('wildcard strategy broadcasts prior findings to all analysts via "*"', async () => {
    const store = inMemoryStore()
    await store.append('run-prev', [f('f-old', 'failure-mode')])
    const registry = stubRegistry({ findings: [] }, ['improvement'])

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: store,
      priorFindingsStrategy: 'wildcard',
      log: () => {},
    })

    const opts = registry.lastOpts as { priorFindings: Record<string, AnalystFinding[]> }
    expect(opts.priorFindings['*']?.[0]?.finding_id).toBe('f-old')
  })

  it('priorFindingsStrategy:"none" passes no prior context', async () => {
    const store = inMemoryStore()
    await store.append('run-prev', [f('f-old', 'failure-mode')])
    const registry = stubRegistry({ findings: [] }, ['failure-mode'])

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: store,
      priorFindingsStrategy: 'none',
      log: () => {},
    })

    const opts = registry.lastOpts as { priorFindings?: unknown }
    expect(opts.priorFindings).toBeUndefined()
  })

  it('passes earlier same-run findings to later analysts when chaining is enabled', async () => {
    const { seen } = await captureSameRunUpstreamFindings(true)

    expect(seen?.map((finding) => finding.finding_id)).toEqual(['first-finding'])
  })

  it('passes earlier same-run findings through the streaming registry path', async () => {
    const { seen, emittedEvents } = await captureSameRunUpstreamFindings(true, true)

    expect(emittedEvents).toBeGreaterThan(0)
    expect(seen?.map((finding) => finding.finding_id)).toEqual(['first-finding'])
  })

  it('forwards an explicit false chain setting', async () => {
    const registry = stubRegistry({ findings: [] }, [])

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      chainFindings: false,
      log: () => {},
    })

    const opts = registry.lastOpts as { chainFindings?: boolean }
    expect(opts.chainFindings).toBe(false)
  })

  it('keeps same-run findings isolated by default', async () => {
    expect((await captureSameRunUpstreamFindings()).seen).toBeUndefined()
  })

  it('baselineRunId:null skips diff entirely', async () => {
    const store = inMemoryStore()
    await store.append('run-prev', [f('f-old', 'failure-mode')])
    const registry = stubRegistry({ findings: [f('f-new', 'failure-mode')] }, ['failure-mode'])

    const out = await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: store,
      baselineRunId: null,
      log: () => {},
    })

    expect(out.baselineRunId).toBeNull()
    expect(out.diff).toBeNull()
  })

  it('returns every knowledge proposal without applying customer state', async () => {
    const findings = [
      f('high', 'knowledge-gap', { confidence: 0.95, subject: 'agent-knowledge:wiki:x' }),
      f('low', 'knowledge-gap', { confidence: 0.6, subject: 'agent-knowledge:wiki:y' }),
    ]
    const registry = stubRegistry({ findings }, ['knowledge-gap'])
    const source: KnowledgeProposalSource = {
      proposeFromFindings: () => ({
        proposals: findings.map((f) => ({
          sourceFindingId: f.finding_id,
          path: `knowledge/${f.subject}.md`,
        })),
        skipped: 0,
        errors: [],
      }),
    }

    const out = await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      knowledgeProposalSource: source,
      log: () => {},
    })

    expect(out.knowledge?.proposals).toEqual([
      { sourceFindingId: 'high', path: 'knowledge/agent-knowledge:wiki:x.md' },
      { sourceFindingId: 'low', path: 'knowledge/agent-knowledge:wiki:y.md' },
    ])
  })

  it('returns every agent-surface edit without applying customer state', async () => {
    const findings = [
      f('h', 'improvement', { confidence: 0.92, subject: 'system-prompt:x' }),
      f('l', 'improvement', { confidence: 0.85, subject: 'tool-doc:y' }),
    ]
    const registry = stubRegistry({ findings }, ['improvement'])
    const source: ImprovementProposalSource = {
      proposeFromFindings: () => ({
        edits: findings.map((f) => ({ sourceFindingId: f.finding_id })),
        skipped: 0,
        errors: [],
      }),
    }

    const out = await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      improvementProposalSource: source,
      log: () => {},
    })

    expect(out.improvement?.edits).toEqual([{ sourceFindingId: 'h' }, { sourceFindingId: 'l' }])
  })

  it('persists findings even when knowledge adapter is missing (ledger is source of truth)', async () => {
    const store = inMemoryStore()
    const registry = stubRegistry({ findings: [f('a', 'failure-mode')] }, ['failure-mode'])

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: store,
      log: () => {},
    })

    expect(store.rows.map((r) => r.finding_id)).toEqual(['a'])
  })

  it('null findingsStore: no persistence + no auto-baseline pick', async () => {
    const registry = stubRegistry({ findings: [f('a', 'failure-mode')] }, ['failure-mode'])

    const out = await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      log: () => {},
    })

    expect(out.baselineRunId).toBeNull()
    expect(out.diff).toBeNull()
  })
})

function streamingRegistry(
  findings: ReadonlyArray<AnalystFinding>,
  ids: string[],
): AnalystRegistryStreamingLike {
  const result: AnalystRunResult = {
    run_id: 'run-cur',
    correlation_id: 'corr',
    started_at: '2026-05-19T00:00:00Z',
    ended_at: '2026-05-19T00:00:01Z',
    findings: [...findings],
    per_analyst: ids.map((id) => ({
      analyst_id: id,
      status: 'ok' as const,
      findings_count: findings.filter((x) => x.analyst_id === id).length,
      latency_ms: 1,
      cost_usd: 0,
    })),
    total_cost_usd: 0,
  }
  return {
    list: () => ids.map((id) => ({ id })),
    run: async () => result,
    runStream: async function* () {
      yield {
        type: 'run-started',
        run_id: result.run_id,
        correlation_id: result.correlation_id,
        started_at: result.started_at,
        analyst_ids: ids,
      } satisfies AnalystRunEvent
      for (const id of ids) {
        yield {
          type: 'analyst-started',
          analyst_id: id,
          started_at: result.started_at,
        } satisfies AnalystRunEvent
        const sub = findings.filter((x) => x.analyst_id === id)
        yield {
          type: 'analyst-completed',
          summary: {
            analyst_id: id,
            status: 'ok',
            findings_count: sub.length,
            latency_ms: 1,
            cost_usd: 0,
          },
          findings: sub,
        } satisfies AnalystRunEvent
      }
      yield { type: 'run-completed', result } satisfies AnalystRunEvent
    },
  }
}

describe('runAnalystLoop onEvent', () => {
  it('emits baseline-resolved → findings-persisted → diff-computed → loop-completed for a clean run', async () => {
    const store = inMemoryStore()
    await store.append('run-prev', [f('f-old', 'failure-mode')])
    const registry = stubRegistry(
      { findings: [f('f-new', 'failure-mode'), f('f-old', 'failure-mode')] },
      ['failure-mode'],
    )
    const events: AnalystLoopEvent[] = []

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: store,
      onEvent: (ev) => {
        events.push(ev)
      },
      log: () => {},
    })

    const types = events.map((e) => e.type)
    expect(types).toEqual([
      'baseline-resolved',
      'findings-persisted',
      'diff-computed',
      'loop-completed',
    ])

    const baseline = events[0] as Extract<AnalystLoopEvent, { type: 'baseline-resolved' }>
    expect(baseline.baselineRunId).toBe('run-prev')
    expect(baseline.priorFindingCount).toBe(1)

    const persisted = events[1] as Extract<AnalystLoopEvent, { type: 'findings-persisted' }>
    expect(persisted.count).toBe(2)

    const diff = events[2] as Extract<AnalystLoopEvent, { type: 'diff-computed' }>
    expect(diff.baselineRunId).toBe('run-prev')
    expect(diff.appeared).toBe(1)
    expect(diff.persisted).toBe(1)

    const done = events[3] as Extract<AnalystLoopEvent, { type: 'loop-completed' }>
    expect(done.durationMs).toBeGreaterThanOrEqual(0)
    expect(done.runId).toBe('run-cur')
  })

  it('forwards AnalystRegistry.runStream events verbatim via { type: "analyst" }', async () => {
    const registry = streamingRegistry([f('a', 'failure-mode')], ['failure-mode'])
    const events: AnalystLoopEvent[] = []

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      onEvent: (ev) => {
        events.push(ev)
      },
      log: () => {},
    })

    const analystEvents = events.filter(
      (e): e is Extract<AnalystLoopEvent, { type: 'analyst' }> => e.type === 'analyst',
    )
    expect(analystEvents.map((e) => e.event.type)).toEqual([
      'run-started',
      'analyst-started',
      'analyst-completed',
      'run-completed',
    ])
    expect(analystEvents.every((e) => e.runId === 'run-cur')).toBe(true)
  })

  it('skips diff-computed when no baseline (null findingsStore)', async () => {
    const registry = stubRegistry({ findings: [f('a', 'failure-mode')] }, ['failure-mode'])
    const events: AnalystLoopEvent[] = []

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      onEvent: (ev) => {
        events.push(ev)
      },
      log: () => {},
    })

    const types = events.map((e) => e.type)
    expect(types).toEqual(['baseline-resolved', 'loop-completed'])
  })

  it('emits one knowledge-proposed event and no write event', async () => {
    const findings = [
      f('high', 'knowledge-gap', { confidence: 0.95 }),
      f('low', 'knowledge-gap', { confidence: 0.6 }),
    ]
    const registry = stubRegistry({ findings }, ['knowledge-gap'])
    const source: KnowledgeProposalSource = {
      proposeFromFindings: () => ({
        proposals: findings.map((fi) => ({ sourceFindingId: fi.finding_id })),
        skipped: 0,
        errors: [],
      }),
    }
    const events: AnalystLoopEvent[] = []

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      knowledgeProposalSource: source,
      onEvent: (ev) => {
        events.push(ev)
      },
      log: () => {},
    })

    const proposed = events.find(
      (e): e is Extract<AnalystLoopEvent, { type: 'knowledge-proposed' }> =>
        e.type === 'knowledge-proposed',
    )!
    expect(proposed.proposalCount).toBe(2)
    expect(events.map((event) => event.type)).toEqual([
      'baseline-resolved',
      'knowledge-proposed',
      'loop-completed',
    ])
  })

  it('emits one improvement-proposed event and no write event', async () => {
    const findings = [f('e', 'improvement', { confidence: 0.99 })]
    const registry = stubRegistry({ findings }, ['improvement'])
    const source: ImprovementProposalSource = {
      proposeFromFindings: () => ({
        edits: [{ sourceFindingId: 'e' }],
        skipped: 0,
        errors: [],
      }),
    }
    const events: AnalystLoopEvent[] = []

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      improvementProposalSource: source,
      onEvent: (ev) => {
        events.push(ev)
      },
      log: () => {},
    })

    const proposed = events.find(
      (e): e is Extract<AnalystLoopEvent, { type: 'improvement-proposed' }> =>
        e.type === 'improvement-proposed',
    )!
    expect(proposed.editCount).toBe(1)
    expect(events.map((event) => event.type)).toEqual([
      'baseline-resolved',
      'improvement-proposed',
      'loop-completed',
    ])
  })

  it('awaits slow onEvent so subscribers apply backpressure', async () => {
    const registry = stubRegistry({ findings: [f('a', 'failure-mode')] }, ['failure-mode'])
    const order: string[] = []

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      onEvent: async (ev) => {
        order.push(`enter:${ev.type}`)
        await new Promise((r) => setTimeout(r, 5))
        order.push(`exit:${ev.type}`)
      },
      log: () => {},
    })

    for (let i = 0; i < order.length; i += 2) {
      expect(order[i]?.startsWith('enter:')).toBe(true)
      expect(order[i + 1]?.startsWith('exit:')).toBe(true)
      expect(order[i]?.slice(6)).toBe(order[i + 1]?.slice(5))
    }
  })

  it('falls back to registry.run() when no runStream is exposed', async () => {
    const registry = stubRegistry({ findings: [f('a', 'failure-mode')] }, ['failure-mode'])
    const events: AnalystLoopEvent[] = []

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      onEvent: (ev) => {
        events.push(ev)
      },
      log: () => {},
    })

    expect(events.some((e) => e.type === 'analyst')).toBe(false)
    expect(registry.run).toHaveBeenCalledTimes(1)
  })
})
