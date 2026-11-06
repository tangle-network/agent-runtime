import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileCoordinationLog } from '../../runtime/supervise/coordination-log'
import {
  createRootStreamSink,
  readRootStream,
  readRootStreamReceipt,
} from '../../runtime/supervise/root-stream'
import { readCommittedJsonLines } from '../jsonl-file'
import { FileObserverJournal } from '../observer-journal'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'streaming-journal-'))
})
afterEach(async () => {
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
  it('preserves UTF-8 and records across multiple stream chunks', async () => {
    const path = join(root, 'records.jsonl')
    const records = [{ text: '🙂é'.repeat(50_001) }, { text: 'after boundary' }]
    await fs.writeFile(path, records.map((record) => JSON.stringify(record)).join('\n'))
    expect(await collect(readCommittedJsonLines(path))).toEqual(records)
  })

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
    expect((await new FileCoordinationLog(path).load('run', 'A')).findings).toEqual([{ id: 'A' }])
  })

  it('hashes exact root-stream bytes, including an uncommitted non-UTF8 tail', async () => {
    const path = join(root, 'root-stream.jsonl')
    const bytes = Buffer.concat([Buffer.from('{"seq":1}\n{"torn":"'), Buffer.from([0xff])])
    await fs.writeFile(path, bytes)
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
    const resumed = createRootStreamSink(root, () => 2)
    await resumed.beginAttempt()
    resumed.append({ kind: 'text_delta', text: 'second' })
    expect((await resumed.close())?.events).toBe(2)
    expect((await readRootStream(root))?.map((record) => record.seq)).toEqual([1, 2])
    expect(await readRootStream(join(root, 'missing'))).toBeUndefined()
    expect(await readRootStreamReceipt(join(root, 'missing'))).toBeUndefined()
  })
})
