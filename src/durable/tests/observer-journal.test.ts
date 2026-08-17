import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileObserverJournal } from '../observer-journal'

function event(id: string, pursuitId = 'pursuit:test') {
  return {
    id,
    pursuitId,
    runId: 'run:1',
    target: 'agent.spawn' as const,
    phase: 'event' as const,
    timestamp: 1,
    payload: { child: id },
  }
}

describe('FileObserverJournal', () => {
  it('persists one execution journal with a verified chain', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-observer-'))
    const path = join(dir, 'observer.jsonl')
    const journal = new FileObserverJournal(path, 'pursuit:test')

    await journal.appendEvent(event('e1'))
    await journal.appendEvent({ ...event('e2'), runId: 'run:2' })

    const records = await journal.read()
    expect(records.map((record) => record.sequence)).toEqual([1, 2])
    expect(records.map((record) => record.pursuitId)).toEqual(['pursuit:test', 'pursuit:test'])
    expect(records[1]?.previousDigest).toBe(records[0]?.digest)
    expect(records[1]?.event?.runId).toBe('run:2')
  })

  it('stamps every hook event and decision with the pursuit identity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-observer-hooks-'))
    const journal = new FileObserverJournal(join(dir, 'observer.jsonl'), 'pursuit:hooks')
    const hooks = journal.hooks()

    await hooks.onEvent?.(
      {
        id: 'event',
        runId: 'run:1',
        target: 'agent.child',
        phase: 'event',
        timestamp: 1,
      },
      {},
    )
    await hooks.onDecisionPoint?.(
      {
        id: 'decision',
        runId: 'run:1',
        stepIndex: 0,
        kind: 'continue',
        candidateActions: ['continue'],
        evidence: [],
      },
      {},
    )

    const records = await journal.read()
    expect(records).toHaveLength(2)
    expect(records[0]?.event?.pursuitId).toBe('pursuit:hooks')
    expect(records[1]?.decision?.pursuitId).toBe('pursuit:hooks')
  })

  it('fails closed on identity conflicts and detects mutation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-observer-corrupt-'))
    const path = join(dir, 'observer.jsonl')
    const journal = new FileObserverJournal(path, 'pursuit:one')

    await expect(journal.appendEvent(event('wrong', 'pursuit:two'))).rejects.toThrow(
      /does not match/,
    )
    await journal.appendEvent(event('right', 'pursuit:one'))

    const text = await readFile(path, 'utf8')
    await writeFile(path, text.replace('agent.spawn', 'agent.child'), 'utf8')
    await expect(new FileObserverJournal(path, 'pursuit:one').read()).rejects.toThrow(
      /digest mismatch/,
    )
  })

  it('never returns a trusted projection after a durable append failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-observer-write-failure-'))
    const blocker = join(dir, 'not-a-directory')
    await writeFile(blocker, 'block', 'utf8')
    const journal = new FileObserverJournal(join(blocker, 'observer.jsonl'), 'pursuit:one')

    await expect(journal.appendEvent(event('cannot-write', 'pursuit:one'))).rejects.toThrow()
    await expect(journal.read()).rejects.toThrow(/completeness is unknown/)
  })
})
