import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { compileFixture } from '../helpers/compile-fixture'

const exec = promisify(execFile)
/** Each coordinator process's own bound; a hang fails there, naming the phase and keeping its dir. */
const CHILD_TIMEOUT_MS = 15_000
const dirs: string[] = []
let fixture: Awaited<ReturnType<typeof compileFixture>>
beforeAll(async () => {
  fixture = await compileFixture('tests/integration/fixtures/parking-coordinator.ts')
})
afterAll(async () => {
  await fixture?.dispose()
})
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'supervise-parking-'))
  dirs.push(dir)
  return dir
}
async function coordinator(dir: string, mode: string, phase = 'park') {
  try {
    const { stdout, stderr } = await exec(process.execPath, [fixture.path, dir, mode, phase], {
      timeout: CHILD_TIMEOUT_MS,
      maxBuffer: 2_000_000,
    })
    expect(stderr).not.toContain('TimeoutOverflowWarning')
    return JSON.parse(stdout.trim().split('\n').at(-1)!)
  } catch (cause) {
    const index = dirs.indexOf(dir)
    if (index !== -1) dirs.splice(index, 1)
    const timing = await readFile(join(dir, 'process-timing.jsonl'), 'utf8').catch(
      () => 'fixture did not reach module entry',
    )
    const error = cause as Error & { stdout?: string; stderr?: string; signal?: string }
    throw new Error(
      `parking ${mode}/${phase} failed; retained ${dir}; signal=${error.signal}\n${timing}\nstdout: ${error.stdout ?? ''}\nstderr: ${error.stderr ?? ''}`,
      { cause },
    )
  }
}
async function events(dir: string) {
  return (await readFile(join(dir, 'spawn-journal.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .flatMap((row) => row.events ?? (row.event ? [row.event] : [row]))
}

describe('durable coordinator parking across real process exits', () => {
  it.each(['pause', 'seat', 'deadline'])(
    'parks a %s wait, releases its process and resumes the recorded run',
    async (mode) => {
      const dir = await directory()
      const parked = await coordinator(dir, mode)
      expect(parked.kind).toBe('parked')
      expect(parked.projection).toEqual({ runId: parked.runId, ...parked.parking })
      expect(parked.parking.reason).toBe(
        mode === 'pause' ? 'paused-root' : mode === 'seat' ? 'seat-wait' : 'deadline',
      )
      expect(Date.parse(parked.parking.wakeAt)).toBeGreaterThan(Date.parse(parked.parking.since))
      expect(existsSync(join(dir, 'supervise.lock'))).toBe(false)
      expect(existsSync(join(dir, 'failure.json'))).toBe(false)
      expect(existsSync(join(dir, 'result.json'))).toBe(false)
      // A process can die after the authoritative event fsync but before publishing its projection.
      await unlink(join(dir, 'parking.json'))
      const early = await coordinator(dir, mode, 'early')
      expect(early.parking.wakeAt).toBe(parked.parking.wakeAt)
      expect(early.projection).toEqual(parked.projection)
      expect((await events(dir)).filter((event) => event.kind === 'run-parked')).toHaveLength(1)
      if (mode !== 'seat')
        expect((await readFile(join(dir, 'drives.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(
          1,
        )
      const resumed = await coordinator(dir, mode, 'resume')
      expect(resumed.kind).toBe('settled')
      expect(resumed.projection).toBeNull()
      expect(resumed.result.tree.root).toBe('parking-proof')
      if (mode === 'deadline') expect(resumed.result.reason).toBe('deadline')
      expect(existsSync(join(dir, 'result.json'))).toBe(true)
      const journal = await events(dir)
      expect(
        journal.filter((event) => event.kind === 'spawned' && event.id === 'parking-proof'),
      ).toHaveLength(1)
      expect(journal.some((event) => event.kind === 'root-reentered')).toBe(true)
      if (mode === 'seat')
        expect(
          journal.some((event) => event.kind === 'seat-segment' && event.phase === 'started'),
        ).toBe(true)
    },
    // Three processes run in sequence. A 20 s whole-test bound fired before the second or third
    // process's own bound under publisher load (1.9 s alone, over 20 s there) and lost its diagnosis.
    3 * CHILD_TIMEOUT_MS + 5_000,
  )

  it('keeps the coordinator while its child is active and cancellation settles normally', async () => {
    const dir = await directory()
    const outcome = await coordinator(dir, 'active')
    expect(outcome.kind).toBe('settled')
    expect(outcome.result.reason).toBe('cancelled')
    expect((await events(dir)).some((event) => event.kind === 'run-parked')).toBe(false)
  })

  it('parks when the last active child finishes during an existing long root pause', async () => {
    const dir = await directory()
    const outcome = await coordinator(dir, 'draining')
    expect(outcome.kind).toBe('parked')
    const journal = await events(dir)
    const settled = journal.findIndex(
      (event) => event.kind === 'settled' && event.id !== 'parking-proof',
    )
    const parked = journal.findIndex((event) => event.kind === 'run-parked')
    expect(settled).toBeGreaterThanOrEqual(0)
    expect(parked).toBeGreaterThan(settled)
    expect(existsSync(join(dir, 'result.json'))).toBe(false)
  })

  it('treats another run parking as a driver failure and joins its own active child', async () => {
    const dir = await directory()
    const outcome = await coordinator(dir, 'foreign')
    expect(outcome.kind).toBe('settled')
    expect(outcome.result.kind).toBe('no-winner')
    expect(outcome.result.reason).toBe('driver-failed')
    expect(
      outcome.result.tree.nodes.find((node: { label: string }) => node.label === 'active-work')
        ?.status,
    ).toBe('failed')
    expect(outcome.result.tree.inFlight).toBe(0)
    expect(existsSync(join(dir, 'child-ended'))).toBe(true)
    const journal = await events(dir)
    expect(journal).toContainEqual(
      expect.objectContaining({
        kind: 'settled',
        id: 'parking-proof:s0',
        status: 'down',
        reason: 'root driver failed; no child settle grace configured',
      }),
    )
    expect(journal.some((event) => event.kind === 'run-parked')).toBe(false)
    expect(existsSync(join(dir, 'result.json'))).toBe(true)
  })

  it('reopens an early-cancelled parked run before its historical wake without parking again', async () => {
    const dir = await directory()
    const parked = await coordinator(dir, 'pause')
    expect(parked.kind).toBe('parked')
    const cancelled = await coordinator(dir, 'pause', 'cancel')
    expect(cancelled.kind).toBe('settled')
    expect(cancelled.result.reason).toBe('cancelled')
    const reopened = await coordinator(dir, 'pause', 'reopen')
    expect(Date.now()).toBeLessThan(Date.parse(parked.parking.wakeAt))
    expect(reopened.kind).toBe('settled')
    expect(reopened.projection).toBeNull()
    expect((await events(dir)).filter((event) => event.kind === 'run-parked')).toHaveLength(1)
    expect((await events(dir)).some((event) => event.kind === 'reopened')).toBe(true)
    expect(
      (await readFile(join(dir, 'drives.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).phase),
    ).toEqual(['park', 'reopen'])
  })

  it('keeps receipted effects and their unread outcomes alive during a root pause', async () => {
    const dir = await directory()
    const outcome = await coordinator(dir, 'tool')
    expect(outcome.kind).toBe('settled')
    expect(outcome.result.reason).toBe('cancelled')
    expect(existsSync(join(dir, 'tool-receipt'))).toBe(true)
    expect(existsSync(join(dir, 'tool-finished'))).toBe(true)
    expect((await events(dir)).some((event) => event.kind === 'run-parked')).toBe(false)
    const observer = await readFile(join(dir, 'coordination-log.jsonl'), 'utf8')
    expect(observer).toContain('tool-outcome')
  })

  it('ends a root stop-pause on a durable steer and completes through its normal coordination route', async () => {
    const dir = await directory()
    const outcome = await coordinator(dir, 'steer')
    expect(outcome.kind).toBe('settled')
    expect(['driver-failed', 'cancelled']).not.toContain(outcome.result.reason)
    expect(outcome.steer.effect).toBe('delivered')
    const drives = (await readFile(join(dir, 'drives.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(drives.length).toBeGreaterThanOrEqual(2)
    expect(
      drives
        .slice(1)
        .some((drive) => String(drive.task).includes('Continue after this durable correction.')),
    ).toBe(true)
    expect((await events(dir)).some((event) => event.kind === 'run-parked')).toBe(false)
  })
})
