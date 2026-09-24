/**
 * Token accounting over a trace this package actually exports.
 *
 * The run below goes through the real path: `createIntelligenceClient().exportRunRecord` →
 * `createOtelExporter` → an OTLP/HTTP POST to a loopback collector. The captured body is then read
 * by the two consumers that decide what a span IS: the contract's `resolveSpanKind` (used by the
 * validator and `traces`) and agent-eval's `otlpRowsToRunRecords` (used by VerticalBench grading
 * and the trace analyst). Each must count the run's model tokens once.
 *
 * The trap this pins: the run span carries the run's token TOTAL, each `loop.iteration` span
 * (`gen_ai.operation.name = invoke_agent`) carries its iteration's total, and each
 * `gen_ai.client.inference` span carries one model call. Only the last are model calls. A reader
 * that classifies the first two as LLM counts the same tokens two or three times.
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolveSpanKind } from '@tangle-network/agent-trace-contract'
import { flattenOtlpExportToNdjson, otlpRowsToRunRecords } from '@tangle-network/agent-eval/traces'
import { afterEach, describe, expect, it } from 'vitest'
import { createIntelligenceClient, type RunRecord } from '../src/intelligence'

const LLM_CALLS = [
  { input: 1200, output: 300 },
  { input: 1100, output: 250 },
]
const TRUE_INPUT = LLM_CALLS.reduce((sum, call) => sum + call.input, 0)
const TRUE_OUTPUT = LLM_CALLS.reduce((sum, call) => sum + call.output, 0)

/** One fan-out round: two iterations, each driving one model call. */
function loopEvents(): NonNullable<RunRecord['loopEvents']> {
  const event = (kind: string, timestamp: number, payload: object) => ({
    kind,
    runId: 'run-1',
    timestamp,
    payload,
  })
  return [
    event('loop.started', 1000, { driver: 'dynamic', agentRunNames: ['claude', 'codex'] }),
    event('loop.plan', 1010, { roundIndex: 0, plannedCount: 2, moveKind: 'fanout' }),
    event('loop.iteration.started', 1020, { iterationIndex: 0, agentRunName: 'claude' }),
    event('loop.iteration.started', 1022, { iterationIndex: 1, agentRunName: 'codex' }),
    event('loop.iteration.ended', 1500, {
      iterationIndex: 0,
      agentRunName: 'claude',
      tokenUsage: LLM_CALLS[0],
      verdict: { valid: true, score: 0.9 },
    }),
    event('loop.iteration.ended', 1600, {
      iterationIndex: 1,
      agentRunName: 'codex',
      tokenUsage: LLM_CALLS[1],
      verdict: { valid: false, score: 0.4 },
    }),
    event('loop.decision', 1610, { decision: 'done' }),
    event('loop.ended', 1700, { winnerIterationIndex: 0, iterations: 2 }),
  ] as NonNullable<RunRecord['loopEvents']>
}

function runRecord(traceId: string): RunRecord {
  return {
    runId: 'run-1',
    traceId,
    project: 'token-accounting',
    target: 'agent',
    input: { task: 'fix the bug' },
    output: { patch: 'diff' },
    outcome: { success: true, usage: { inferenceUsd: 0.05, intelligenceUsd: 0 } },
    timing: { startedAt: 1000, completedAt: 1700, durationMs: 700 },
    model: 'anthropic/claude-sonnet-4.6',
    tokens: { input: TRUE_INPUT, output: TRUE_OUTPUT },
    runtimeEvents: LLM_CALLS.map((call, index) => ({
      type: 'llm_call' as const,
      model: 'anthropic/claude-sonnet-4.6',
      tokensIn: call.input,
      tokensOut: call.output,
      timestamp: new Date(1100 + index * 500).toISOString(),
    })),
    loopEvents: loopEvents(),
  }
}

interface CapturedExport {
  resourceSpans: Array<{ scopeSpans: Array<{ spans: unknown[] }> }>
}

async function exportThroughCollector(record: (traceId: string) => RunRecord): Promise<{
  body: CapturedExport
  close: () => Promise<void>
}> {
  const bodies: CapturedExport[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      bodies.push(JSON.parse(raw) as CapturedExport)
      res.writeHead(200).end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const client = createIntelligenceClient({
    project: 'token-accounting',
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${port}`,
  })
  client.exportRunRecord(record(client.freshTraceId()))
  await client.flush()
  const merged: CapturedExport = {
    resourceSpans: bodies.flatMap((body) => body.resourceSpans),
  }
  return {
    body: merged,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function numberAttr(attributes: Record<string, unknown>, key: string): number {
  const value = attributes[key]
  return typeof value === 'number' ? value : Number(value ?? 0)
}

describe('token accounting over an exported runtime trace', () => {
  const closers: Array<() => Promise<void>> = []
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()))
  })

  it('the contract classifies only the model-call spans as LLM', async () => {
    const { body, close } = await exportThroughCollector(runRecord)
    closers.push(close)
    const rows = flattenOtlpExportToNdjson(body as never)

    const llmRows = rows.filter((row) => resolveSpanKind(row) === 'LLM')
    const llmInput = llmRows.reduce(
      (sum, row) => sum + numberAttr(row.attributes, 'gen_ai.usage.input_tokens'),
      0,
    )

    expect(llmRows.map((row) => row.name).sort()).toEqual([
      'gen_ai.client.inference',
      'gen_ai.client.inference',
    ])
    expect(llmInput).toBe(TRUE_INPUT)
  })

  it('agent-eval counts each model call once', async () => {
    const { body, close } = await exportThroughCollector(runRecord)
    closers.push(close)
    const rows = flattenOtlpExportToNdjson(body as never)

    const [record] = otlpRowsToRunRecords(rows, {
      experimentId: 'token-accounting',
      candidateId: 'runtime',
    })

    expect(record?.tokenUsage).toMatchObject({ input: TRUE_INPUT, output: TRUE_OUTPUT })
    expect(record?.outcome.raw.llm_span_count).toBe(LLM_CALLS.length)
  })
})
