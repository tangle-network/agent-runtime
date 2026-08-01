/**
 * One PHASE of a durable run driven by the BUILT-IN coordination driver (`supervise`), executed as
 * its own OS process so the coordinator's death is a real one.
 *
 * Usage: `node --import tsx resume-driver-child.ts <dir> <runId> <phase:1|2|control>`
 *
 * Phase `1` SIGKILLs itself from inside the brain the instant it has pulled three settlements — no
 * unwinding, no flush. Phase `2` is a brand-new process pointed at the SAME dir + runId. Phase
 * `control` runs the identical script start-to-finish in a fresh directory: the uninterrupted
 * baseline the crash-then-resume pair must match.
 *
 * Every phase runs the SAME brain script — five keyed workers, then pull events until idle. The
 * brain is deliberately NOT resume-aware: it re-issues the identical plan every time. Skipping the
 * committed work is therefore the RUNTIME's job (`spawn_agent`'s `key` resolving against the
 * journal), which is exactly the property under test.
 */

import { appendFileSync } from 'node:fs'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { supervise } from '../../src/runtime/supervise/supervise'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'

const [dir, runId, phase] = process.argv.slice(2)
if (
  dir === undefined ||
  runId === undefined ||
  (phase !== '1' && phase !== '2' && phase !== 'control')
) {
  throw new Error('usage: resume-driver-child.ts <dir> <runId> <1|2|control>')
}

/** Append-only proof of which workers actually RAN their paid execution in THIS process. The
 *  acceptance claim is exactly "phase 2's log holds none of the workers phase 1 committed". */
const execLog = `${dir}/exec-${phase}.log`
const recordExec = (name: string): void => {
  appendFileSync(execLog, `${name}\n`)
}

/** The five paid assignments. Scores ascend, so the winner is `w5` — an assignment that is still
 *  in flight when phase 1 dies, making the final output reachable only by combining both
 *  processes' work. */
const workers = [
  { key: 'w1', out: 'W1', score: 0.1 },
  { key: 'w2', out: 'W2', score: 0.2 },
  { key: 'w3', out: 'W3', score: 0.3 },
  { key: 'w4', out: 'W4', score: 0.4 },
  { key: 'w5', out: 'W5', score: 0.5 },
] as const

/** Workers that must NOT have settled when phase 1 dies, so the kill lands with exactly three
 *  committed assignments and two in flight. */
const hangsInPhase1 = new Set(['w4', 'w5'])

const workerUsage: UsageEvent[] = [
  { kind: 'iteration' },
  { kind: 'tokens', input: 10, output: 10 },
  { kind: 'cost', usd: 0.01 },
]
const workerSpend = spendFromUsageEvents(workerUsage)

function leafAgent(
  name: string,
  out: string,
  score: number,
  hang: boolean,
): Agent<unknown, string> {
  const executor: Executor<string> = {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      recordExec(name)
      return (async function* () {
        for (const ev of workerUsage) yield ev
        if (hang) await new Promise<never>(() => {})
      })()
    },
    teardown: async () => ({ destroyed: true }),
    resultArtifact: (): ExecutorResult<string> => ({
      outRef: `mock:${name}`,
      out,
      verdict: { score, valid: true },
      spent: workerSpend,
    }),
  }
  const spec: AgentSpec = {
    profile: { name } as AgentProfile,
    harness: null,
    executor: executor as Executor<unknown>,
  }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, string> & {
    executorSpec: AgentSpec
  }
}

/** Per-brain-turn inference cost — deterministic, so the run's driver-inference channel is a
 *  countable number of turns rather than a wall-clock artifact. */
const brainUsage = { input: 100, output: 20 }

let spawnedPlan = false
const brain: ToolLoopChat = async (messages) => {
  const toolResults = messages.filter((m) => m.role === 'tool').map((m) => String(m.content ?? ''))
  const settlementsPulled = toolResults.filter((t) => t.includes('"type":"settled"')).length

  // PHASE 1 CRASH: three assignments are committed (their blob + `settled` record are fsynced
  // before `await_event` can return them), two are still running. Die the way a real process dies.
  if (phase === '1' && settlementsPulled >= 3) process.kill(process.pid, 'SIGKILL')

  if (!spawnedPlan) {
    spawnedPlan = true
    return {
      toolCalls: workers.map((w, i) => ({
        id: `spawn-${i}`,
        name: 'spawn_agent',
        arguments: JSON.stringify({
          profile: { name: w.key },
          task: `do ${w.key}`,
          label: w.key,
          key: w.key,
        }),
      })),
      usage: brainUsage,
    }
  }

  // Nothing queued and nothing live — every assignment is accounted for, so close the run.
  if ((toolResults[toolResults.length - 1] ?? '').includes('"idle":true')) {
    return { content: 'done', toolCalls: [], usage: brainUsage }
  }
  return {
    toolCalls: [{ id: `await-${toolResults.length}`, name: 'await_event', arguments: '{}' }],
    usage: brainUsage,
  }
}

const result = await supervise({ name: 'root', harness: 'cli-base' }, 'five assignments', {
  budget: { maxIterations: 200, maxTokens: 500_000 },
  // Explicit per-worker ceiling: the default is a quarter of the pool, which would starve the
  // fifth spawn and make this a four-worker test.
  perWorker: { maxIterations: 5, maxTokens: 10_000 },
  makeWorkerAgent: (profile) => {
    const name = String((profile as { name?: unknown } | undefined)?.name ?? '')
    const w = workers.find((x) => x.key === name)
    if (w === undefined) throw new Error(`unknown worker profile ${JSON.stringify(profile)}`)
    return leafAgent(w.key, w.out, w.score, phase === '1' && hangsInPhase1.has(w.key))
  },
  brain,
  runId,
  runDir: dir,
  now: () => (phase === '2' ? 2_000 : 1_000),
})

process.stdout.write(
  `${JSON.stringify({
    phase,
    kind: result.kind,
    out: result.kind === 'winner' ? result.out : null,
    spentTotal: result.spentTotal,
    spentBreakdown: result.kind === 'winner' ? result.spentBreakdown : undefined,
    settledNodes: result.tree.nodes
      .filter((n) => n.status === 'done')
      .map((n) => n.label)
      .sort(),
  })}\n`,
)
