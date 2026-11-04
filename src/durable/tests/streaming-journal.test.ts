import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileCoordinationLog } from '../../runtime/supervise/coordination-log'
import {
  createRootStreamSink,
  readRootStream,
  readRootStreamReceipt,
} from '../../runtime/supervise/root-stream'
import { parseCommittedJsonLines, readCommittedJsonLines } from '../jsonl-file'
import { FileObserverJournal } from '../observer-journal'

vi.mock('node:fs/promises', async (load) => {
  const actual = await load<typeof fs>()
  return { ...actual, readFile: vi.fn(actual.readFile), open: vi.fn(actual.open) }
})

let root: string
beforeEach(async () => {
  const actual = await vi.importActual<typeof fs>('node:fs/promises')
  vi.mocked(fs.open).mockImplementation(actual.open)
  vi.mocked(fs.readFile).mockImplementation(actual.readFile)
  vi.clearAllMocks()
  root = await fs.mkdtemp(join(tmpdir(), 'streaming-journal-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})
async function collect<T>(records: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const record of records) out.push(record)
  return out
}

const event = (id: string) => ({
  id,
  pursuitId: 'pursuit',
  runId: 'run',
  target: 'agent.child' as const,
  phase: 'event' as const,
  timestamp: 1,
})

describe('streaming committed JSONL', () => {
  it.each([
    '',
    '\n',
    'null\nfalse\n0\n"text"\n',
    '{"a":1}\n\n{"b":2}',
    '{"a":1}\n{"torn":',
    '{"first":',
    '{"a":1}\r\n{"b":2}\r\n',
  ])('matches in-memory parsing for %j', async (bytes) => {
    const path = join(root, 'records.jsonl')
    await fs.writeFile(path, bytes)
    expect(await collect(readCommittedJsonLines(path))).toEqual(
      parseCommittedJsonLines(bytes, path),
    )
  })

  it('preserves UTF-8 and records across multiple stream chunks', async () => {
    const path = join(root, 'records.jsonl')
    const records = [{ text: '🙂é'.repeat(50_001) }, { text: 'after boundary' }]
    await fs.writeFile(path, records.map((record) => JSON.stringify(record)).join('\n'))
    expect(await collect(readCommittedJsonLines(path))).toEqual(records)
  })

  it.each(['{}\n\nBAD\n', '{}\nBAD\n{"torn":', '{}\r{}\n', ' \n'])(
    'refuses committed corruption in %j',
    async (bytes) => {
      const path = join(root, 'records.jsonl')
      await fs.writeFile(path, bytes)
      const expected = (() => {
        try {
          parseCommittedJsonLines(bytes, path)
        } catch (error) {
          return (error as Error).message
        }
      })()
      await expect(collect(readCommittedJsonLines(path))).rejects.toThrow(expected)
      expect(await fs.readFile(path, 'utf8')).toBe(bytes)
    },
  )

  it('only treats a missing file as empty when explicitly requested', async () => {
    const path = join(root, 'absent.jsonl')
    await expect(collect(readCommittedJsonLines(path))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await collect(readCommittedJsonLines(path, { allowMissing: true }))).toEqual([])
    await expect(collect(readCommittedJsonLines(root, { allowMissing: true }))).rejects.toThrow()
  })

  it('never follows appends beyond the prefix opened by this read', async () => {
    const path = join(root, 'records.jsonl')
    await fs.writeFile(path, '1\n2\n')
    const reader = readCommittedJsonLines<number>(path)
    expect(await reader.next()).toMatchObject({ value: 1, done: false })
    await fs.appendFile(path, '3\n')
    expect(await collect(reader)).toEqual([2])
    expect(await collect(readCommittedJsonLines(path))).toEqual([1, 2, 3])
  })

  it('does not mistake a concurrently truncated snapshot for a successful read', async () => {
    const path = join(root, 'records.jsonl')
    await fs.writeFile(path, `1\n${JSON.stringify('x'.repeat(1_000_000))}\n`)
    const reader = readCommittedJsonLines(path)
    expect(await reader.next()).toMatchObject({ value: 1 })
    await fs.truncate(path, 2)
    await expect(collect(reader)).rejects.toThrow(/journal changed/)
  })

  it('does not hide an allocation failure as a torn final write', async () => {
    const path = join(root, 'records.jsonl')
    const bytes = '{"keep":true}'
    await fs.writeFile(path, bytes)
    const parse = JSON.parse
    const failure = new RangeError('fixture allocation failure')
    vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      if (text === bytes) throw failure
      return parse(text, reviver)
    })
    expect(() => parseCommittedJsonLines(bytes, path)).toThrow(failure)
    await expect(collect(readCommittedJsonLines(path))).rejects.toBe(failure)
    expect(await fs.readFile(path, 'utf8')).toBe(bytes)
  })
})

describe('durable consumers share streaming reads', () => {
  it('checks the entire observer chain before allowing a resumed append', async () => {
    const path = join(root, 'observer.jsonl')
    const original = new FileObserverJournal(path, 'pursuit')
    await original.appendEvent(event('one'))
    await original.appendEvent(event('two'))
    const bytes = (await fs.readFile(path, 'utf8')).replace('"id":"one"', '"id":"tampered"')
    await fs.writeFile(path, bytes)
    const resumed = new FileObserverJournal(path, 'pursuit')
    await expect(resumed.appendEvent(event('three'))).rejects.toThrow(/digest mismatch/)
    expect(await fs.readFile(path, 'utf8')).toBe(bytes)
  })

  it('keeps coordination and conversation filtering on the streamed path', async () => {
    const path = join(root, 'coordination-log.jsonl')
    await fs.writeFile(
      path,
      [
        { runId: 'run', ownerId: 'A' },
        { runId: 'run', ownerId: 'B' },
      ]
        .map((identity) =>
          JSON.stringify({
            ...identity,
            seq: 1,
            at: 1,
            priority: 0,
            event: { type: 'finding', finding: { id: identity.ownerId } },
          }),
        )
        .join('\n'),
    )
    vi.mocked(fs.readFile).mockImplementation(async () => {
      throw new Error('whole-file read')
    })
    expect((await new FileCoordinationLog(path).load('run', 'A')).findings).toEqual([{ id: 'A' }])
  })

  it('hashes exact root-stream bytes, including an uncommitted non-UTF8 tail', async () => {
    const path = join(root, 'root-stream.jsonl')
    const bytes = Buffer.concat([Buffer.from('{"seq":1}\n{"torn":"'), Buffer.from([0xff])])
    await fs.writeFile(path, bytes)
    vi.mocked(fs.readFile).mockImplementation(async () => {
      throw new Error('whole-file read')
    })
    expect(await readRootStreamReceipt(root)).toEqual({
      ref: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      events: 1,
    })
    expect(await readRootStream(root)).toEqual([{ seq: 1 }])
  })

  it('resumes the root stream and preserves its sequence and raw-byte receipt', async () => {
    const sink = createRootStreamSink(root, () => 1)
    await sink.beginAttempt()
    sink.append({ kind: 'text_delta', text: 'first' })
    await sink.close()
    vi.mocked(fs.readFile).mockImplementation(async () => {
      throw new Error('whole-file read')
    })
    const resumed = createRootStreamSink(root, () => 2)
    await resumed.beginAttempt()
    resumed.append({ kind: 'text_delta', text: 'second' })
    expect((await resumed.close())?.events).toBe(2)
    expect((await readRootStream(root))?.map((record) => record.seq)).toEqual([1, 2])
    expect(await readRootStream(join(root, 'missing'))).toBeUndefined()
    expect(await readRootStreamReceipt(join(root, 'missing'))).toBeUndefined()
  })
})
