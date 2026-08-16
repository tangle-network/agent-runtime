/**
 * The kernel offers two ways to compose agents, and they are not interchangeable.
 *
 * `runPersonified(shape)` runs a COMBINATOR: the composition code decides what runs next. It takes
 * no model interface at all, so the order is a property of the program.
 *
 * `runGraph(graph)` runs a MODEL-DECIDED topology: the root supervisor chooses each delegation by
 * emitting `spawn_agent`. A node with a `delegates` edge pointing at it runs only when the root
 * model asks for it.
 *
 * These tests hold that boundary open, because it is the reason the two families both exist. A
 * `pipeline` is not a `runGraph` with fewer options: replacing one with the other exchanges a
 * guaranteed order for a requested one.
 *
 * `runTree` is asserted here too — it is a view merge over a resumed run, not a third runtime, and
 * every caller already receives its output on `SupervisedResult.tree`.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { ValidationError } from '../../src/errors'
import type { MakeWorkerAgent } from '../../src/mcp/tools/coordination'
import * as kernel from '../../src/runtime/index'
import { pipeline } from '../../src/runtime/personify/combinators'
import { definePersona, runPersonified } from '../../src/runtime/personify/persona'
import type { Outcome, Persona } from '../../src/runtime/personify/wave-types'
import { spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { runTree } from '../../src/runtime/supervise/finalizer'
import type { AgentGraph } from '../../src/runtime/supervise/graph'
import { promptHandle } from '../../src/runtime/supervise/prompt-registry'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  NodeSnapshot,
  Scope,
  Settled,
  TreeView,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { runGraph } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

// ── Offline leaf: records the order stages actually ran in ────────────────────────

/** A leaf that appends its task to `ran` and settles with it. No network, no model. */
function recordingExecutor(ran: string[]): Executor<unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'router',
    execute(task: unknown): AsyncIterable<UsageEvent> {
      return (async function* () {
        ran.push(String(task))
        const events: UsageEvent[] = [
          { kind: 'iteration' },
          { kind: 'tokens', input: 1, output: 1 },
        ]
        artifact = {
          outRef: `mock:${String(task)}`,
          out: String(task),
          spent: spendFromUsageEvents(events),
        }
        for (const ev of events) yield ev
      })()
    },
    teardown(): Promise<{ destroyed: boolean }> {
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) throw new ValidationError('recording: resultArtifact before stream drained')
      return artifact
    },
  }
}

function recordingPersona(ran: string[]): Persona<string> {
  const base = createExecutorRegistry()
  return definePersona<string>({
    name: 'families',
    root: { profile: testAgentProfile('stage'), harness: null },
    directive: 'run the stage',
    context: { role: 'stage' },
    executors: {
      registry: {
        register: base.register.bind(base),
        resolve<Out>(spec: AgentSpec) {
          if (!spec.executor && spec.harness === null) {
            return {
              succeeded: true as const,
              value: (): Executor<Out> => recordingExecutor(ran) as Executor<Out>,
            }
          }
          return base.resolve<Out>(spec)
        },
      },
    },
  })
}

const wideBudget: Budget = { maxIterations: 50, maxTokens: 200_000 }

describe('code-decided composition — the combinator family', () => {
  it('pipeline runs every stage in order with no model interface anywhere in the run', async () => {
    const ran: string[] = []
    const shape = pipeline<string, string>([
      {
        label: 'first',
        feed: (carry) => `stage-a:${String(carry)}`,
        collect: (settled: Settled<Outcome<unknown>>) =>
          settled.kind === 'done'
            ? ({ kind: 'done', deliverable: settled.out } as Outcome<unknown>)
            : ({ kind: 'blocked', blockers: ['first went down'] } as Outcome<unknown>),
      },
      {
        label: 'second',
        feed: (carry) => `stage-b:${String(carry)}`,
        collect: (settled: Settled<Outcome<unknown>>) =>
          settled.kind === 'done'
            ? ({ kind: 'done', deliverable: settled.out } as Outcome<unknown>)
            : ({ kind: 'blocked', blockers: ['second went down'] } as Outcome<unknown>),
      },
    ])

    // `RunPersonifiedOptions` carries no brain, no router, and no model config. The composition
    // is the whole control policy — that is the capability under test.
    const res = await runPersonified<string, string>({
      persona: recordingPersona(ran),
      shape,
      task: 'seed',
      budget: wideBudget,
      shapeBudget: { fanout: 2, perChild: { maxIterations: 10, maxTokens: 20_000 } },
      runId: 'families:pipeline',
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      now: () => 0,
    })

    expect(res.kind).toBe('winner')
    // Both stages ran, in order, and stage two received stage one's output. Nothing decided this
    // but the pipeline itself.
    expect(ran).toEqual(['stage-a:seed', 'stage-b:stage-a:seed'])
  })
})

describe('model-decided composition — the graph family', () => {
  const twoNodeGraph = (): AgentGraph => ({
    nodes: [
      {
        id: 'driver',
        profile: testAgentProfile('driver', {
          harness: 'cli-base',
          prompt: { systemPrompt: 'Drive the worker until it delivers.' },
        }),
      },
      {
        id: 'worker',
        profile: testAgentProfile('worker', {
          prompt: { systemPrompt: 'You build what the driver asks.' },
        }),
      },
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'driver',
        to: 'worker',
        directive: promptHandle('delegates/worker-brief/v1'),
      },
    ],
    deliverable: { describe: 'the built artifact', check: (out) => out !== undefined },
    budget: { maxIterations: 20, maxTokens: 50_000 },
  })

  /** Records every worker the graph actually spawned, and settles it delivered. */
  function countingSeam(received: AgentProfile[]): MakeWorkerAgent {
    return (profile) => {
      received.push(profile)
      const name = profile.name ?? 'worker'
      let artifact: ExecutorResult<unknown> | undefined
      const ex: Executor<unknown> = {
        runtime: 'router',
        async execute() {
          artifact = {
            outRef: `w:${name}`,
            out: { built: name },
            verdict: { valid: true, score: 1 },
            spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
          }
          return artifact
        },
        teardown: () => Promise.resolve({ destroyed: true }),
        resultArtifact: () => {
          if (!artifact) throw new ValidationError('worker: resultArtifact before drain')
          return artifact
        },
      }
      const spec: AgentSpec = { profile, harness: null, executor: ex }
      return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
        executorSpec: AgentSpec
      }
    }
  }

  it('a delegates edge does not run its worker — the root model decides, and may decline', async () => {
    const received: AgentProfile[] = []
    // The graph is identical to the one whose worker DOES run in `graph.test.ts`; only the brain
    // differs. This brain never emits `spawn_agent`.
    const res = await runGraph(twoNodeGraph(), {
      makeWorkerAgent: countingSeam(received),
      brain: scriptedBrain([{ content: 'I decline to delegate.' }]),
    })

    // The edge exists, the node is reachable, the budget is ample — and the worker never ran,
    // because the model never asked. A `pipeline` stage cannot be skipped this way: that is the
    // behaviour `runGraph` does not provide and cannot be configured into.
    expect(received).toHaveLength(0)
    expect(res.result.kind).not.toBe('winner')
  })

  it('the same graph runs its worker when the model does ask — the seam is the brain, not the edge', async () => {
    const received: AgentProfile[] = []
    const res = await runGraph(twoNodeGraph(), {
      makeWorkerAgent: countingSeam(received),
      brain: scriptedBrain([
        {
          toolCalls: [
            {
              name: 'spawn_agent',
              arguments: { profile: { name: 'worker' }, task: 'build it' },
            },
          ],
        },
        { toolCalls: [{ name: 'await_event', arguments: {} }] },
        { content: 'done' },
      ]),
    })

    expect(received).toHaveLength(1)
    expect(res.result.kind).toBe('winner')
  })
})

describe('runTree — a view merge over a resumed run, not a runtime', () => {
  const node = (id: string, status: NodeSnapshot['status']): NodeSnapshot =>
    ({ id, label: id, status, parent: 'root' }) as NodeSnapshot

  const view = (nodes: NodeSnapshot[], over?: Partial<TreeView>): TreeView => ({
    root: 'root',
    nodes,
    inFlight: 1,
    waiting: 0,
    ...over,
  })

  const asScope = (v: TreeView, resumed?: TreeView): Pick<Scope<unknown>, 'view' | 'resume'> =>
    ({ view: v, ...(resumed ? { resume: { view: resumed } } : {}) }) as Pick<
      Scope<unknown>,
      'view' | 'resume'
    >

  it('returns the live view unchanged on a run that never resumed', () => {
    const live = view([node('a', 'done')])
    expect(runTree(asScope(live))).toBe(live)
  })

  it('carries the prior process nodes in and keeps the LIVE in-flight counts', () => {
    const live = view([node('c', 'running')], { inFlight: 1 })
    const prior = view([node('a', 'done'), node('b', 'done')], { inFlight: 2 })
    const merged = runTree(asScope(live, prior))

    expect(merged.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    // A prior process's in-flight node died with that process; it is not in flight now.
    expect(merged.inFlight).toBe(1)
  })

  it('a node id present in both views is not duplicated', () => {
    const live = view([node('a', 'done'), node('b', 'running')])
    const prior = view([node('a', 'running')])
    const merged = runTree(asScope(live, prior))

    expect(merged.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    // The LIVE snapshot wins for an id this process owns.
    expect(merged.nodes.find((n) => n.id === 'a')?.status).toBe('done')
  })

  it('is a supervisor internal — callers read the merged tree off the result instead', () => {
    // The merge is applied before a result is handed out, so nothing outside the package needs
    // to call it. Keeping it off `/kernel` is what stops it reading as a second graph runtime.
    expect('runTree' in kernel).toBe(false)
  })
})
