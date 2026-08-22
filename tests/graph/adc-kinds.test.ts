/**
 * The generality proof, exercised: agent-dev-container's `integration.invoke` and `notify` as host
 * kinds, registered beside the core kinds, narrowed to their own effect, and run through a real
 * kernel Scope. `generality.test.ts` proves the engine source never names them.
 */
import { describe, expect, it, vi } from 'vitest'
import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import {
  agentKind,
  createGraphEngine,
  narrowEffects,
  scriptKind,
  subgraphKind,
  supervisorKind,
} from '../../src/runtime/graph'
import {
  type FakeIntegrations,
  type FakeNotifier,
  integrationInvokeKind,
  notifyKind,
} from './fixtures/adc-kinds'
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

function fakeHost() {
  const integrations: FakeIntegrations = { invoke: vi.fn(async () => ({ rows: 3 })) }
  const notifier: FakeNotifier = { send: vi.fn(async () => undefined) }
  return { integrations, notifier }
}

describe('ADC host kinds beside the core kinds', () => {
  it('register in the same registry, and the engine names what the host still owes', () => {
    const owing = createGraphEngine({
      coreKinds: core(),
      kinds: [integrationInvokeKind(), notifyKind()],
      effects: {},
    })
    expect(owing.kinds.names()).toEqual(
      expect.arrayContaining(['agent/v1', 'integration.invoke/v1', 'notify/v1', 'script/v1']),
    )
    expect(owing.missingEffects()).toEqual(['integrations', 'notifier'])

    const paid = createGraphEngine({
      coreKinds: core(),
      kinds: [integrationInvokeKind(), notifyKind()],
      effects: fakeHost(),
    })
    expect(paid.missingEffects()).toEqual([])
  })

  it('each host kind sees exactly its own effect — notify cannot reach integrations', () => {
    const host = fakeHost()
    const forNotify = narrowEffects(notifyKind().effects, host, 'notify')
    expect(Object.keys(forNotify)).toEqual(['notifier'])
    expect((forNotify as Record<string, unknown>).integrations).toBeUndefined()
    const forInvoke = narrowEffects(integrationInvokeKind().effects, host, 'invoke')
    expect(Object.keys(forInvoke)).toEqual(['integrations'])
  })

  it('integration.invoke runs through a REAL Scope: the connector is called, the result settles, nothing is spent', async () => {
    const host = fakeHost()
    const kind = integrationInvokeKind()
    const config = kind.validateConfig({ connector: 'github', operation: 'listIssues' }, 'n1')
    const { pool, scope } = await scopeHost()
    const before = pool.readout()
    const spawned = scope.spawn(
      kind.run({
        config,
        profile: { name: 'n1' },
        inputs: { args: { repo: 'agent-runtime' } },
        effects: narrowEffects(kind.effects, host, 'n1'),
      }),
      'x',
      { label: 'n1', budget: { maxIterations: 1, maxTokens: 1_000 } },
    )
    expect(spawned.ok).toBe(true)
    const settled = await scope.next()
    expect(settled?.kind).toBe('done')
    if (settled?.kind !== 'done') return
    expect(settled.out).toEqual({ rows: 3 })
    expect(host.integrations.invoke).toHaveBeenCalledWith('github', 'listIssues', {
      repo: 'agent-runtime',
    })
    expect(pool.readout()).toEqual(before)
    expect(spawned.ok && spawned.handle.identity?.correlation).toEqual({
      nodeKind: 'integration.invoke/v1',
    })
  })

  it('notify runs through a REAL Scope: the rendered message is sent on the channel', async () => {
    const host = fakeHost()
    const kind = notifyKind()
    const config = kind.validateConfig({ channel: '#ops', template: 'run: {message}' }, 'n2')
    const { scope } = await scopeHost()
    const spawned = scope.spawn(
      kind.run({
        config,
        profile: { name: 'n2' },
        inputs: { message: 'green' },
        effects: narrowEffects(kind.effects, host, 'n2'),
      }),
      'x',
      { label: 'n2', budget: { maxIterations: 1, maxTokens: 1_000 } },
    )
    expect(spawned.ok).toBe(true)
    const settled = await scope.next()
    expect(settled?.kind).toBe('done')
    if (settled?.kind !== 'done') return
    expect(settled.out).toEqual({ sent: true, channel: '#ops' })
    expect(host.notifier.send).toHaveBeenCalledWith('#ops', 'run: green')
  })

  it('a host kind refuses a bad config by name, like a core kind', () => {
    expect(() => notifyKind().validateConfig({ channel: '#ops' }, 'n2')).toThrow(
      /n2: template must be a non-empty string/,
    )
    expect(() => integrationInvokeKind().validateConfig('nope', 'n1')).toThrow(
      /n1: config must be an object/,
    )
  })
})
