/**
 * runGraph kill-and-resume conformance through the durable graph entry, `superviseGraphPursuit`:
 * the file run context (`runDir` → `FileSpawnJournal` + `FileResultBlobStore` +
 * `FileCoordinationLog`) plus the directory's lock and terminal record. A killed process leaves
 * `supervise.lock` naming a dead pid; the resumed process reclaims it, settles, and writes
 * `result.json`.
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
 *
 * The flow graph (`flow-conformance-graph.ts`) has no brain to re-drive it: the route walker
 * replays it from the spawn journal. Its matrix is every mid-step instant and every settle boundary
 * of its reference run, plus the instant inside the gate's decision, and its contract per case:
 * the same output; one done settle per execution (builder and review twice, for the authored
 * repair); phase 2 runs exactly the keyed steps with no done settlement at the kill, each once, so
 * a map killed between its source's settle and its join re-expands, runs only its unsettled items
 * and its join once; the same spawn keys as the reference; and one gate decision, asked again only
 * when it was not journaled before the kill.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RUN_DIRECTORY_LOCK_FILE } from '../../src/durable/run-lock'
import { readSettleRecord } from '../../src/durable/settle-record'
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
import {
  FLOW_RUN_ID,
  FLOW_SETTLES_BY_LABEL,
  type FlowChildReport,
  PIPELINE_OUT,
  readGateCalls,
} from '../helpers/durability/flow-conformance-graph'

const childScript = new URL('../helpers/durability/graph-child.ts', import.meta.url).pathname
const flowChildScript = new URL('../helpers/durability/flow-graph-child.ts', import.meta.url)
  .pathname

interface PhaseExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

async function runPhase(
  dir: string,
  phase: '1' | '2',
  killAt?: string,
  script = childScript,
  env: Readonly<Record<string, string>> = {},
): Promise<PhaseExit> {
  return await new Promise<PhaseExit>((resolvePhase, rejectPhase) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', script, dir, phase, ...(phase === '1' ? [killAt ?? '-'] : [])],
      { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
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

function parseReport<Report = GraphChildReport>(stdout: string): Report {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop()
  if (line === undefined) throw new Error(`child printed no report line: ${stdout.slice(0, 500)}`)
  return JSON.parse(line) as Report
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

      // 3b. An interrupted in-process key retries under ITS OWN key — the runtime's automatic
      // escalation (an `inline` execution provably died with the process), so the driver never
      // invents a replacement key: no manual escalations, one distinct key per node label.
      expect(report.escalations, 'the runtime should auto-retry interrupted inline keys').toEqual(
        [],
      )
      for (const node of WORKER_NODES) {
        expect(
          final.spawnedKeysByLabel[node],
          `node ${node} must keep ONE key across processes (no reminted replacement keys)`,
        ).toEqual([`step:${node}`])
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

      // 6. The durable entry closed the directory: the settle record names this run as the
      //    winner, and the lock the killed process left was reclaimed and released.
      const settled = await readSettleRecord(dir)
      expect(settled?.kind).toBe('winner')
      expect(settled?.tree.root).toBe(RUN_ID)
      expect(existsSync(join(dir, RUN_DIRECTORY_LOCK_FILE))).toBe(false)
    },
  )
})

// ── The flow graph: the route walker replays it from the spawn journal ──────────────────────

/** The spawn key of every keyed child whose done settlement is in the journal. */
function committedKeys(final: JournalAudit): Set<string> {
  const keyById = new Map<string, string>()
  for (const e of final.events) {
    if (e.kind === 'spawned' && e.key !== undefined) keyById.set(e.id, e.key)
  }
  const keys = new Set<string>()
  for (const e of final.events) {
    const key = keyById.get(e.id)
    if (e.kind === 'settled' && e.status === 'done' && key !== undefined) keys.add(key)
  }
  return keys
}

const gateDecisionRows = (final: JournalAudit): number =>
  final.events.filter((e) => e.kind === 'edge' && e.gate !== undefined).length

const flowReferenceDir = await mkdtemp(join(tmpdir(), 'flow-kill-resume-ref-'))
const flowReferenceExit = await runPhase(flowReferenceDir, '1', undefined, flowChildScript)
if (flowReferenceExit.code !== 0) {
  throw new Error(`flow reference run failed: ${flowReferenceExit.stderr}`)
}
const flowReference = parseReport<FlowChildReport>(flowReferenceExit.stdout)
const flowReferenceJournal = await auditSpawnJournal(flowReferenceDir, FLOW_RUN_ID)
const flowCases: string[] = referenceLabels(flowReferenceDir, '1')
await rm(flowReferenceDir, { recursive: true, force: true })
const flowKeys = flowReference.exec.map((step) => step.key)
const mapSourceKey = 'route:entry:surveyor'
const mapJoinKey = flowKeys.find((key) => key.startsWith('map:') && key.endsWith(':join'))
// Map items run concurrently, so the reference run may execute them in either order.
const mapItemKeys = flowKeys
  .filter((key) => key.startsWith('map:') && !key.endsWith(':join'))
  .sort()

describe('flow graph kill-and-resume conformance (route walker replays the journal)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flow-kill-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  afterAll(() => {
    console.log(
      `flow kill-and-resume case matrix (${flowCases.length} labels): ${flowCases.join(', ')}`,
    )
  })

  it('the reference run wins after one repair and one gate decision, with keyed map spawns', () => {
    expect(flowReference.kind).toBe('winner')
    expect(flowReference.out).toEqual({ verifier: { verified: true, build: 2 } })
    expect(flowReference.decisionRows).toBe(1)
    expect(flowReferenceJournal.settledDoneByLabel).toEqual(FLOW_SETTLES_BY_LABEL)
    expect(new Set(flowKeys).size).toBe(flowKeys.length)
    expect(mapItemKeys).toEqual([
      'map:maps:surveyor->scout->collate#1:0',
      'map:maps:surveyor->scout->collate#1:1',
    ])
    expect(mapJoinKey).toBe('map:maps:surveyor->scout->collate#1:join')
    expect(flowCases.some((label) => label.startsWith('settled:'))).toBe(true)
    expect(flowCases.some((label) => label.endsWith(':mid'))).toBe(true)
    expect(flowCases).toContain('gate:ship:asked')
  })

  it.each(flowCases.map((label) => [label] as const))(
    'SIGKILL at %s → the walker resumes to the reference output and reruns no committed step',
    { timeout: 120_000 },
    async (label: string) => {
      const killed = await runPhase(dir, '1', label, flowChildScript)
      expect(killed.signal, `phase 1 should die by SIGKILL, got code=${killed.code}`).toBe(
        'SIGKILL',
      )
      expect(await readFile(join(dir, 'killed.log'), 'utf8')).toBe(`${label}\n`)
      const atKill = await auditSpawnJournal(dir, FLOW_RUN_ID)
      const committed = committedKeys(atKill)
      const decidedAtKill = gateDecisionRows(atKill) > 0

      const resumed = await runPhase(dir, '2', undefined, flowChildScript)
      expect(resumed.code, `phase 2 stderr: ${resumed.stderr}`).toBe(0)
      const report = parseReport<FlowChildReport>(resumed.stdout)

      // The resumed run wins with exactly the reference output.
      expect(report.kind).toBe('winner')
      expect(report.stopped).toBeUndefined()
      expect(report.out).toEqual(flowReference.out)

      // Every execution settled done exactly once across both processes, under the reference keys.
      const final = await auditSpawnJournal(dir, FLOW_RUN_ID)
      expect(final.settledDoneByLabel).toEqual(FLOW_SETTLES_BY_LABEL)
      expect(final.spawnedKeysByLabel).toEqual(flowReferenceJournal.spawnedKeysByLabel)
      expect(committedKeys(final)).toEqual(new Set(flowKeys))

      // Phase 2 ran exactly the steps with no done settlement at the kill, each once: no
      // committed step ran again, and nothing was lost.
      const rerun = report.exec.map((step) => step.key)
      expect(rerun.filter((key) => committed.has(key))).toEqual([])
      expect([...rerun].sort()).toEqual(flowKeys.filter((key) => !committed.has(key)).sort())

      // Killed after the map source settled and before its join: the map re-expanded, ran only
      // its unsettled items, and ran its join once.
      if (committed.has(mapSourceKey) && mapJoinKey !== undefined && !committed.has(mapJoinKey)) {
        expect(rerun.filter((key) => key === mapJoinKey)).toHaveLength(1)
        expect(rerun.filter((key) => mapItemKeys.includes(key)).sort()).toEqual(
          mapItemKeys.filter((key) => !committed.has(key)),
        )
      }

      // One gate decision: asked again only when it was not journaled before the kill.
      const asked = readGateCalls(dir).filter((call) => call.phase === '2')
      expect(asked).toHaveLength(decidedAtKill ? 0 : 1)
      expect(report.decisionRows).toBe(1)
      expect(gateDecisionRows(final)).toBe(1)

      expect(final.rootSpawned).toBe(1)
      expect(final.duplicateCursorSeqs).toEqual([])
      const settled = await readSettleRecord(dir)
      expect(settled?.kind).toBe('winner')
      expect(settled?.tree.root).toBe(FLOW_RUN_ID)
      expect(existsSync(join(dir, RUN_DIRECTORY_LOCK_FILE))).toBe(false)
    },
  )
})

describe('a three-node flow killed right after its entry settles', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flow-pipeline-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // The restart re-settles the committed entry down its outgoing route rather than only
  // republishing its old settlement, so the pipeline continues instead of returning no result.
  it('resumes along the entry route and runs only the unfinished nodes', {
    timeout: 120_000,
  }, async () => {
    const env = { FLOW_GRAPH: 'pipeline' }
    const killed = await runPhase(dir, '1', 'settled:draft', flowChildScript, env)
    expect(killed.signal, `phase 1 should die by SIGKILL, got code=${killed.code}`).toBe('SIGKILL')
    const atKill = await auditSpawnJournal(dir, FLOW_RUN_ID)
    expect(atKill.settledDoneByLabel).toEqual({ draft: 1 })

    const resumed = await runPhase(dir, '2', undefined, flowChildScript, env)
    expect(resumed.code, `phase 2 stderr: ${resumed.stderr}`).toBe(0)
    const report = parseReport<FlowChildReport>(resumed.stdout)
    expect(report.kind).toBe('winner')
    expect(report.out).toEqual(PIPELINE_OUT)
    expect(report.exec.map((step) => step.tag)).toEqual(['edit', 'publish'])

    const final = await auditSpawnJournal(dir, FLOW_RUN_ID)
    expect(final.settledDoneByLabel).toEqual({ draft: 1, edit: 1, publish: 1 })
    expect(final.rootSpawned).toBe(1)
    expect((await readSettleRecord(dir))?.kind).toBe('winner')
  })
})
