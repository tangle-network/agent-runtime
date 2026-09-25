/**
 * runGraph kill-and-resume conformance — the SQL arm.
 *
 * The durable stores are `SqlSpawnJournal` + `SqlResultBlobStore` over a REAL sqlite file: the
 * killed process's only inheritance is the database. The FULL matrix — every step boundary and
 * mid-step instant of the reference run, derived from its own label sequence — under the same
 * contract as the file-run-context matrix: completes with the same final output, no step lost, no
 * committed step repeated (nodes settled in SQL before the kill never re-run), one key per
 * assignment, the side effect exactly once, and a resume-contract-clean journal.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ARTIFACT_KEY,
  auditSpawnJournalAt,
  type GraphChildReport,
  type JournalAudit,
  RUN_ID,
  referenceLabels,
  WORKER_NODES,
} from '../helpers/durability/conformance-graph'

const childScript = new URL('../helpers/durability/sql-child.ts', import.meta.url).pathname

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

// ── Reference run at module scope (its label sequence parametrizes the cases) ───────────────

const referenceDir = await mkdtemp(join(tmpdir(), 'sql-kill-resume-ref-'))
const referenceExit = await runPhase(referenceDir, '1')
if (referenceExit.code !== 0) throw new Error(`reference run failed: ${referenceExit.stderr}`)
const reference: GraphChildReport = parseReport(referenceExit.stdout)
const cases: string[] = referenceLabels(referenceDir, '1')
await rm(referenceDir, { recursive: true, force: true })

describe('runGraph kill-and-resume conformance (SQL run context, sqlite)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sql-kill-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  afterAll(() => {
    console.log(`SQL kill-and-resume case matrix (${cases.length} labels): ${cases.join(', ')}`)
  })

  it('the reference run completes with the expected outcome', () => {
    expect(reference.kind).toBe('winner')
    expect(reference.out).toEqual({ artifactKey: ARTIFACT_KEY, nodes: [...WORKER_NODES] })
    expect(reference.committedEffects).toEqual([ARTIFACT_KEY])
    expect(reference.escalations).toEqual([])
    expect([...reference.exec].sort()).toEqual([...WORKER_NODES].sort())
  })

  it.each(cases.map((label) => [label] as const))(
    'SIGKILL at %s → resume completes, loses nothing, repeats no committed step',
    { timeout: 120_000 },
    async (label: string) => {
      const killed = await runPhase(dir, '1', label)
      expect(killed.signal, `phase 1 stderr: ${killed.stderr}`).toBe('SIGKILL')

      const atKill = await auditSpawnJournalAt(RUN_ID, `${dir}/run.sqlite`)
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

      const final = await auditSpawnJournalAt(RUN_ID, `${dir}/run.sqlite`)
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
