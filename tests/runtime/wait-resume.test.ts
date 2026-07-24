/**
 * THE wait-state claim, proven across a real process death: a supervision tree that is WAITING can
 * be SIGKILLed, and a brand-new process resumes it still waiting — to the ORIGINAL instant, not a
 * fresh countdown, and with a `poll` predicate re-resolved by name.
 *
 * Phase 1 arms a `timer` 3s out plus a `poll` on a file-existence probe, waits until both `waiting`
 * records are fsynced, and kills itself. Phase 2 inherits nothing but `spawn-journal.jsonl`. It
 * re-arms both waits by LABEL while deliberately passing FRESH specs (another 3s from its own
 * clock) — so a restarted countdown and an intact one are separated by a measurable gap, and the
 * assertion can tell them apart rather than taking the implementation's word for it.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FileSpawnJournal,
  materializeTreeView,
  pendingWaits,
} from '../../src/durable/spawn-journal'

const childScript = new URL('../helpers/supervisor-wait-child.ts', import.meta.url).pathname

interface PhaseReport {
  readonly phase: string
  readonly kind: string
  readonly processStart: number
  readonly timerMs: number
  readonly armed: Array<{ label: string; untilMs?: number; armedAt: number }>
  readonly resumedWaits: Array<{ label: string; untilMs?: number; armedAt: number }>
  readonly outcomes: Array<{
    label: string
    kind: string
    settled: string
    untilMs?: number
    armedAt: number
    wokenAt: number
    polls: number
    resumed: boolean
  }>
}

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

describe('wait-states survive a real process kill', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wait-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('a SIGKILLed waiting tree resumes still waiting, to its ORIGINAL deadline, with its poll probe re-resolved', {
    timeout: 120_000,
  }, async () => {
    const runId = 'wait-run'

    // ── Phase 1: arm two waits, then die hard ────────────────────────────────────────────
    const first = await runPhase(dir, runId, '1')
    expect(first.signal, `phase 1 stderr: ${first.stderr}`).toBe('SIGKILL')
    expect(first.code).toBeNull()

    // What survived: two `waiting` records, no `woken` — the tree is still waiting on disk.
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    const crashed = (await journal.loadTree(runId)) ?? []
    const armedEvents = crashed.filter((e) => e.kind === 'waiting')
    expect(armedEvents).toHaveLength(2)
    expect(crashed.filter((e) => e.kind === 'woken')).toHaveLength(0)

    // The materialized tree reports them as `waiting` — the status exists precisely so a killed
    // run reads as "still waiting" rather than as pending, running, or lost.
    const crashView = materializeTreeView(crashed)
    expect(crashView.waiting).toBe(2)
    expect(crashView.inFlight).toBe(0)

    // The pending set is what a resumed run re-arms — each with its ORIGINAL absolute deadline.
    const pending = pendingWaits(crashed)
    expect(pending.map((w) => w.label).sort()).toEqual(['ci-wait', 'timer-wait'])
    const journaledTimer = pending.find((w) => w.label === 'timer-wait')
    if (journaledTimer?.spec.kind !== 'timer') throw new Error('expected a timer spec')
    const originalUntilMs = journaledTimer.spec.untilMs
    expect(originalUntilMs).toBeGreaterThan(journaledTimer.armedAt)

    // ── The external condition flips while NOTHING is running ────────────────────────────
    // No process is alive here. That is the mechanic: the world moves on, and the run costs
    // nothing while it does.
    await writeFile(join(dir, 'ci-green.flag'), 'green')

    // ── Phase 2: a brand-new process, same dir + runId ────────────────────────────────────
    const second = await runPhase(dir, runId, '2')
    expect(second.code, `phase 2 stderr: ${second.stderr}`).toBe(0)
    const report = JSON.parse(second.stdout.trim()) as PhaseReport

    // Both waits came back on `Scope.resume.waits` with the instants phase 1 recorded.
    expect(report.resumedWaits.map((w) => w.label).sort()).toEqual(['ci-wait', 'timer-wait'])
    expect(report.resumedWaits.find((w) => w.label === 'timer-wait')?.untilMs).toBe(originalUntilMs)

    const timerOutcome = report.outcomes.find((o) => o.label === 'timer-wait')
    const ciOutcome = report.outcomes.find((o) => o.label === 'ci-wait')
    expect(timerOutcome).toBeDefined()
    expect(ciOutcome).toBeDefined()
    if (!timerOutcome || !ciOutcome) throw new Error('unreachable')

    // THE claim, three ways.
    // (1) The resumed wait is the SAME wait — same absolute instant, same original arm time,
    //     and it knows it was resumed.
    expect(timerOutcome.resumed).toBe(true)
    expect(timerOutcome.untilMs).toBe(originalUntilMs)
    expect(timerOutcome.armedAt).toBe(journaledTimer.armedAt)
    // (2) It did not fire EARLY — the deadline was honoured, not discarded.
    expect(timerOutcome.settled).toBe('fired')
    expect(timerOutcome.wokenAt).toBeGreaterThanOrEqual(originalUntilMs)
    // (3) It did not RESTART — phase 2 handed `wait` a fresh spec 3s out from its own start, and
    //     a restarted countdown would have woken no earlier than that. Waking measurably before
    //     it is only possible if the journaled instant won.
    const restartWouldWakeAt = report.processStart + report.timerMs
    expect(timerOutcome.wokenAt).toBeLessThan(restartWouldWakeAt - 200)

    // The poll re-resolved its probe BY NAME in a process that never saw the original closure,
    // and fired on the condition that flipped while nothing was running.
    expect(ciOutcome.resumed).toBe(true)
    expect(ciOutcome.settled).toBe('fired')
    expect(ciOutcome.polls).toBeGreaterThanOrEqual(1)

    // ── One intact tree spanning both processes ───────────────────────────────────────────
    const finalEvents = (await journal.loadTree(runId)) ?? []
    // Still exactly two `waiting` records: phase 2 ADOPTED the journaled waits rather than
    // arming a second pair (which would have doubled the tree and re-based the deadlines).
    expect(finalEvents.filter((e) => e.kind === 'waiting')).toHaveLength(2)
    expect(finalEvents.filter((e) => e.kind === 'woken')).toHaveLength(2)
    expect(pendingWaits(finalEvents)).toEqual([])
    const finalView = materializeTreeView(finalEvents)
    expect(finalView.waiting).toBe(0)
    for (const label of ['timer-wait', 'ci-wait']) {
      expect(finalView.nodes.find((n) => n.label === label)?.status).toBe('done')
    }
    // Every settlement kept a unique cursor position across the process boundary.
    const cursors = finalEvents
      .filter((e) => e.kind === 'settled' || e.kind === 'cancelled' || e.kind === 'woken')
      .map((e) => e.seq)
    expect(new Set(cursors).size).toBe(cursors.length)

    // And the whole thing cost nothing: a wait reserves no budget, so a run that only waited —
    // across two processes and several seconds — journaled zero spend.
    expect(report.kind).toBe('winner')
    const spent = finalEvents.filter((e) => e.kind === 'settled' || e.kind === 'metered')
    expect(spent).toHaveLength(0)
  })
})
