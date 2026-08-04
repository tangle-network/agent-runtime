/**
 * One PHASE of a durable supervised run, executed as its own OS process so the crash boundary in
 * `tests/runtime/supervisor-resume.test.ts` is a real one: phase 1 SIGKILLs itself the instant the
 * second child settles (no unwinding, no flush, no teardown), and phase 2 is a brand-new process
 * whose only inheritance is `${dir}/spawn-journal.jsonl` + `${dir}/blobs/`.
 *
 * Usage: `node --import tsx supervisor-resume-child.ts <dir> <runId> <phase:1|2>`
 * Phase 2 prints one JSON line describing what it resumed and what it re-ran.
 *
 * Both phases run the SAME root agent, so the only difference between them is what the journal
 * says — which is the point: resume must be a property of the durable stores, not of the code path.
 */

import { appendFileSync } from 'node:fs'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
  Settled,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

const [dir, runId, phase] = process.argv.slice(2)
if (dir === undefined || runId === undefined || (phase !== '1' && phase !== '2')) {
  throw new Error('usage: supervisor-resume-child.ts <dir> <runId> <1|2>')
}

/** Append-only proof of which leaf executors actually RAN in this process. The resume claim is
 *  exactly "phase 2's log does not contain the arms phase 1 committed". */
const execLog = `${dir}/exec-phase-${phase}.log`
const recordExec = (name: string): void => {
  appendFileSync(execLog, `${name}\n`)
}

const usage = (n: number): UsageEvent[] => [
  { kind: 'iteration' },
  { kind: 'tokens', input: n, output: n },
]

/** A scripted leaf. `hang: true` never settles — it stands in for the worker that was still
 *  running when the process died. `delayMs` staggers settlement so the cursor order is
 *  deterministic and the crash lands after a known pair of settlements. */
function leafAgent(
  name: string,
  out: string,
  score: number,
  hang: boolean,
  delayMs: number,
): Agent<unknown, string> {
  const events = usage(10)
  const spent = spendFromUsageEvents(events)
  const executor: Executor<string> = {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      recordExec(name)
      return (async function* () {
        for (const ev of events) yield ev
        if (hang) await new Promise<never>(() => {})
        if (delayMs > 0) await new Promise<void>((r) => setTimeout(r, delayMs))
      })()
    },
    teardown: async () => ({ destroyed: true }),
    resultArtifact: (): ExecutorResult<string> => ({
      outRef: `mock:${name}`,
      out,
      verdict: { score, valid: true },
      spent,
    }),
  }
  const spec: AgentSpec = {
    profile: testAgentProfile(name),
    harness: null,
    executor: executor as Executor<unknown>,
  }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, string> & {
    executorSpec: AgentSpec
  }
}

interface Arm {
  readonly name: string
  readonly out: string
  readonly score: number
  readonly hang: boolean
  readonly delayMs: number
}

const arms: Arm[] = [
  { name: 'a', out: 'A', score: 0.3, hang: false, delayMs: 0 },
  { name: 'b', out: 'B', score: 0.5, hang: false, delayMs: 50 },
  // `c` is the arm still in flight when phase 1 dies; in phase 2 it is allowed to finish.
  { name: 'c', out: 'C', score: 0.9, hang: phase === '1', delayMs: 0 },
]

/** Recorded for the assertions: what came back on `scope.resume` and what this phase re-spawned. */
const resumedLabels: string[] = []
const resumedOuts: string[] = []
const spawnedLabels: string[] = []

/**
 * The resume-aware root: skip every arm the journal already settled, spawn the rest, then rank
 * across BOTH the rehydrated and the fresh settlements. A resume-blind root would re-spawn all
 * three and still be correct — just wasteful — which is why the test asserts on the exec log.
 */
const root: Agent<unknown, string> = {
  name: 'resume-aware-root',
  async act(task: unknown, scope: Scope<string>): Promise<string> {
    const committed = scope.resume?.settled ?? []
    const done = new Set<string>()
    const ranked: Array<{ out: string; score: number }> = []
    for (const s of committed) {
      resumedLabels.push(s.handle.label)
      done.add(s.handle.label)
      if (s.kind === 'done') {
        resumedOuts.push(s.out)
        ranked.push({ out: s.out, score: s.verdict?.score ?? 0 })
      }
    }
    for (const arm of arms) {
      if (done.has(arm.name)) continue
      const agent = leafAgent(arm.name, arm.out, arm.score, arm.hang, arm.delayMs)
      const res = scope.spawn(agent, task, {
        budget: { maxIterations: 1, maxTokens: 1_000 },
        label: arm.name,
      })
      if (res.ok) spawnedLabels.push(arm.name)
    }
    for (let s: Settled<string> | null = await scope.next(); s !== null; s = await scope.next()) {
      if (s.kind === 'done') ranked.push({ out: s.out, score: s.verdict?.score ?? 0 })
      // PHASE 1 CRASH: the moment the SECOND settlement lands, die the way a real process dies.
      // Both settled records are already fsynced to the journal (the scope writes the blob, then
      // the event, before `next()` resolves), so the journal is a valid mid-flight tree.
      if (phase === '1' && ranked.length === 2) process.kill(process.pid, 'SIGKILL')
    }
    ranked.sort((x, y) => y.score - x.score)
    const best = ranked[0]
    if (best === undefined) throw new Error('no child produced a result')
    return best.out
  },
}

const ctx = createFileRunContext(dir)
const result = await createSupervisor<unknown, string>().run(root, 'task', {
  budget: { maxIterations: 50, maxTokens: 100_000 },
  rootIdentity: {
    profileDigest: canonicalCandidateDigest({ name: root.name }),
    taskDigest: canonicalCandidateDigest('task'),
  },
  runId,
  ...ctx,
  now: () => (phase === '1' ? 1_000 : 2_000),
})

process.stdout.write(
  `${JSON.stringify({
    phase,
    kind: result.kind,
    out: result.kind === 'winner' ? result.out : null,
    resumedLabels,
    resumedOuts,
    spawnedLabels,
    treeNodes: result.tree.nodes.map((n) => ({ id: n.id, label: n.label, status: n.status })),
  })}\n`,
)
