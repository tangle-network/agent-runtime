import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tryAcquireAtomicFileLock } from '@tangle-network/agent-eval/ledger-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileCorpus } from '../../src/runtime/personify/corpus'
import type { CorpusRecord } from '../../src/runtime/personify/wave-types'

const record: CorpusRecord = {
  schemaVersion: '1.0.0',
  id: 'finding',
  runId: 'run',
  producedAt: '2026-09-05T00:00:00Z',
  area: 'verification',
  claim: 'Run the requested check.',
  tags: ['original'],
  confidence: 0.9,
  evidence: [{ kind: 'trace', uri: 'trace:original' }],
}
const corpusModule = new URL('../../src/runtime/personify/corpus.ts', import.meta.url).href

function writer(path: string, claim: string, leaveLock = false) {
  const source = `
    import { FileCorpus } from ${JSON.stringify(corpusModule)}
    import { tryAcquireAtomicFileLock } from '@tangle-network/agent-eval/ledger-core'
    const [path, recordJson, leaveLock] = process.argv.slice(1)
    process.once('message', async () => {
      try {
        const result = leaveLock === 'true'
          ? tryAcquireAtomicFileLock({ lockPath: path + '.lock' })
          : await new FileCorpus(path).append(JSON.parse(recordJson))
        process.send({ result: leaveLock === 'true' ? { acquired: result.acquired } : result },
          () => process.exit(0))
      } catch (error) {
        console.error(error)
        process.exit(1)
      }
    })
    process.send('ready')
  `
  const child = spawn(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      '--input-type=module',
      '-e',
      source,
      path,
      JSON.stringify({ ...record, claim }),
      String(leaveLock),
    ],
    { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  )
  let errors = ''
  let result: unknown
  child.stderr?.on('data', (data) => {
    errors += String(data)
  })
  const ready = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('message', (message) => {
      if (message === 'ready') resolve()
      else reject(new Error(`unexpected child readiness: ${JSON.stringify(message)}`))
    })
    child.once('exit', () => reject(new Error(`corpus child exited before readiness: ${errors}`)))
  })
  child.on('message', (message) => {
    if (message && typeof message === 'object' && 'result' in message) result = message.result
  })
  const completed = new Promise<unknown>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0 && result !== undefined) resolve(result)
      else reject(new Error(`corpus child exited ${code}: ${errors}`))
    })
  })
  return { child, ready, completed }
}

describe('FileCorpus transaction integrity', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'corpus-integrity-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('serializes conflicting appends across instances and symlink aliases', async () => {
    const realDir = join(dir, 'real')
    const aliasDir = join(dir, 'alias')
    await mkdir(realDir)
    await symlink(realDir, aliasDir, 'dir')
    const path = join(realDir, 'corpus.jsonl')
    const outcomes = await Promise.all([
      new FileCorpus(path).append(record),
      new FileCorpus(join(aliasDir, 'corpus.jsonl')).append({
        ...record,
        claim: 'Conflicting advice.',
      }),
    ])
    expect(outcomes.filter((result) => result.succeeded)).toHaveLength(1)
    expect(outcomes.find((result) => !result.succeeded)).toMatchObject({
      error: expect.stringContaining('corpus conflict'),
    })
    expect(await new FileCorpus(path).query({})).toHaveLength(1)
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('deduplicates concurrent identical appends and snapshots values before awaiting storage', async () => {
    const path = join(dir, 'corpus.jsonl')
    const mutable = structuredClone(record)
    const pending = new FileCorpus(path).append(mutable)
    Reflect.set(mutable.tags, 0, 'changed')
    const outcomes = await Promise.all([
      pending,
      new FileCorpus(path).append(record),
      new FileCorpus(path).append(record),
    ])
    expect(outcomes).toEqual([{ succeeded: true }, { succeeded: true }, { succeeded: true }])
    const saved = await new FileCorpus(path).query({})
    expect(saved).toEqual([record])
    expect(Reflect.set(saved[0]!.tags, 0, 'changed')).toBe(false)
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it.each([false, true])(
    'coordinates separate writer processes (identical=%s)',
    async (identical) => {
      const path = join(dir, 'corpus.jsonl')
      const children = [
        writer(path, record.claim),
        writer(path, identical ? record.claim : 'Conflicting advice.'),
      ]
      try {
        await Promise.all(children.map((child) => child.ready))
        for (const child of children) child.child.send('append')
        const outcomes = await Promise.all(children.map((child) => child.completed))
        expect(
          outcomes.filter((result) => (result as { succeeded: boolean }).succeeded),
        ).toHaveLength(identical ? 2 : 1)
        expect(await new FileCorpus(path).query({})).toHaveLength(1)
        expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(1)
      } finally {
        for (const child of children) child.child.kill()
      }
    },
    15000,
  )

  it('recovers an exited process lock before appending', async () => {
    const path = join(dir, 'corpus.jsonl')
    const child = writer(path, record.claim, true)
    try {
      await child.ready
      child.child.send('lock')
      expect(await child.completed).toEqual({ acquired: true })
      expect(await new FileCorpus(path).append(record)).toEqual({ succeeded: true })
    } finally {
      child.child.kill()
    }
  }, 15000)

  it('returns a typed failure when a live owner exceeds the bounded lock wait', async () => {
    const path = join(dir, 'corpus.jsonl')
    const acquired = tryAcquireAtomicFileLock({ lockPath: `${path}.lock` })
    if (!acquired.acquired) throw new Error('test lock was unavailable')
    try {
      expect(await new FileCorpus(path).append(record)).toEqual({
        succeeded: false,
        error: expect.stringContaining('lock unavailable after 5000ms'),
      })
    } finally {
      acquired.lock.release()
    }
    expect(await new FileCorpus(path).append(record)).toEqual({ succeeded: true })
  }, 10000)

  it('returns storage errors through the append outcome', async () => {
    await writeFile(join(dir, 'blocked'), 'file blocks directory creation')
    expect(await new FileCorpus(join(dir, 'blocked', 'corpus.jsonl')).append(record)).toMatchObject(
      {
        succeeded: false,
        error: expect.any(String),
      },
    )
  })
})
