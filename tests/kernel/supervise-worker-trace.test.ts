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

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { OtelExporter, OtelSpan } from '../../src/otel-export'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import {
  createSupervisorSpanRecorder,
  type SupervisorSpanRecorder,
} from '../../src/runtime/supervise/otel-spans'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import { supervise } from '../../src/runtime/supervise/supervise'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  Budget,
  ExecutorFactory,
  ExecutorRegistry,
  Scope,
  SupervisorOpts,
} from '../../src/runtime/supervise/types'
import { scriptedBrain } from './scripted-brain'

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** What the spawned worker reports about the trace context it inherited. */
interface InheritedEnv {
  TRACE_ID: string | null
  PARENT_SPAN_ID: string | null
}

/** A real child process that prints exactly the two env vars this feature is about. */
const PRINT_TRACE_ENV = [
  '-e',
  'process.stdout.write(JSON.stringify({' +
    'TRACE_ID: process.env.TRACE_ID ?? null,' +
    'PARENT_SPAN_ID: process.env.PARENT_SPAN_ID ?? null}))',
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

const OUTER_CHILD_BUDGET: Budget = { maxIterations: 8, maxTokens: 5_000, maxUsd: 5 }
const INNER_CHILD_BUDGET: Budget = { maxIterations: 4, maxTokens: 1_000, maxUsd: 1 }

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
    executorSpec: { profile: { name }, harness: null },
    act: () => Promise.resolve(undefined),
  } as unknown as Agent<unknown, unknown>
}

function supervisorOpts(over: Partial<SupervisorOpts>): SupervisorOpts {
  return {
    budget: over.budget ?? { maxIterations: 100, maxTokens: 100_000, maxUsd: 10 },
    runId: over.runId ?? 'run',
    journal: over.journal ?? new InMemorySpawnJournal(),
    blobs: over.blobs ?? new InMemoryResultBlobStore(),
    executors: over.executors ?? withDriverExecutor(registryOf(() => Promise.reject())),
    maxDepth: over.maxDepth ?? 4,
    now: over.now ?? (() => 1_000),
    ...(over.hooks ? { hooks: over.hooks } : {}),
    ...(over.workerTrace ? { workerTrace: over.workerTrace } : {}),
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
// the precedence rule is that they are NOT what a child inherits.
const saved = { trace: process.env.TRACE_ID, parent: process.env.PARENT_SPAN_ID }
beforeEach(() => {
  delete process.env.TRACE_ID
  delete process.env.PARENT_SPAN_ID
})
afterEach(() => {
  if (saved.trace === undefined) delete process.env.TRACE_ID
  else process.env.TRACE_ID = saved.trace
  if (saved.parent === undefined) delete process.env.PARENT_SPAN_ID
  else process.env.PARENT_SPAN_ID = saved.parent
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
        { label: 'mid', agent: driverChild('mid', mid, journal) as Agent<unknown, unknown> },
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
    expect(inherited(untraced.out)).toEqual({ TRACE_ID: null, PARENT_SPAN_ID: null })

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
    expect(inherited(observedOnly.out)).toEqual({ TRACE_ID: null, PARENT_SPAN_ID: null })
    // …and that run really did trace, so the equality above is not vacuous.
    expect(spans.length).toBeGreaterThan(0)
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
            harness: 'opencode',
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
            harness: 'opencode',
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
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worker-trace-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** The worker writes its inherited environment to a file, so the assertion does not depend on how
   *  the finalizer treats an ungated CLI artifact. */
  function probeArgs(outPath: string): string[] {
    return [
      '-e',
      'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({' +
        'TRACE_ID: process.env.TRACE_ID ?? null,' +
        'PARENT_SPAN_ID: process.env.PARENT_SPAN_ID ?? null}))',
      outPath,
    ]
  }

  function superviseOnce(outPath: string, exporter?: OtelExporter) {
    return supervise(
      { name: 'root', harness: null, systemPrompt: 'drive the worker' },
      'solve it',
      {
        budget: { maxIterations: 100, maxTokens: 100_000 },
        runId: 'front-door',
        backend: { backend: 'cli', bin: process.execPath, args: probeArgs(outPath) },
        brain: scriptedBrain([
          {
            toolCalls: [
              { name: 'spawn_agent', arguments: { profile: { name: 'worker' }, task: 'go' } },
            ],
          },
          { toolCalls: [{ name: 'await_event', arguments: {} }] },
          { content: 'done' },
        ]),
        ...(exporter ? { otel: { exporter } } : {}),
      },
    )
  }

  it('hands the front door worker the run trace id and the root span id', async () => {
    const { exporter, spans } = recordingExporter()
    const outPath = join(dir, 'traced.json')
    await superviseOnce(outPath, exporter)

    const env = JSON.parse(await readFile(outPath, 'utf8')) as InheritedEnv
    const root = spans.find((s) => s.name === 'supervisor.run')
    expect(root).toBeDefined()
    expect(env.TRACE_ID).toBe(root?.traceId)
    expect(env.PARENT_SPAN_ID).toBe(root?.spanId)
  })

  it('stamps nothing when the front door configures no telemetry', async () => {
    const outPath = join(dir, 'untraced.json')
    await superviseOnce(outPath)
    expect(JSON.parse(await readFile(outPath, 'utf8'))).toEqual({
      TRACE_ID: null,
      PARENT_SPAN_ID: null,
    })
  })
})
