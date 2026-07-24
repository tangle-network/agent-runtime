/**
 * Durable resume across a REAL process death.
 *
 * Phase 1 runs a supervision tree in its own OS process against `createFileRunContext(dir)` and
 * SIGKILLs itself the instant the second child settles — no unwinding, no teardown, no flush.
 * Phase 2 is a brand-new process pointed at the SAME `dir` + `runId`, whose only inheritance is
 * what survived on disk. It must resume: the two committed children come back rehydrated on
 * `Scope.resume` (their real outputs, not placeholders), only the un-settled arm re-executes, and
 * the run finishes with a winner over one intact tree spanning both processes.
 *
 * This is the proof the mechanic exists at all. Every part of it (`FileSpawnJournal`,
 * `FileResultBlobStore`, `replaySpawnTree`, `materializeTreeView`) was already built and tested in
 * isolation; what was missing — and had been written, merged, and reverted — is the wiring that
 * makes a second process pick up where the first one died.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FileResultBlobStore,
  FileSpawnJournal,
  materializeTreeView,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'

const childScript = new URL('../helpers/supervisor-resume-child.ts', import.meta.url).pathname

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

/** Lines of a phase's exec log — which leaf executors actually ran IN THAT PROCESS. */
async function execLog(dir: string, phase: '1' | '2'): Promise<string[]> {
  try {
    const text = await readFile(join(dir, `exec-phase-${phase}.log`), 'utf8')
    return text.split('\n').filter((l) => l.length > 0)
  } catch {
    return []
  }
}

describe('supervisor durable resume across a real process kill', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sup-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('a SIGKILLed run restarts from the journal, re-runs only the un-settled work, and completes', {
    timeout: 120_000,
  }, async () => {
    const runId = 'resume-run'

    // ── Phase 1: run until two children settle, then die hard ──────────────────────────────
    const first = await runPhase(dir, runId, '1')
    expect(first.signal, `phase 1 stderr: ${first.stderr}`).toBe('SIGKILL')
    expect(first.code).toBeNull()
    // All three arms started; two of them settled before the kill.
    expect(await execLog(dir, '1')).toEqual(['a', 'b', 'c'])

    // What actually survived: two `settled` records and their content-addressed blobs.
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    const blobs = new FileResultBlobStore(join(dir, 'blobs'))
    const crashed = await journal.loadTree(runId)
    expect(crashed).toBeDefined()
    const settledEvents = (crashed ?? []).filter((e) => e.kind === 'settled')
    expect(settledEvents).toHaveLength(2)
    // The blob for every journaled ref is present — the write order (blob, then event) means a
    // kill can never leave a journaled ref pointing at a missing payload.
    const replayed = await replaySpawnTree(journal, blobs, runId)
    expect(replayed.map((s) => s.handle.label)).toEqual(['a', 'b'])
    // The un-settled arm is on the tree as still-pending — the honest record of what was in
    // flight when the process died.
    const crashView = materializeTreeView(crashed ?? [])
    expect(crashView.nodes.find((n) => n.label === 'c')?.status).toBe('pending')

    // ── Phase 2: a brand-new process, same dir + runId ──────────────────────────────────────
    const second = await runPhase(dir, runId, '2')
    expect(second.code, `phase 2 stderr: ${second.stderr}`).toBe(0)
    const report = JSON.parse(second.stdout.trim()) as {
      kind: string
      out: string | null
      resumedLabels: string[]
      resumedOuts: string[]
      spawnedLabels: string[]
    }

    // The committed children came back through `Scope.resume`, rehydrated from the blob store
    // with their REAL outputs — not re-executed, not placeholders.
    expect(report.resumedLabels).toEqual(['a', 'b'])
    expect(report.resumedOuts).toEqual(['A', 'B'])
    // Only the arm that never settled was spawned again.
    expect(report.spawnedLabels).toEqual(['c'])
    // THE claim: the second process did not re-run a single committed child.
    expect(await execLog(dir, '2')).toEqual(['c'])
    // And the run reached a winner — 'C' outranks the resumed 'A'/'B', so the winner is only
    // reachable by combining work from BOTH processes.
    expect(report.kind).toBe('winner')
    expect(report.out).toBe('C')

    // ── One intact tree spanning both processes ─────────────────────────────────────────────
    const finalEvents = await journal.loadTree(runId)
    const view = materializeTreeView(finalEvents ?? [])
    const byLabel = new Map(view.nodes.map((n) => [n.label, n]))
    expect(view.root).toBe(runId)
    // The root plus phase 1's two settled arms, phase 1's killed arm, and phase 2's replacement.
    expect(view.nodes).toHaveLength(5)
    expect(byLabel.get('a')?.status).toBe('done')
    expect(byLabel.get('b')?.status).toBe('done')
    // Four nodes carry the label 'c': the killed one stays `pending`, the retry is `done`.
    const cNodes = view.nodes.filter((n) => n.label === 'c')
    expect(cNodes.map((n) => n.status).sort()).toEqual(['done', 'pending'])
    // Every settlement kept a unique cursor position — the resumed scope continued the counters
    // past the journaled maxima instead of colliding with them.
    const cursors = (finalEvents ?? [])
      .filter((e) => e.kind === 'settled' || e.kind === 'cancelled')
      .map((e) => e.seq)
    expect(new Set(cursors).size).toBe(cursors.length)
    // The full replay still rehydrates every committed child, phase 1's and phase 2's alike.
    expect((await replaySpawnTree(journal, blobs, runId)).map((s) => s.handle.label)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('without `resume`, the same durable stores start a FRESH tree (opt-in, not a default)', {
    timeout: 120_000,
  }, async () => {
    // The default-safety claim: durability is a store choice, resume is a separate opt-in. A
    // supervisor run that does not pass `resume` re-runs everything even against a journal that
    // already holds committed work.
    const { createSupervisor } = await import('../../src/runtime/supervise/supervisor')
    const { InMemoryResultBlobStore, InMemorySpawnJournal } = await import(
      '../../src/durable/spawn-journal'
    )
    const { createExecutorRegistry } = await import('../../src/runtime/supervise/runtime')

    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const executors = createExecutorRegistry()
    let acts = 0
    const root = {
      name: 'counting-root',
      act: async () => {
        acts += 1
        return 'out'
      },
    }
    const opts = {
      budget: { maxIterations: 5, maxTokens: 1_000 },
      runId: 'no-resume',
      journal,
      blobs,
      executors,
      now: () => 0,
    }
    const a = await createSupervisor<unknown, string>().run(root, 't', opts)
    expect(a.kind).toBe('winner')
    // A second run on the SAME journal + runId still takes the fresh path (`beginTree` is
    // idempotent for an identical `at`), and `Scope.resume` was never populated.
    const b = await createSupervisor<unknown, string>().run(root, 't', opts)
    expect(b.kind).toBe('winner')
    expect(acts).toBe(2)
  })
})
