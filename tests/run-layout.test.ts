import { spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claimWorkerSteerDelivery,
  legacySupervisorRunDir,
  readWorkerSteerAcknowledgement,
  readWorkerSteerRequests,
  safeWorkerFile,
  supervisorRunDir,
  supervisorRunsRoot,
  workerInboxFile,
  workerSteerAcknowledgementFile,
  workerSteerRequestFile,
  writeWorkerSteer,
  writeWorkerSteerAcknowledgement,
} from '../src/runtime/supervise/run-layout'

const childScript = new URL('./helpers/worker-steer-child.ts', import.meta.url).pathname

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
    expect(workerInboxFile('/ws', 'run-1', 'worker a/b')).toBe(
      join('/ws', '.agent', 'supervisor', 'run-1', 'workers', 'worker_a_b.inbox.ndjson'),
    )
  })

  it('pins the legacy pre-rename location readers fall back to: <root>/.loops/supervisor/<id>', () => {
    expect(legacySupervisorRunDir('/ws', 'run-1')).toBe(
      join('/ws', '.loops', 'supervisor', 'run-1'),
    )
  })

  it('reduces any label to a safe filename, with a stable fallback for empty ones', () => {
    expect(safeWorkerFile('review: pkg/α')).toBe('review__pkg__')
    expect(safeWorkerFile('')).toBe('worker')
  })

  it('round-trips a steer through the durable inbox', () => {
    const root = tempRoot()
    const written = writeWorkerSteer(root, 'run-1', 'run-1:s0', {
      operationId: 'steer-1',
      message: 'focus on the failing test',
      source: 'human',
    })
    const read = readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'run-1:s0')
    expect(read).toEqual([written.request])
    expect(written.request.source).toBe('human')
    expect(written.replayed).toBe(false)

    const replay = writeWorkerSteer(root, 'run-1', 'run-1:s0', {
      operationId: 'steer-1',
      message: 'focus on the failing test',
      source: 'human',
    })
    expect(replay.replayed).toBe(true)
    expect(readWorkerSteerRequests(supervisorRunDir(root, 'run-1'))).toHaveLength(1)
    expect(() =>
      writeWorkerSteer(root, 'run-1', 'run-1:s0', {
        operationId: 'steer-1',
        message: 'change the request body',
      }),
    ).toThrow(/conflicts/)
  })

  it('rejects an empty steer instead of writing a blank line', () => {
    expect(() =>
      writeWorkerSteer(tempRoot(), 'run-1', 'run-1:s0', {
        operationId: 'steer-empty',
        message: '   ',
      }),
    ).toThrow(/empty/)
  })

  it('a corrupt or partial line never poisons later valid lines', () => {
    const root = tempRoot()
    writeWorkerSteer(root, 'run-1', 'run-1:s0', {
      operationId: 'steer-first',
      message: 'first',
    })
    writeWorkerSteer(root, 'run-1', 'run-1:s0', {
      operationId: 'steer-second',
      message: 'second',
    })
    const file = workerInboxFile(root, 'run-1', 'run-1:s0')
    const raw = readFileSync(file, 'utf8')
    // Simulate a writer killed mid-append between the two valid lines.
    const lines = raw.trimEnd().split('\n')
    writeFileSync(
      file,
      `${lines[0]}\n{"operationId":"trunc`.concat('\n', lines[1] ?? '', '\n'),
      'utf8',
    )
    const read = readWorkerSteerRequests(supervisorRunDir(root, 'run-1'), 'run-1:s0')
    expect(read.map((r) => r.message)).toEqual(['first', 'second'])
  })

  it('admits one delivery claimant and exposes the durable acknowledgement after restart', () => {
    const root = tempRoot()
    const dir = supervisorRunDir(root, 'run-1')
    const request = writeWorkerSteer(root, 'run-1', 'run-1:s0', {
      operationId: 'steer-claim',
      message: 'inspect the failing case',
    }).request
    const claim = {
      schemaVersion: 1 as const,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      worker: request.worker,
      effect: 'unknown' as const,
      requestedAt: request.at,
      observedAt: '2026-08-28T00:00:00.000Z',
      detail: 'delivery admitted; outcome not yet known',
    }
    expect(claimWorkerSteerDelivery(dir, claim)).toBe(true)
    expect(claimWorkerSteerDelivery(dir, claim)).toBe(false)
    expect(readWorkerSteerAcknowledgement(dir, request.operationId)).toEqual(claim)
    writeWorkerSteerAcknowledgement(dir, {
      ...claim,
      effect: 'delivered',
      observedAt: '2026-08-28T00:00:01.000Z',
      detail: 'delivered once',
    })
    expect(readWorkerSteerAcknowledgement(dir, request.operationId)?.effect).toBe('delivered')
  })

  it('admits one canonical request across concurrent writer processes', async () => {
    const root = tempRoot()
    const startAt = Date.now() + 250
    const args = [
      'write',
      root,
      'run-concurrent-write',
      'run-concurrent-write:s0',
      'steer-concurrent-write',
      'inspect the same failure',
      String(startAt),
    ]
    const results = await Promise.all([runChild(args), runChild(args)])
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true])
    expect(readWorkerSteerRequests(supervisorRunDir(root, 'run-concurrent-write'))).toHaveLength(1)
  })

  it('admits one delivery claimant across concurrent manager processes', async () => {
    const root = tempRoot()
    const dir = supervisorRunDir(root, 'run-concurrent-claim')
    writeWorkerSteer(root, 'run-concurrent-claim', 'run-concurrent-claim:s0', {
      operationId: 'steer-concurrent-claim',
      message: 'deliver this once',
    })
    const startAt = Date.now() + 250
    const args = ['claim', dir, 'steer-concurrent-claim', String(startAt)]
    const results = await Promise.all([runChild(args), runChild(args)])
    expect(results.map((result) => result.won).sort()).toEqual([false, true])
    expect(readWorkerSteerAcknowledgement(dir, 'steer-concurrent-claim')?.effect).toBe('unknown')
  })

  it('skips one corrupt canonical request without hiding another operation', () => {
    const root = tempRoot()
    const dir = supervisorRunDir(root, 'run-corrupt-request')
    writeWorkerSteer(root, 'run-corrupt-request', 'run-corrupt-request:s0', {
      operationId: 'steer-corrupt',
      message: 'first',
    })
    writeWorkerSteer(root, 'run-corrupt-request', 'run-corrupt-request:s0', {
      operationId: 'steer-valid',
      message: 'second',
    })
    writeFileSync(workerSteerRequestFile(dir, 'steer-corrupt'), '{"schemaVersion":', 'utf8')
    expect(readWorkerSteerRequests(dir).map((request) => request.operationId)).toEqual([
      'steer-valid',
    ])
  })

  it('fails closed for a corrupt acknowledgement and a symlinked steer directory', () => {
    const root = tempRoot()
    const dir = supervisorRunDir(root, 'run-corrupt-ack')
    writeWorkerSteer(root, 'run-corrupt-ack', 'run-corrupt-ack:s0', {
      operationId: 'steer-corrupt-ack',
      message: 'inspect',
    })
    mkdirSync(join(dir, 'steers', 'acks'), { recursive: true })
    writeFileSync(
      workerSteerAcknowledgementFile(dir, 'steer-corrupt-ack'),
      '{"schemaVersion":',
      'utf8',
    )
    expect(() => readWorkerSteerAcknowledgement(dir, 'steer-corrupt-ack')).toThrow()

    const symlinkRoot = tempRoot()
    const symlinkDir = supervisorRunDir(symlinkRoot, 'run-symlink')
    const outside = tempRoot()
    mkdirSync(symlinkDir, { recursive: true })
    symlinkSync(outside, join(symlinkDir, 'steers'), 'dir')
    expect(() =>
      writeWorkerSteer(symlinkRoot, 'run-symlink', 'run-symlink:s0', {
        operationId: 'steer-symlink',
        message: 'must not escape',
      }),
    ).toThrow(/symbolic link/)
    expect(readdirSync(outside)).toEqual([])
  })
})

function runChild(args: string[]): Promise<Record<string, boolean>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', childScript, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker steer child exited ${String(code)}: ${stderr}`))
        return
      }
      resolve(JSON.parse(stdout.trim()) as Record<string, boolean>)
    })
  })
}
