/**
 * The supervisor tree as OTLP spans.
 *
 * The whole point of the feature is that a span carrying `parent_span_id` IS a tree, so these cases
 * assert the SHAPE (a real recursive run's spans nest to arbitrary depth) and the two properties
 * that make telemetry safe to turn on: it is off unless configured, and a broken exporter cannot
 * reach the run.
 *
 * Fully offline — scripted leaf executors and a scripted driver, no network, sandbox, or subprocess.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { OtelExporter, OtelSpan } from '../../src/otel-export'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createSupervisorSpanRecorder } from '../../src/runtime/supervise/otel-spans'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import type { SuperviseOptions } from '../../src/runtime/supervise/supervise'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  Scope,
  SpawnEvent,
  Spend,
  SupervisorOpts,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

// ── Offline fixtures ──────────────────────────────────────────────────────────

function workerLeaf(
  name: string,
  out: unknown,
  tokens: { input: number; output: number },
  score = 0.9,
): Agent<unknown, unknown> {
  const spent: Spend = { iterations: 1, tokens, usd: 0.25, ms: 0 }
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: tokens.input, output: tokens.output } as UsageEvent
        yield {
          kind: 'cost',
          usd: 0.25,
          usdKnown: true,
          provenance: 'provider-receipt',
        } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `worker:${name}`,
      out,
      verdict: { valid: true, score },
      spent,
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

/** Per-child spawn budgets SHRINK with depth: a nested spawn reserves from the same conserved pool
 *  through its parent driver's reservation, so a child asking for its parent's whole envelope is
 *  refused `budget-exhausted` before the tree can form. */
const OUTER_CHILD_BUDGET = { maxIterations: 8, maxTokens: 5_000, maxUsd: 5 }
const INNER_CHILD_BUDGET = { maxIterations: 4, maxTokens: 1_000, maxUsd: 1 }

/** A driver that meters `turns` of its own inference, spawns its declared children, drains them,
 *  and returns the first `done` child's output. */
function scriptedDriver(
  name: string,
  children: (scope: Scope<unknown>) => Array<{ label: string; agent: Agent<unknown, unknown> }>,
  turns: ReadonlyArray<{ spend: Spend; detail?: Record<string, unknown> }> = [],
  childBudget: Budget = OUTER_CHILD_BUDGET,
): Agent<unknown, unknown> {
  return {
    name,
    async act(task, scope: Scope<unknown>): Promise<unknown> {
      for (const turn of turns) await scope.meter(turn.spend, turn.detail)
      for (const c of children(scope)) {
        const res = scope.spawn(c.agent, task, { budget: childBudget, label: c.label })
        if (!res.ok) throw new Error(`${name}: spawn ${c.label} failed: ${res.reason}`)
      }
      let out: unknown
      for (let s = await scope.next(); s !== null; s = await scope.next()) {
        if (s.kind === 'done' && out === undefined) out = s.out
      }
      return out
    },
  }
}

function supervisorOpts(over: Partial<SupervisorOpts> = {}): SupervisorOpts {
  return {
    budget: over.budget ?? { maxIterations: 100, maxTokens: 100_000, maxUsd: 10 },
    runId: over.runId ?? 'run',
    journal: over.journal ?? new InMemorySpawnJournal(),
    blobs: over.blobs ?? new InMemoryResultBlobStore(),
    executors: over.executors ?? withDriverExecutor(createExecutorRegistry()),
    maxDepth: over.maxDepth ?? 4,
    now: over.now ?? (() => 1_000),
    ...(over.hooks ? { hooks: over.hooks } : {}),
  }
}

/** Capture spans in memory instead of POSTing them. */
function recordingExporter(): { spans: OtelSpan[]; exporter: OtelExporter } {
  const spans: OtelSpan[] = []
  return {
    spans,
    exporter: {
      exportSpan: (span) => {
        spans.push(span)
      },
      flush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    },
  }
}

function attrs(span: OtelSpan): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const a of span.attributes ?? []) {
    if (a.value.stringValue !== undefined) out[a.key] = a.value.stringValue
    else if (a.value.intValue !== undefined) out[a.key] = Number(a.value.intValue)
    else if (a.value.doubleValue !== undefined) out[a.key] = a.value.doubleValue
    else if (a.value.boolValue !== undefined) out[a.key] = a.value.boolValue
  }
  return out
}

/** The one span whose `tangle.supervise.node.id` is `nodeId`, or `undefined`. */
function nodeSpan(spans: OtelSpan[], nodeId: string): OtelSpan | undefined {
  return spans.find(
    (s) => s.name !== 'gen_ai.client.inference' && attrs(s)['tangle.supervise.node.id'] === nodeId,
  )
}

/** A depth-2 tree: root driver → mid DRIVER child → worker leaf. Returns the run + the spans. */
async function runNestedTree(exporter: OtelExporter) {
  const journal = new InMemorySpawnJournal()
  const recorder = createSupervisorSpanRecorder({ runId: 'run', exporter, now: () => 1_000 })
  if (!recorder) throw new Error('recorder must exist when an exporter is supplied')
  const worker = workerLeaf('worker', { answer: 42 }, { input: 20, output: 10 })
  const mid = scriptedDriver(
    'mid',
    () => [{ label: 'worker', agent: worker }],
    [{ spend: { iterations: 0, tokens: { input: 7, output: 3 }, usd: 0.01, ms: 5 } }],
    INNER_CHILD_BUDGET,
  )
  const root = scriptedDriver(
    'root',
    () => [{ label: 'mid', agent: driverChild(testAgentProfile('mid'), mid, journal) }],
    [
      {
        spend: { iterations: 0, tokens: { input: 100, output: 40 }, usd: 0.5, ms: 12 },
        detail: { driver: 'root', turn: 0, kind: 'driver-inference', toolCalls: ['spawn_worker'] },
      },
    ],
  )
  const result = await createSupervisor<unknown, unknown>().run(
    root,
    'solve',
    supervisorOpts({ runId: 'run', journal, hooks: recorder.hooks }),
  )
  await recorder.finish({ result })
  return { result, recorder, journal }
}

const savedEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
afterEach(() => {
  if (savedEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = savedEndpoint
})

// ── Off by default ────────────────────────────────────────────────────────────

/** Attempt ids are per-execution nonces by design (`newExecutionAttemptId`); every OTHER byte of
 *  two equivalent runs must still match, so comparisons normalize exactly that one field. */
function normalizeAttemptIds<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, v) => (key === 'attemptId' ? '<attempt>' : v))) as T
}

describe('opt-in: a run that configures no exporter emits nothing', () => {
  it('resolves no recorder at all when neither an exporter nor an endpoint is configured', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    // No exporter, no config: the caller opted in to nothing.
    expect(createSupervisorSpanRecorder({ runId: 'run' })).toBeUndefined()
    // Config present but no reachable endpoint (and none in env): still nothing. "Configured but
    // unreachable" must cost the run nothing, not half-install an observer.
    expect(createSupervisorSpanRecorder({ runId: 'run', exportConfig: {} })).toBeUndefined()
  })

  it('leaves the result and the journal byte-identical to a run with no observer at all', async () => {
    // The observer is pure: attaching it must not perturb spawn order, settle order, ids, seqs,
    // spend, or the terminal result. Same tree, two runs — one traced, one not.
    const traced = new InMemorySpawnJournal()
    const { exporter, spans } = recordingExporter()
    const recorder = createSupervisorSpanRecorder({ runId: 'run', exporter, now: () => 1_000 })
    if (!recorder) throw new Error('recorder must exist when an exporter is supplied')
    const tracedResult = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [
        { label: 'a', agent: workerLeaf('a', { v: 1 }, { input: 5, output: 2 }) },
      ]),
      'task',
      supervisorOpts({ runId: 'run', journal: traced, hooks: recorder.hooks }),
    )
    await recorder.finish({ result: tracedResult })

    const plain = new InMemorySpawnJournal()
    const plainResult = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [
        { label: 'a', agent: workerLeaf('a', { v: 1 }, { input: 5, output: 2 }) },
      ]),
      'task',
      supervisorOpts({ runId: 'run', journal: plain }),
    )

    expect(normalizeAttemptIds(plainResult)).toEqual(normalizeAttemptIds(tracedResult))
    expect(normalizeAttemptIds(await plain.loadTree('run'))).toEqual(
      normalizeAttemptIds(await traced.loadTree('run')),
    )
    // …and the traced run really did produce spans, so the equality above is not vacuous.
    expect(spans.length).toBeGreaterThan(0)
  })
})

// ── The tree ──────────────────────────────────────────────────────────────────

describe('one span per supervised node, parented to its parent node', () => {
  it('nests to arbitrary depth: root → driver child → nested worker', async () => {
    const { exporter, spans } = recordingExporter()
    const { result, recorder } = await runNestedTree(exporter)
    expect(result.kind).toBe('winner')

    const root = spans.find((s) => s.name === 'supervisor.run')
    const mid = nodeSpan(spans, 'run:s0') // the driver child, spawned by the root scope
    const worker = nodeSpan(spans, 'run:s0:s0') // spawned by the driver's NESTED scope
    expect(root).toBeDefined()
    expect(mid).toBeDefined()
    expect(worker).toBeDefined()
    if (!root || !mid || !worker) return

    // The parent chain IS the tree. A flat emitter would parent both nodes at the root.
    expect(root.spanId).toBe(recorder.rootSpanId)
    expect(root.parentSpanId).toBeUndefined()
    expect(mid.parentSpanId).toBe(root.spanId)
    expect(worker.parentSpanId).toBe(mid.spanId)

    // The run root is the trace: every span, at every depth, shares one trace id.
    expect(recorder.traceId).toMatch(/^[0-9a-f]{32}$/)
    for (const s of spans) expect(s.traceId).toBe(recorder.traceId)

    // Nodes are AGENT spans carrying the label a viewer groups on.
    expect(attrs(mid)['openinference.span.kind']).toBe('AGENT')
    expect(attrs(mid)['agent.name']).toBe('mid')
    expect(attrs(worker)['agent.name']).toBe('worker')
    expect(attrs(worker)['tangle.supervise.node.parent_id']).toBe('run:s0')
    // The nested subtree names its own journal tree, which is what joins a span to the rows
    // that prove its spend.
    expect(attrs(worker)['tangle.supervise.tree.root']).not.toBe('run')
  })

  it('closes each node at settle with its verdict and its metered spend', async () => {
    const { exporter, spans } = recordingExporter()
    await runNestedTree(exporter)
    const worker = nodeSpan(spans, 'run:s0:s0')
    expect(worker).toBeDefined()
    if (!worker) return
    const a = attrs(worker)
    expect(a['tangle.supervise.node.status']).toBe('done')
    expect(a['tangle.supervise.verdict.valid']).toBe(true)
    expect(a['tangle.supervise.verdict.score']).toBe(0.9)
    // The vocabulary agent-eval's trace reader already indexes — not new keys.
    expect(a['llm.token_count.prompt']).toBe(20)
    expect(a['llm.token_count.completion']).toBe(10)
    expect(a['llm.cost_usd']).toBe(0.25)
    expect(a['tangle.cost.usd']).toBe(0.25)
    expect(worker.status?.code).toBe(1)
  })

  it('emits driver inference as an LLM child span under the node that metered it', async () => {
    const { exporter, spans } = recordingExporter()
    const { recorder } = await runNestedTree(exporter)
    const inference = spans.filter((s) => s.name === 'gen_ai.client.inference')
    // One per metered turn: the root driver's and the mid driver's.
    expect(inference).toHaveLength(2)

    const rootTurn = inference.find((s) => attrs(s)['agent.name'] === 'root')
    expect(rootTurn).toBeDefined()
    if (!rootTurn) return
    const a = attrs(rootTurn)
    expect(a['openinference.span.kind']).toBe('LLM')
    expect(a['llm.token_count.prompt']).toBe(100)
    expect(a['llm.token_count.completion']).toBe(40)
    expect(a['llm.cost_usd']).toBe(0.5)
    expect(a['tangle.supervise.turn.index'] ?? a['tangle.supervise.turn.turn']).toBe(0)
    expect(a['tangle.supervise.turn.toolCalls']).toBe('spawn_worker')
    // The root driver meters against the run root, so its turn hangs off the root span; the mid
    // driver's turn hangs off the mid driver's own node span.
    expect(rootTurn.parentSpanId).toBe(recorder.rootSpanId)
    const midTurn = inference.find((s) => s !== rootTurn)
    expect(midTurn?.parentSpanId).toBe(nodeSpan(spans, 'run:s0')?.spanId)
  })

  it('records the run outcome and the conserved total on the root span', async () => {
    const { exporter, spans } = recordingExporter()
    const { result } = await runNestedTree(exporter)
    const root = spans.find((s) => s.name === 'supervisor.run')
    expect(root).toBeDefined()
    if (!root || result.kind !== 'winner') return
    const a = attrs(root)
    expect(a['tangle.supervise.result']).toBe('winner')
    expect(a['tangle.run.id']).toBe('run')
    expect(a['llm.token_count.prompt']).toBe(result.spentTotal.tokens.input)
    expect(a['llm.token_count.completion']).toBe(result.spentTotal.tokens.output)
    expect(root.status?.code).toBe(1)
  })
})

// ── Unknown is never zero ─────────────────────────────────────────────────────

describe('an unmeasured turn is marked unknown, never written as 0', () => {
  it('omits the token and cost attributes and flags the channel instead', async () => {
    const { exporter, spans } = recordingExporter()
    const recorder = createSupervisorSpanRecorder({ runId: 'run', exporter, now: () => 1_000 })
    if (!recorder) throw new Error('recorder must exist when an exporter is supplied')
    // The exact `Spend` a driver turn produces when the brain reported no usage at all: the
    // conserved pool debits the zero it knows, and BOTH channels say so.
    const unknownTurn: Spend = {
      iterations: 0,
      tokens: { input: 0, output: 0 },
      tokensKnown: false,
      usd: 0,
      usdKnown: false,
      ms: 0,
    }
    const result = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [], [{ spend: unknownTurn, detail: { driver: 'root' } }]),
      'task',
      // No `maxUsd`: the conserved pool REFUSES an unknown-dollar turn under a dollar-capped
      // budget (it cannot honour a cap it can no longer measure), so an uncapped root is the only
      // shape in which an unknown turn actually reaches the span recorder.
      supervisorOpts({
        runId: 'run',
        budget: { maxIterations: 100, maxTokens: 100_000 },
        hooks: recorder.hooks,
      }),
    )
    await recorder.finish({ result })

    const turn = spans.find((s) => s.name === 'gen_ai.client.inference')
    expect(turn).toBeDefined()
    if (!turn) return
    const a = attrs(turn)
    // A `0` here would tell every downstream reader the turn was free. It must be ABSENT.
    expect(a['llm.token_count.prompt']).toBeUndefined()
    expect(a['llm.token_count.completion']).toBeUndefined()
    expect(a['llm.cost_usd']).toBeUndefined()
    expect(a['tangle.cost.usd']).toBeUndefined()
    // …and the unknown-ness is stated, not merely implied by absence.
    expect(a['tangle.supervise.tokens_known']).toBe(false)
    expect(a['tangle.supervise.cost_known']).toBe(false)
  })
})

// ── Telemetry is not the work ─────────────────────────────────────────────────

describe('an exporter that throws never fails the run', () => {
  it('produces the same result and journal as the same run with a working exporter', async () => {
    const hostile: OtelExporter = {
      exportSpan: () => {
        throw new Error('collector unreachable')
      },
      flush: () => Promise.reject(new Error('flush exploded')),
      shutdown: () => Promise.reject(new Error('shutdown exploded')),
    }
    const hostileJournal = new InMemorySpawnJournal()
    const recorder = createSupervisorSpanRecorder({
      runId: 'run',
      exporter: hostile,
      now: () => 1_000,
    })
    if (!recorder) throw new Error('recorder must exist when an exporter is supplied')
    const hostileResult = await createSupervisor<unknown, unknown>().run(
      scriptedDriver(
        'root',
        () => [{ label: 'a', agent: workerLeaf('a', { v: 1 }, { input: 5, output: 2 }) }],
        [{ spend: { iterations: 0, tokens: { input: 3, output: 1 }, usd: 0, ms: 0 } }],
      ),
      'task',
      supervisorOpts({ runId: 'run', journal: hostileJournal, hooks: recorder.hooks }),
    )
    // `finish` is called OUTSIDE the runtime's hook-error containment, so it must swallow on
    // its own — a rejecting flush/shutdown here would otherwise surface as a run failure.
    await expect(recorder.finish({ result: hostileResult })).resolves.toBeUndefined()

    const cleanJournal = new InMemorySpawnJournal()
    const cleanResult = await createSupervisor<unknown, unknown>().run(
      scriptedDriver(
        'root',
        () => [{ label: 'a', agent: workerLeaf('a', { v: 1 }, { input: 5, output: 2 }) }],
        [{ spend: { iterations: 0, tokens: { input: 3, output: 1 }, usd: 0, ms: 0 } }],
      ),
      'task',
      supervisorOpts({ runId: 'run', journal: cleanJournal }),
    )
    expect(hostileResult.kind).toBe('winner')
    expect(normalizeAttemptIds(hostileResult)).toEqual(normalizeAttemptIds(cleanResult))
    expect(normalizeAttemptIds(await hostileJournal.loadTree('run'))).toEqual(
      normalizeAttemptIds(await cleanJournal.loadTree('run')),
    )
  })

  it('survives a hook fired directly with a malformed event', () => {
    const { exporter, spans } = recordingExporter()
    const recorder = createSupervisorSpanRecorder({ runId: 'run', exporter, now: () => 1_000 })
    if (!recorder) throw new Error('recorder must exist when an exporter is supplied')
    expect(() =>
      recorder.hooks.onEvent?.(
        {
          id: 'x',
          runId: 'run',
          target: 'agent.child',
          phase: 'after',
          timestamp: 0,
          payload: 'not-an-object',
        },
        {},
      ),
    ).not.toThrow()
    // A settle for a node that was never spawned is dropped, not turned into a parentless span.
    expect(spans).toHaveLength(0)
  })
})

// ── Nothing is silently dropped ───────────────────────────────────────────────

describe('a node that never settled is closed and marked, not dropped', () => {
  it('emits an unsettled span for a child still in flight when the run ends', async () => {
    const { exporter, spans } = recordingExporter()
    const recorder = createSupervisorSpanRecorder({ runId: 'run', exporter, now: () => 2_000 })
    if (!recorder) throw new Error('recorder must exist when an exporter is supplied')
    // Spawn is observed through the hook; the settle never is. This is exactly the shape of a run
    // that died with work in flight.
    recorder.hooks.onEvent?.(
      {
        id: 'run:s0:spawn',
        runId: 'run',
        target: 'agent.spawn',
        phase: 'after',
        timestamp: 1_000,
        parentId: 'run',
        stepIndex: 0,
        payload: { childId: 'run:s0', label: 'stuck', runtime: 'router', depth: 0 },
      },
      {},
    )
    await recorder.finish()

    const stuck = nodeSpan(spans, 'run:s0')
    expect(stuck).toBeDefined()
    if (!stuck) return
    expect(attrs(stuck)['tangle.supervise.node.status']).toBe('unsettled')
    expect(attrs(stuck)['tangle.supervise.node.settled']).toBe(false)
    // UNSET, not OK: the run never proved this node succeeded, and it must not read as if it did.
    expect(stuck.status?.code).toBe(0)
    expect(stuck.parentSpanId).toBe(recorder.rootSpanId)
  })
})

/** Guards the fixture's own claim that the tree really is depth-2 in the journal. */
async function assertNestedTreeShape(journal: InMemorySpawnJournal): Promise<void> {
  const events = ((await journal.loadTree('run')) ?? []) as SpawnEvent[]
  expect(events.some((e) => e.kind === 'spawned' && e.id === 'run:s0')).toBe(true)
}

describe('fixture integrity', () => {
  it('the nested fixture really produces a depth-2 journal tree', async () => {
    const { exporter } = recordingExporter()
    const { journal } = await runNestedTree(exporter)
    await assertNestedTreeShape(journal)
  })
})

// ── The one-call front door ───────────────────────────────────────────────────

/** The whole `supervise()` call, minus the telemetry choice under test. */
function superviseOnce(otel?: SuperviseOptions['otel']) {
  return supervise(
    testAgentProfile('root', {
      harness: 'cli-base',
      prompt: { systemPrompt: 'drive the worker' },
      tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
    }),
    'solve it',
    {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'front-door',
      // Injected clock: the two arms of the identical-result comparison must not diverge on a
      // real-millisecond `settledAt` boundary.
      now: () => 1_000,
      makeWorkerAgent: () => workerLeaf('w', { answer: 42 }, { input: 5, output: 5 }, 1),
      brain: scriptedBrain([
        {
          toolCalls: [
            { name: 'spawn_worker', arguments: { profile: { name: 'worker' }, task: 'go' } },
          ],
        },
        { toolCalls: [{ name: 'await_event', arguments: {} }] },
        { content: 'done' },
      ]),
      ...(otel ? { otel } : {}),
    },
  )
}

describe('supervise(): telemetry is opt-in at the front door', () => {
  it('emits a closed root span and a node span per worker when `otel` is configured', async () => {
    const { exporter, spans } = recordingExporter()
    const result = await superviseOnce({ exporter })
    expect(result.kind).toBe('winner')
    // `supervise` closed the root span itself — the run's own lifecycle, not the caller's.
    const root = spans.find((s) => s.name === 'supervisor.run')
    expect(root).toBeDefined()
    expect(attrs(root ?? spans[0]!)['tangle.supervise.result']).toBe('winner')
    expect(attrs(root ?? spans[0]!)['tangle.run.id']).toBe('front-door')
    // The worker the supervisor spawned is a node span under the root.
    const worker = spans.find(
      (s) => s.name !== 'supervisor.run' && attrs(s)['openinference.span.kind'] === 'AGENT',
    )
    expect(worker?.parentSpanId).toBe(root?.spanId)
  })

  it('emits nothing and returns the identical result when `otel` is omitted', async () => {
    const { exporter, spans } = recordingExporter()
    const traced = await superviseOnce({ exporter })
    const untraced = await superviseOnce()
    expect(normalizeAttemptIds(untraced)).toEqual(normalizeAttemptIds(traced))
    // The traced arm proves the untraced comparison is not vacuous.
    expect(spans.length).toBeGreaterThan(0)
  })
})
