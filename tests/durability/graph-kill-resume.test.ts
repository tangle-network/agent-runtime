/**
 * runGraph kill-and-resume conformance — the file run context (`runDir` → `FileSpawnJournal` +
 * `FileResultBlobStore` + `FileCoordinationLog`), which is the ONLY durable backend a graph run
 * can take today.
 *
 * Case matrix: every step boundary and mid-step instant a reference run passes through (driver
 * turn edges, each worker's before/mid/after, the side-effect tool's before/after-effect). For
 * each: phase 1 SIGKILLs itself at that instant; phase 2 is a brand-new process with nothing but
 * the directory. The conformance contract, per case:
 *
 *   1. the resumed run COMPLETES and wins with the SAME final output as the reference run;
 *   2. no step is LOST — every worker node executes (across the two processes) and settles
 *      exactly once, with exactly one done-settlement per node label in the final journal;
 *   3. no COMMITTED step is REPEATED — a node whose settlement was already on disk at the kill
 *      is never re-executed by the resumed process (keyed spawns return `resumed: "completed"`);
 *   4. the side effect happens EXACTLY ONCE — one committed effect, always under the same
 *      idempotency key, no matter how many times the tool is re-invoked across processes;
 *   5. the journal stays resume-contract clean — one root `spawned`, at most one root
 *      `materialized`, root bindings under distinct attempt ids, unique cursor seqs (the
 *      2026-08-11 autopsy's duplicate-root-record signature must stay absent).
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
  type JournalAudit,
  RUN_ID,
  readExecLog,
  referenceLabels,
  WORKER_NODES,
} from '../helpers/durability/conformance-graph'

const childScript = new URL('../helpers/durability/graph-child.ts', import.meta.url).pathname

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

function expectJournalClean(final: JournalAudit): void {
  expect(final.rootSpawned, 'exactly one root spawned record across processes').toBe(1)
  expect(
    final.rootMaterialized,
    'at most one root materialization across processes',
  ).toBeLessThanOrEqual(1)
  expect(
    new Set(final.rootBoundAttemptIds).size,
    'root execution bindings carry distinct attempt ids',
  ).toBe(final.rootBoundAttemptIds.length)
  expect(final.duplicateCursorSeqs, 'cursor seqs are unique across processes').toEqual([])
}

// ── The reference run — module scope, so its label sequence parametrizes the cases ──────────

const referenceDir = await mkdtemp(join(tmpdir(), 'graph-kill-resume-ref-'))
const referenceExit = await runPhase(referenceDir, '1')
if (referenceExit.code !== 0) {
  throw new Error(`reference run failed: ${referenceExit.stderr}`)
}
const reference: GraphChildReport = parseReport(referenceExit.stdout)
const cases: string[] = referenceLabels(referenceDir, '1')
await rm(referenceDir, { recursive: true, force: true })

describe('runGraph kill-and-resume conformance (file run context)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'graph-kill-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  afterAll(() => {
    // The case matrix is the reference run's own label sequence — print it once so a red suite
    // shows exactly which instants were covered.
    console.log(`kill-and-resume case matrix (${cases.length} labels): ${cases.join(', ')}`)
  })

  it('the reference run completes with the expected outcome and covers boundaries and mid-step', () => {
    expect(reference.kind).toBe('winner')
    expect(reference.out).toEqual({ artifactKey: ARTIFACT_KEY, nodes: [...WORKER_NODES] })
    expect(reference.committedEffects).toEqual([ARTIFACT_KEY])
    expect(reference.escalations).toEqual([])
    expect([...reference.exec].sort()).toEqual([...WORKER_NODES].sort())
    expect(cases.some((l) => l.startsWith('driver:turn:') && l.endsWith(':before'))).toBe(true)
    expect(cases.some((l) => l.includes(':mid'))).toBe(true)
    expect(cases.filter((l) => l.startsWith('worker:')).length).toBeGreaterThanOrEqual(
      WORKER_NODES.length * 3,
    )
  })

  it.each(cases.map((label) => [label] as const))(
    'SIGKILL at %s → resume completes, loses nothing, repeats no committed step',
    { timeout: 120_000 },
    async (label: string) => {
      // ── Phase 1: die, exactly at the labeled instant ───────────────────────────────────
      const killed = await runPhase(dir, '1', label)
      expect(killed.signal, `phase 1 should die by SIGKILL, got code=${killed.code}`).toBe(
        'SIGKILL',
      )
      expect(await readFile(join(dir, 'killed.log'), 'utf8')).toBe(`${label}\n`)

      // What the durable stores prove at the moment of death: these settlements are COMMITTED
      // work; everything else may legitimately re-execute (at-least-once, never twice-committed).
      const atKill = await auditSpawnJournal(dir, RUN_ID)
      const committedNodes = new Set(
        Object.entries(atKill.settledDoneByLabel)
          .filter(([, count]) => count > 0)
          .map(([node]) => node),
      )

      // ── Phase 2: a brand-new process resumes the same runId + runDir ───────────────────
      const resumed = await runPhase(dir, '2')
      expect(resumed.code, `phase 2 stderr: ${resumed.stderr}`).toBe(0)
      const report = parseReport(resumed.stdout)

      // 1. Completes with the SAME final output.
      expect(report.fatal).toBeUndefined()
      expect(report.kind).toBe('winner')
      expect(report.out).toEqual(reference.out)

      // 2. No step lost: every node settled exactly once, in one intact tree.
      const final = await auditSpawnJournal(dir, RUN_ID)
      expect(final.settledDoneByLabel).toEqual({ surveyor: 1, builder: 1, verifier: 1 })
      const execUnion = new Map<string, number>()
      for (const name of [...readExecLog(dir, '1'), ...report.exec]) {
        execUnion.set(name, (execUnion.get(name) ?? 0) + 1)
      }
      for (const node of WORKER_NODES) expect(execUnion.get(node)).toBeGreaterThan(0)
      // At most one re-execution per node (a killed attempt's keyed replacement), never more.
      for (const node of WORKER_NODES) expect(execUnion.get(node) ?? 0).toBeLessThanOrEqual(2)

      // 3. No COMMITTED step repeated: nodes settled on disk before the kill never re-ran.
      for (const node of committedNodes) {
        expect(report.exec, `committed node ${node} re-executed after resume`).not.toContain(node)
        // …and the planner never even escalated its key.
        expect(
          report.escalations.map((e) => e.node),
          `committed node ${node} was treated as in-doubt after resume`,
        ).not.toContain(node)
      }

      // 4. Side effect exactly once, always under the same key.
      expect(report.committedEffects).toEqual([ARTIFACT_KEY])
      const invocationText = await readFile(join(dir, 'side-effect-invocations.jsonl'), 'utf8')
      const invocations = invocationText
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as { key: string })
      expect(invocations.length).toBeGreaterThanOrEqual(1)
      expect(invocations.every((i) => i.key === ARTIFACT_KEY)).toBe(true)

      // 5. Journal resume-contract clean (the 2026-08-11 signature must stay absent).
      expectJournalClean(final)
    },
  )
})
