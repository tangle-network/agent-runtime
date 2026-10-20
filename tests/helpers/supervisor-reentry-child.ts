/**
 * One PHASE of a harness-driven supervised run, executed as its own OS process so the restart in
 * `tests/runtime/supervisor-reentry.test.ts` is a real one.
 *
 * Phase 1: the root's first drive streams a model event, spawns a worker that never settles, and
 * SIGKILLs the process once the worker's `spawned` record is on disk. Phase 2: a new process on the
 * same directory and run id re-enters the run; its model is scripted per drive by `PHASE2_DRIVES`.
 * Only the model process (`driveHarness`) and the supervisor clock are fake.
 *
 * Usage: `node --import tsx supervisor-reentry-child.ts <dir> <runId> <phase:1|2>`
 * Writes `${dir}/tasks-phase-<n>.jsonl` and `${dir}/attempts-phase-<n>.jsonl`; phase 2 prints one
 * JSON line with the settled result.
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { type DriveHarness, supervisorAgent } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'
import { testContinuation } from './continuation'

const [dir, runId, phase] = process.argv.slice(2)
if (dir === undefined || runId === undefined || (phase !== '1' && phase !== '2')) {
  throw new Error('usage: supervisor-reentry-child.ts <dir> <runId> <1|2>')
}

/** Phase 2's model, one entry per drive: whether that drive streams a model event. No drive makes
 *  progress: none submits, spawns, or meters. */
const PHASE2_DRIVES: ReadonlyArray<{ readonly modelEvent: boolean }> = [
  { modelEvent: false },
  { modelEvent: false },
  { modelEvent: true },
  { modelEvent: true },
  { modelEvent: true },
  { modelEvent: true },
]

const log = (name: string, value: unknown): void => {
  appendFileSync(`${dir}/${name}-phase-${phase}.jsonl`, `${JSON.stringify(value)}\n`)
}

async function rpc(url: string, name: string, args: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  return response.json()
}

/** A worker whose executor never settles: the work still running when the host went down. */
function hangingWorker(): Agent<unknown, unknown> {
  const events: UsageEvent[] = [{ kind: 'iteration' }, { kind: 'tokens', input: 1, output: 1 }]
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      return (async function* () {
        for (const event of events) yield event
        await new Promise<never>(() => {})
      })()
    },
    teardown: async () => ({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: 'unreachable',
      out: undefined,
      spent: spendFromUsageEvents(events),
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile('worker'), harness: null, executor }
  return { name: 'worker', act: async () => undefined, executorSpec: spec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

const journalPath = `${dir}/spawn-journal.jsonl`
const workerSpawnedOnDisk = (): boolean => {
  try {
    return readFileSync(journalPath, 'utf8')
      .split('\n')
      .some((line) => line.includes('"kind":"spawned"') && line.includes('"parent":'))
  } catch {
    return false
  }
}

let drives = 0
const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task, onModelEvent }) => {
  drives += 1
  log('tasks', String(task))
  if (phase === '1') {
    onModelEvent?.()
    await rpc(coordinationMcpUrl, 'spawn_worker', {
      profile: testAgentProfile('worker'),
      task: 'keep working',
    })
    while (!workerSpawnedOnDisk()) await new Promise((resolve) => setTimeout(resolve, 5))
    process.kill(process.pid, 'SIGKILL')
    return
  }
  const script = PHASE2_DRIVES[drives - 1]
  if (script === undefined)
    throw new Error(`phase 2 drove ${drives} times; the script has ${PHASE2_DRIVES.length}`)
  if (script.modelEvent) onModelEvent?.()
}

const profile = testAgentProfile('reentry-root', {
  harness: 'opencode',
  tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
})
const ctx = createFileRunContext(dir)
const root = supervisorAgent(profile, {
  blobs: ctx.blobs,
  makeWorkerAgent: () => hangingWorker(),
  perWorker: { maxIterations: 10, maxTokens: 1_000 },
  driveHarness,
  deliverable: { describe: 'A checked answer.', check: () => false },
  continuation: testContinuation({ maxBarren: 2 }),
  onDriverAttempt: (record) => log('attempts', record),
})
const task = 'Answer the question.'
// The supervisor clock is fake: each phase reads one fixed instant.
const result = await createSupervisor<unknown, unknown>().run(root, task, {
  budget: { maxIterations: 100, maxTokens: 100_000 },
  rootIdentity: {
    profileDigest: canonicalCandidateDigest(profile),
    taskDigest: canonicalCandidateDigest(task),
  },
  runId,
  ...ctx,
  now: () => (phase === '1' ? 1_000 : 2_000),
})

process.stdout.write(
  `${JSON.stringify({
    kind: result.kind,
    reason: result.kind === 'no-winner' ? result.reason : undefined,
    drives,
  })}\n`,
)
