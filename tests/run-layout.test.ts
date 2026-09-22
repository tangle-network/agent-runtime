import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertExactWorkerId,
  cancelWorker,
  defaultWorkerControlPersistence,
  legacySupervisorRunDir,
  readWorkerCancellation,
  readWorkerCancelRequests,
  readWorkerSteerAcknowledgement,
  readWorkerSteerRequests,
  SupervisorOperationConflictError,
  safeWorkerFile,
  supervisorRunDir,
  supervisorRunsRoot,
  workerCancellationIntentFile,
  workerInboxFile,
  workerSteerIntentFile,
  writeWorkerCancellation,
  writeWorkerSteer,
  writeWorkerSteerAcknowledgement,
} from '../src/runtime/supervise/run-layout'

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'run-layout-'))
  cleanups.push(dir)
  return dir
}

describe('supervisor run layout', () => {
  it('pins the published path shape traces reads: <root>/.agent/supervisor/<id>', () => {
    // This exact shape is consumed by `traces analyze --supervisor-run-dir`; changing it is a
    // breaking change to a PUBLISHED reader, not a refactor.
    expect(supervisorRunsRoot('/ws')).toBe(join('/ws', '.agent', 'supervisor'))
    expect(supervisorRunDir('/ws', 'run-1')).toBe(join('/ws', '.agent', 'supervisor', 'run-1'))
    expect(workerInboxFile('/ws', 'run-1', 'run-1:s0')).toBe(
      join('/ws', '.agent', 'supervisor', 'run-1', 'workers', 'run-1:s0.inbox.ndjson'),
    )
  })

  it('pins the legacy pre-rename location readers fall back to: <root>/.loops/supervisor/<id>', () => {
    expect(legacySupervisorRunDir('/ws', 'run-1')).toBe(
      join('/ws', '.loops', 'supervisor', 'run-1'),
    )
  })

  it.each(['../escape', '..', '.', 'nested/run', 'nested\\run', 'nul\0run'])(
    'rejects traversal-capable supervisor id %j before writing state',
    (id) => {
      const root = tempRoot()
      expect(() => supervisorRunDir(root, id)).toThrow(/unsafe supervisor id/)
      expect(() => legacySupervisorRunDir(root, id)).toThrow(/unsafe supervisor id/)
      expect(() => workerInboxFile(root, id, 'coder')).toThrow(/unsafe supervisor id/)
      expect(() => writeWorkerSteer(root, id, 'coder', 'do not write')).toThrow(
        /unsafe supervisor id/,
      )
      expect(existsSync(join(root, 'escape'))).toBe(false)
    },
  )

  it('keeps safe existing ids, including non-separator punctuation', () => {
    for (const id of ['run-1', 'sup.1', 'sup:1', 'foo..bar']) {
      expect(supervisorRunDir('/ws', id)).toBe(join('/ws', '.agent', 'supervisor', id))
    }
    expect(() => supervisorRunsRoot('/ws\0unsafe')).toThrow(/NUL/)
  })

  it.each(['', '   ', ' worker', 'worker ', 'worker\0id'])(
    'rejects unsafe exact worker id %j before writing state',
    (worker) => {
      const root = tempRoot()
      expect(() => assertExactWorkerId(worker)).toThrow(/unsafe workerId/)
      expect(() => writeWorkerSteer(root, 'run-1', worker, 'do not write')).toThrow(
        /unsafe workerId/,
      )
      expect(() => cancelWorker(root, worker, 'cancel-unsafe')).toThrow(/unsafe workerId/)
      expect(existsSync(join(root, '.agent'))).toBe(false)
      expect(existsSync(join(root, 'cancellations'))).toBe(false)
    },
  )

  it.each(['worker a', 'worker/a', 'worker\\a', '../worker', '.', '..'])(
    'encodes exact worker id %j without allowing path traversal',
    (worker) => {
      const root = tempRoot()
      const written = writeWorkerSteer(root, 'run-1', worker, 'preserve the exact worker')
      expect(written.request.worker).toBe(worker)
      expect(written.file).toMatch(/[\\/]workers[\\/]~[a-f0-9]{64}\.inbox\.ndjson$/u)
      expect(readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), worker)).toEqual([
        written.request,
      ])
      expect(existsSync(join(root, 'worker.inbox.ndjson'))).toBe(false)
    },
  )

  it('reduces any label to a safe filename, with a stable fallback for empty ones', () => {
    expect(safeWorkerFile('review: pkg/α')).toBe('review__pkg__')
    expect(safeWorkerFile('')).toBe('worker')
  })

  it('round-trips a steer through the durable inbox', () => {
    const root = tempRoot()
    const written = writeWorkerSteer(root, 'run-1', 'coder', 'focus on the failing test', 'human')
    const read = readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'coder')
    expect(read).toEqual([written.request])
    expect(written.request.source).toBe('human')
  })

  it('keeps exact worker reads isolated when safe filenames collide', () => {
    const root = tempRoot()
    writeWorkerSteer(root, 'run-1', 'a:b', 'for colon worker')
    writeWorkerSteer(root, 'run-1', 'a_b', 'for underscore worker')

    expect(
      readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'a:b').map((r) => r.message),
    ).toEqual(['for colon worker'])
    expect(
      readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'a_b').map((r) => r.message),
    ).toEqual(['for underscore worker'])
  })

  it('rejects an empty steer instead of writing a blank line', () => {
    expect(() => writeWorkerSteer(tempRoot(), 'run-1', 'coder', '   ')).toThrow(/empty/)
  })

  it('a corrupt or partial line never poisons later valid lines', () => {
    const root = tempRoot()
    writeWorkerSteer(root, 'run-1', 'coder', 'first')
    const file = writeWorkerSteer(root, 'run-1', 'coder', 'second').file
    const raw = readFileSync(file, 'utf8')
    // Simulate a writer killed mid-append between the two valid lines.
    const lines = raw.trimEnd().split('\n')
    writeFileSync(file, `${lines[0]}\n{"id":"trunc`.concat('\n', lines[1] ?? '', '\n'), 'utf8')
    const read = readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'coder')
    expect(read.map((r) => r.message)).toEqual(['first', 'second'])
  })

  it('separates a torn final line before appending the next durable request', () => {
    const root = tempRoot()
    const first = writeWorkerSteer(root, 'run-1', 'coder', 'first')
    writeFileSync(first.file, `${readFileSync(first.file, 'utf8')}{"id":"trunc`, 'utf8')

    writeWorkerSteer(root, 'run-1', 'coder', 'second')

    expect(
      readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'coder').map((r) => r.message),
    ).toEqual(['first', 'second'])
  })

  it('replays a caller-keyed steer and rejects changed target material', () => {
    const root = tempRoot()
    const first = writeWorkerSteer(root, 'run-1', 'coder', 'focus on tests', 'cli', 'steer-1')
    const replay = writeWorkerSteer(root, 'run-1', 'coder', 'focus on tests', 'cli', 'steer-1')
    expect(replay).toEqual(first)
    expect(
      writeWorkerSteer(root, 'run-1', 'coder', 'focus on tests', { operationId: 'steer-1' }),
    ).toEqual(first)
    expect(readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'coder')).toHaveLength(1)

    expect(() =>
      writeWorkerSteer(root, 'run-1', 'reviewer', 'focus on tests', 'cli', 'steer-1'),
    ).toThrow(SupervisorOperationConflictError)
    expect(() =>
      writeWorkerSteer(root, 'run-1', 'coder', 'focus on docs', 'cli', 'steer-1'),
    ).toThrow(SupervisorOperationConflictError)
    expect(() =>
      writeWorkerSteer(root, 'run-1', 'coder', 'focus on tests', 'human', 'steer-1'),
    ).toThrow(SupervisorOperationConflictError)
    expect(readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'coder')).toHaveLength(1)
  })

  it('repairs a claimed steer after an append crash without changing its source', () => {
    const root = tempRoot()
    const first = writeWorkerSteer(root, 'run-1', 'coder', 'focus on tests', 'cli', 'steer-crash')
    rmSync(first.file)

    const replay = writeWorkerSteer(root, 'run-1', 'coder', 'focus on tests', {
      operationId: 'steer-crash',
    })
    expect(replay.request).toEqual(first.request)
    expect(readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'coder')).toEqual([
      first.request,
    ])
  })

  it('keeps a steer and cancellation intent after an injected inbox write failure', () => {
    const root = tempRoot()
    const persistence = {
      ...defaultWorkerControlPersistence,
      appendFile: (_file: string, _contents: string): never => {
        throw new Error('injected append failure')
      },
    }

    expect(() =>
      writeWorkerSteer(root, 'run-1', 'run-1:s0', 'retry me', {
        operationId: 'steer-append-fail',
        persistence,
      }),
    ).toThrow('injected append failure')
    expect(
      existsSync(workerSteerIntentFile(supervisorRunDir(root, 'run-1'), 'steer-append-fail')),
    ).toBe(true)
    const steerRetry = writeWorkerSteer(root, 'run-1', 'run-1:s0', 'retry me', {
      operationId: 'steer-append-fail',
    })
    expect(steerRetry.request.message).toBe('retry me')

    expect(() =>
      cancelWorker(root, 'run-1:s0', 'cancel-append-fail', {
        source: 'test',
        persistence,
      }),
    ).toThrow('injected append failure')
    expect(existsSync(workerCancellationIntentFile(root, 'cancel-append-fail'))).toBe(true)
    const cancelRetry = cancelWorker(root, 'run-1:s0', 'cancel-append-fail', { source: 'test' })
    expect(cancelRetry.effect).toBe('unknown')
    expect(readWorkerCancelRequests(root)).toHaveLength(1)
  })

  it('replays an acknowledged steer without relabeling its target or effect', () => {
    const root = tempRoot()
    const first = writeWorkerSteer(root, 'run-1', 'run-1:s0', 'focus on tests', 'cli', 'steer-ack')
    const acknowledgement = {
      operationId: 'steer-ack',
      worker: 'run-1:s0',
      source: 'cli',
      message: 'focus on tests',
      requestId: first.request.id,
      requestedAt: first.request.at,
      observedAt: new Date(1_000).toISOString(),
      effect: 'delivered' as const,
    }
    writeWorkerSteerAcknowledgement(supervisorRunDir(root, 'run-1'), acknowledgement)
    expect(readWorkerSteerAcknowledgement(supervisorRunDir(root, 'run-1'), 'steer-ack')).toEqual(
      acknowledgement,
    )

    const replay = writeWorkerSteer(root, 'run-1', 'run-1:s0', 'focus on tests', {
      operationId: 'steer-ack',
    })
    expect(replay.request).toEqual(first.request)
    expect(replay.file).toBe(first.file)
    expect(readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'run-1:s0')).toHaveLength(1)
    expect(() =>
      writeWorkerSteer(root, 'run-1', 'run-1:s1', 'focus on tests', 'cli', 'steer-ack'),
    ).toThrow(SupervisorOperationConflictError)
    expect(() =>
      writeWorkerSteer(root, 'run-1', 'run-1:s0', 'focus on docs', 'cli', 'steer-ack'),
    ).toThrow(SupervisorOperationConflictError)
    expect(() =>
      writeWorkerSteer(root, 'run-1', 'run-1:s0', 'focus on tests', 'human', 'steer-ack'),
    ).toThrow(SupervisorOperationConflictError)
  })

  it('binds pending and acknowledged cancellation retries to their request material', () => {
    const dir = tempRoot()
    const pending = cancelWorker(dir, 'coder', 'cancel-1', {
      source: 'cli',
      reason: 'stop after approval',
    })
    expect(
      cancelWorker(dir, 'coder', 'cancel-1', {
        source: 'cli',
        reason: 'stop after approval',
      }),
    ).toEqual(pending)
    expect(() => cancelWorker(dir, 'reviewer', 'cancel-1', { source: 'cli' })).toThrow(
      SupervisorOperationConflictError,
    )
    expect(() => cancelWorker(dir, 'coder', 'cancel-1', { source: 'human' })).toThrow(
      SupervisorOperationConflictError,
    )
    expect(() => cancelWorker(dir, 'coder', 'cancel-1', { reason: 'different' })).toThrow(
      SupervisorOperationConflictError,
    )

    const acknowledged = {
      operationId: 'cancel-ack',
      worker: 'coder',
      source: 'cli',
      effect: 'unknown' as const,
      requestedAt: new Date(0).toISOString(),
      observedAt: new Date(0).toISOString(),
      reason: 'wait for response',
      terminated: [],
    }
    writeWorkerCancellation(dir, acknowledged)
    expect(cancelWorker(dir, 'coder', 'cancel-ack', { source: 'cli' })).toEqual(acknowledged)
    expect(() => cancelWorker(dir, 'reviewer', 'cancel-ack')).toThrow(
      SupervisorOperationConflictError,
    )
    expect(() => cancelWorker(dir, 'coder', 'cancel-ack', { source: 'human' })).toThrow(
      SupervisorOperationConflictError,
    )
    expect(() => cancelWorker(dir, 'coder', 'cancel-ack', { reason: 'different' })).toThrow(
      SupervisorOperationConflictError,
    )
  })

  it('reads a legacy cancellation acknowledgement using its durable request source', () => {
    const dir = tempRoot()
    const request = cancelWorker(dir, 'coder', 'legacy-ack', {
      source: 'cli',
      reason: 'stop after approval',
    })
    const file = join(dir, 'cancellations', 'legacy-ack.json')
    writeFileSync(
      file,
      `${JSON.stringify({
        operationId: request.operationId,
        worker: request.worker,
        effect: 'unknown',
        requestedAt: request.requestedAt,
        observedAt: request.observedAt,
        reason: request.reason,
        terminated: [],
      })}\n`,
      'utf8',
    )

    expect(readWorkerCancellation(dir, 'legacy-ack')).toMatchObject({
      operationId: 'legacy-ack',
      source: 'cli',
    })
  })
})
