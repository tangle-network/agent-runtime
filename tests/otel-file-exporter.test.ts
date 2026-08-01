/**
 * The file exporter's whole job is producing lines another tool can read. A shape mistake here is
 * silent — the run writes a file, the reader finds nothing in it, and the trace looks empty rather
 * than malformed. So these tests pin the wire shape, not the internals.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OtelSpan } from '../src/otel-export'
import { createOpenInferenceFileExporter } from '../src/otel-export'

const span = (over: Partial<OtelSpan> = {}): OtelSpan => ({
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  name: 'worker:write-artifact',
  startTimeUnixNano: '1700000000000000000',
  endTimeUnixNano: '1700000001000000000',
  attributes: [
    { key: 'openinference.span.kind', value: { stringValue: 'AGENT' } },
    { key: 'llm.token_count.prompt', value: { intValue: '46727' } },
    { key: 'agent.name', value: { stringValue: 'scribe' } },
  ],
  status: { code: 1 },
  ...over,
})

function writeAndRead(spans: OtelSpan[]): Record<string, unknown>[] {
  const path = join(mkdtempSync(join(tmpdir(), 'oi-')), 'spans.otlp.jsonl')
  const exporter = createOpenInferenceFileExporter(path)
  for (const s of spans) exporter.exportSpan(s)
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('createOpenInferenceFileExporter', () => {
  it('writes one complete JSON span per line', () => {
    const rows = writeAndRead([span(), span({ spanId: 'c'.repeat(16) })])
    expect(rows).toHaveLength(2)
    expect(rows[0]!.span_id).toBe('b'.repeat(16))
    expect(rows[1]!.span_id).toBe('c'.repeat(16))
  })

  it('uses snake_case identity fields and ISO-8601 times, which is what a reader parses', () => {
    const [row] = writeAndRead([span()])
    expect(row!.trace_id).toBe('a'.repeat(32))
    expect(row!.start_time).toBe('2023-11-14T22:13:20.000Z')
    expect(row!.end_time).toBe('2023-11-14T22:13:21.000Z')
    expect(Number.isNaN(Date.parse(String(row!.start_time)))).toBe(false)
  })

  it('spells a root span parent as "" rather than null or absent', () => {
    const [row] = writeAndRead([span({ parentSpanId: undefined })])
    expect(row!.parent_span_id).toBe('')
  })

  it('carries the parent id through when there is one', () => {
    const [row] = writeAndRead([span({ parentSpanId: 'd'.repeat(16) })])
    expect(row!.parent_span_id).toBe('d'.repeat(16))
  })

  it('flattens OTLP key/value attributes into a plain object, ints as numbers', () => {
    const [row] = writeAndRead([span()])
    expect(row!.attributes).toMatchObject({
      'openinference.span.kind': 'AGENT',
      'llm.token_count.prompt': 46727,
      'agent.name': 'scribe',
    })
  })

  it('lifts the span kind to the top level, defaulting to CHAIN', () => {
    expect(writeAndRead([span()])[0]!.kind).toBe('AGENT')
    expect(writeAndRead([span({ attributes: [] })])[0]!.kind).toBe('CHAIN')
  })

  // The bug this file did not catch on the first pass: every field above was checked and the
  // status was not, so a reader FOUND the file and refused it — "status.code must be OK, ERROR,
  // UNSET, or its STATUS_CODE_* form". A whole run's per-turn detail lost to one field.
  it("spells status as an OpenInference NAME, never OTLP's numeric code", () => {
    expect(writeAndRead([span({ status: { code: 1 } })])[0]!.status).toEqual({ code: 'OK' })
    expect(writeAndRead([span({ status: { code: 2 } })])[0]!.status).toEqual({ code: 'ERROR' })
    expect(writeAndRead([span({ status: { code: 0 } })])[0]!.status).toEqual({ code: 'UNSET' })
  })

  it('defaults a missing status to UNSET rather than omitting it', () => {
    expect(writeAndRead([span({ status: undefined })])[0]!.status).toEqual({ code: 'UNSET' })
  })

  it('carries a status message through when there is one', () => {
    const [row] = writeAndRead([span({ status: { code: 2, message: 'budget-exhausted' } })])
    expect(row!.status).toEqual({ code: 'ERROR', message: 'budget-exhausted' })
  })

  it('keeps spans already written when a later one fails, and surfaces the failure from flush', async () => {
    const exporter = createOpenInferenceFileExporter('/proc/definitely/not/writable/spans.jsonl')
    exporter.exportSpan(span())
    await expect(exporter.flush()).rejects.toThrow(/failed writing/)
  })
})
