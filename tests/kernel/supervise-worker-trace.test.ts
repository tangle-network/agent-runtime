/**
 * Trace context handed DOWN to a spawned worker, so one supervised tree spans machines.
 *
 * `otel-spans.ts` makes the supervisor's own tree readable by a trace viewer but stops at the
 * process boundary: a worker in a child process or on a remote box opens its OWN trace root, and
 * the viewer shows two unrelated trees for one run. These cases pin the wire that closes it — the
 * `TRACE_ID` / `PARENT_SPAN_ID` env convention this package already reads
 * (`readTraceContextFromEnv`) — and the three properties that make it safe to leave in:
 *
 *   1. a spawned worker really observes the run's trace id and the SPAWNING node's span id,
 *   2. at depth 2 that is the MIDDLE node's span, not the root's (a flat wire would look identical
 *      to a correct one at depth 1, which is why the nested case is the load-bearing one),
 *   3. a caller's own id wins, and with tracing off nothing is stamped at all.
 *
 * The subprocess cases spawn a REAL `node -e` child through the real `cli` backend and assert on
 * the environment that process actually observed — not on the options object we built for it.
 */

import { deriveHexId } from '@tangle-network/agent-trace-contract'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { OtelExporter, OtelSpan } from '../../src/otel-export'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import {
  createSupervisorSpanRecorder,
  type SupervisorSpanRecorder,
} from '../../src/runtime/supervise/otel-spans'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  Budget,
  ExecutorFactory,
  ExecutorRegistry,
  Scope,
  SupervisorOpts,
} from '../../src/runtime/supervise/types'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** What the spawned worker reports about the trace context it inherited. */
interface InheritedEnv {
  TRACE_ID: string | null
  PARENT_SPAN_ID: string | null
  TRACEPARENT: string | null
}

/** A real child process that prints exactly the env vars this feature is about. */
const PRINT_TRACE_ENV = [
  '-e',
  'process.stdout.write(JSON.stringify({' +
    'TRACE_ID: process.env.TRACE_ID ?? null,' +
    'PARENT_SPAN_ID: process.env.PARENT_SPAN_ID ?? null,' +
    'TRACEPARENT: process.env.TRACEPARENT ?? null}))',
]

/** Read the worker's printed environment back off the supervised run's output. */
function inherited(out: unknown): InheritedEnv {
  const content = (out as { content?: unknown } | undefined)?.content
  if (typeof content !== 'string') throw new Error(`worker produced no stdout: ${String(out)}`)
  return JSON.parse(content) as InheritedEnv
}

/**
 * Resolve EVERY non-driver child to one factory. The stock registry maps a spec to `router` or
 * `sandbox` only, and a bring-your-own `AgentSpec.executor` bypasses `ExecutorContext` entirely —
 * neither would exercise the seam the scope seeds, which is the thing under test.
 */
function registryOf(factory: ExecutorFactory<unknown>): ExecutorRegistry {
  return withDriverExecutor({
    register(): void {
      throw new Error('registryOf: registration is not part of these cases')
    },
    resolve<Out>() {
      return { succeeded: true as const, value: factory as unknown as ExecutorFactory<Out> }
    },
  })
}

const OUTER_CHILD_BUDGET: Budget = { maxIterations: 8, maxTokens: 5_000 }
const INNER_CHILD_BUDGET: Budget = { maxIterations: 4, maxTokens: 1_000 }

/** Spawns its declared children, drains them, and returns the first `done` child's output. */
function scriptedDriver(
  name: string,
  children: () => Array<{ label: string; agent: Agent<unknown, unknown> }>,
  childBudget: Budget = OUTER_CHILD_BUDGET,
): Agent<unknown, unknown> {
  return {
    name,
    async act(task, scope: Scope<unknown>): Promise<unknown> {
      for (const c of children()) {
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

/** A leaf whose executor is resolved by the registry (so it sees the scope-seeded seam). */
function resolvedLeaf(name: string): Agent<unknown, unknown> {
  return {
    name,
    executorSpec: { profile: testAgentProfile(name), harness: null },
    act: () => Promise.resolve(undefined),
  } as unknown as Agent<unknown, unknown>
}

function supervisorOpts(over: Partial<SupervisorOpts>): SupervisorOpts {
  return {
    budget: over.budget ?? { maxIterations: 100, maxTokens: 100_000 },
    runId: over.runId ?? 'run',
    journal: over.journal ?? new InMemorySpawnJournal(),
    blobs: over.blobs ?? new InMemoryResultBlobStore(),
    executors: over.executors ?? withDriverExecutor(registryOf(() => Promise.reject())),
    maxDepth: over.maxDepth ?? 4,
    now: over.now ?? (() => 1_000),
    ...(over.hooks ? { hooks: over.hooks } : {}),
    ...(over.workerTrace ? { workerTrace: over.workerTrace } : {}),
    ...(over.workerTraceUnpropagated
      ? { workerTraceUnpropagated: over.workerTraceUnpropagated }
      : {}),
  }
}

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

/** The one node span for `nodeId`. */
function nodeSpan(spans: OtelSpan[], nodeId: string): OtelSpan | undefined {
  return spans.find(
    (s) => s.name !== 'gen_ai.client.inference' && attrs(s)['tangle.supervise.node.id'] === nodeId,
  )
}

function recorderWith(exporter: OtelExporter): SupervisorSpanRecorder {
  const recorder = createSupervisorSpanRecorder({ runId: 'run', exporter, now: () => 1_000 })
  if (!recorder) throw new Error('recorder must exist when an exporter is supplied')
  return recorder
}

/** The `cli` backend running the printer, optionally with a caller's own seam env. */
function printerFactory(env?: Record<string, string>): ExecutorFactory<unknown> {
  return createExecutor({
    backend: 'cli',
    bin: process.execPath,
    args: PRINT_TRACE_ENV,
    ...(env ? { env } : {}),
  })
}

// The supervisor process's OWN ambient ids must not leak into these assertions: the whole point of
// the precedence rule is that they are NOT what a child inherits. TRACEPARENT included — an
// ambient W3C wire from the shell/CI that launched vitest would leak into every untraced child.
const saved = {
  trace: process.env.TRACE_ID,
  parent: process.env.PARENT_SPAN_ID,
  traceparent: process.env.TRACEPARENT,
}
beforeEach(() => {
  delete process.env.TRACE_ID
  delete process.env.PARENT_SPAN_ID
  delete process.env.TRACEPARENT
})
afterEach(() => {
  if (saved.trace === undefined) delete process.env.TRACE_ID
  else process.env.TRACE_ID = saved.trace
  if (saved.parent === undefined) delete process.env.PARENT_SPAN_ID
  else process.env.PARENT_SPAN_ID = saved.parent
  if (saved.traceparent === undefined) delete process.env.TRACEPARENT
  else process.env.TRACEPARENT = saved.traceparent
})

// ── The wire ──────────────────────────────────────────────────────────────────

describe('a spawned worker inherits the run trace and the spawning node span', () => {
  it('stamps the run trace id and the ROOT span on a depth-1 worker', async () => {
    const { exporter, spans } = recordingExporter()
    const recorder = recorderWith(exporter)
    const result = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [{ label: 'w', agent: resolvedLeaf('w') }]),
      'task',
      supervisorOpts({
        executors: registryOf(printerFactory()),
        hooks: recorder.hooks,
        workerTrace: recorder.workerTrace,
      }),
    )
    await recorder.finish({ result })
    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return

    const env = inherited(result.out)
    // The subprocess really saw them — this is read back out of the child's own stdout.
    expect(env.TRACE_ID).toBe(recorder.traceId)
    expect(env.PARENT_SPAN_ID).toBe(recorder.rootSpanId)
    // …and the span the child names as its parent is a span this run actually emitted.
    expect(spans.some((s) => s.spanId === env.PARENT_SPAN_ID)).toBe(true)
    // Dual-write (B4): the SAME spawn env carries the W3C wire alongside the legacy pair, so a
    // standard reader (an OTel SDK, the Claude Code harness) joins the same trace with no shim.
    expect(env.TRACEPARENT).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('stamps the MIDDLE node span on a depth-2 worker, never the run root', async () => {
    // The load-bearing case. A wire that always used the recorder's root span would pass the
    // depth-1 case above unchanged; only a nested spawn separates "the spawning node" from "the
    // run root", and a worker filed under the root loses the whole middle of the tree.
    const { exporter, spans } = recordingExporter()
    const recorder = recorderWith(exporter)
    const journal = new InMemorySpawnJournal()
    const mid = scriptedDriver(
      'mid',
      () => [{ label: 'w', agent: resolvedLeaf('w') }],
      INNER_CHILD_BUDGET,
    )
    const result = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [
        {
          label: 'mid',
          agent: driverChild(testAgentProfile('mid'), mid, journal) as Agent<unknown, unknown>,
        },
      ]),
      'task',
      supervisorOpts({
        journal,
        executors: registryOf(printerFactory()),
        hooks: recorder.hooks,
        workerTrace: recorder.workerTrace,
      }),
    )
    await recorder.finish({ result })
    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return

    const midSpan = nodeSpan(spans, 'run:s0')
    expect(midSpan).toBeDefined()
    const env = inherited(result.out)
    expect(env.TRACE_ID).toBe(recorder.traceId)
    expect(env.PARENT_SPAN_ID).toBe(midSpan?.spanId)
    expect(env.PARENT_SPAN_ID).not.toBe(recorder.rootSpanId)
  })

  it("lets a caller's own TRACE_ID / PARENT_SPAN_ID win over the stamped pair", async () => {
    // A seam env is a deliberate declaration about this worker; the supervisor never overrides it.
    const { exporter } = recordingExporter()
    const recorder = recorderWith(exporter)
    const result = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [{ label: 'w', agent: resolvedLeaf('w') }]),
      'task',
      supervisorOpts({
        executors: registryOf(
          printerFactory({ TRACE_ID: 'caller-owned-trace', PARENT_SPAN_ID: 'caller-owned-span' }),
        ),
        hooks: recorder.hooks,
        workerTrace: recorder.workerTrace,
      }),
    )
    await recorder.finish({ result })
    if (result.kind !== 'winner') throw new Error('expected a winner')

    const env = inherited(result.out)
    expect(env.TRACE_ID).toBe('caller-owned-trace')
    expect(env.PARENT_SPAN_ID).toBe('caller-owned-span')
    expect(env.TRACE_ID).not.toBe(recorder.traceId)
    // The W3C wire follows the caller too: the merged TRACEPARENT is rebuilt from the CALLER's
    // ids (the same deriveHexId dual-write every emitter uses), never left as the recorder's —
    // or a standard reader would join the recorder's trace while the legacy pair names the
    // caller's.
    expect(env.TRACEPARENT).toBe(
      `00-${deriveHexId('caller-owned-trace', 16)}-${deriveHexId('caller-owned-span', 8)}-01`,
    )
    expect(env.TRACEPARENT).not.toContain(recorder.traceId)
  })
})

// ── Off when recording is off ─────────────────────────────────────────────────

describe('a run that records no spans stamps nothing', () => {
  it('leaves the worker environment free of both ids, and identical to a run with no wiring', async () => {
    // No recorder ⇒ no `workerTrace` ⇒ no seam ⇒ no env merge. The worker sees exactly what it
    // saw before this feature existed.
    const untraced = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [{ label: 'w', agent: resolvedLeaf('w') }]),
      'task',
      supervisorOpts({ executors: registryOf(printerFactory()) }),
    )
    if (untraced.kind !== 'winner') throw new Error('expected a winner')
    expect(inherited(untraced.out)).toEqual({
      TRACE_ID: null,
      PARENT_SPAN_ID: null,
      TRACEPARENT: null,
    })

    // Recording ON but `workerTrace` NOT threaded is also silent: the seam, not the hook, is what
    // stamps — so an observer alone can never perturb a worker's environment.
    const { exporter, spans } = recordingExporter()
    const recorder = recorderWith(exporter)
    const observedOnly = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [{ label: 'w', agent: resolvedLeaf('w') }]),
      'task',
      supervisorOpts({ executors: registryOf(printerFactory()), hooks: recorder.hooks }),
    )
    await recorder.finish({ result: observedOnly })
    if (observedOnly.kind !== 'winner') throw new Error('expected a winner')
    expect(inherited(observedOnly.out)).toEqual({
      TRACE_ID: null,
      PARENT_SPAN_ID: null,
      TRACEPARENT: null,
    })
    // …and that run really did trace, so the equality above is not vacuous.
    expect(spans.length).toBeGreaterThan(0)
  })
})

// ── The severed hop is a journaled fact ───────────────────────────────────────

describe('a traced run on a channel-less backend journals each severed hop', () => {
  it('appends a trace-unpropagated event per spawn, naming backend + reason + expected trace id', async () => {
    const { exporter } = recordingExporter()
    const recorder = recorderWith(exporter)
    const journal = new InMemorySpawnJournal()
    const result = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [{ label: 'w', agent: resolvedLeaf('w') }]),
      'task',
      supervisorOpts({
        journal,
        executors: registryOf(printerFactory()),
        hooks: recorder.hooks,
        workerTrace: recorder.workerTrace,
        // The declaration `supervise()` derives from WORKER_TRACE_PROPAGATION for a cli-worktree
        // run: the transport exposes no environment channel, so the context CANNOT reach the
        // worker. (The bridge propagates over request headers and no longer declares this.)
        workerTraceUnpropagated: { backend: 'cli-worktree', reason: 'no-env-channel' },
      }),
    )
    await recorder.finish({ result })
    expect(result.kind).toBe('winner')
    const events = (await journal.loadTree('run')) ?? []
    const severed = events.filter((ev) => ev.kind === 'trace-unpropagated')
    expect(severed).toHaveLength(1)
    expect(severed[0]).toMatchObject({
      id: 'run:s0',
      expectedTraceId: recorder.traceId,
      backend: 'cli-worktree',
      reason: 'no-env-channel',
    })
  })

  it('journals nothing when the run is untraced — the declaration alone claims no severed hop', async () => {
    const journal = new InMemorySpawnJournal()
    const result = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [{ label: 'w', agent: resolvedLeaf('w') }]),
      'task',
      supervisorOpts({
        journal,
        executors: registryOf(printerFactory()),
        workerTraceUnpropagated: { backend: 'cli-worktree', reason: 'no-env-channel' },
      }),
    )
    expect(result.kind).toBe('winner')
    const events = (await journal.loadTree('run')) ?? []
    expect(events.filter((ev) => ev.kind === 'trace-unpropagated')).toHaveLength(0)
  })
})

// ── The cross-machine arm ─────────────────────────────────────────────────────

/** Records the `CreateSandboxOptions` each box was created with. */
function fakeSandboxClient() {
  const created: CreateSandboxOptions[] = []
  let seq = 0
  const client = {
    async create(options?: CreateSandboxOptions): Promise<SandboxInstance> {
      created.push(options ?? {})
      const id = `box-${seq++}`
      return {
        id,
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          yield { type: 'result', data: { ok: true, text: 'done' } } as SandboxEvent
          yield { type: 'done', data: { outcome: { type: 'completed' } } } as SandboxEvent
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
  return { client, created }
}

describe('the sandbox arm carries the context onto the box itself', () => {
  it('puts the ids on CreateSandboxOptions.env, so a worker on another machine joins the trace', async () => {
    const { exporter } = recordingExporter()
    const recorder = recorderWith(exporter)
    const fake = fakeSandboxClient()
    const result = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [{ label: 'w', agent: resolvedLeaf('w') }]),
      'task',
      supervisorOpts({
        executors: registryOf(
          createExecutor({
            backend: 'sandbox',
            sandboxClient: fake.client,
          }),
        ),
        hooks: recorder.hooks,
        workerTrace: recorder.workerTrace,
      }),
    )
    await recorder.finish({ result })
    expect(result.kind).toBe('winner')

    expect(fake.created.length).toBeGreaterThan(0)
    for (const options of fake.created) {
      expect(options.env?.TRACE_ID).toBe(recorder.traceId)
      expect(options.env?.PARENT_SPAN_ID).toBe(recorder.rootSpanId)
    }
  })

  it('adds no env key at all when the run records no spans', async () => {
    const fake = fakeSandboxClient()
    const result = await createSupervisor<unknown, unknown>().run(
      scriptedDriver('root', () => [{ label: 'w', agent: resolvedLeaf('w') }]),
      'task',
      supervisorOpts({
        executors: registryOf(
          createExecutor({
            backend: 'sandbox',
            sandboxClient: fake.client,
          }),
        ),
      }),
    )
    expect(result.kind).toBe('winner')
    expect(fake.created.length).toBeGreaterThan(0)
    // Not "an empty env object" — no key, so the create options are what they always were.
    for (const options of fake.created) expect(options.env).toBeUndefined()
  })
})

// ── The one-call front door ───────────────────────────────────────────────────

/**
 * `supervise({ backend })` builds its leaf executor EAGERLY, through `workerFromBackend`, and hands
 * it to the registry as a bring-your-own `Executor` — a path that never consults the per-child
 * `ExecutorContext` the scope seeds. Without the front door supplying the seam itself, every
 * `supervise({ backend, otel })` run would look wired and stamp nothing, which is the exact failure
 * this whole change exists to remove. This case is the guard on that.
 */
describe('supervise({ backend, otel }) stamps its workers too', () => {
  async function superviseOnce(exporter?: OtelExporter) {
    const fake = fakeSandboxClient()
    const result = await supervise(
      testAgentProfile('root', {
        harness: 'cli-base',
        prompt: { systemPrompt: 'drive the worker' },
        tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
      }),
      'solve it',
      {
        budget: { maxIterations: 100, maxTokens: 100_000 },
        runId: 'front-door',
        backend: { backend: 'sandbox', sandboxClient: fake.client },
        brain: scriptedBrain([
          {
            toolCalls: [
              {
                name: 'spawn_worker',
                arguments: {
                  profile: testAgentProfile('worker'),
                  task: 'go',
                },
              },
            ],
          },
          { toolCalls: [{ name: 'await_event', arguments: {} }] },
          { content: 'done' },
        ]),
        ...(exporter ? { otel: { exporter } } : {}),
      },
    )
    return { result, created: fake.created }
  }

  it('hands the front door worker the run trace id and the root span id', async () => {
    const { exporter, spans } = recordingExporter()
    const { result, created } = await superviseOnce(exporter)

    expect(result.kind).toBe('winner')
    const env = created[0]?.env
    const root = spans.find((s) => s.name === 'supervisor.run')
    expect(root).toBeDefined()
    expect(env.TRACE_ID).toBe(root?.traceId)
    expect(env.PARENT_SPAN_ID).toBe(root?.spanId)
    // The dual-write reaches the front-door wire too: the W3C TRACEPARENT the ecosystem reads
    // carries the SAME run trace id and root span id, not just the legacy pair.
    expect(env.TRACEPARENT).toBe(`00-${root?.traceId}-${root?.spanId}-01`)
  })

  it('stamps nothing when the front door configures no telemetry', async () => {
    const { result, created } = await superviseOnce()
    expect(result.kind).toBe('winner')
    expect(created[0]?.env).toBeUndefined()
  })
})
