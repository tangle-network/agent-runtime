/**
 * A supervisor restart is not a barren streak.
 *
 * Measured 2026-10-19 on magnetar-rust-20261019f: a host reboot killed the supervisor with three
 * workers open; the new process re-drove the root with the bare original task, two barren
 * continuations followed, and the run settled `no-winner` / `no-result-selected`.
 *
 * Phase 1 runs a harness-driven root in its own OS process and SIGKILLs it mid-drive, with one
 * worker open. Phase 2 is a new process on the same run directory and run id, and no phase-2 drive
 * makes progress. The run must record the re-entry, stay running through two barren drives after
 * it, and refuse a continuation only after `maxBarren` (2) barren drives that each began after the
 * first post-re-entry model event. Two model shapes: silent for two drives before it speaks, and
 * the incident's, speaking from the first drive. Only the model process and the supervisor clock
 * are fake (`tests/helpers/supervisor-reentry-child.ts`).
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-attempt-evidence'

type Shape = 'silent-first' | 'streams-first'

/** What the run's journal held as one phase-2 drive began. */
interface JournalAtDrive {
  readonly drive: number
  readonly reentries: number
  readonly attempts: ReadonlyArray<DriverAttemptRecord>
}

const childScript = new URL('../helpers/supervisor-reentry-child.ts', import.meta.url).pathname

interface PhaseExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

async function runPhase(
  dir: string,
  runId: string,
  phase: '1' | '2',
  shape?: Shape,
): Promise<PhaseExit> {
  const args = [childScript, dir, runId, phase, ...(shape === undefined ? [] : [shape])]
  return await new Promise<PhaseExit>((resolvePhase, rejectPhase) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (c: string) => {
      stdout += c
    })
    child.stderr.setEncoding('utf8').on('data', (c: string) => {
      stderr += c
    })
    child.once('error', rejectPhase)
    child.once('close', (code, signal) => resolvePhase({ code, signal, stdout, stderr }))
  })
}

async function jsonLines<T>(path: string): Promise<T[]> {
  try {
    return (await readFile(path, 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T)
  } catch {
    return []
  }
}

describe('supervisor re-entry after a process restart', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sup-reentry-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** Phase 1, the kill, and phase 2 under `shape`; returns phase 2's journal and evidence. */
  async function restartedRun(runId: string, shape: Shape) {
    const first = await runPhase(dir, runId, '1')
    expect(first.signal, `phase 1 stderr: ${first.stderr}`).toBe('SIGKILL')
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    const crashed = (await journal.loadTree(runId)) ?? []
    const worker = crashed.find((event) => event.kind === 'spawned' && event.parent === runId)
    expect(worker).toBeDefined()
    expect(crashed.some((event) => event.kind === 'root-reentered')).toBe(false)

    const second = await runPhase(dir, runId, '2', shape)
    expect(second.code, `phase 2 stderr: ${second.stderr}`).toBe(0)
    const events = (await journal.loadTree(runId)) ?? []
    return {
      workerId: worker?.id,
      events,
      // The root's driver records, as the run's journal holds them after it settled.
      attempts: events.flatMap((event) =>
        event.kind === 'driver-attempt' && event.id === runId ? [event.record] : [],
      ),
      atDrive: await jsonLines<JournalAtDrive>(join(dir, 'journal-phase-2.jsonl')),
      tasks: await jsonLines<string>(join(dir, 'tasks-phase-2.jsonl')),
    }
  }

  const refusals = (records: ReadonlyArray<DriverAttemptRecord>) =>
    records.filter((record) => record.repromptRefusedBy !== undefined || record.stop !== undefined)

  for (const shape of ['silent-first', 'streams-first'] as const) {
    it(`records the re-entry and stays running through two barren drives (${shape})`, {
      timeout: 120_000,
    }, async () => {
      const runId = `reentry-${shape}`
      const { workerId, events, attempts, atDrive, tasks } = await restartedRun(runId, shape)

      // The re-entry is a typed record on the run, naming the worker that was open.
      expect(events.filter((event) => event.kind === 'root-reentered')).toEqual([
        expect.objectContaining({ id: runId, live: [workerId], replaced: [], seq: 0 }),
      ])
      // The first drive after re-entry is re-driven with the worker that was live.
      expect(tasks[0]).toContain(`${workerId}`)

      // As the third drive began, two drives after re-entry had made no progress, and the run's
      // journal held the re-entry and no refusal or stop: the run was still being driven.
      const third = atDrive.find((snapshot) => snapshot.drive === 3)
      expect(third?.reentries).toBe(1)
      expect(third?.attempts).toHaveLength(2)
      expect(third?.attempts.every((record) => record.madeProgress === false)).toBe(true)
      expect(refusals(third?.attempts ?? [])).toEqual([])

      // Exactly one refusal, by `no-progress`, after `maxBarren` drives that began after the first
      // post-re-entry model event; every drive that began before it is marked and never counted.
      const silent = shape === 'silent-first' ? 3 : 1
      expect(attempts).toHaveLength(silent + 2)
      expect(attempts[0]).toMatchObject({ attempt: 1, reentry: 'run-reentered' })
      expect(attempts.slice(0, silent).every((record) => record.beforeModelEvent === true)).toBe(
        true,
      )
      expect(attempts.slice(silent).some((record) => record.beforeModelEvent === true)).toBe(false)
      expect(attempts.slice(0, -1).every((record) => record.reprompted === true)).toBe(true)
      expect(refusals(attempts)).toEqual([
        expect.objectContaining({
          attempt: silent + 2,
          madeProgress: false,
          repromptRefusedBy: 'no-progress',
          stop: 'completed',
        }),
      ])
    })
  }
})
