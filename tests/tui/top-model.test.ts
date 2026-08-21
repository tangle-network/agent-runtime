import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal'
import {
  legacySupervisorRunDir,
  readWorkerSteerRequests,
  safeWorkerFile,
  supervisorRunDir,
  workerControlLogFile,
  writeWorkerSteer,
} from '../../src/runtime/supervise/run-layout'
import { loadTopSnapshot, renderTopFrame, renderTopFrameWithLayout } from '../../src/tui/top-model'

describe('supervisor top model', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
    roots.length = 0
  })

  it('does not manufacture a worker when the journal root id differs from state.json', () => {
    // state.json and the journal have different producers: the journal's root is the runtime's
    // `runId`, which defaults to a value unrelated to the supervisor id. A guard that only knows
    // state.id lets every driver metered/settled event mint a phantom worker named for the runId —
    // one that never settles, sorts first as RUNNING, and captures steers nothing will read.
    const root = fixtureRoot()
    const dir = supervisorRunDir(root, 'sup-mismatch')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({
        id: 'sup-mismatch',
        status: 'running',
        task: 'root ids disagree',
        workspaceDir: '/repo',
        budget: 2,
      }),
    )
    writeFileSync(
      join(dir, 'spawn-journal.jsonl'),
      `${[
        JSON.stringify({ kind: 'spawned', id: 'supervise', label: 'root', at: 1 }),
        JSON.stringify({
          kind: 'metered',
          id: 'supervise',
          usd: 0.03,
          tokensIn: 300,
          tokensOut: 150,
          at: 2,
        }),
        JSON.stringify({ kind: 'spawned', id: 'w-0', parent: 'supervise', label: 'w-0', at: 3 }),
        JSON.stringify({ kind: 'settled', id: 'w-0', at: 4 }),
      ].join('\n')}\n`,
    )

    const snapshot = loadTopSnapshot(root)
    const view = snapshot.supervisors[0]!
    expect(view.workers.map((w) => w.id)).toEqual(['w-0'])
    // The driver's spend belongs to the driver, not to a fabricated worker row.
    expect(view.workers.some((w) => w.id === 'supervise')).toBe(false)
  })

  it('renders workers, status, token bars, cost bars, and latency histograms from the journal', () => {
    const root = fixtureRoot()
    const dir = supervisorRunDir(root, 'sup-1-rich')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify(
        {
          id: 'sup-1-rich',
          status: 'running',
          task: 'ship the interactive TUI',
          workspaceDir: '/repo',
          budget: 4,
          verifyCmd: 'pnpm test',
          workerModel: 'deepseek-v4-flash',
          driverModel: 'deepseek-v4-flash',
          startedAt: '2026-06-28T10:00:00.000Z',
          maxSandboxes: 4,
          maxLifetimeSeconds: 1200,
          maxUsd: 5,
          maxDepth: 4,
        },
        null,
        2,
      ),
    )
    writeFileSync(
      join(dir, 'journal.jsonl'),
      [
        '{corrupt',
        JSON.stringify({
          kind: 'spawned',
          id: 'sup-1-rich',
          label: 'root',
          budget: { maxIterations: 16 },
          runtime: 'inline',
          seq: 0,
          at: '2026-06-28T10:00:00.000Z',
        }),
        JSON.stringify({
          kind: 'metered',
          id: 'sup-1-rich',
          spend: { iterations: 1, tokens: { input: 300, output: 90 }, usd: 0.003, ms: 1200 },
          seq: 1,
          at: '2026-06-28T10:00:01.000Z',
        }),
        JSON.stringify({
          kind: 'spawned',
          id: 'sup-1-rich:s1',
          parent: 'sup-1-rich',
          label: 'w-0',
          budget: { maxIterations: 2, maxTokens: 8000 },
          runtime: 'inline',
          seq: 2,
          at: '2026-06-28T10:00:02.000Z',
        }),
        JSON.stringify({
          kind: 'spawned',
          id: 'sup-1-rich:s2',
          parent: 'sup-1-rich',
          label: 'w-1',
          budget: { maxIterations: 2, maxTokens: 8000 },
          runtime: 'inline',
          seq: 3,
          at: '2026-06-28T10:00:08.000Z',
        }),
        JSON.stringify({
          kind: 'settled',
          id: 'sup-1-rich:s1',
          status: 'done',
          outRef: 'sha256:ok',
          verdict: { valid: true, score: 1 },
          spent: { iterations: 1, tokens: { input: 1200, output: 640 }, usd: 0.021, ms: 0 },
          seq: 4,
          at: '2026-06-28T10:00:32.000Z',
        }),
        JSON.stringify({
          kind: 'settled',
          id: 'sup-1-rich:s2',
          status: 'down',
          infra: false,
          spent: { iterations: 1, tokens: { input: 900, output: 210 }, usd: 0.013, ms: 0 },
          seq: 5,
          at: '2026-06-28T10:01:08.000Z',
        }),
      ].join('\n'),
    )
    mkdirSync(join(dir, 'workers'))
    writeFileSync(
      workerControlLogFile(dir, 'w-0'),
      [
        JSON.stringify({
          at: '2026-06-28T10:00:03.000Z',
          label: 'w-0',
          kind: 'started',
          cwd: '/tmp/worktree',
        }),
        JSON.stringify({
          at: '2026-06-28T10:00:04.000Z',
          label: 'w-0',
          kind: 'message',
          source: 'human',
          message: 'try the narrow fix',
          queued: true,
          delivered: false,
        }),
        JSON.stringify({
          at: '2026-06-28T10:00:05.000Z',
          label: 'w-0',
          kind: 'message',
          source: 'human',
          message: 'try the narrow fix',
          queued: false,
          delivered: true,
        }),
        JSON.stringify({
          at: '2026-06-28T10:00:18.000Z',
          label: 'w-0',
          kind: 'progress',
          iteration: 1,
          phase: 'editing',
        }),
        JSON.stringify({
          at: '2026-06-28T10:00:30.000Z',
          label: 'w-0',
          kind: 'verify',
          backend: 'bridge-worktree',
          passed: true,
          exitCode: 0,
        }),
        JSON.stringify({
          at: '2026-06-28T10:00:31.000Z',
          label: 'w-0',
          kind: 'finished',
          backend: 'bridge-worktree',
          passed: true,
          branch: 'delegate/sup-1-rich-w-0',
          patchBytes: 512,
          filesChanged: 2,
          testPassed: true,
        }),
      ].join('\n'),
    )

    const snapshot = loadTopSnapshot(root, Date.parse('2026-06-28T10:01:20.000Z'))
    expect(snapshot.supervisors).toHaveLength(1)
    const supervisor = snapshot.supervisors[0]
    expect(supervisor?.totals.workers).toBe(2)
    expect(supervisor?.stateDir).toBe(dir)
    expect(supervisor?.totals.tokensInput).toBe(2400)
    expect(supervisor?.totals.tokensOutput).toBe(940)
    expect(supervisor?.totals.down).toBe(1)
    expect(supervisor?.totals.workerLatency.n).toBe(2)
    const worker = supervisor?.workers.find((candidate) => candidate.label === 'w-0')
    expect(worker?.cwd).toBe('/tmp/worktree')
    expect(worker?.eventFile).toBe(workerControlLogFile(dir, 'w-0'))

    const frame = renderTopFrame(snapshot, {
      color: false,
      width: 132,
      height: 48,
      selectedSupervisorId: 'sup-1-rich',
      selectedWorkerId: 'sup-1-rich:s1',
      focus: 'workers',
      mode: 'detail',
      steerInput: { active: true, value: 'please inspect the TUI input path', workerLabel: 'w-0' },
    })

    expect(frame).toContain('SUPERVISORS')
    expect(frame).toContain('WORKERS sup-1-rich')
    expect(frame).toContain('OBSERVABILITY')
    expect(frame).toContain('cost   total $0.04')
    expect(frame).toContain('tokens total in 2.4k / out 940')
    expect(frame).toContain('latency n=2')
    expect(frame).toContain('w-0')
    expect(frame).toContain('w-1')
    expect(frame).toContain('valid')
    expect(frame).toContain('cwd /tmp/worktree')
    expect(frame).toContain('events ')
    expect(frame).toContain('live events:')
    expect(frame).toContain('steer w-0 > please inspect the TUI input path_')
    expect(frame).toContain('human steer queued delivered=false try the narrow fix')
    expect(frame).toContain('human steer sent delivered=true try the narrow fix')
    expect(frame).toContain('progress iter 1 editing')
    expect(frame).toContain('verify passed=true exit=0')
    expect(frame).toContain('files=2 tests=true branch=delegate/sup-1-rich-w-0')
  })

  it('calibrates the observability eval: weak frame scores low, rich frame scores high', () => {
    const root = fixtureRoot()
    const dir = supervisorRunDir(root, 'sup-2-eval')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({
        id: 'sup-2-eval',
        status: 'completed',
        verdict: 'delivered',
        task: 'observable run',
        workspaceDir: '/repo',
        budget: 3,
        startedAt: '2026-06-28T10:00:00.000Z',
        completedAt: '2026-06-28T10:02:00.000Z',
      }),
    )
    writeFileSync(
      join(dir, 'journal.jsonl'),
      [
        JSON.stringify({
          kind: 'spawned',
          id: 'sup-2-eval:s1',
          parent: 'sup-2-eval',
          label: 'worker-a',
          runtime: 'inline',
          seq: 1,
          at: '2026-06-28T10:00:05.000Z',
        }),
        JSON.stringify({
          kind: 'settled',
          id: 'sup-2-eval:s1',
          status: 'done',
          verdict: { valid: true },
          spent: { iterations: 1, tokens: { input: 1000, output: 500 }, usd: 0.02, ms: 0 },
          seq: 2,
          at: '2026-06-28T10:01:05.000Z',
        }),
      ].join('\n'),
    )

    const weak = 'SUPERVISORS\n(none)\n'
    const rich = renderTopFrame(loadTopSnapshot(root), { color: false, width: 128, height: 42 })

    expect(observabilityScore(weak)).toBeLessThan(30)
    expect(observabilityScore(rich)).toBeGreaterThan(70)
  })

  it('returns row targets for mouse selection, and keeps pre-rename .loops runs visible', () => {
    const root = fixtureRoot()
    // Deliberately a pre-rename .loops run: legacy runs stay visible in the top view.
    const dir = legacySupervisorRunDir(root, 'sup-3-click')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({
        id: 'sup-3-click',
        status: 'running',
        task: 'click me',
        workspaceDir: '/repo',
        budget: 1,
      }),
    )
    writeFileSync(
      join(dir, 'journal.jsonl'),
      JSON.stringify({
        kind: 'spawned',
        id: 'sup-3-click:s1',
        parent: 'sup-3-click',
        label: 'w-click',
        runtime: 'inline',
        seq: 1,
        at: '2026-06-28T10:00:00.000Z',
      }),
    )

    const snapshot = loadTopSnapshot(root)
    expect(snapshot.supervisors.map((supervisor) => supervisor.id)).toEqual(['sup-3-click'])
    expect(snapshot.supervisors[0]?.stateDir).toBe(dir)

    const rendered = renderTopFrameWithLayout(snapshot, { color: false, width: 120, height: 36 })

    expect(
      rendered.targets.some(
        (target) => target.kind === 'supervisor' && target.id === 'sup-3-click',
      ),
    ).toBe(true)
    expect(
      rendered.targets.some((target) => target.kind === 'worker' && target.id === 'sup-3-click:s1'),
    ).toBe(true)
  })

  it('shows a run whose journal the durable FileSpawnJournal wrote', async () => {
    const root = fixtureRoot()
    const dir = supervisorRunDir(root, 'sup-4-durable')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({
        id: 'sup-4-durable',
        status: 'running',
        task: 'durable journal run',
        workspaceDir: '/repo',
        budget: 2,
        startedAt: '2026-06-28T10:00:00.000Z',
      }),
    )

    // The exact file `createFileRunContext(dir)` binds, written by the exact class it binds — so a
    // reader that only knew the retired `journal.jsonl` name fails this test.
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    await journal.beginTree('sup-4-durable', '2026-06-28T10:00:00.000Z')
    await journal.appendEvent('sup-4-durable', {
      kind: 'spawned',
      id: 'sup-4-durable:s1',
      parent: 'sup-4-durable',
      label: 'w-durable',
      budget: { maxIterations: 2 },
      runtime: 'inline',
      seq: 1,
      at: '2026-06-28T10:00:02.000Z',
    })
    await journal.appendEvent('sup-4-durable', {
      kind: 'settled',
      id: 'sup-4-durable:s1',
      status: 'done',
      verdict: { valid: true },
      spent: { iterations: 1, tokens: { input: 700, output: 300 }, usd: 0.05, ms: 0 },
      seq: 2,
      at: '2026-06-28T10:00:40.000Z',
    })

    const snapshot = loadTopSnapshot(root, Date.parse('2026-06-28T10:01:00.000Z'))
    const supervisor = snapshot.supervisors[0]
    expect(supervisor?.totals.workers).toBe(1)
    expect(supervisor?.totals.done).toBe(1)
    expect(supervisor?.totals.tokensInput).toBe(700)
    expect(supervisor?.workers[0]?.verdict).toBe('valid')

    const frame = renderTopFrame(snapshot, { color: false, width: 128, height: 42 })
    expect(frame).toContain('w-durable')
    expect(frame).toContain('cost   total $0.05')
  })

  it('reads back the control-event log that writeWorkerSteer produced, sanitised label included', () => {
    const root = fixtureRoot()
    const dir = supervisorRunDir(root, 'sup-5-steer')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({
        id: 'sup-5-steer',
        status: 'running',
        task: 'steer round trip',
        workspaceDir: '/repo',
        budget: 1,
        startedAt: '2026-06-28T10:00:00.000Z',
      }),
    )
    // A label whose filename stem differs from the label itself; the reader must still join them.
    const label = 'feat/w 0'
    expect(safeWorkerFile(label)).not.toBe(label)
    writeFileSync(
      join(dir, 'journal.jsonl'),
      JSON.stringify({
        kind: 'spawned',
        id: 'sup-5-steer:s1',
        parent: 'sup-5-steer',
        label,
        runtime: 'inline',
        seq: 1,
        at: '2026-06-28T10:00:01.000Z',
      }),
    )

    const written = writeWorkerSteer(root, 'sup-5-steer', label, 'narrow the diff', 'human')
    expect(written.file).toBe(join(dir, 'workers', `${safeWorkerFile(label)}.inbox.ndjson`))
    expect(readWorkerSteerRequests(dir, label).map((request) => request.message)).toEqual([
      'narrow the diff',
    ])

    const snapshot = loadTopSnapshot(root, Date.parse('2026-06-28T10:00:30.000Z'))
    const worker = snapshot.supervisors[0]?.workers[0]
    expect(worker?.label).toBe(label)
    expect(worker?.eventFile).toBe(workerControlLogFile(dir, label))
    // The inbox file lives in the same directory and must NOT be mistaken for a control log.
    expect(worker?.liveTail.length).toBe(1)
    expect(worker?.liveTail[0]).toContain('narrow the diff')

    const frame = renderTopFrame(snapshot, {
      color: false,
      width: 132,
      height: 48,
      selectedWorkerId: 'sup-5-steer:s1',
      focus: 'workers',
      mode: 'detail',
    })
    expect(frame).toContain('human steer queued delivered=false narrow the diff')
    // The inbox line itself is not a control event and must not surface as one.
    expect(readFileSync(written.file, 'utf8')).toContain('narrow the diff')
  })

  it('reports no supervisors for a workspace with no run state', () => {
    const root = fixtureRoot()
    const snapshot = loadTopSnapshot(root)
    expect(snapshot.supervisors).toEqual([])
    const frame = renderTopFrame(snapshot, { color: false, width: 120, height: 30 })
    expect(frame).toContain('NO SUPERVISORS')
    expect(frame).toContain(join(root, '.agent', 'supervisor'))
  })

  it('keeps the complete supervisor and reports one bounded diagnostic for a half-written one', () => {
    const root = fixtureRoot()
    const okDir = supervisorRunDir(root, 'sup-ok')
    mkdirSync(okDir, { recursive: true })
    writeFileSync(
      join(okDir, 'state.json'),
      JSON.stringify({
        id: 'sup-ok',
        status: 'running',
        task: 'stay readable',
        workspaceDir: '/repo',
        budget: 1,
      }),
    )
    const tornDir = supervisorRunDir(root, 'sup-torn')
    mkdirSync(tornDir, { recursive: true })
    // A writer mid-append leaves state.json truncated; the read degrades and reports, never throws.
    writeFileSync(join(tornDir, 'state.json'), '{"id":"sup-torn","status":"running"')

    const partial = loadTopSnapshot(root)
    expect(partial.supervisors.map((view) => view.id)).toEqual(['sup-ok'])
    expect(partial.completeness).toBe('partial')
    expect(partial.diagnostics).toEqual([
      { source: 'supervisor-state', runId: 'sup-torn', path: 'state.json', reason: 'partial-json' },
    ])
    expect(partial.discovered).toBe(2)
    expect(partial.loaded).toBe(1)

    writeFileSync(
      join(tornDir, 'state.json'),
      JSON.stringify({
        id: 'sup-torn',
        status: 'running',
        task: 'now complete',
        workspaceDir: '/repo',
        budget: 1,
      }),
    )
    const complete = loadTopSnapshot(root)
    expect(complete.completeness).toBe('complete')
    expect(complete.diagnostics).toEqual([])
    expect(complete.discovered).toBe(2)
    expect(complete.loaded).toBe(2)
    expect(complete.supervisors.map((view) => view.id).sort()).toEqual(['sup-ok', 'sup-torn'])
  })

  it('reports a journal mid-append as partial-json and a wrong state shape as invalid-state', () => {
    const root = fixtureRoot()
    const dir = supervisorRunDir(root, 'sup-journal')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({
        id: 'sup-journal',
        status: 'running',
        task: 'journal mid-append',
        workspaceDir: '/repo',
        budget: 1,
      }),
    )
    writeFileSync(
      join(dir, 'spawn-journal.jsonl'),
      `${JSON.stringify({
        kind: 'spawned',
        id: 'sup-journal:s1',
        parent: 'sup-journal',
        label: 'w-0',
        at: '2026-06-28T10:00:00.000Z',
      })}\n{"kind":"settl`,
    )
    const shapeDir = supervisorRunDir(root, 'sup-shape')
    mkdirSync(shapeDir, { recursive: true })
    // Valid JSON, wrong shape: distinct from a torn write.
    writeFileSync(join(shapeDir, 'state.json'), JSON.stringify({ id: 'sup-shape' }))

    const snapshot = loadTopSnapshot(root)
    // The resilient read keeps every line that parsed.
    expect(snapshot.supervisors.map((view) => view.id)).toEqual(['sup-journal'])
    expect(snapshot.supervisors[0]!.workers.map((worker) => worker.id)).toEqual(['sup-journal:s1'])
    expect(snapshot.completeness).toBe('partial')
    expect(snapshot.diagnostics).toEqual([
      {
        source: 'journal',
        runId: 'sup-journal',
        path: 'spawn-journal.jsonl',
        reason: 'partial-json',
      },
      {
        source: 'supervisor-state',
        runId: 'sup-shape',
        path: 'state.json',
        reason: 'invalid-state',
      },
    ])
    expect(snapshot.discovered).toBe(2)
    expect(snapshot.loaded).toBe(1)
  })

  function fixtureRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'agent-runtime-top-'))
    roots.push(root)
    return root
  }
})

function observabilityScore(frame: string): number {
  const checks = [
    /SUPERVISORS/,
    /WORKERS/,
    /OBSERVABILITY/,
    /status/,
    /cost\s+total/,
    /tokens total in/,
    /latency n=/,
    /tok in\/out/,
    /\$0\.\d/,
    /worker/,
    /valid|done|delivered/i,
    /keys .*a shell.*c cancel.*mouse/,
  ]
  const hits = checks.filter((check) => check.test(frame)).length
  return (hits / checks.length) * 100
}
