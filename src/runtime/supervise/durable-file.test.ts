import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publishExclusiveDurableFile, writeAtomicDurableFile } from './durable-file'
import {
  cancelRun,
  cancelWorker,
  readRunCancellation,
  readRunCancelRequest,
  readWorkerCancellation,
  readWorkerCancelRequests,
  workerCancelRequestsFile,
  writeRunCancellation,
  writeWorkerCancellation,
} from './run-layout'

let root: string | undefined

function expectPrivateMode(filePath: string): void {
  if (process.platform !== 'win32') expect(statSync(filePath).mode & 0o777).toBe(0o600)
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('durable file helpers', () => {
  it('fsyncs complete exclusive contents and refuses to clobber a winner', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))
    const filePath = join(root, 'state.json')

    expect(publishExclusiveDurableFile(filePath, '{"winner":true}\n', { mode: 0o600 })).toBe(true)

    expect(readFileSync(filePath, 'utf8')).toBe('{"winner":true}\n')
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    expect(publishExclusiveDurableFile(filePath, '{"winner":false}\n')).toBe(false)
    expect(readFileSync(filePath, 'utf8')).toBe('{"winner":true}\n')
  })

  it('fsyncs an atomic replacement and leaves no temporary publication file', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))
    const filePath = join(root, 'nested', 'state.json')
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, '{"generation":1}\n')

    writeAtomicDurableFile(filePath, '{"generation":2}\n', { mode: 0o600 })

    expect(readFileSync(filePath, 'utf8')).toBe('{"generation":2}\n')
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    expect(readdirSync(dirname(filePath))).toEqual(['state.json'])
  })

  it('writes worker cancellation acknowledgements through the durable replacement path', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))
    const first = {
      operationId: 'worker-op',
      worker: 'worker-1',
      effect: 'cancel_requested' as const,
      requestedAt: '2026-08-28T00:00:00.000Z',
      observedAt: '2026-08-28T00:00:01.000Z',
      detail: 'abort issued',
      terminated: [],
    }
    const second = { ...first, effect: 'cancelled' as const, terminated: ['worker-1'] }

    writeWorkerCancellation(root, first)
    expect(readWorkerCancellation(root, first.operationId)).toEqual(first)
    writeWorkerCancellation(root, second)

    expect(readWorkerCancellation(root, second.operationId)).toEqual(second)
    expectPrivateMode(join(root, 'cancellations', 'worker-op.json'))
    expect(readdirSync(join(root, 'cancellations'))).toEqual(['worker-op.json'])
  })

  it('writes run cancellation acknowledgements through the durable replacement path', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))
    const first = {
      operationId: 'run-op',
      effect: 'cancel_requested' as const,
      requestedAt: '2026-08-28T00:00:00.000Z',
      observedAt: '2026-08-28T00:00:01.000Z',
      detail: 'root abort issued',
    }
    const second = { ...first, effect: 'cancelled' as const, detail: 'run aborted' }

    writeRunCancellation(root, first)
    expect(readRunCancellation(root, first.operationId)).toEqual(first)
    writeRunCancellation(root, second)

    expect(readRunCancellation(root, second.operationId)).toEqual(second)
    expectPrivateMode(join(root, 'cancellations', 'run.json'))
    expect(readdirSync(join(root, 'cancellations'))).toEqual(['run.json'])
  })

  it('writes run cancellation requests through the durable replacement path', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))

    expect(cancelRun(root, 'run-request', { source: 'test', reason: 'stop now' }).effect).toBe(
      'unknown',
    )
    expect(readRunCancelRequest(root)).toMatchObject({
      operationId: 'run-request',
      source: 'test',
      reason: 'stop now',
    })
    expectPrivateMode(join(root, 'cancellations', 'run.request.json'))
    expect(readdirSync(join(root, 'cancellations'))).toEqual(['run.request.json'])
  })

  it('appends worker cancellation requests in order and replays one operation', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))

    cancelWorker(root, 'worker-a', 'worker-op-a', { source: 'test' })
    cancelWorker(root, 'worker-b', 'worker-op-b', { source: 'test' })
    expect(() => cancelWorker(root!, 'worker-a', 'worker-op-a', { source: 'different' })).toThrow(
      /conflicts/u,
    )
    const firstReplay = cancelWorker(root, 'worker-a', 'worker-op-a')

    const firstLine = readFileSync(workerCancelRequestsFile(root), 'utf8').split('\n')[0]
    appendFileSync(workerCancelRequestsFile(root), `${firstLine}\n`, 'utf8')

    expect(firstReplay.operationId).toBe('worker-op-a')
    expect(readWorkerCancelRequests(root).map((request) => request.operationId)).toEqual([
      'worker-op-a',
      'worker-op-b',
    ])
    expectPrivateMode(workerCancelRequestsFile(root))
    expect(
      readFileSync(workerCancelRequestsFile(root), 'utf8').split('\n').filter(Boolean),
    ).toHaveLength(3)
  })

  it('rejects worker cancellation payload changes for one operation', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))

    cancelWorker(root, 'worker-a', 'worker-op', { source: 'source-a', reason: 'reason-a' })
    expect(() =>
      cancelWorker(root!, 'worker-b', 'worker-op', { source: 'source-a', reason: 'reason-a' }),
    ).toThrow(/worker/u)
    expect(() =>
      cancelWorker(root!, 'worker-a', 'worker-op', { source: 'source-b', reason: 'reason-a' }),
    ).toThrow(/source/u)
    expect(() =>
      cancelWorker(root!, 'worker-a', 'worker-op', { source: 'source-a', reason: 'reason-b' }),
    ).toThrow(/reason/u)
  })

  it('rejects run cancellation payload changes for one operation', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))

    cancelRun(root, 'run-op', { source: 'source-a', reason: 'reason-a' })
    expect(() => cancelRun(root!, 'run-op', { source: 'source-b', reason: 'reason-a' })).toThrow(
      /source/u,
    )
    expect(() => cancelRun(root!, 'run-op', { source: 'source-a', reason: 'reason-b' })).toThrow(
      /reason/u,
    )
  })

  it('rejects a worker cancellation target that is a symbolic link', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))
    const dir = join(root, 'cancellations')
    mkdirSync(dir)
    const target = join(root, 'worker-target.json')
    writeFileSync(target, '{}')
    symlinkSync(target, join(dir, 'worker-op.json'))

    const record = {
      operationId: 'worker-op',
      worker: 'worker-1',
      effect: 'cancel_requested' as const,
      requestedAt: '2026-08-28T00:00:00.000Z',
      observedAt: '2026-08-28T00:00:01.000Z',
      detail: 'abort issued',
      terminated: [],
    }
    expect(() => writeWorkerCancellation(root!, record)).toThrow(/symbolic link/u)
    expect(() => readWorkerCancellation(root!, record.operationId)).toThrow(/symbolic link/u)
  })

  it('rejects a run cancellation request through a symbolic-link directory', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))
    const target = join(root, 'run-target')
    mkdirSync(target)
    symlinkSync(target, join(root, 'cancellations'), 'dir')

    expect(() => cancelRun(root!, 'run-op', { source: 'test' })).toThrow(/symbolic link/u)
  })

  it('rejects a run cancellation target that is a symbolic link', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))
    const dir = join(root, 'cancellations')
    mkdirSync(dir)
    const target = join(root, 'run-target.json')
    writeFileSync(target, '{}')
    symlinkSync(target, join(dir, 'run.json'))

    const record = {
      operationId: 'run-op',
      effect: 'cancel_requested' as const,
      requestedAt: '2026-08-28T00:00:00.000Z',
      observedAt: '2026-08-28T00:00:01.000Z',
      detail: 'abort issued',
    }
    expect(() => writeRunCancellation(root!, record)).toThrow(/symbolic link/u)
    expect(() => readRunCancellation(root!, record.operationId)).toThrow(/symbolic link/u)
  })
})
