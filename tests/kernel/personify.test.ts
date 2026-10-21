import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/in-memory-spawn-stores'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { FileResultBlobStore } from '../../src/durable/spawn-journal/result-blob-store'
import { RuntimeRunStateError, ValidationError } from '../../src/errors'
import { fanout } from '../../src/runtime/personify/combinators'
import { definePersona, runPersonified } from '../../src/runtime/personify/persona'
import type { Persona } from '../../src/runtime/personify/types'
import type { CombinatorShape, Outcome } from '../../src/runtime/personify/wave-types'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import type {
  AgentSpec,
  Budget,
  DefaultVerdict,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { spendFromUsageEvents } from '../../src/runtime/supervise/usage-metering'

import { testAgentProfile } from './test-agent-profile'

// ── Offline mock leaf runtime ─────────────────────────────────────────────────────
//
// The whole personify layer runs offline against this. A registered `'router'` factory
// mints a fresh scripted leaf per spawn; the script is derived FROM the child task the
// combinator fed (the seam every shape uses to route a per-child role), so one persona
// can drive many children with distinct verdicts. No network, no sandbox, no subprocess.

interface MockScript {
  readonly out: unknown
  readonly events: UsageEvent[]
  readonly verdict?: DefaultVerdict
  /** When set, the stream throws — the scope types it into a `down` settlement. */
  readonly failWith?: string
}

function mintMockExecutor(scriptFor: (task: unknown) => MockScript): Executor<unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'router',
    execute(task: unknown): AsyncIterable<UsageEvent> {
      const script = scriptFor(task)
      return (async function* () {
        if (script.failWith !== undefined) throw new ValidationError(script.failWith)
        artifact = {
          outRef: `mock:${stableKey(script.out)}`,
          out: script.out,
          ...(script.verdict ? { verdict: script.verdict } : {}),
          spent: spendFromUsageEvents(script.events),
        }
        for (const ev of script.events) yield ev
      })()
    },
    teardown(): Promise<{ destroyed: boolean }> {
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) throw new ValidationError('mock: resultArtifact before stream drained')
      return artifact
    },
  }
}

function stableKey(value: unknown): string {
  return JSON.stringify(value) ?? String(value)
}

/** A registry whose `harness:null` specs resolve to a fresh per-spawn mock; everything else
 *  falls through to the real registry. The persona's root spec is `harness:null`, so every
 *  child the shapes spawn drives this — fully offline. */
function mockRegistry(scriptFor: (task: unknown) => MockScript) {
  const base = createExecutorRegistry()
  return {
    register: base.register.bind(base),
    resolve<Out>(spec: AgentSpec) {
      if (!spec.executor && spec.harness === null) {
        return {
          succeeded: true as const,
          value: (): Executor<Out> => mintMockExecutor(scriptFor) as Executor<Out>,
        }
      }
      return base.resolve<Out>(spec)
    },
  }
}

function makePersona<D>(
  name: string,
  role: string,
  scriptFor: (task: unknown) => MockScript,
): Persona<D> {
  return definePersona<D>({
    name,
    root: { profile: testAgentProfile(role), harness: null },
    directive: `act as ${role}`,
    context: { role },
    executors: { registry: mockRegistry(scriptFor) },
  })
}

const ev = (input: number, output: number): UsageEvent[] => [
  { kind: 'iteration' },
  { kind: 'tokens', input, output },
]

const wideBudget: Budget = { maxIterations: 200, maxTokens: 1_000_000 }
const wideShapeBudget = { fanout: 4, perChild: { maxIterations: 10, maxTokens: 50_000 } }

/** Run a combinator factory verbatim (NOT via a registry name) through the real keystone.
 *  Passing the factory directly keeps the test independent of the shape-name registry. */
async function runShape<Task, D>(persona: Persona<D>, shape: CombinatorShape<Task, D>, task: Task) {
  return runPersonified<Task, D>({
    persona,
    shape,
    task,
    budget: wideBudget,
    shapeBudget: wideShapeBudget,
    runId: `${persona.name}:run`,
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    now: () => 0,
  })
}

/** A combinator returns a `done`/`blocked` Outcome; that Outcome rides home on a supervisor
 *  `winner` (the root act resolved). The Outcome contract lives in `out.kind`, never in
 *  `SupervisedResult.kind`. */
function expectOutcome<D>(result: Awaited<ReturnType<typeof runShape<unknown, D>>>): Outcome<D> {
  expect(result.kind).toBe('winner')
  if (result.kind !== 'winner') throw new Error('expected a supervisor winner')
  return result.out
}

// ── 2. fanout (+ generality: one shape, two domains) ─────────────────────────────────

const angleFanout = <D>() =>
  fanout<{ topic: string }, string, D>(['bull', 'bear', 'base'], {
    itemTask: (item, index) => ({ angle: item, index }),
    label: (item, index) => `angle:${index}:${item}`,
  })

function indexOf(task: unknown): number {
  if (task && typeof task === 'object' && typeof (task as { index?: unknown }).index === 'number') {
    return (task as { index: number }).index
  }
  return 0
}

// ── runPersonified · resume / rootIdentity / workerSlots forwarding ────────────
//
// `SupervisorOpts.resume`, `rootIdentity` and `workerSlots` existed on the keystone but never
// reached it through this entry point, so a second `runPersonified` under a journaled runId could
// only throw. Each case below proves the field lands where the supervisor reads it.

describe('runPersonified · resume, rootIdentity and workerSlots forwarding', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'personify-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('resume: true re-enters a journaled runId and reaches the same winner (fanout does not key its spawns, so its angles execute again)', async () => {
    let executions = 0
    const persona = makePersona<string>('analyst', 'equity analyst', (task) => {
      executions += 1
      const i = indexOf(task)
      return {
        out: `thesis-${i}`,
        events: ev(20, 20),
        verdict: { valid: true, score: 0.3 + i * 0.3 },
      }
    })
    const task = { topic: 'ACME' }
    // The identity the journal records on the first run; a resume must present the SAME one.
    const rootIdentity = {
      profileDigest: canonicalCandidateDigest(persona.root.profile),
      taskDigest: canonicalCandidateDigest(task),
    }
    // Fresh store objects per call over the SAME paths — what a second process would build.
    const durable = () => ({
      persona,
      shape: angleFanout<string>(),
      task,
      budget: wideBudget,
      shapeBudget: wideShapeBudget,
      runId: 'analyst:durable',
      rootIdentity,
      journal: new FileSpawnJournal(join(dir, 'spawn-journal.jsonl')),
      blobs: new FileResultBlobStore(join(dir, 'blobs')),
      now: () => 0,
    })

    const first = expectOutcome(await runPersonified<{ topic: string }, string>(durable()))
    expect(first.kind).toBe('done')
    if (first.kind === 'done') expect(first.deliverable).toBe('thesis-2')
    expect(executions).toBe(3)

    // Omitting `resume` keeps the keystone's guard: the reused runId is refused before any
    // executor runs. The guard is intentional; only the way past it was missing.
    const refused = await runPersonified<{ topic: string }, string>(durable()).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(refused).toBeInstanceOf(RuntimeRunStateError)
    expect((refused as Error).message).toBe(
      "supervisor: runId 'analyst:durable' already exists; pass resume: true to continue it or use a new runId",
    )
    expect(executions).toBe(3)

    // `resume` without `rootIdentity` is refused too — the identity must reach the keystone for
    // a resume to be possible at all.
    const { rootIdentity: _omitted, ...anonymous } = durable()
    await expect(
      runPersonified<{ topic: string }, string>({ ...anonymous, resume: true }),
    ).rejects.toThrow(/requires an exact rootIdentity/)
    expect(executions).toBe(3)

    const resumed = expectOutcome(
      await runPersonified<{ topic: string }, string>({ ...durable(), resume: true }),
    )
    expect(resumed.kind).toBe('done')
    if (resumed.kind === 'done') expect(resumed.deliverable).toBe('thesis-2')
    // `fanout` spawns by label, not by key, so keyed replay does not apply: the resumed tree
    // re-executes its three angles. A keyed shape would leave this at 3.
    expect(executions).toBe(6)
  })
})
