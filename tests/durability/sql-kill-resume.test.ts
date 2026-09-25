/**
 * runGraph kill-and-resume conformance — the SQL arm (DRAFT, representative subset).
 *
 * The durable stores are `SqlSpawnJournal` + `SqlResultBlobStore` over a REAL sqlite file: the
 * killed process's only inheritance is the database. Same contract as the file-run-context
 * matrix, over a representative kill set (early boundary, worker mid/after — the in-doubt window,
 * the side-effect window, and the final submission turn); the full 23-point sweep and the
 * capabilities.json registration land when this leaves draft.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ARTIFACT_KEY,
  auditSpawnJournalAt,
  type GraphChildReport,
  type JournalAudit,
  RUN_ID,
  WORKER_NODES,
} from '../helpers/durability/conformance-graph'

const childScript = new URL('../helpers/durability/sql-child.ts', import.meta.url).pathname

const CASES = [
  'driver:turn:1:before',
  'worker:surveyor:mid',
  'worker:builder:after',
  'tool:commit:after-effect',
  'driver:turn:6:after',
] as const

interface PhaseExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

async function runPhase(dir: string, phase: '1' | '2', killAt?: string): Promise<PhaseExit> {
  return await new Promise<PhaseExit>((resolvePhase, rejectPhase) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', childScript, dir, phase, ...(phase === '1' ? [killAt ?? '-'] : [])],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
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

function parseReport(stdout: string): GraphChildReport {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop()
  if (line === undefined) throw new Error(`child printed no report line: ${stdout.slice(0, 500)}`)
  return JSON.parse(line) as GraphChildReport
}

describe('runGraph kill-and-resume conformance (SQL run context, sqlite) — draft subset', () => {
  let dir: string
  let reference: GraphChildReport

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sql-kill-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('the reference run completes with the expected outcome', { timeout: 120_000 }, async () => {
    const ref = await runPhase(dir, '1')
    expect(ref.code, `reference stderr: ${ref.stderr}`).toBe(0)
    reference = parseReport(ref.stdout)
    expect(reference.kind).toBe('winner')
    expect(reference.out).toEqual({ artifactKey: ARTIFACT_KEY, nodes: [...WORKER_NODES] })
    expect(reference.committedEffects).toEqual([ARTIFACT_KEY])
    expect(reference.escalations).toEqual([])
  })

  it.each(CASES.map((label) => [label] as const))(
    'SIGKILL at %s → resume completes, loses nothing, repeats no committed step',
    { timeout: 120_000 },
    async (label: string) => {
      const killed = await runPhase(dir, '1', label)
      expect(killed.signal, `phase 1 stderr: ${killed.stderr}`).toBe('SIGKILL')

      const atKill = await auditSpawnJournalAt(dir, RUN_ID, `${dir}/run.sqlite`)
      const committedNodes = new Set(
        Object.entries(atKill.settledDoneByLabel)
          .filter(([, count]) => count > 0)
          .map(([node]) => node),
      )

      const resumed = await runPhase(dir, '2')
      expect(resumed.code, `phase 2 stderr: ${resumed.stderr}`).toBe(0)
      const report = parseReport(resumed.stdout)

      expect(report.fatal).toBeUndefined()
      expect(report.kind).toBe('winner')
      expect(report.out).toEqual(reference.out)

      const final = await auditSpawnJournalAt(dir, RUN_ID, `${dir}/run.sqlite`)
      expect(final.settledDoneByLabel).toEqual({ surveyor: 1, builder: 1, verifier: 1 })
      for (const node of committedNodes) {
        expect(report.exec, `committed node ${node} re-executed after resume`).not.toContain(node)
      }
      expect(report.escalations).toEqual([])
      for (const node of WORKER_NODES) {
        expect(final.spawnedKeysByLabel[node]).toEqual([`step:${node}`])
      }
      expect(report.committedEffects).toEqual([ARTIFACT_KEY])
      expectJournalClean(final)
    },
  )
})

function expectJournalClean(final: JournalAudit): void {
  expect(final.rootSpawned).toBe(1)
  expect(final.rootMaterialized).toBeLessThanOrEqual(1)
  expect(new Set(final.rootBoundAttemptIds).size).toBe(final.rootBoundAttemptIds.length)
  expect(final.duplicateCursorSeqs).toEqual([])
}
