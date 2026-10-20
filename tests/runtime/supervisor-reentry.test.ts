/**
 * A supervisor restart is not a barren streak.
 *
 * Measured 2026-10-19 on magnetar-rust-20261019f: a host reboot killed the supervisor with three
 * workers open; the new process re-drove the root with the bare original task, two barren
 * continuations followed, and the run settled `no-winner` / `no-result-selected`.
 *
 * Phase 1 runs a harness-driven root in its own OS process and SIGKILLs it mid-drive, with one
 * worker open. Phase 2 is a new process on the same run directory and run id. Its model streams no
 * event for two drives, then streams events without progress. The run must keep running through
 * the silent drives, record the re-entry, and refuse a continuation only after `maxBarren` barren
 * drives that began after the first post-re-entry model event. Only the model process and the
 * supervisor clock are fake (`tests/helpers/supervisor-reentry-child.ts`).
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-retry'

const childScript = new URL('../helpers/supervisor-reentry-child.ts', import.meta.url).pathname

interface PhaseExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

async function runPhase(dir: string, runId: string, phase: '1' | '2'): Promise<PhaseExit> {
  return await new Promise<PhaseExit>((resolvePhase, rejectPhase) => {
    const child = spawn(process.execPath, ['--import', 'tsx', childScript, dir, runId, phase], {
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

  it('keeps a re-entered run running until a barren streak follows its first model event', {
    timeout: 120_000,
  }, async () => {
    const runId = 'reentry-run'

    const first = await runPhase(dir, runId, '1')
    expect(first.signal, `phase 1 stderr: ${first.stderr}`).toBe('SIGKILL')
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    const crashed = (await journal.loadTree(runId)) ?? []
    const worker = crashed.find((event) => event.kind === 'spawned' && event.parent === runId)
    expect(worker).toBeDefined()
    expect(crashed.some((event) => event.kind === 'root-reentered')).toBe(false)

    const second = await runPhase(dir, runId, '2')
    expect(second.code, `phase 2 stderr: ${second.stderr}`).toBe(0)

    // The re-entry is a typed record on the run, naming the worker that was open.
    const events = (await journal.loadTree(runId)) ?? []
    const reentries = events.filter((event) => event.kind === 'root-reentered')
    expect(reentries).toEqual([
      expect.objectContaining({ id: runId, live: [worker?.id], replaced: [], seq: 0 }),
    ])

    // The first drive after re-entry is re-driven with the workers that were live.
    const tasks = await jsonLines<string>(join(dir, 'tasks-phase-2.jsonl'))
    expect(tasks[0]).toContain('a new process took it over')
    expect(tasks[0]).toContain(`Gone, and they will not report: ${worker?.id}.`)

    const attempts = await jsonLines<DriverAttemptRecord>(join(dir, 'attempts-phase-2.jsonl'))
    // Two drives with no model event, then one that streams: all three are re-entered without a
    // refusal, and the silent ones are marked as such.
    expect(attempts.slice(0, 3)).toEqual([
      expect.objectContaining({
        attempt: 1,
        reentry: 'run-reentered',
        beforeModelEvent: true,
        reprompted: true,
      }),
      expect.objectContaining({
        attempt: 2,
        reentry: 'unmet-contract',
        beforeModelEvent: true,
        reprompted: true,
      }),
      expect.objectContaining({
        attempt: 3,
        reentry: 'unmet-contract',
        beforeModelEvent: true,
        reprompted: true,
      }),
    ])
    expect(attempts.slice(0, 3).every((record) => record.madeProgress === false)).toBe(true)
    // Drives 4 and 5 began after the first model event and made no progress: maxBarren is 2, so
    // the second of them is the first refusal.
    expect(attempts.slice(3)).toEqual([
      expect.objectContaining({ attempt: 4, reprompted: true, madeProgress: false }),
      expect.objectContaining({
        attempt: 5,
        repromptRefusedBy: 'no-progress',
        stop: 'completed',
        madeProgress: false,
      }),
    ])
    expect(attempts.slice(3).some((record) => record.beforeModelEvent === true)).toBe(false)
    expect(attempts.filter((record) => record.repromptRefusedBy !== undefined)).toHaveLength(1)

    const report = JSON.parse(second.stdout.trim()) as { kind: string; drives: number }
    expect(report.drives).toBe(5)
  })
})
