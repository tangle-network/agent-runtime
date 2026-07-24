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
    // Two arms committed before the kill. Settle ORDER between them is a race the kernel does not
    // fix (both are fsyncing a blob then a journal record), so it is never asserted here — what
    // matters is WHICH work survived, not in which order it landed.
    expect((await execLog(dir, '1')).sort()).toEqual(expect.arrayContaining(['a', 'b']))

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
    expect(replayed.map((s) => s.handle.label).sort()).toEqual(['a', 'b'])
    // Nothing claims the still-running arm finished. (Its `spawned` record may or may not be on
    // disk: `spawn` appends that one fire-and-forget while `settled` is awaited, so a hard kill
    // can drop it. The tree stays coherent either way — replay reads settlements, not spawns.)
    const crashView = materializeTreeView(crashed ?? [])
    expect(crashView.nodes.find((n) => n.label === 'c')?.status ?? 'pending').toBe('pending')

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
    expect([...report.resumedLabels].sort()).toEqual(['a', 'b'])
    expect([...report.resumedOuts].sort()).toEqual(['A', 'B'])
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
    // Phase 1's two settled arms and phase 2's replacement all hang off the ONE root, in one
    // tree — plus the killed arm when its fire-and-forget `spawned` record made it to disk.
    expect(view.nodes.length).toBeGreaterThanOrEqual(4)
    expect(byLabel.get('a')?.status).toBe('done')
    expect(byLabel.get('b')?.status).toBe('done')
    expect(view.nodes.filter((n) => n.label === 'c' && n.status === 'done')).toHaveLength(1)
    // Every node that is not the root names the root as its parent — the resumed scope kept
    // spawning into the SAME tree rather than starting a second one.
    for (const n of view.nodes) {
      if (n.id !== runId) expect(n.parent).toBe(runId)
    }
    // Every settlement kept a unique cursor position — the resumed scope continued the counters
    // past the journaled maxima instead of colliding with them.
    const cursors = (finalEvents ?? [])
      .filter((e) => e.kind === 'settled' || e.kind === 'cancelled')
      .map((e) => e.seq)
    expect(new Set(cursors).size).toBe(cursors.length)
    // The full replay rehydrates every committed child, phase 1's and phase 2's alike. Cursor
    // order puts phase 2's retry last by construction (its seq continues past phase 1's maxima).
    const finalLabels = (await replaySpawnTree(journal, blobs, runId)).map((s) => s.handle.label)
    expect(finalLabels).toHaveLength(3)
    expect(finalLabels.slice(0, 2).sort()).toEqual(['a', 'b'])
    expect(finalLabels[2]).toBe('c')
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
