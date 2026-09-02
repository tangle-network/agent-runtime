import type { AnalystFinding, ToolSpan } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import {
  ANALYST_DEFINITION_BOUNDS,
  type AnalystKind,
  type AnalystRegistry,
  type AuthoredAnalystDefinition,
  type CoordinationEvent,
  createCoordinationTools,
  type DefinedAnalystRecord,
  parseAuthoredAnalystDefinition,
} from '../../src/mcp/tools/coordination'
import type { Agent, ResultBlobStore, Scope, Spend, WorkerTraceEvidence } from '../../src/runtime'
import { contentAddress, WORKER_TOOL_TRACE_SCHEMA_VERSION } from '../../src/runtime'

const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })

const toolSpan = {
  spanId: 'worker-trace-t0',
  runId: 'worker-trace',
  kind: 'tool',
  name: 'read_file',
  toolName: 'read_file',
  args: { path: 'actual.ts' },
  result: { text: 'structured tool result' },
  status: 'ok',
  startedAt: 100,
  endedAt: 105,
} as const satisfies ToolSpan
const traceArtifact = { schemaVersion: WORKER_TOOL_TRACE_SCHEMA_VERSION, spans: [toolSpan] }
const traceRef = contentAddress(traceArtifact)
const availableTrace = {
  status: 'available',
  traceRef,
  spanCount: 1,
} as const satisfies WorkerTraceEvidence

const blobs: ResultBlobStore = {
  get: async (ref) => (ref === traceRef ? traceArtifact : undefined),
  put: async () => {},
}
const makeWorkerAgent = (): Agent<unknown, unknown> => ({ name: 'w', act: async () => 0 })
const perWorker = { maxIterations: 1, maxTokens: 10 }

/** One settled child, so a defined lens has a real trace to be run over. */
function scopeWithSettledChild(): Scope<unknown> {
  const nodes = [
    {
      id: 'w1',
      label: 'settled',
      status: 'done' as const,
      runtime: 'router',
      budget: { maxIterations: 1, maxTokens: 10 },
      spent: zeroSpend(),
      outRef: 'blob:w1',
      trace: availableTrace,
    },
  ]
  return {
    spawn: () => ({ ok: false as const, reason: 'budget-exhausted' as const }),
    next: async () => null,
    send: () => false,
    get view() {
      return { root: 'root', nodes, inFlight: 0 }
    },
    budget: { tokensLeft: 10, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
    signal: new AbortController().signal,
  } as unknown as Scope<unknown>
}

const definition = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  id: 'handoff-loss',
  description: 'Did a worker lose context the parent had already established?',
  area: 'coordination',
  question: 'Where did a child re-derive a fact its parent had already given it?',
  instructions:
    'Read every tool span. A finding requires a span where the child obtained a fact the task prompt already stated. Refuse to infer a handoff loss from prose alone.',
  toolGroup: 'discoveryAndRead',
  ...over,
})

/** A registry whose `register` records what it was handed and then serves the new lens. */
function authoringRegistry(options: { refuse?: string } = {}) {
  const registered: AuthoredAnalystDefinition[] = []
  const menu: AnalystKind[] = [
    { id: 'failure-mode', description: 'Shipped lens.', area: 'failure' },
  ]
  const registry: AnalystRegistry = {
    kinds: menu,
    run: async (kindId) =>
      [
        {
          analyst_id: kindId,
          area: 'coordination',
          claim: `ran ${kindId}`,
          severity: 'info',
        } as unknown as AnalystFinding,
      ] as ReadonlyArray<AnalystFinding>,
    register: (authored) => {
      if (options.refuse !== undefined) throw new Error(options.refuse)
      registered.push(authored)
      return { id: authored.id, description: authored.description, area: authored.area }
    },
  }
  return { registry, registered }
}

function manager(
  registry: AnalystRegistry | undefined,
  extra: Record<string, unknown> = {},
): ReturnType<typeof createCoordinationTools> {
  return createCoordinationTools({
    scope: scopeWithSettledChild(),
    blobs,
    makeWorkerAgent,
    perWorker,
    ...(registry ? { analysts: registry } : {}),
    ...extra,
  })
}

const tool = (tb: ReturnType<typeof createCoordinationTools>, name: string) => {
  const found = tb.tools.find((t) => t.name === name)
  if (!found) throw new Error(`no tool ${name}`)
  return found
}

const define = (tb: ReturnType<typeof createCoordinationTools>, args: unknown) =>
  tool(tb, 'define_analyst').handler(args) as Promise<Record<string, unknown>>

describe('define_analyst', () => {
  it('mounts only when the registry admits an authored lens', () => {
    expect(manager(undefined).tools.map((t) => t.name)).not.toContain('define_analyst')

    const fixedMenu: AnalystRegistry = { kinds: [], run: async () => [] }
    const fixed = manager(fixedMenu)
    expect(fixed.tools.map((t) => t.name)).toContain('list_analysts')
    expect(fixed.tools.map((t) => t.name)).not.toContain('define_analyst')

    expect(manager(authoringRegistry().registry).tools.map((t) => t.name)).toContain(
      'define_analyst',
    )
  })

  it('a manager defines a lens, runs it on its own child, and reads the finding', async () => {
    const { registry, registered } = authoringRegistry()
    const tb = manager(registry)

    const defined = await define(tb, definition())
    expect(defined).toMatchObject({
      analyst: {
        id: 'handoff-loss',
        area: 'coordination',
        description: 'Did a worker lose context the parent had already established?',
      },
      defined: 1,
    })
    expect(String(defined.digest)).toMatch(/^sha256:[0-9a-f]{64}$/)

    // The registry received the manager's own words, not a re-derivation of them.
    expect(registered).toHaveLength(1)
    expect(registered[0]?.instructions).toContain(
      'Refuse to infer a handoff loss from prose alone.',
    )
    expect(registered[0]?.toolGroup).toBe('discoveryAndRead')

    // It is on the menu beside the lens the run shipped with.
    expect(await tool(tb, 'list_analysts').handler({})).toEqual({
      analysts: [
        { id: 'failure-mode', description: 'Shipped lens.', area: 'failure' },
        {
          id: 'handoff-loss',
          description: 'Did a worker lose context the parent had already established?',
          area: 'coordination',
        },
      ],
    })

    // And it runs over this manager's own settled child, through the ordinary lens path.
    const findings = (await tool(tb, 'run_analyst').handler({
      kind: 'handoff-loss',
      workerId: 'w1',
    })) as { findings: ReadonlyArray<{ claim: string }> }
    expect(findings.findings[0]?.claim).toBe('ran handoff-loss')
  })

  it('journals every definition as a run artifact: exact bytes, digest, and order', async () => {
    const { registry } = authoringRegistry()
    const tb = manager(registry)
    const first = await define(tb, definition())
    await define(tb, definition({ id: 'tool-thrash', area: 'tool-use' }))

    const journaled = tb
      .history()
      .filter((record) => record.event.type === 'analyst-defined')
      .map(
        (record) =>
          (record.event as Extract<CoordinationEvent, { type: 'analyst-defined' }>).analyst,
      )
    expect(journaled.map((record) => record.kind.id)).toEqual(['handoff-loss', 'tool-thrash'])
    expect(journaled[0]?.digest).toBe(first.digest)
    expect(journaled[0]?.definition.instructions).toBe(definition().instructions)
    expect(journaled[0]?.definedAt).toBeGreaterThan(0)
    expect(tb.definedAnalysts().map((r: DefinedAnalystRecord) => r.kind.id)).toEqual([
      'handoff-loss',
      'tool-thrash',
    ])

    // Record-only: a manager's own action never lands in the inbox it pulls from.
    const awaited = await tool(tb, 'await_event').handler({ kinds: ['finding'] })
    expect(JSON.stringify(awaited)).not.toContain('analyst-defined')
  })

  it('the same words always produce the same digest; different words never do', async () => {
    const a = manager(authoringRegistry().registry)
    const b = manager(authoringRegistry().registry)
    const first = await define(a, definition())
    const same = await define(b, definition())
    expect(same.digest).toBe(first.digest)

    const c = manager(authoringRegistry().registry)
    const changed = await define(
      c,
      definition({ instructions: `${definition().instructions} Also cite the span id.` }),
    )
    expect(changed.digest).not.toBe(first.digest)
  })

  it('refuses a definition it cannot bound, and names every reason at once', async () => {
    const tb = manager(authoringRegistry().registry)
    const refused = await define(tb, {
      id: 'Not A Valid Id',
      description: '',
      area: 'coordination',
      question: 'q',
      instructions: 'i',
      toolGroup: 'everything',
    })
    expect(refused.error).toBe('invalid-definition')
    const issues = refused.issues as ReadonlyArray<{ path: string }>
    expect(issues.map((issue) => issue.path).sort()).toEqual(['description', 'id', 'toolGroup'])
    expect(String(refused.reason)).toContain('toolGroup')
    expect(tb.definedAnalysts()).toHaveLength(0)
    expect(tb.history().filter((r) => r.event.type === 'analyst-defined')).toHaveLength(0)
  })

  it('refuses code: a field that would carry a function is rejected, not dropped', () => {
    const parsed = parseAuthoredAnalystDefinition({
      ...definition(),
      prepareContext: 'return store.getOverview()',
      postProcess: 'row => row',
    })
    expect('issues' in parsed).toBe(true)
    if (!('issues' in parsed)) throw new Error('expected issues')
    expect(parsed.issues.map((issue) => issue.path).sort()).toEqual([
      'postProcess',
      'prepareContext',
    ])
  })

  it('clamps investigation limits instead of refusing them, and reports what was accepted', async () => {
    const { registry, registered } = authoringRegistry()
    const tb = manager(registry)
    await define(
      tb,
      definition({
        limits: {
          maxIterations: 999,
          maxLlmCalls: 999,
          maxToolCalls: 999,
          maxOutputChars: 10_000_000,
        },
      }),
    )
    expect(registered[0]?.limits).toEqual({
      maxIterations: ANALYST_DEFINITION_BOUNDS.maxIterations,
      maxLlmCalls: ANALYST_DEFINITION_BOUNDS.maxLlmCalls,
      maxToolCalls: ANALYST_DEFINITION_BOUNDS.maxToolCalls,
      maxOutputChars: ANALYST_DEFINITION_BOUNDS.maxOutputChars,
    })

    const bad = await define(tb, definition({ id: 'other', limits: { maxLlmCalls: 0 } }))
    expect(bad.error).toBe('invalid-definition')
  })

  it('refuses an id already on the menu, shipped or defined', async () => {
    const tb = manager(authoringRegistry().registry)
    const shipped = await define(tb, definition({ id: 'failure-mode' }))
    expect(shipped).toMatchObject({ error: 'duplicate-analyst' })
    expect(String(shipped.reason)).toContain('Shipped lens.')

    await define(tb, definition())
    const twice = await define(tb, definition())
    expect(twice).toMatchObject({ error: 'duplicate-analyst' })
    expect(tb.definedAnalysts()).toHaveLength(1)
  })

  it('passes the registry’s refusal through as the reason, and journals nothing', async () => {
    const { registry } = authoringRegistry({ refuse: 'no engine serves model "gpt-9"' })
    const tb = manager(registry)
    const refused = await define(tb, definition({ model: 'gpt-9' }))
    expect(refused).toEqual({
      error: 'register-refused',
      reason: 'no engine serves model "gpt-9"',
    })
    expect(tb.definedAnalysts()).toHaveLength(0)
    expect(tb.history().filter((r) => r.event.type === 'analyst-defined')).toHaveLength(0)
  })

  it('caps how many lenses one manager may define', async () => {
    const { registry } = authoringRegistry()
    const tb = manager(registry, { maxDefinedAnalysts: 2 })
    expect((await define(tb, definition({ id: 'one' }))).analyst).toBeDefined()
    expect((await define(tb, definition({ id: 'two' }))).analyst).toBeDefined()
    const third = await define(tb, definition({ id: 'three' }))
    expect(third).toMatchObject({ error: 'max-defined-analysts', defined: ['one', 'two'] })
    expect(String(third.reason)).toContain('run the ones you have')
  })

  it('a lens one manager defined is not runnable by a sibling that shares the registry', async () => {
    // The registry object is shared by every manager of a run, so a defined lens is registered
    // tree-wide. The MENU is the grant: without this fence a sibling could run another manager's
    // authored instructions on its own workers, spending the run's account, and `list_analysts`
    // would never have shown it the id.
    const shared = authoringRegistry()
    const author = manager(shared.registry)
    const sibling = manager(shared.registry)
    await define(author, definition())

    expect(
      await tool(author, 'run_analyst').handler({ kind: 'handoff-loss', workerId: 'w1' }),
    ).toMatchObject({
      findings: [{ claim: 'ran handoff-loss' }],
    })

    const refused = await tool(sibling, 'run_analyst').handler({
      kind: 'handoff-loss',
      workerId: 'w1',
    })
    expect(refused).toMatchObject({ error: 'unknown-analyst' })
    expect(String((refused as { reason: string }).reason)).toContain('list_analysts')
    expect((await tool(sibling, 'list_analysts').handler({})) as { analysts: unknown[] }).toEqual({
      analysts: [{ id: 'failure-mode', description: 'Shipped lens.', area: 'failure' }],
    })
  })

  it('seeds the menu and the cap from lenses defined in a prior process', async () => {
    const prior = {
      definition: {
        ...definition(),
        id: 'from-prior-process',
      } as unknown as AuthoredAnalystDefinition,
      kind: {
        id: 'from-prior-process',
        description: 'Defined before the restart.',
        area: 'coordination',
      },
      digest: `sha256:${'a'.repeat(64)}`,
      definedAt: 1,
    } satisfies DefinedAnalystRecord
    const tb = manager(authoringRegistry().registry, {
      priorAnalystDefinitions: [prior],
      maxDefinedAnalysts: 2,
    })

    expect(
      (await tool(tb, 'list_analysts').handler({})) as { analysts: Array<{ id: string }> },
    ).toMatchObject({
      analysts: [{ id: 'failure-mode' }, { id: 'from-prior-process' }],
    })
    // Re-defining it is a duplicate, not a silent second registration.
    expect(await define(tb, definition({ id: 'from-prior-process' }))).toMatchObject({
      error: 'duplicate-analyst',
    })
    // And it counts against the cap: one prior + one new fills a cap of two.
    expect((await define(tb, definition())).analyst).toBeDefined()
    expect(await define(tb, definition({ id: 'third' }))).toMatchObject({
      error: 'max-defined-analysts',
    })
  })

  it('refuses an unknown key inside limits instead of dropping it', () => {
    const parsed = parseAuthoredAnalystDefinition({
      ...definition(),
      limits: { maxLlmCalls: 4, prepareContext: 'return store.getOverview()' },
    })
    expect('issues' in parsed).toBe(true)
    if (!('issues' in parsed)) throw new Error('expected issues')
    expect(parsed.issues.map((issue) => issue.path)).toEqual(['limits.prepareContext'])
  })

  it('the model seat reaches the registry verbatim, and is optional', async () => {
    const { registry, registered } = authoringRegistry()
    const tb = manager(registry)
    await define(tb, definition({ id: 'seated', model: 'anthropic/claude-opus-4' }))
    await define(tb, definition({ id: 'default-seat' }))
    expect(registered[0]?.model).toBe('anthropic/claude-opus-4')
    expect(registered[1]?.model).toBeUndefined()
  })
})
