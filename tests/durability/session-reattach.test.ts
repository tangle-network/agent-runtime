/**
 * runGraph kill-and-resume conformance — the RE-ATTACH arm: session-backed workers.
 *
 * The in-doubt refusal exists for executions that can OUTLIVE the coordinator process (a sandbox
 * session, a CLI bridge session). This suite proves the other half of the interrupted-key
 * contract through the real runGraph path: a worker killed mid-session is RECOVERED by the
 * resumed process — `runGraph({ recoverExecutor })` reconstructs the executor, the scope adopts
 * the interrupted child before the driver drives, the executor re-attaches its session and
 * CONTINUES from the persisted steps. A restart would re-run steps; the assertions below make
 * that fail.
 *
 * Per case (every mid-session and driver-boundary kill point of the reference run):
 *   1. the resumed run COMPLETES and wins with the same final output;
 *   2. every session step ran EXACTLY ONCE across both processes — no step lost, none repeated;
 *   3. every interrupted worker RE-ATTACHED (recorded by the executor when the recovered context
 *      carried its prior admissions) — never restarted from step 1;
 *   4. the driver never saw an in-doubt refusal (no manual key escalations): the recovery owned
 *      the interrupted children, so their keys were never reminted;
 *   5. the side effect commits exactly once under its stable idempotency key.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ARTIFACT_KEY,
  auditSpawnJournal,
  type GraphChildReport,
  RUN_ID,
  referenceLabels,
  WORKER_NODES,
} from '../helpers/durability/conformance-graph'
import { readLabels } from '../helpers/durability/kill-switch'

const childScript = new URL('../helpers/durability/session-child.ts', import.meta.url).pathname

interface SessionReport extends GraphChildReport {
  readonly steps: string[]
  readonly reattached: string[]
}

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

function parseReport(stdout: string): SessionReport {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop()
  if (line === undefined) throw new Error(`child printed no report line: ${stdout.slice(0, 500)}`)
  return JSON.parse(line) as SessionReport
}

// ── Reference run at module scope (its label sequence parametrizes the cases) ───────────────

const referenceDir = await mkdtemp(join(tmpdir(), 'session-kill-resume-ref-'))
const referenceExit = await runPhase(referenceDir, '1')
if (referenceExit.code !== 0) throw new Error(`reference run failed: ${referenceExit.stderr}`)
const reference = parseReport(referenceExit.stdout)
const cases: string[] = referenceLabels(referenceDir, '1')
await rm(referenceDir, { recursive: true, force: true })

describe('runGraph kill-and-resume conformance (session-backed workers, re-attach)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-kill-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  afterAll(() => {
    console.log(`session re-attach case matrix (${cases.length} labels): ${cases.join(', ')}`)
  })

  it('the reference run completes, running every session step exactly once', () => {
    expect(reference.kind).toBe('winner')
    expect(reference.out).toEqual({ artifactKey: ARTIFACT_KEY, nodes: [...WORKER_NODES] })
    expect(reference.reattached).toEqual([])
    const expected = WORKER_NODES.flatMap((node) => [1, 2, 3].map((step) => `${node}:${step}`))
    expect([...reference.steps].sort()).toEqual([...expected].sort())
  })

  it.each(cases.map((label) => [label] as const))(
    'SIGKILL at %s → resume re-attaches the sessions, nothing lost or repeated',
    { timeout: 120_000 },
    async (label: string) => {
      const killed = await runPhase(dir, '1', label)
      expect(killed.signal, `phase 1 should die by SIGKILL, got code=${killed.code}`).toBe(
        'SIGKILL',
      )
      expect(await readFile(join(dir, 'killed.log'), 'utf8')).toBe(`${label}\n`)

      // Which sessions had already SETTLED when the process died: those must not re-attach or
      // re-run anything; the rest are recovered mid-flight.
      const atKill = await auditSpawnJournal(dir, RUN_ID)
      const settledNodes = new Set(
        Object.entries(atKill.settledDoneByLabel)
          .filter(([, count]) => count > 0)
          .map(([node]) => node),
      )

      const resumed = await runPhase(dir, '2')
      expect(resumed.code, `phase 2 stderr: ${resumed.stderr}`).toBe(0)
      const report = parseReport(resumed.stdout)

      // 1. Completes with the SAME final output.
      expect(report.fatal).toBeUndefined()
      expect(report.kind).toBe('winner')
      expect(report.out).toEqual(reference.out)

      // 2. Every session step ran exactly once across BOTH processes.
      const phase1Steps = await readPhase1Steps()
      async function readPhase1Steps(): Promise<string[]> {
        try {
          return (await readFile(join(dir, 'session-steps-1.log'), 'utf8'))
            .split('\n')
            .filter((l) => l.length > 0)
        } catch {
          return []
        }
      }
      const every = [...phase1Steps, ...report.steps]
      expect(new Set(every).size, 'no session step may run twice across processes').toBe(
        every.length,
      )
      for (const node of WORKER_NODES) {
        for (let step = 1; step <= 3; step += 1) {
          expect(every).toContain(`${node}:${step}`)
        }
      }

      // 3. Interrupted sessions RE-ATTACHED — every node that had started but not settled.
      const started = new Set(phase1Steps.map((s) => s.split(':')[0] as string))
      for (const node of started) {
        if (settledNodes.has(node)) continue
        expect(
          report.reattached,
          `interrupted session ${node} must re-attach, not restart`,
        ).toContain(node)
      }

      // 4. The recovery owned the interruption: no in-doubt refusals, no reminted keys.
      expect(report.escalations).toEqual([])
      const final = await auditSpawnJournal(dir, RUN_ID)
      for (const node of WORKER_NODES) {
        expect(final.spawnedKeysByLabel[node]).toEqual([`step:${node}`])
      }
      expect(final.settledDoneByLabel).toEqual({ surveyor: 1, builder: 1, verifier: 1 })
      expect(final.rootSpawned).toBe(1)
      expect(final.duplicateCursorSeqs).toEqual([])

      // 5. Side effect exactly once under the stable key.
      expect(report.committedEffects).toEqual([ARTIFACT_KEY])
    },
  )
})
