/**
 * The acceptance test for the resume-aware BUILT-IN driver.
 *
 * Five paid workers are dispatched by `supervise`'s own coordination driver under semantic spawn
 * keys. Three settle; the coordinator is then killed with two still in flight. A brand-new process
 * resumes on the same `runId` + `runDir` and re-issues the IDENTICAL plan — the brain is not
 * resume-aware, so every skip has to come from the runtime.
 *
 * What must hold: no replacement starts for a worker whose prior remote execution has no terminal
 * receipt. The resumed run keeps that work visible as unknown and charges its declared ceiling.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal'
import type { Spend } from '../../src/runtime/supervise/types'

const childScript = new URL('../helpers/resume-driver-child.ts', import.meta.url).pathname

type Phase = '1' | '2' | 'control'

interface PhaseExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

interface PhaseReport {
  readonly phase: Phase
  readonly kind: string
  readonly out: string | null
  readonly spentTotal: Spend
  readonly spentBreakdown?: { driverInference: Spend; childWork: Spend }
  readonly settledNodes: string[]
  readonly inDoubtRefusals: string[]
}

async function runPhase(dir: string, runId: string, phase: Phase): Promise<PhaseExit> {
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

/** Which workers actually ran their paid execution in that phase's process. */
async function execLog(dir: string, phase: Phase): Promise<string[]> {
  try {
    const text = await readFile(join(dir, `exec-${phase}.log`), 'utf8')
    return text
      .split('\n')
      .filter((l) => l.length > 0)
      .sort()
  } catch {
    return []
  }
}

describe('resume-aware built-in driver — a killed coordinator never duplicates unknown work', () => {
  let dir: string
  let controlDir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'resume-driver-'))
    controlDir = await mkdtemp(join(tmpdir(), 'resume-control-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(controlDir, { recursive: true, force: true })
  })

  it('five workers, three settled, coordinator killed: the two unknown assignments are refused without new execution', {
    timeout: 180_000,
  }, async () => {
    const runId = 'five-assignments'

    // ── Control: the same script, start to finish, never interrupted ─────────────────────
    const control = await runPhase(controlDir, runId, 'control')
    expect(control.code, `control stderr: ${control.stderr}`).toBe(0)
    const controlReport = JSON.parse(control.stdout.trim()) as PhaseReport
    expect(controlReport.kind).toBe('winner')
    // All five ran once in the uninterrupted baseline.
    expect(await execLog(controlDir, 'control')).toEqual(['w1', 'w2', 'w3', 'w4', 'w5'])
    expect(controlReport.settledNodes).toEqual(['w1', 'w2', 'w3', 'w4', 'w5'])

    // ── Phase 1: dispatch five, pull three settlements, die hard ─────────────────────────
    const first = await runPhase(dir, runId, '1')
    expect(first.signal, `phase 1 stderr: ${first.stderr}`).toBe('SIGKILL')
    expect(first.code).toBeNull()
    // All five assignments STARTED — the two that hang are the in-flight work the kill destroys.
    expect(await execLog(dir, '1')).toEqual(['w1', 'w2', 'w3', 'w4', 'w5'])

    // Exactly three assignments were committed to disk before the kill.
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    const crashed = (await journal.loadTree(runId)) ?? []
    const settledEvents = crashed.filter((e) => e.kind === 'settled')
    expect(settledEvents).toHaveLength(3)
    // Every one of the five spawns was journaled under its semantic key — that is what lets the
    // resumed run tell "already paid for" from "lost with the process".
    const spawnedKeys = crashed
      .filter((e): e is Extract<typeof e, { kind: 'spawned' }> => e.kind === 'spawned')
      .map((e) => e.key)
      .filter((k): k is string => k !== undefined)
      .sort()
    expect(spawnedKeys).toEqual(['w1', 'w2', 'w3', 'w4', 'w5'])

    // ── Phase 2: a new process, same runId + runDir, identical plan re-issued ─────────────
    const second = await runPhase(dir, runId, '2')
    expect(second.code, `phase 2 stderr: ${second.stderr}`).toBe(0)
    const resumed = JSON.parse(second.stdout.trim()) as PhaseReport

    // The safety boundary: phase 2 starts no replacement. The two keyed requests return an
    // action-oriented refusal instead of treating an absent receipt as proof of death.
    expect(await execLog(dir, '2')).toEqual([])
    expect(resumed.inDoubtRefusals).toHaveLength(2)
    for (const refusal of resumed.inDoubtRefusals) {
      expect(refusal).toContain('"error":"in-doubt"')
      expect(refusal).toContain('no replacement was started')
    }

    // Phase 2 emits no `spawned` records. The original five semantic assignments remain the
    // whole tree, with only the three terminal records the journal can prove.
    const afterResume = (await journal.loadTree(runId)) ?? []
    const resumedSpawnedKeys = afterResume
      .filter((e): e is Extract<typeof e, { kind: 'spawned' }> => e.kind === 'spawned')
      .map((e) => e.key)
      .filter((k): k is string => k !== undefined)
      .sort()
    expect(resumedSpawnedKeys).toEqual(['w1', 'w2', 'w3', 'w4', 'w5'])

    // The default finalizer may select the best independently verified settled artifact. It does
    // not invent terminal records for the two unknown assignments or claim their work completed.
    expect(resumed.kind).toBe('winner')
    expect(resumed.out).toBe('W3')
    expect(resumed.out).not.toBe(controlReport.out)
    expect(resumed.settledNodes).toEqual(['w1', 'w2', 'w3'])

    // Spend does not pretend the two killed executions were free: their missing receipts remain
    // charged at both declared ceilings and their telemetry remains unknown.
    expect(resumed.spentBreakdown?.childWork.iterations).toBe(13)
    expect(resumed.spentBreakdown?.childWork.tokens).toEqual({
      input: 20_030,
      output: 30,
      cacheBreakdownKnown: false,
    })
    expect(resumed.spentBreakdown?.childWork.tokensKnown).toBe(false)
    expect(resumed.spentBreakdown?.childWork.usdKnown).toBe(false)
    expect(resumed.spentBreakdown?.childWork.usd).toBeCloseTo(0.03, 10)

    // The resumed coordinator still has a metered inference record. Refusing unknown work may use
    // fewer turns than an uninterrupted control, but neither path may hide the coordinator cost.
    const resumedBrain = resumed.spentBreakdown?.driverInference.tokens.input ?? 0
    const controlBrain = controlReport.spentBreakdown?.driverInference.tokens.input ?? 0
    expect(controlBrain).toBeGreaterThan(0)
    expect(resumedBrain).toBeGreaterThan(0)
  })
})
