import { appendFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createRootStreamSink,
  ROOT_STREAM_FILE,
  readRootStream,
  readRootStreamReceipt,
} from './root-stream'

describe('root stream sink', () => {
  let dir: string
  let tick = 0
  const now = () => Date.UTC(2026, 8, 15, 0, 0, tick++)

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'root-stream-'))
    tick = 0
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('leaves no file and no receipt when no attempt ever begins', async () => {
    const sink = createRootStreamSink(dir, now)
    expect(await sink.close()).toBeUndefined()
    expect(await readRootStream(dir)).toBeUndefined()
    expect(await readRootStreamReceipt(dir)).toBeUndefined()
  })

  it('continues seq and attempt across a second process and drops a torn tail once', async () => {
    const first = createRootStreamSink(dir, now)
    await first.beginAttempt()
    first.append({ kind: 'reasoning_delta', text: 'first process' })
    first.append({ kind: 'text_delta', text: 'still first' })
    expect(await first.close()).toEqual({ ref: expect.stringMatching(/^sha256:/), events: 2 })
    // The process died mid-write: half a record with no newline. It is not a record, and the
    // reader says so before the next process appends anything after it.
    appendFileSync(join(dir, ROOT_STREAM_FILE), '{"seq":99,"at":"torn')
    expect((await readRootStreamReceipt(dir))?.events).toBe(2)
    expect((await readRootStream(dir))?.map((line) => line.seq)).toEqual([1, 2])

    const second = createRootStreamSink(dir, now)
    await second.beginAttempt()
    second.append({ kind: 'text_delta', text: 'second process' })
    // A driver retry inside the same process is the next attempt of the same file.
    await second.beginAttempt()
    second.append({ kind: 'tool_call', toolName: 'note', args: { after: 'retry' } })
    const receipt = await second.close()

    const lines = (await readRootStream(dir)) ?? []
    expect(lines.map((line) => [line.seq, line.attempt])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 2],
    ])
    expect(lines.map((line) => ('event' in line ? line.event.kind : 'dropped'))).toEqual([
      'reasoning_delta',
      'text_delta',
      'text_delta',
      'tool_call',
    ])
    // The torn bytes are gone, so the file is exactly its committed lines and the receipt is
    // the content address of those bytes.
    const bytes = await readFile(join(dir, ROOT_STREAM_FILE), 'utf8')
    expect(bytes.endsWith('\n')).toBe(true)
    expect(bytes).not.toContain('"seq":99')
    expect(receipt).toEqual(await readRootStreamReceipt(dir))
    expect(receipt?.events).toBe(4)
  })

  it('records a line JSON cannot encode as dropped instead of failing the turn', async () => {
    const sink = createRootStreamSink(dir, now)
    await sink.beginAttempt()
    sink.append({ kind: 'tool_result', toolName: 'count', result: { total: 1n } })
    sink.append({ kind: 'text_delta', text: 'after the gap' })
    expect(await sink.close()).toMatchObject({ events: 2 })
    const lines = (await readRootStream(dir)) ?? []
    expect(lines[0]).toMatchObject({
      seq: 1,
      attempt: 1,
      dropped: { kind: 'tool_result', reason: expect.stringMatching(/BigInt/) },
    })
    expect(lines[1]).toMatchObject({ seq: 2, event: { kind: 'text_delta', text: 'after the gap' } })
  })

  it('refuses an append before an attempt and any use after close', async () => {
    const sink = createRootStreamSink(dir, now)
    expect(() => sink.append({ kind: 'text_delta', text: 'early' })).toThrow(
      /append before beginAttempt/,
    )
    await sink.beginAttempt()
    await sink.close()
    expect(() => sink.append({ kind: 'text_delta', text: 'late' })).toThrow(/append after close/)
    await expect(sink.beginAttempt()).rejects.toThrow(/beginAttempt after close/)
    await expect(sink.close()).rejects.toThrow(/closed twice/)
  })
})
