import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publishExclusiveDurableFile, writeAtomicDurableFile } from './durable-file'
import {
  readRunCancellation,
  readWorkerCancellation,
  writeRunCancellation,
  writeWorkerCancellation,
} from './run-layout'

let root: string | undefined

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
    expect(readdirSync(join(root, 'cancellations'))).toEqual(['run.json'])
  })
})
