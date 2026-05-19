import type {
  AnalystFinding,
  AnalystRunEvent,
  AnalystRunInputs,
  AnalystRunResult,
} from '@tangle-network/agent-eval'
import { describe, expect, it, vi } from 'vitest'
import type {
  AnalystLoopEvent,
  AnalystRegistryLike,
  AnalystRegistryStreamingLike,
  FindingsStoreLike,
  ImprovementAdapter,
  KnowledgeAdapter,
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
        ...result,
      }
    }),
  }
  return stub as AnalystRegistryLike & { lastOpts: unknown }
}

describe('runAnalystLoop', () => {
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

  it('knowledge adapter: high-confidence proposals auto-apply, low-confidence withhold', async () => {
    const findings = [
      f('high', 'knowledge-gap', { confidence: 0.95, subject: 'agent-knowledge:wiki:x' }),
      f('low', 'knowledge-gap', { confidence: 0.6, subject: 'agent-knowledge:wiki:y' }),
    ]
    const registry = stubRegistry({ findings }, ['knowledge-gap'])
    const adapter: KnowledgeAdapter = {
      proposeFromFindings: () => ({
        proposals: findings.map((f) => ({
          sourceFindingId: f.finding_id,
          path: `knowledge/${f.subject}.md`,
        })),
        skipped: 0,
        errors: [],
      }),
      apply: vi.fn(async (proposals: unknown[]) => ({
        written: proposals.map((_, i) => `applied-${i}`),
        warnings: [],
      })),
    }

    const out = await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      knowledgeAdapter: adapter,
      autoApply: { knowledge: true, knowledgeConfidenceThreshold: 0.85 },
      log: () => {},
    })

    expect(adapter.apply).toHaveBeenCalledTimes(1)
    const applyCall = (adapter.apply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Array<{
      sourceFindingId: string
    }>
    expect(applyCall.map((p) => p.sourceFindingId)).toEqual(['high'])
    expect(out.knowledge?.applied).toEqual(['applied-0'])
    expect(out.knowledge?.withheld_for_review).toBe(1)
  })

  it('knowledge adapter without apply: all proposals withhold for review (default safe)', async () => {
    const findings = [f('any', 'knowledge-gap', { confidence: 0.99 })]
    const registry = stubRegistry({ findings }, ['knowledge-gap'])
    const adapter: KnowledgeAdapter = {
      proposeFromFindings: () => ({
        proposals: [{ sourceFindingId: 'any' }],
        skipped: 0,
        errors: [],
      }),
    }

    const out = await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      knowledgeAdapter: adapter,
      log: () => {},
    })

    expect(out.knowledge?.applied).toEqual([])
    expect(out.knowledge?.withheld_for_review).toBe(1)
  })

  it('improvement adapter mirrors knowledge but with its own threshold', async () => {
    const findings = [
      f('h', 'improvement', { confidence: 0.92, subject: 'system-prompt:x' }),
      f('l', 'improvement', { confidence: 0.85, subject: 'tool-doc:y' }),
    ]
    const registry = stubRegistry({ findings }, ['improvement'])
    const adapter: ImprovementAdapter = {
      proposeFromFindings: () => ({
        edits: findings.map((f) => ({ sourceFindingId: f.finding_id })),
        skipped: 0,
        errors: [],
      }),
      apply: vi.fn(async (edits: unknown[]) => ({
        applied: edits.map((_, i) => `edit-${i}`),
        warnings: [],
      })),
    }

    const out = await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      improvementAdapter: adapter,
      autoApply: { improvement: true, improvementConfidenceThreshold: 0.9 },
      log: () => {},
    })

    const applyCall = (adapter.apply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Array<{
      sourceFindingId: string
    }>
    expect(applyCall.map((e) => e.sourceFindingId)).toEqual(['h'])
    expect(out.improvement?.withheld_for_review).toBe(1)
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

  it('emits knowledge-proposed + knowledge-applied with applied count and withheld count', async () => {
    const findings = [
      f('high', 'knowledge-gap', { confidence: 0.95 }),
      f('low', 'knowledge-gap', { confidence: 0.6 }),
    ]
    const registry = stubRegistry({ findings }, ['knowledge-gap'])
    const adapter: KnowledgeAdapter = {
      proposeFromFindings: () => ({
        proposals: findings.map((fi) => ({ sourceFindingId: fi.finding_id })),
        skipped: 0,
        errors: [],
      }),
      apply: async (props) => ({
        written: props.map((_, i) => `applied-${i}`),
        warnings: [],
      }),
    }
    const events: AnalystLoopEvent[] = []

    await runAnalystLoop({
      runId: 'run-cur',
      registry,
      inputs: {},
      findingsStore: null,
      knowledgeAdapter: adapter,
      autoApply: { knowledge: true, knowledgeConfidenceThreshold: 0.85 },
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
    const applied = events.find(
      (e): e is Extract<AnalystLoopEvent, { type: 'knowledge-applied' }> =>
        e.type === 'knowledge-applied',
    )!
    expect(applied.writtenCount).toBe(1)
    expect(applied.withheldForReview).toBe(1)
  })

  it('emits improvement-proposed + improvement-applied with no adapter.apply (all withheld)', async () => {
    const findings = [f('e', 'improvement', { confidence: 0.99 })]
    const registry = stubRegistry({ findings }, ['improvement'])
    const adapter: ImprovementAdapter = {
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
      improvementAdapter: adapter,
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
    const applied = events.find(
      (e): e is Extract<AnalystLoopEvent, { type: 'improvement-applied' }> =>
        e.type === 'improvement-applied',
    )!
    expect(applied.appliedCount).toBe(0)
    expect(applied.withheldForReview).toBe(1)
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
