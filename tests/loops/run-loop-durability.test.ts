/**
 * Crash-durability: a run killed mid-flight, then reloaded against the SAME journal +
 * runId, RESUMES from the last committed step and does NOT redo committed work.
 *
 * Covers all three durability legs:
 *  1. Kernel `runLoop` — committed iterations survive a crash (file-backed `LoopJournal`),
 *     a resumed run re-uses them and the worker only executes the UN-committed rounds.
 *  2. `createFileRunContext(dir)` — the default-durable supervised run context: a crashed
 *     supervised run re-runs with the same `runId` + `dir` and re-uses the committed children
 *     rehydrated from disk (proving `loadTree`-first is wired and the file stores round-trip).
 *  3. The supervisor exposes the replayed committed work as `scope.resume`.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import { ValidationError } from '../../src/errors'
import { FileLoopJournal, InMemoryLoopJournal } from '../../src/runtime/loop-journal'
import { runLoop } from '../../src/runtime/run-loop'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { settledToIteration } from '../../src/runtime/supervise/scope'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import type { AgentRunSpec, Driver, OutputAdapter, SandboxClient } from '../../src/runtime/types'

// ── 1. Kernel runLoop crash → resume ──────────────────────────────────────────

describe('runLoop durable iteration history', () => {
  // A counting sandbox client: every `create()` increments, so we can prove a resumed run
  // does NOT re-create a box for an already-committed round.
  function countingClient(): { client: SandboxClient; creates: () => number } {
    let creates = 0
    const client: SandboxClient = {
      async create(): Promise<SandboxInstance> {
        creates += 1
        const id = `box-${creates}`
        return {
          id,
          name: id,
          status: 'running',
          // eslint-disable-next-line require-yield
          async *streamPrompt(prompt: string): AsyncIterable<SandboxEvent> {
            yield { type: 'result', data: { finalText: `out:${prompt}` } } as SandboxEvent
          },
          async delete() {},
        } as unknown as SandboxInstance
      },
    }
    return { client, creates: () => creates }
  }

  const output: OutputAdapter<string> = {
    parse: (events) => String(events.at(-1)?.data?.finalText ?? ''),
  }

  // A driver that plans one task per round for `rounds` rounds, then stops.
  function nRoundDriver(rounds: number): Driver<string, string, 'done'> {
    return {
      name: 'n-round',
      async plan(_task, history) {
        return history.length < rounds ? [`round-${history.length}`] : []
      },
      decide() {
        return 'done'
      },
    }
  }

  it('resumes from the last committed iteration and does NOT redo committed rounds', async () => {
    const journal = new InMemoryLoopJournal()
    const runId = 'loop-resume-1'

    // Run 1: crash after the FIRST committed round by capping iterations at 1.
    const first = countingClient()
    const r1 = await runLoop({
      driver: nRoundDriver(3),
      agentRun: { profile: { name: 'w' }, taskToPrompt: (t) => t },
      output,
      task: 'go',
      maxIterations: 1,
      runId,
      journal,
      ctx: { sandboxClient: first.client, signal: new AbortController().signal },
    })
    // One round ran and committed.
    expect(r1.iterations).toHaveLength(1)
    expect(first.creates()).toBe(1)
    const committed = await journal.loadRun<string, string>(runId)
    expect(committed?.iterations).toHaveLength(1)
    expect(committed?.endedAt).toBeUndefined() // crashed mid-flight, not finalized

    // Run 2: SAME runId + journal, now allowed to finish. It must RESUME — re-use the
    // committed iteration (no new box for it) and only execute the 2 remaining rounds.
    const second = countingClient()
    const r2 = await runLoop({
      driver: nRoundDriver(3),
      agentRun: { profile: { name: 'w' }, taskToPrompt: (t) => t },
      output,
      task: 'go',
      maxIterations: 3,
      runId,
      journal,
      ctx: { sandboxClient: second.client, signal: new AbortController().signal },
    })

    // History is the full 3 — the first iteration carried over verbatim from the journal.
    expect(r2.iterations).toHaveLength(3)
    expect(r2.iterations[0]?.output).toBe('out:round-0')
    expect(r2.iterations.map((i) => i.index)).toEqual([0, 1, 2])
    // CRITICAL: the resumed process only created boxes for the 2 un-committed rounds.
    expect(second.creates()).toBe(2)
  })

  it('an already-ended run short-circuits to its result (idempotent re-run, zero boxes)', async () => {
    const journal = new InMemoryLoopJournal()
    const runId = 'loop-ended-1'
    const first = countingClient()
    await runLoop({
      driver: nRoundDriver(2),
      agentRun: { profile: { name: 'w' }, taskToPrompt: (t) => t },
      output,
      task: 'go',
      maxIterations: 2,
      runId,
      journal,
      ctx: { sandboxClient: first.client, signal: new AbortController().signal },
    })
    expect(first.creates()).toBe(2)
    const ended = await journal.loadRun<string, string>(runId)
    expect(ended?.endedAt).toBeDefined()

    // Re-run: must return the recorded result without creating a single box.
    const second = countingClient()
    const replay = await runLoop({
      driver: nRoundDriver(2),
      agentRun: { profile: { name: 'w' }, taskToPrompt: (t) => t },
      output,
      task: 'go',
      maxIterations: 2,
      runId,
      journal,
      ctx: { sandboxClient: second.client, signal: new AbortController().signal },
    })
    expect(replay.iterations).toHaveLength(2)
    expect(second.creates()).toBe(0)
  })

  it('file-backed journal survives across journal instances (real crash boundary)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loop-journal-'))
    try {
      const path = join(dir, 'loop.jsonl')
      const runId = 'loop-file-1'
      // Process A: a distinct FileLoopJournal instance commits one round, then "crashes".
      const a = countingClient()
      await runLoop({
        driver: nRoundDriver(3),
        agentRun: { profile: { name: 'w' }, taskToPrompt: (t) => t },
        output,
        task: 'go',
        maxIterations: 1,
        runId,
        journal: new FileLoopJournal(path),
        ctx: { sandboxClient: a.client, signal: new AbortController().signal },
      })
      expect(a.creates()).toBe(1)

      // Process B: a BRAND-NEW FileLoopJournal reading the same file resumes from disk.
      const b = countingClient()
      const r = await runLoop({
        driver: nRoundDriver(3),
        agentRun: { profile: { name: 'w' }, taskToPrompt: (t) => t },
        output,
        task: 'go',
        maxIterations: 3,
        runId,
        journal: new FileLoopJournal(path),
        ctx: { sandboxClient: b.client, signal: new AbortController().signal },
      })
      expect(r.iterations).toHaveLength(3)
      expect(r.iterations[0]?.output).toBe('out:round-0')
      expect(b.creates()).toBe(2) // only the un-committed rounds re-ran
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ── 2. Supervisor crash → resume via createFileRunContext ──────────────────────

describe('supervisor durable resume (createFileRunContext)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sup-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // A scripted leaf executor that records each time it actually executes — so we can prove a
  // resumed supervisor re-uses the journaled child instead of re-running it.
  function leafAgent(
    name: string,
    out: unknown,
    events: UsageEvent[],
    onExecute: () => void,
  ): Agent<unknown, unknown> {
    const spent = spendFromUsageEvents(events)
    const executor: Executor<unknown> = {
      runtime: 'router',
      execute(_t: unknown): AsyncIterable<UsageEvent> {
        onExecute()
        return (async function* () {
          for (const ev of events) yield ev
        })()
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact: (): ExecutorResult<unknown> => ({ outRef: `mock:${name}`, out, spent }),
    }
    const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor }
    return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }

  const tokens = (n: number): UsageEvent[] => [{ kind: 'iteration' }, { kind: 'tokens', input: n, output: n }]

  // A resume-aware driver: spawn each arm whose label is NOT already in scope.resume, drain,
  // then select the highest-scoring across BOTH resumed + fresh children.
  function resumeAwareHarness(
    arms: Array<{ name: string; out: unknown; events: UsageEvent[]; score: number; exec: () => void }>,
  ): Agent<unknown, unknown> {
    return {
      name: 'resume-aware',
      async act(task, scope: Scope<unknown>): Promise<unknown> {
        const alreadyDone = new Set((scope.resume?.settled ?? []).map((s) => s.handle.label))
        for (const arm of arms) {
          if (alreadyDone.has(arm.name)) continue
          const agent = leafAgent(arm.name, arm.out, arm.events, arm.exec)
          scope.spawn(agent, task, {
            budget: { maxIterations: 1, maxTokens: 1000 },
            label: arm.name,
          })
        }
        const seen: Array<{ out: unknown; score: number }> = []
        // The committed children come back through scope.resume (rehydrated from disk).
        for (const s of scope.resume?.settled ?? []) {
          if (s.kind === 'done') {
            const it = settledToIteration(s)
            seen.push({ out: it.output, score: s.verdict?.score ?? 0 })
          }
        }
        for (let s = await scope.next(); s !== null; s = await scope.next()) {
          if (s.kind === 'done') seen.push({ out: s.out, score: s.verdict?.score ?? 0 })
        }
        seen.sort((a, b) => b.score - a.score)
        if (seen.length === 0) throw new ValidationError('no child')
        return seen[0]!.out
      },
    }
  }

  it('rehydrates committed children from disk and does NOT re-run them', async () => {
    const runId = 'sup-resume-run'
    const execLog: string[] = []

    // Run 1: spawn arm "a" (committed to disk), then crash — abort the run AFTER "a" settles.
    // We model the crash by aborting once the first child has settled via a controller the arm trips.
    const ctx1 = createFileRunContext(dir)
    const supervisor = createSupervisor<unknown, unknown>()
    const controller = new AbortController()
    const armA = {
      name: 'a',
      out: 'A',
      events: tokens(10),
      score: 0.5,
      exec: () => {
        execLog.push('a')
      },
    }
    // Arm "b" trips the abort when it executes, simulating a crash before it can settle.
    const armB = {
      name: 'b',
      out: 'B',
      events: tokens(10),
      score: 0.9,
      exec: () => {
        execLog.push('b')
        controller.abort('simulated crash')
      },
    }
    const r1 = await supervisor.run(resumeAwareHarness([armA, armB]), 't', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId,
      ...ctx1,
      now: () => 0,
      signal: controller.signal,
    })
    // Run 1 ended without a clean winner (it was aborted mid-flight).
    expect(r1.kind).toBe('no-winner')
    // Arm "a" committed at least one settlement to the journal.
    const tree = await ctx1.journal.loadTree(runId)
    expect(tree?.some((e) => e.kind === 'settled' && e.status === 'done')).toBe(true)

    execLog.length = 0
    // Run 2: SAME runId + dir, fresh context instances (a real reload). The supervisor
    // loadTree-first, rehydrates "a" via scope.resume, and the harness only spawns "b".
    const ctx2 = createFileRunContext(dir)
    const r2 = await createSupervisor<unknown, unknown>().run(
      resumeAwareHarness([
        { ...armA, exec: () => execLog.push('a') },
        { ...armB, score: 0.9, exec: () => execLog.push('b') },
      ]),
      't',
      {
        budget: { maxIterations: 100, maxTokens: 100_000 },
        runId,
        ...ctx2,
        now: () => 1,
      },
    )
    expect(r2.kind).toBe('winner')
    // "b" (the higher score) wins now that it ran to completion.
    if (r2.kind === 'winner') expect(r2.out).toBe('B')
    // CRITICAL: "a" was NOT re-executed on resume; only "b" ran.
    expect(execLog).toEqual(['b'])
  })
})
