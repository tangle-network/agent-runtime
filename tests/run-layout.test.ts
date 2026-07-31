import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readWorkerSteerRequests,
  safeWorkerFile,
  supervisorRunDir,
  workerInboxFile,
  writeWorkerSteer,
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
  it('pins the published path shape traces reads: <root>/.loops/supervisor/<id>', () => {
    // This exact shape is consumed by `traces analyze --supervisor-run-dir`; changing it is a
    // breaking change to a PUBLISHED reader, not a refactor.
    expect(supervisorRunDir('/ws', 'run-1')).toBe(join('/ws', '.loops', 'supervisor', 'run-1'))
    expect(workerInboxFile('/ws', 'run-1', 'worker a/b')).toBe(
      join('/ws', '.loops', 'supervisor', 'run-1', 'workers', 'worker_a_b.inbox.ndjson'),
    )
  })

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
})
