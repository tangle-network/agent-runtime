import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectRunReportSources,
  computeRunReport,
  findCellDirs,
  isUnavailable,
  parsePatch,
  renderRollupMarkdown,
  renderRunReportHeadline,
  renderRunReportMarkdown,
  rollupRunReports,
  writeRunReport,
  type RunReportSources,
  type WorkerLogSource,
} from './run-report.mts'

// ---------------------------------------------------------------------------
// Synthetic journal builders — the whole point is that every metric is derivable
// from bytes, with no supervisor process and no network.
// ---------------------------------------------------------------------------

const T0 = Date.parse('2026-07-23T00:00:00.000Z')
const at = (sec: number): string => new Date(T0 + sec * 1000).toISOString()

interface JournalPlan {
  root?: string
  /** [label, spawnSec, settleSec | null, status?] */
  workers: Array<[string, number, number | null, ('done' | 'down' | 'cancelled')?]>
  /** driver inference events: [sec, inTok, outTok, usd] */
  metered?: Array<[number, number, number, number]>
  endSec?: number
}

function journal(plan: JournalPlan): string {
  const root = plan.root ?? 'sup-1-test'
  const lines: string[] = [
    JSON.stringify({ kind: 'spawned', id: root, label: 'root', budget: {}, runtime: 'inline', seq: 0, at: at(0) }),
  ]
  const timed: Array<{ sec: number; line: string }> = []
  plan.workers.forEach(([label, spawnSec, settleSec, status], i) => {
    const id = `${root}:s${i}`
    timed.push({
      sec: spawnSec,
      line: JSON.stringify({ kind: 'spawned', id, parent: root, label, budget: {}, runtime: 'inline', seq: i, at: at(spawnSec) }),
    })
    if (settleSec !== null) {
      timed.push({
        sec: settleSec,
        line:
          status === 'cancelled'
            ? JSON.stringify({ kind: 'cancelled', id, reason: 'budget', seq: i, at: at(settleSec) })
            : JSON.stringify({
                kind: 'settled',
                id,
                status: status ?? 'done',
                verdict: status === 'down' ? 'no-winner' : 'winner',
                spent: { iterations: 1, tokens: { input: 100, output: 20 }, usd: 0.001, ms: 0 },
                seq: i,
                at: at(settleSec),
              }),
      })
    }
  })
  for (const [sec, tin, tout, usd] of plan.metered ?? []) {
    timed.push({
      sec,
      line: JSON.stringify({ kind: 'metered', id: root, spend: { iterations: 0, tokens: { input: tin, output: tout }, usd, ms: 0 }, seq: sec, at: at(sec) }),
    })
  }
  timed.sort((a, b) => a.sec - b.sec)
  return [...lines, ...timed.map((t) => t.line)].join('\n') + '\n'
}

function state(plan: { startSec: number; endSec: number; usd?: number; verdict?: string }): string {
  return JSON.stringify({
    id: 'sup-1-test',
    status: 'completed',
    startedAt: at(plan.startSec),
    completedAt: at(plan.endSec),
    verdict: plan.verdict ?? 'delivered',
    result: { delivered: true, spentTokens: 1000, spentUsd: plan.usd ?? 0.5 },
  })
}

function worker(
  label: string,
  opts: { startSec: number; finishSec?: number; passed?: boolean; patchBytes?: number; steers?: string[]; questions?: number } = {
    startSec: 0,
  },
): WorkerLogSource {
  const events: string[] = [JSON.stringify({ at: at(opts.startSec), label, kind: 'started', cwd: `/tmp/clone-${label}` })]
  const inboxLines: string[] = []
  for (const [i, msg] of (opts.steers ?? []).entries()) {
    const requestId = `req-${label}-${i}`
    inboxLines.push(JSON.stringify({ id: requestId, at: at(opts.startSec + 1 + i), source: 'brain', worker: label, message: msg }))
    events.push(
      JSON.stringify({
        at: at(opts.startSec + 1 + i),
        label,
        kind: 'message',
        direction: 'down',
        source: 'brain',
        requestId,
        message: msg,
        queued: false,
        delivered: true,
      }),
    )
  }
  for (let q = 0; q < (opts.questions ?? 0); q += 1) {
    events.push(JSON.stringify({ at: at(opts.startSec + 2), label, kind: 'message', direction: 'up', text: 'which file?' }))
  }
  if (opts.finishSec !== undefined) {
    events.push(
      JSON.stringify({
        at: at(opts.finishSec),
        label,
        kind: 'finished',
        passed: opts.passed ?? true,
        testPassed: opts.passed ?? true,
        typecheckPassed: true,
        patchBytes: opts.patchBytes ?? 100,
        evidence: 'verify PASSED\n',
      }),
    )
  }
  return {
    label,
    events: events.join('\n') + '\n',
    inbox: inboxLines.length === 0 ? null : inboxLines.join('\n') + '\n',
    patchBytes: opts.patchBytes ?? null,
  }
}

function sources(over: Partial<RunReportSources> = {}): RunReportSources {
  return {
    cellDir: '/tmp/cell/runs/inst-1/ARM',
    instanceId: 'inst-1',
    arm: 'ARM',
    supRunDir: '/tmp/cell/ws/.loops/supervisor/sup-1-test',
    journal: null,
    brainLog: null,
    state: null,
    progress: null,
    workers: null,
    workersMissingReason: null,
    result: null,
    judge: null,
    judgeSource: null,
    patch: null,
    driverLog: null,
    opencodeWorkerTokens: null,
    opencodeMissingReason: null,
    ...over,
  }
}

// ---------------------------------------------------------------------------

describe('computeRunReport — steers present', () => {
  const src = sources({
    journal: journal({ workers: [['fix-a', 10, 200], ['fix-b', 12, 300]], metered: [[5, 1000, 100, 0.01]] }),
    state: state({ startSec: 0, endSec: 400 }),
    workers: [
      worker('w-0', { startSec: 10, finishSec: 200, passed: true, patchBytes: 500, steers: ['narrow the fix', 'add a test'] }),
      worker('w-1', { startSec: 12, finishSec: 300, passed: false, patchBytes: 0, steers: ['try the other module'], questions: 1 }),
    ],
  })
  const r = computeRunReport(src)

  it('counts steers per worker and in total', () => {
    expect(r.orchestration.steers).toBe(3)
    expect(r.orchestration.steersDelivered).toBe(3)
    expect(r.orchestration.steersByWorker).toEqual([
      { worker: 'w-0', queued: 2, delivered: 2 },
      { worker: 'w-1', queued: 1, delivered: 1 },
    ])
  })

  it('counts worker questions as review traffic alongside steers', () => {
    expect(r.decision.reviewActions).toBe(4)
  })

  it('renders the steer count without the "no steering" note', () => {
    expect(renderRunReportHeadline(r)).toContain('steers=3 queued / 3 delivered')
  })
})

describe('computeRunReport — steers absent is a ZERO, not an unavailable', () => {
  const src = sources({
    journal: journal({ workers: [['a', 10, 100], ['b', 120, 200]], metered: [[5, 500, 50, 0.005]] }),
    state: state({ startSec: 0, endSec: 300 }),
    workers: [worker('w-0', { startSec: 10, finishSec: 100 }), worker('w-1', { startSec: 120, finishSec: 200 })],
  })
  const r = computeRunReport(src)

  it('reports 0 steers, not unavailable', () => {
    expect(r.orchestration.steers).toBe(0)
    expect(isUnavailable(r.orchestration.steers)).toBe(false)
  })

  it('says so explicitly in the headline', () => {
    expect(renderRunReportHeadline(r)).toContain('steers=0 (spawn→wait→respawn only; no mid-task steering)')
  })

  it('records no gap for a real zero', () => {
    expect(r.gaps.join('|')).not.toContain('steers')
  })
})

describe('computeRunReport — missing artifacts become unavailable, never zero', () => {
  it('marks steers unavailable when the workers dir is missing', () => {
    const r = computeRunReport(
      sources({
        journal: journal({ workers: [['a', 10, 100]] }),
        state: state({ startSec: 0, endSec: 200 }),
        workers: null,
        workersMissingReason: 'workers/ directory absent under /tmp/sup',
      }),
    )
    expect(isUnavailable(r.orchestration.steers)).toBe(true)
    expect(r.orchestration.steers).toEqual({ unavailable: 'workers/ directory absent under /tmp/sup' })
    expect(renderRunReportHeadline(r)).toContain('steers=unavailable — workers/ directory absent under /tmp/sup')
    expect(r.gaps.some((g) => g.startsWith('steers:'))).toBe(true)
  })

  it('marks the whole orchestration block unavailable with no journal', () => {
    const r = computeRunReport(sources({ supRunDir: null }))
    for (const v of [
      r.orchestration.workersSpawned,
      r.orchestration.waves,
      r.orchestration.maxConcurrency,
      r.orchestration.supervisorWallMs,
      r.orchestration.workerUtilization,
      r.economics.brain.tokensIn,
    ]) {
      expect(isUnavailable(v)).toBe(true)
    }
    expect(r.gaps.length).toBeGreaterThan(0)
  })

  it('marks judge fields unavailable without judge.json', () => {
    const r = computeRunReport(sources({ journal: journal({ workers: [['a', 1, 2]] }) }))
    expect(isUnavailable(r.outcome.judgeResolved)).toBe(true)
    expect(r.outcome.judgeSource).toBeNull()
  })

  it('marks the patch unavailable when the patch file is missing', () => {
    const r = computeRunReport(sources({ journal: journal({ workers: [] }) }))
    expect(isUnavailable(r.outcome.patch)).toBe(true)
  })

  it('renders unavailable and zero differently in markdown', () => {
    const zero = computeRunReport(
      sources({ journal: journal({ workers: [['a', 1, 2]] }), state: state({ startSec: 0, endSec: 10 }), workers: [worker('w-0', { startSec: 1, finishSec: 2 })] }),
    )
    const gone = computeRunReport(
      sources({ journal: journal({ workers: [['a', 1, 2]] }), state: state({ startSec: 0, endSec: 10 }), workers: null, workersMissingReason: 'no workers dir' }),
    )
    expect(renderRunReportMarkdown(zero)).toContain('| **Steers (mid-task messages to live workers)** | **0** |')
    expect(renderRunReportMarkdown(gone)).toContain('| **Steers (mid-task messages to live workers)** | **unavailable — no workers dir** |')
  })
})

describe('computeRunReport — waves, concurrency, idle, utilization', () => {
  // Two overlapping workers, then two more after both settle: 2 waves.
  const r = computeRunReport(
    sources({
      journal: journal({
        workers: [
          ['a', 10, 110],
          ['b', 20, 120],
          ['c', 200, 260],
          ['d', 210, 270],
        ],
      }),
      state: state({ startSec: 0, endSec: 300 }),
      workers: [
        worker('w-0', { startSec: 10, finishSec: 110 }),
        worker('w-1', { startSec: 20, finishSec: 120 }),
        worker('w-2', { startSec: 200, finishSec: 260 }),
        worker('w-3', { startSec: 210, finishSec: 270 }),
      ],
    }),
  )

  it('groups spawns into waves by intervening settlements', () => {
    expect(r.orchestration.waves).toBe(2)
    expect(r.orchestration.waveSizes).toEqual([2, 2])
  })

  it('measures max concurrency', () => {
    expect(r.orchestration.maxConcurrency).toBe(2)
  })

  it('measures idle wall as the time with zero live workers', () => {
    // idle = [0,10) + [120,200) + [270,300] = 10 + 80 + 30 = 120s
    expect(r.orchestration.idleMs).toBe(120_000)
    expect(r.orchestration.idlePct).toBe(40)
  })

  it('measures worker utilization as summed worker wall over supervisor wall', () => {
    // Σ worker wall = 100 + 100 + 60 + 60 = 320s over a 300s run.
    expect(r.orchestration.workerUtilization).toBeCloseTo(320 / 300, 3)
  })

  it('measures time to first spawn and respawn count', () => {
    expect(r.orchestration.timeToFirstSpawnMs).toBe(10_000)
    expect(r.orchestration.respawns).toBe(2)
  })

  it('counts evidence→respawn sequences', () => {
    expect(r.decision.observeThenRespawn).toBe(1)
    expect(r.decision.respawnWithoutEvidence).toBe(1)
  })
})

describe('computeRunReport — cancelled workers', () => {
  const r = computeRunReport(
    sources({
      journal: journal({ workers: [['a', 10, 100, 'done'], ['b', 20, 90, 'cancelled'], ['c', 30, null]] }),
      state: state({ startSec: 0, endSec: 200 }),
      workers: [
        worker('w-0', { startSec: 10, finishSec: 100, passed: true, patchBytes: 10 }),
        worker('w-1', { startSec: 20 }),
        worker('w-2', { startSec: 30 }),
      ],
    }),
  )

  it('counts cancelled separately from settled', () => {
    expect(r.orchestration.workersSpawned).toBe(3)
    expect(r.orchestration.workersSettled).toBe(1)
    expect(r.orchestration.workersCancelled).toBe(1)
    expect(r.decision.settledByStatus).toEqual({ done: 1, cancelled: 1 })
  })

  it('leaves a never-settled worker live to the end of the run (no idle credit)', () => {
    // One worker is still live from t=30 to the end, so idle is only [0,10).
    expect(r.orchestration.idleMs).toBe(10_000)
  })

  it('reports per-worker wall as unavailable when no finished event exists', () => {
    const perWorker = r.economics.perWorker
    expect(isUnavailable(perWorker)).toBe(false)
    if (isUnavailable(perWorker)) return
    expect(perWorker.find((w) => w.worker === 'w-1')?.wallMs).toBeNull()
  })
})

describe('computeRunReport — decision quality and economics', () => {
  const r = computeRunReport(
    sources({
      journal: journal({
        workers: [['a', 10, 100], ['b', 20, 110], ['c', 30, 120]],
        metered: [
          [5, 1000, 200, 0.02],
          [50, 2000, 300, 0.03],
        ],
      }),
      state: state({ startSec: 0, endSec: 200, usd: 0.05 }),
      workers: [
        worker('w-0', { startSec: 10, finishSec: 100, passed: true, patchBytes: 400 }),
        worker('w-1', { startSec: 20, finishSec: 110, passed: false, patchBytes: 0 }),
        worker('w-2', { startSec: 30, finishSec: 120, passed: true, patchBytes: 0 }),
      ],
      opencodeWorkerTokens: { sessions: 3, input: 50_000, output: 9_000 },
      judge: JSON.stringify({ resolved: true, score: 0.75, passed: 15, total: 20 }),
      judgeSource: '/tmp/cell/judge.json',
      result: JSON.stringify({ verify_pass: true, verify_rc: 0 }),
    }),
  )

  it('splits accepted / rejected / empty-pass', () => {
    expect(r.decision.accepted).toBe(1)
    expect(r.decision.rejected).toBe(1)
    expect(r.decision.emptyPass).toBe(1)
  })

  it('attributes brain spend to journal metered events', () => {
    expect(r.economics.brain.tokensIn).toBe(3000)
    expect(r.economics.brain.tokensOut).toBe(500)
    expect(r.economics.brain.usd).toBeCloseTo(0.05, 6)
    expect(r.economics.brain.source).toContain('n=2')
  })

  it('counts truncated brain completions from the brain tap, and never reports 0 when the tap is absent', () => {
    // A truncated brain turn means the supervisor acted on a half-written plan. It went
    // unnoticed once because nothing recorded finish_reason; the journal's metered rows carry
    // token counts only, so the count has to come from loops' brain.jsonl.
    const withTap = computeRunReport(
      sources({
        journal: journal({ workers: [] }),
        state: state({ startSec: 0, endSec: 10 }),
        workers: [],
        brainLog: [
          JSON.stringify({ finish_reason: 'length', completion_tokens: 8192, req_max_tokens: null }),
          JSON.stringify({ finish_reason: 'stop', completion_tokens: 120, req_max_tokens: 128000 }),
        ].join('\n'),
      }),
    )
    expect(withTap.economics.brainTruncations).toBe(1)

    const clean = computeRunReport(
      sources({
        journal: journal({ workers: [] }),
        state: state({ startSec: 0, endSec: 10 }),
        workers: [],
        brainLog: JSON.stringify({ finish_reason: 'stop', completion_tokens: 12_000 }),
      }),
    )
    expect(clean.economics.brainTruncations).toBe(0)

    // UNAVAILABLE ≠ ZERO: an older loops wrote no tap, so truncation cannot be ruled out.
    expect(r.economics.brainTruncations).toEqual({
      unavailable: 'brain.jsonl absent — loops predates the brain-call tap, so truncation cannot be ruled out',
    })
  })

  it('adds the opencode session join to journal-settled worker tokens', () => {
    expect(r.economics.workers.tokensIn).toBe(300 + 50_000)
    expect(r.economics.workers.tokensOut).toBe(60 + 9_000)
    expect(r.economics.workers.source).toContain('n=3')
  })

  it('marks worker tokens unavailable when the store is gone and the journal metered nothing', () => {
    const r2 = computeRunReport(
      sources({
        journal: journal({ workers: [] }),
        state: state({ startSec: 0, endSec: 10 }),
        workers: [],
        opencodeWorkerTokens: null,
        opencodeMissingReason: 'opencode session store unreadable (ENOENT)',
      }),
    )
    expect(r2.economics.workers.tokensIn).toEqual({ unavailable: 'opencode session store unreadable (ENOENT)' })
  })

  it('computes cost per accepted patch, and refuses it with no denominator', () => {
    expect(r.economics.costPerAcceptedPatchUsd).toBeCloseTo(0.05, 6)
    const none = computeRunReport(
      sources({ journal: journal({ workers: [] }), state: state({ startSec: 0, endSec: 10 }), workers: [] }),
    )
    expect(isUnavailable(none.economics.costPerAcceptedPatchUsd)).toBe(true)
  })

  it('carries judge provenance and outcome', () => {
    expect(r.outcome.judgeResolved).toBe(true)
    expect(r.outcome.judgeScore).toBe(0.75)
    expect(r.outcome.judgeSource).toBe('/tmp/cell/judge.json')
    expect(r.outcome.verifyPass).toBe(true)
  })

  it('flags brain-only totals so an unpriced worker arm cannot read as full cost', () => {
    expect(r.economics.totalUsdSource).toContain('state.json result.spentUsd')
  })
})

describe('driver.log steer verbs', () => {
  it('ignores the tool-registration banner and counts real invocations', () => {
    const log = [
      '[driver] registered tools: spawn_supervisor, supervisor_watch, supervisor_steer, loop_run',
      '[watch] 30s status=running',
      '[driver] supervisor_steer(sup-1, w-0): tighten the diff',
      '[driver] supervisor_steer(sup-1, w-1): re-run verify',
    ].join('\n')
    const r = computeRunReport(sources({ journal: journal({ workers: [] }), driverLog: log }))
    expect(r.orchestration.driverSteerCalls).toBe(2)
  })

  it('is unavailable without a driver.log', () => {
    const r = computeRunReport(sources({ journal: journal({ workers: [] }) }))
    expect(isUnavailable(r.orchestration.driverSteerCalls)).toBe(true)
  })
})

describe('parsePatch', () => {
  it('counts files, lines, and test-file touches', () => {
    const patch = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index 111..222 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,2 +1,3 @@',
      ' keep',
      '+added',
      '-removed',
      'diff --git a/src/foo.test.ts b/src/foo.test.ts',
      '--- /dev/null',
      '+++ b/src/foo.test.ts',
      '@@ -0,0 +1,2 @@',
      '+it("works", () => {})',
      '+// end',
    ].join('\n')
    const stats = parsePatch(patch)
    expect(stats.files).toBe(2)
    expect(stats.linesAdded).toBe(3)
    expect(stats.linesRemoved).toBe(1)
    expect(stats.testFilesTouched).toEqual(['src/foo.test.ts'])
  })

  it('recognizes python test paths', () => {
    const stats = parsePatch('+++ b/tests/test_thing.py\n+assert True\n')
    expect(stats.testFilesTouched).toEqual(['tests/test_thing.py'])
  })
})

describe('rollupRunReports', () => {
  const withSteers = computeRunReport(
    sources({
      journal: journal({ workers: [['a', 10, 100]] }),
      state: state({ startSec: 0, endSec: 200 }),
      workers: [worker('w-0', { startSec: 10, finishSec: 100, steers: ['go'] })],
      judge: JSON.stringify({ resolved: true }),
      judgeSource: 'j',
    }),
  )
  const withoutSteers = computeRunReport(
    sources({
      journal: journal({ workers: [['a', 10, 100]] }),
      state: state({ startSec: 0, endSec: 200 }),
      workers: [worker('w-0', { startSec: 10, finishSec: 100 })],
      judge: JSON.stringify({ resolved: false }),
      judgeSource: 'j',
    }),
  )
  const blind = computeRunReport(sources({ supRunDir: null }))

  it('separates unavailable cells from zero cells in the rollup', () => {
    const rollup = rollupRunReports([withSteers, withoutSteers, blind])
    expect(rollup.cells).toBe(3)
    expect(rollup.steersTotal).toBe(1)
    expect(rollup.cellsWithSteers).toBe(1)
    expect(rollup.cellsWithUnavailableSteers).toBe(1)
    expect(rollup.resolvedCount).toBe(1)
  })

  it('renders a per-cell table', () => {
    const md = renderRollupMarkdown(rollupRunReports([withSteers, withoutSteers]))
    expect(md).toContain('| Instance | Arm | Steers | Waves |')
    expect(md).toContain('Steers across all cells: 1')
  })

  it('reports unavailable rather than 0 when NO cell measured a metric', () => {
    const rollup = rollupRunReports([blind])
    expect(isUnavailable(rollup.steersTotal)).toBe(true)
    expect(isUnavailable(rollup.utilizationMean)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// I/O layer over a real temp directory.
// ---------------------------------------------------------------------------

describe('collectRunReportSources + writeRunReport over a real cell directory', () => {
  async function makeCell(opts: { steers?: boolean; withJudge?: boolean } = {}): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'run-report-test-'))
    const cell = join(root, 'runs', 'inst-9', 'ARM')
    const sup = join(cell, 'ws', '.loops', 'supervisor', 'sup-1-abc')
    await mkdir(join(sup, 'workers'), { recursive: true })
    await writeFile(join(sup, 'journal.jsonl'), journal({ workers: [['a', 10, 100], ['b', 150, 220]] }))
    await writeFile(join(sup, 'state.json'), state({ startSec: 0, endSec: 300 }))
    const w0 = worker('w-0', { startSec: 10, finishSec: 100, passed: true, patchBytes: 40, ...(opts.steers ? { steers: ['refocus'] } : {}) })
    await writeFile(join(sup, 'workers', 'w-0.ndjson'), w0.events ?? '')
    if (w0.inbox !== null) await writeFile(join(sup, 'workers', 'w-0.inbox.ndjson'), w0.inbox)
    await writeFile(join(sup, 'workers', 'w-0.patch'), 'x'.repeat(40))
    const patchPath = join(root, 'delivered.patch')
    await writeFile(patchPath, '+++ b/src/a.ts\n+line\n')
    await writeFile(join(cell, 'result.json'), JSON.stringify({ iid: 'inst-9', arm: 'ARM', verify_pass: true, verify_rc: 0, patchPath }))
    if (opts.withJudge) await writeFile(join(cell, 'judge.json'), JSON.stringify({ resolved: true, score: 1 }))
    await writeFile(join(cell, 'driver.log'), '[driver] registered tools: supervisor_steer\n')
    return cell
  }

  it('reads a cell end to end and writes both artifacts + the log headline', async () => {
    const cell = await makeCell({ steers: true, withJudge: true })
    const logPath = join(cell, '..', '..', '..', 'run.log')
    await writeFile(logPath, '')
    const report = await writeRunReport(cell, { opencodeDb: null, appendHeadlineTo: logPath, echo: false })

    expect(report.orchestration.steers).toBe(1)
    expect(report.orchestration.workersSpawned).toBe(2)
    expect(report.outcome.judgeResolved).toBe(true)
    expect(report.outcome.verifyPass).toBe(true)
    expect(report.instanceId).toBe('inst-9')

    const json = JSON.parse(await readFile(join(cell, 'run-report.json'), 'utf8')) as { orchestration: { steers: number } }
    expect(json.orchestration.steers).toBe(1)
    const md = await readFile(join(cell, 'run-report.md'), 'utf8')
    expect(md).toContain('# Run report — inst-9 [ARM]')
    const log = await readFile(logPath, 'utf8')
    expect(log).toContain('RUN-REPORT inst-9 [ARM]')
    expect(log).toContain('steers=1 queued / 1 delivered')
  })

  it('reports a steer-free cell as 0, and falls back to the ledger for the verdict', async () => {
    const cell = await makeCell()
    const ledger = join(cell, '..', '..', '..', 'ledger.jsonl')
    await writeFile(ledger, JSON.stringify({ iid: 'inst-9', arm: 'ARM', resolved: false, score: 0.43, passed: 13, total: 30 }) + '\n')
    const src = await collectRunReportSources(cell, { opencodeDb: null, ledgerPath: ledger })
    const report = computeRunReport(src)
    expect(report.orchestration.steers).toBe(0)
    expect(report.outcome.judgeResolved).toBe(false)
    expect(report.outcome.judgeScore).toBe(0.43)
    expect(report.outcome.judgeSource).toContain('ledger row')
  })

  it('honours reportDir so a READ-ONLY run directory is never written to', async () => {
    const cell = await makeCell()
    const dest = await mkdtemp(join(tmpdir(), 'run-report-out-'))
    await writeRunReport(cell, { opencodeDb: null, reportDir: dest, echo: false })
    await expect(readFile(join(cell, 'run-report.json'), 'utf8')).rejects.toThrow()
    const written = await readFile(join(dest, 'inst-9.ARM.json'), 'utf8')
    expect(JSON.parse(written)).toMatchObject({ schema: 'swe-arena/run-report@1' })
  })

  it('produces an all-unavailable report for a cell directory with no artifacts at all', async () => {
    const root = await mkdtemp(join(tmpdir(), 'run-report-empty-'))
    const cell = join(root, 'runs', 'inst-0', 'ARM')
    await mkdir(cell, { recursive: true })
    const report = await writeRunReport(cell, { opencodeDb: null, echo: false })
    expect(isUnavailable(report.orchestration.steers)).toBe(true)
    expect(isUnavailable(report.orchestration.workersSpawned)).toBe(true)
    expect(report.gaps.length).toBeGreaterThan(3)
    expect(renderRunReportMarkdown(report)).toContain('unavailable —')
  })

  it('discovers every runs/<iid>/<arm> cell under an out dir', async () => {
    const cell = await makeCell()
    const outDir = join(cell, '..', '..', '..')
    const cells = await findCellDirs(outDir)
    expect(cells).toHaveLength(1)
    expect(cells[0]).toContain('/runs/inst-9/ARM')
  })
})
