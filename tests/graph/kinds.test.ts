/**
 * The four core kinds + `createGraphEngine` (agent-runtime#970, #979).
 *
 * Pinned: each kind validates its config by name; the engine lists required/missing effects
 * BEFORE any run; a `script` node spawned through a REAL `supervise()` settles with a
 * content-addressed output and — when `pure` — is budget-exempt; a metered script that reports
 * nothing is recorded as unknown, never free; `subgraph` refuses by name until #980.
 */

import { describe, expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import {
  agentKind,
  createGraphEngine,
  type NodeKind,
  scriptKind,
  subgraphKind,
  supervisorKind,
} from '../../src/runtime/graph'
import { testAgentProfile } from '../kernel/test-agent-profile'
import { scopeHost } from './fixtures/scope-host'

const core = () => [
  agentKind({}),
  supervisorKind({
    blobs: new InMemoryResultBlobStore(),
    makeWorkerAgent: () => ({ name: 'x', act: async () => 1 }),
  }),
  scriptKind(),
  subgraphKind(),
]

describe('createGraphEngine', () => {
  it('pre-registers the four core kinds, adds host kinds beside them, and lists effects up front', () => {
    const hostKind: NodeKind = {
      id: 'integration.invoke',
      version: 1,
      description: 'Call a hub integration',
      validateConfig: (raw) => raw,
      configSchema: { type: 'object' },
      inputs: [],
      outputs: [],
      effects: ['hub', 'integrations'],
      onCrash: 'restart',
      budget: 'metered',
      run: () => ({ name: 'integration', act: async () => null }),
    }
    const engine = createGraphEngine({ coreKinds: core(), kinds: [hostKind], effects: { hub: {} } })
    expect(engine.kinds.names()).toEqual([
      'agent/v1',
      'integration.invoke/v1',
      'script/v1',
      'subgraph/v1',
      'supervisor/v1',
    ])
    // Listed before any token is spent — the property that lets a compiler refuse a host early.
    expect(engine.requiredEffects()).toEqual(['hub', 'integrations'])
    expect(engine.missingEffects()).toEqual(['integrations'])
  })

  it('refuses a malformed host kind by name at construction, not at the first node', () => {
    expect(() =>
      createGraphEngine({
        coreKinds: core(),
        kinds: [{ ...scriptKind(), id: 'notify', onCrash: 'whatever' as never }],
      }),
    ).toThrow(/createGraphEngine: kind "notify\/v1": onCrash must be/)
  })
})

describe('kind config validation names the node and the field', () => {
  it('agent refuses a non-object config; supervisor requires perWorker; script requires a function body', () => {
    expect(() => agentKind({}).validateConfig('nope', 'node "a"')).toThrow(
      /node "a": agent config must be an object/,
    )
    expect(() =>
      supervisorKind({
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () => ({ name: 'x', act: async () => 1 }),
      }).validateConfig({}, 'node "s"'),
    ).toThrow(/node "s": supervisor config.perWorker must be an object/)
    expect(() => scriptKind().validateConfig({ body: 'not fn' }, 'node "sc"')).toThrow(
      /script config.body must be a function/,
    )
    expect(() =>
      scriptKind().validateConfig({ body: () => 1, pure: true, spent: {} }, 'node "sc"'),
    ).toThrow(/a pure script is budget-exempt and cannot report spent/)
  })

  it('agent refuses to run with no backend anywhere, naming the node', () => {
    const kind = agentKind({})
    expect(() =>
      kind.run({ config: {}, profile: testAgentProfile('w'), inputs: {}, effects: {} }),
    ).toThrow(/agent kind: node "w" has no backend/)
  })

  it('subgraph registers and compiles but refuses to RUN by name until the scheduler lands', () => {
    const kind = subgraphKind()
    expect(kind.validateConfig({ graph: { nodes: [] } }, 'n')).toEqual({ graph: { nodes: [] } })
    expect(() =>
      kind.run({ config: { graph: {} }, profile: testAgentProfile('sg'), inputs: {}, effects: {} }),
    ).toThrow(/subgraph kind: node "sg" cannot run yet — the scheduler .* agent-runtime#980/)
  })
})

describe('script kind hosted by a REAL Scope — the kernel does the admission, journaling, settling', () => {
  // The scheduler (#980) hosts every node instance exactly like this: a Scope, a pool, a journal,
  // `spawn` of the kind's Agent, then `next()`. No supervisor sits in between, so no oracle verdict
  // is asked of a script: its output is its result.
  it('a pure script settles with a content-addressed output and returns its whole reservation to the pool', async () => {
    const kind = scriptKind()
    const script = kind.validateConfig(
      {
        body: (inputs: Record<string, unknown>) => ({ doubled: Number(inputs.n) * 2 }),
        pure: true,
      },
      't',
    )
    const { pool, scope } = await scopeHost()
    const before = pool.readout()
    const spawned = scope.spawn(
      kind.run({ config: script, profile: { name: 'double' }, inputs: { n: 21 }, effects: {} }),
      'x',
      { label: 'double', budget: { maxIterations: 1, maxTokens: 1_000 } },
    )
    expect(spawned.ok).toBe(true)
    const settled = await scope.next()
    expect(settled?.kind).toBe('done')
    if (settled?.kind !== 'done') return
    expect(settled.out).toEqual({ doubled: 42 })
    expect(settled.outRef).toBe(contentAddress({ doubled: 42 }))
    expect(settled.spent.tokens).toEqual({ input: 0, output: 0 })
    // Exempt by construction: the pool reads exactly as it did before the spawn.
    expect(pool.readout()).toEqual(before)
  })

  it('a metered script that reports nothing is recorded as UNKNOWN, never as free', async () => {
    const kind = scriptKind()
    const script = kind.validateConfig({ body: () => 'side-effect' }, 't')
    const { scope } = await scopeHost()
    const spawned = scope.spawn(
      kind.run({ config: script, profile: { name: 'effectful' }, inputs: {}, effects: {} }),
      'x',
      { label: 'effectful', budget: { maxIterations: 1, maxTokens: 1_000 } },
    )
    expect(spawned.ok).toBe(true)
    const settled = await scope.next()
    expect(settled?.kind).toBe('done')
    if (settled?.kind !== 'done') return
    expect(settled.out).toBe('side-effect')
    expect(settled.spent).toMatchObject({ tokensKnown: false, usdKnown: false })
  })

  it('a metered kind whose executor settles without a Spend is an engine error: down by name, pool sealed unknown', async () => {
    // A host kind that forgets to report. The kernel refuses the artifact before it can replace the
    // live spend, so the node goes down with the contract named, the reservation is released, and
    // the pool is sealed unknown — never a silent free node, never a leaked reservation.
    const forgetful: NodeKind = {
      id: 'forgetful',
      version: 1,
      description: 'metered, reports nothing',
      validateConfig: () => ({}),
      configSchema: { type: 'object' },
      inputs: [],
      outputs: [],
      effects: [],
      onCrash: 'restart',
      budget: 'metered',
      run: ({ profile }) =>
        ({
          name: profile.name ?? 'forgetful',
          act: async () => 'x',
          executorSpec: {
            profile,
            harness: null,
            executor: {
              runtime: 'inline',
              execute: async () => ({ outRef: 'x', out: 'x' }),
              teardown: async () => ({ destroyed: true }),
              resultArtifact: () => ({ outRef: 'x', out: 'x' }),
            },
          },
        }) as never,
    }
    createGraphEngine({ coreKinds: core(), kinds: [forgetful] })
    const { pool, scope } = await scopeHost()
    const before = pool.readout()
    const spawned = scope.spawn(
      forgetful.run({ config: {}, profile: { name: 'f' }, inputs: {}, effects: {} }),
      'x',
      { label: 'f', budget: { maxIterations: 1, maxTokens: 1_000 } },
    )
    expect(spawned.ok).toBe(true)
    const settled = await scope.next()
    expect(settled?.kind).toBe('down')
    if (settled?.kind !== 'down') return
    expect(settled.reason).toMatch(/executor settled without a Spend/)
    // The reservation is released and nothing is charged, but the pool is sealed UNKNOWN: the
    // unreported remainder is never reinterpreted as zero.
    expect(pool.readout()).toEqual({ ...before, tokensKnown: false, usdKnown: false })
  })

  it('the script spec names the kind in its node identity and claims no harness or model', () => {
    const kind = scriptKind()
    const script = kind.validateConfig({ body: () => 1, pure: true }, 't')
    const agent = kind.run({ config: script, profile: { name: 'n' }, inputs: {}, effects: {} }) as {
      executorSpec: { profile: unknown; harness: unknown; execution?: { correlation?: unknown } }
    }
    expect(agent.executorSpec.profile).toEqual({ name: 'n' })
    expect(agent.executorSpec.harness).toBeNull()
    expect(agent.executorSpec.execution?.correlation).toEqual({ nodeKind: 'script/v1' })
  })
})
