import type { ToolSpan } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import type { RootStreamRecord } from './root-stream'
import {
  ASSISTANT_REASONING_SPAN,
  ASSISTANT_TEXT_SPAN,
  rootStreamToolSpans,
  runTraceAnalysisStore,
} from './run-traces'
import { WORKER_TOOL_TRACE_SCHEMA_VERSION } from './trace-evidence'

const at = (second: number) => `2026-09-25T00:00:${String(second).padStart(2, '0')}.000Z`
const line = (seq: number, event: unknown, attempt = 1): RootStreamRecord =>
  ({ seq, at: at(seq), attempt, event }) as RootStreamRecord

const stream: RootStreamRecord[] = [
  line(1, { kind: 'reasoning_delta', text: 'The task wants ' }),
  line(2, { kind: 'reasoning_delta', text: 'primes.' }),
  line(3, { kind: 'text_delta', text: 'I will write ' }),
  line(4, { kind: 'text_delta', text: 'primes.txt.' }),
  line(5, { kind: 'tool_call', toolName: 'bash', toolCallId: 'c1', args: { command: 'seq 2 9' } }),
  line(6, { kind: 'tool_result', toolName: 'bash', toolCallId: 'c1', result: '2\n3' }),
  line(7, { kind: 'tool_result', toolName: 'read', toolCallId: 'c0', result: 'orphan' }),
  line(8, { kind: 'text_delta', text: 'Done.' }),
  { seq: 9, at: at(9), attempt: 1, dropped: { kind: 'text_delta', reason: 'not JSON' } },
  line(10, { kind: 'text_delta', text: 'After the gap.' }),
  line(11, { kind: 'text_delta', text: 'Next attempt.' }, 2),
]

describe("a manager's run as trace spans", () => {
  it('turns the root stream into tool calls with results and runs of text and reasoning', () => {
    const spans = rootStreamToolSpans(stream, 'root')
    expect(spans.map((span) => [span.spanId, span.toolName, span.result])).toEqual([
      ['s1', ASSISTANT_REASONING_SPAN, 'The task wants primes.'],
      ['s3', ASSISTANT_TEXT_SPAN, 'I will write primes.txt.'],
      ['s5', 'bash', '2\n3'],
      ['s7', 'read', 'orphan'],
      ['s8', ASSISTANT_TEXT_SPAN, 'Done.'],
      // A dropped line and a new attempt each end a run of text.
      ['s10', ASSISTANT_TEXT_SPAN, 'After the gap.'],
      ['s11', ASSISTANT_TEXT_SPAN, 'Next attempt.'],
    ])
    const call = spans.find((span) => span.spanId === 's5')
    expect(call).toMatchObject({
      runId: 'root',
      args: { command: 'seq 2 9' },
      startedAt: Date.parse(at(5)),
      endedAt: Date.parse(at(6)),
      attributes: { attempt: 1, seq: 5, toolCallId: 'c1' },
    })
    expect(spans.find((span) => span.spanId === 's7')).toMatchObject({ argsCaptured: false })
  })

  it('reads the root stream and every settled worker as one store, one trace per agent', async () => {
    const workerSpan: ToolSpan = {
      kind: 'tool',
      spanId: 'w-1',
      runId: 'child-run-7',
      name: 'edit',
      toolName: 'edit',
      args: { path: 'primes.txt' },
      result: 'ok',
      startedAt: Date.parse(at(20)),
      endedAt: Date.parse(at(21)),
    }
    const blobs = new Map<string, unknown>([
      ['sha256:trace', { schemaVersion: WORKER_TOOL_TRACE_SCHEMA_VERSION, spans: [workerSpan] }],
    ])
    const store = await runTraceAnalysisStore({
      root: { id: 'root', read: async () => stream },
      workers: [
        { id: 'worker-1', trace: { status: 'available', traceRef: 'sha256:trace', spanCount: 1 } },
        { id: 'worker-2', trace: { status: 'unavailable', reason: 'no-tool-spans-captured' } },
      ],
      blobs: { get: async (ref) => blobs.get(ref) },
    })
    expect(store).toBeDefined()
    expect(await store?.countTraces({})).toBe(2)
    expect(await store?.hasTrace('root')).toBe(true)
    expect(await store?.hasSpans({ trace_id: 'worker-1', span_ids: ['w-1'] })).toEqual(['w-1'])
    expect(await store?.hasTrace('worker-2')).toBe(false)

    // No span yet: no store, because an empty trace cannot tell a quiet run from a lost capture.
    expect(
      await runTraceAnalysisStore({
        root: { id: 'root', read: async () => undefined },
        workers: [],
        blobs: { get: async () => undefined },
      }),
    ).toBeUndefined()
    // A settlement that names a trace the blob store lost is incomplete evidence, never an empty one.
    await expect(
      runTraceAnalysisStore({
        workers: [
          { id: 'worker-1', trace: { status: 'available', traceRef: 'sha256:gone', spanCount: 1 } },
        ],
        blobs: { get: async () => undefined },
      }),
    ).rejects.toThrow(/worker worker-1's trace blob 'sha256:gone' is missing/)
  })
})
