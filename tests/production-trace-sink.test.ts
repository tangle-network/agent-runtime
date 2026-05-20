import {
  type FeedbackLabel,
  type FeedbackTrajectory,
  type FeedbackTrajectoryStore,
  TraceEmitter,
} from '@tangle-network/agent-eval'
import { describe, expect, it, vi } from 'vitest'
import {
  createProductionTraceSink,
  type ProductionRunRecord,
  type ProductionRunRecordStore,
} from '../src/agent/production-trace-sink'

function memoryRunRecordStore(): ProductionRunRecordStore & {
  rows: ProductionRunRecord[]
} {
  const rows: ProductionRunRecord[] = []
  return {
    rows,
    async append(record) {
      rows.push(record)
    },
  }
}

function memoryFeedbackStore(): FeedbackTrajectoryStore & {
  data: Map<string, FeedbackTrajectory>
} {
  const data = new Map<string, FeedbackTrajectory>()
  return {
    data,
    async save(t) {
      data.set(t.id, t)
    },
    async get(id) {
      return data.get(id) ?? null
    },
    async list() {
      return [...data.values()]
    },
    async appendAttempt(id, attempt) {
      const t = data.get(id)
      if (!t) throw new Error(`no trajectory ${id}`)
      const next = { ...t, attempts: [...t.attempts, attempt] }
      data.set(id, next)
      return next
    },
    async appendLabel(id, label) {
      const t = data.get(id)
      if (!t) throw new Error(`no trajectory ${id}`)
      const next = { ...t, labels: [...t.labels, label] }
      data.set(id, next)
      return next
    },
  }
}

describe('createProductionTraceSink — RunRecord persistence', () => {
  it('writes a RunRecord on endRun with status / pass / score / scenarioId', async () => {
    const runRecordStore = memoryRunRecordStore()
    const sink = createProductionTraceSink({
      projectId: 'tax-agent',
      runRecordStore,
    })
    const emitter = new TraceEmitter(sink.traceStore, {
      onRunComplete: [sink.onRunComplete],
    })
    await emitter.startRun({ scenarioId: 'sess-1', projectId: 'tax-agent', layer: 'app-runtime' })
    await emitter.endRun({ pass: true, score: 0.92 })

    expect(runRecordStore.rows).toHaveLength(1)
    const row = runRecordStore.rows[0]!
    expect(row.projectId).toBe('tax-agent')
    expect(row.scenarioId).toBe('sess-1')
    expect(row.status).toBe('completed')
    expect(row.pass).toBe(true)
    expect(row.score).toBe(0.92)
  })

  it('captures abortRun as status=aborted with no pass/score', async () => {
    const runRecordStore = memoryRunRecordStore()
    const sink = createProductionTraceSink({ projectId: 'tax-agent', runRecordStore })
    const emitter = new TraceEmitter(sink.traceStore, {
      onRunComplete: [sink.onRunComplete],
    })
    await emitter.startRun({
      scenarioId: 'sess-abort',
      projectId: 'tax-agent',
      layer: 'app-runtime',
    })
    await emitter.abortRun('user-cancelled')

    expect(runRecordStore.rows).toHaveLength(1)
    expect(runRecordStore.rows[0]!.status).toBe('aborted')
  })

  it('captures failureClass + notes when endRun supplies them', async () => {
    const runRecordStore = memoryRunRecordStore()
    const sink = createProductionTraceSink({ projectId: 'tax-agent', runRecordStore })
    const emitter = new TraceEmitter(sink.traceStore, {
      onRunComplete: [sink.onRunComplete],
    })
    await emitter.startRun({
      scenarioId: 'sess-fail',
      projectId: 'tax-agent',
      layer: 'app-runtime',
    })
    await emitter.endRun({
      pass: false,
      score: 0.1,
      failureClass: 'TOOL_ERROR',
      notes: 'sandbox timed out',
    })

    const row = runRecordStore.rows[0]!
    expect(row.status).toBe('failed') // emitter maps pass:false → status:'failed'
    expect(row.pass).toBe(false)
    expect(row.failureClass).toBe('TOOL_ERROR')
    expect(row.notes).toBe('sandbox timed out')
  })

  it('survives runRecordStore throwing (logs, does not crash chat handler)', async () => {
    const log = vi.fn()
    const sink = createProductionTraceSink({
      projectId: 'tax-agent',
      runRecordStore: {
        async append() {
          throw new Error('db down')
        },
      },
      log,
    })
    const emitter = new TraceEmitter(sink.traceStore, {
      onRunComplete: [sink.onRunComplete],
      hookErrors: 'throw', // assert the hook itself doesn't throw
    })
    await emitter.startRun({ scenarioId: 'sess', projectId: 'tax-agent', layer: 'app-runtime' })
    await emitter.endRun({ pass: true, score: 1 })
    expect(log).toHaveBeenCalledWith(
      'runRecordStore.append failed',
      expect.objectContaining({ error: 'db down' }),
    )
  })
})

describe('createProductionTraceSink — OTLP forwarding', () => {
  it('POSTs the run to the configured collector with service.name resource attr', async () => {
    const fetchMock = vi.fn(
      async () => new Response('', { status: 200 }),
    ) as unknown as typeof fetch
    const sink = createProductionTraceSink({
      projectId: 'tax-agent',
      otlp: {
        endpoint: 'https://langfuse.example/api/otel',
        authHeader: 'Basic Zm9vOmJhcg==',
      },
      fetch: fetchMock,
    })
    const emitter = new TraceEmitter(sink.traceStore, {
      onRunComplete: [sink.onRunComplete],
    })
    await emitter.startRun({
      scenarioId: 'sess-otlp',
      projectId: 'tax-agent',
      layer: 'app-runtime',
    })
    await emitter.endRun({ pass: true, score: 0.8 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe('https://langfuse.example/api/otel')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Basic Zm9vOmJhcg==')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse(String((init as RequestInit).body))
    // OtlpExport has `resourceSpans[]` with resource attributes — we just confirm
    // our service.name landed somewhere recognisable.
    expect(JSON.stringify(body)).toContain('tax-agent')
  })

  it('logs (does not throw) on OTLP fetch failure', async () => {
    const log = vi.fn()
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const sink = createProductionTraceSink({
      projectId: 'tax-agent',
      otlp: { endpoint: 'https://x', authHeader: 'auth' },
      fetch: fetchMock,
      log,
    })
    const emitter = new TraceEmitter(sink.traceStore, {
      onRunComplete: [sink.onRunComplete],
      hookErrors: 'throw',
    })
    await emitter.startRun({ scenarioId: 's', projectId: 'tax-agent', layer: 'app-runtime' })
    await emitter.endRun({ pass: true })
    expect(log).toHaveBeenCalledWith(
      'OTLP POST threw',
      expect.objectContaining({ error: 'network down' }),
    )
  })

  it('logs (does not throw) on OTLP non-2xx', async () => {
    const log = vi.fn()
    const fetchMock = vi.fn(
      async () => new Response('', { status: 500 }),
    ) as unknown as typeof fetch
    const sink = createProductionTraceSink({
      projectId: 'tax-agent',
      otlp: { endpoint: 'https://x', authHeader: 'auth' },
      fetch: fetchMock,
      log,
    })
    const emitter = new TraceEmitter(sink.traceStore, { onRunComplete: [sink.onRunComplete] })
    await emitter.startRun({ scenarioId: 's', projectId: 'tax-agent', layer: 'app-runtime' })
    await emitter.endRun({ pass: false, score: 0 })
    expect(log).toHaveBeenCalledWith('OTLP POST non-2xx', expect.objectContaining({ status: 500 }))
  })

  it('omits the auth header when authHeader is undefined', async () => {
    const fetchMock = vi.fn(
      async () => new Response('', { status: 200 }),
    ) as unknown as typeof fetch
    const sink = createProductionTraceSink({
      projectId: 'tax-agent',
      otlp: { endpoint: 'https://x' },
      fetch: fetchMock,
    })
    const emitter = new TraceEmitter(sink.traceStore, { onRunComplete: [sink.onRunComplete] })
    await emitter.startRun({ scenarioId: 's', projectId: 'tax-agent', layer: 'app-runtime' })
    await emitter.endRun({ pass: true })
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBeUndefined()
  })

  it('does NOT attempt OTLP when opts.otlp is undefined', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch
    const sink = createProductionTraceSink({ projectId: 'tax-agent', fetch: fetchMock })
    const emitter = new TraceEmitter(sink.traceStore, { onRunComplete: [sink.onRunComplete] })
    await emitter.startRun({ scenarioId: 's', projectId: 'tax-agent', layer: 'app-runtime' })
    await emitter.endRun({ pass: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createProductionTraceSink — recordFeedback', () => {
  const label: FeedbackLabel = {
    source: { kind: 'user' },
    kind: 'thumbs',
    value: 1,
  }

  it('returns null when no feedbackStore is wired', async () => {
    const sink = createProductionTraceSink({ projectId: 'tax-agent' })
    const id = await sink.recordFeedback({ runId: 'r1', label })
    expect(id).toBeNull()
  })

  it('creates a new trajectory on first feedback for a run', async () => {
    const feedbackStore = memoryFeedbackStore()
    const sink = createProductionTraceSink({ projectId: 'tax-agent', feedbackStore })
    const id = await sink.recordFeedback({ runId: 'r1', label })
    expect(id).toBe('traj-r1')
    expect(feedbackStore.data.get('traj-r1')?.labels).toEqual([label])
    expect(feedbackStore.data.get('traj-r1')?.projectId).toBe('tax-agent')
  })

  it('appends to an existing trajectory on subsequent feedback', async () => {
    const feedbackStore = memoryFeedbackStore()
    const sink = createProductionTraceSink({ projectId: 'tax-agent', feedbackStore })
    await sink.recordFeedback({ runId: 'r1', label })
    const secondLabel: FeedbackLabel = { source: { kind: 'user' }, kind: 'comment', value: 'great' }
    await sink.recordFeedback({ runId: 'r1', label: secondLabel })
    expect(feedbackStore.data.get('traj-r1')?.labels).toEqual([label, secondLabel])
  })

  it('returns null + logs on feedbackStore failure (does not throw)', async () => {
    const log = vi.fn()
    const sink = createProductionTraceSink({
      projectId: 'tax-agent',
      feedbackStore: {
        async save() {
          throw new Error('write fail')
        },
        async get() {
          return null
        },
        async list() {
          return []
        },
        async appendAttempt() {
          throw new Error('na')
        },
        async appendLabel() {
          throw new Error('na')
        },
      },
      log,
    })
    const result = await sink.recordFeedback({ runId: 'r1', label })
    expect(result).toBeNull()
    expect(log).toHaveBeenCalledWith(
      'feedbackStore write failed',
      expect.objectContaining({ error: 'write fail' }),
    )
  })

  it('honours an explicit trajectoryId when the agent provides one', async () => {
    const feedbackStore = memoryFeedbackStore()
    const sink = createProductionTraceSink({ projectId: 'tax-agent', feedbackStore })
    const id = await sink.recordFeedback({
      runId: 'r1',
      trajectoryId: 'agent-supplied-id',
      label,
    })
    expect(id).toBe('agent-supplied-id')
    expect(feedbackStore.data.get('agent-supplied-id')).toBeDefined()
  })
})
