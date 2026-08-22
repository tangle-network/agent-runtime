/**
 * `NodeKind` — the extension contract (agent-runtime#969, #970).
 *
 * What is pinned: a malformed kind is refused by name at registration, not at the first node that
 * uses it; the implicit `out`/`trace` ports cannot be declared; effects are narrowed to the
 * declaration so an undeclared capability is absent, never a service locator; and the
 * `Registry<NodeKind>` composition addresses a kind by its exact versioned handle.
 */

import { describe, expect, it } from 'vitest'
import {
  createRegistry,
  kindHandle,
  type NodeKind,
  narrowEffects,
  validateNodeKind,
} from '../../src/runtime/graph'
import type { Executor } from '../../src/runtime/supervise/types'

const stubExecutor = (): Executor<unknown> =>
  ({
    runtime: 'router',
    async execute() {
      return {
        outRef: 'sha256:stub',
        out: null,
        spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
      }
    },
    async cancel() {
      return { status: 'cancelled' } as never
    },
    async teardown() {
      return { destroyed: true }
    },
    resultArtifact() {
      return {
        outRef: 'sha256:stub',
        out: null,
        spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
      }
    },
  }) as unknown as Executor<unknown>

const baseKind = (over: Partial<NodeKind> = {}): NodeKind => ({
  id: 'script',
  version: 1,
  description: 'Run caller code',
  validateConfig: (raw) => raw,
  configSchema: { type: 'object' },
  inputs: [],
  outputs: [],
  effects: [],
  onCrash: 'restart',
  budget: 'metered',
  run: () => stubExecutor(),
  ...over,
})

describe('NodeKind validation — refused by name at registration', () => {
  it('accepts a well-formed kind and returns it unchanged', () => {
    const kind = baseKind()
    expect(validateNodeKind(kind)).toBe(kind)
  })

  it('refuses a missing id, a bad id, a bad version, a missing description', () => {
    expect(() => validateNodeKind(baseKind({ id: '' }))).toThrow(/non-empty id/)
    expect(() => validateNodeKind(baseKind({ id: 'has space' }))).toThrow(/id may contain only/)
    expect(() => validateNodeKind(baseKind({ version: 0 }))).toThrow(/positive integer/)
    expect(() => validateNodeKind(baseKind({ description: '  ' }))).toThrow(
      /description is required/,
    )
  })

  it('refuses declaring the implicit out/trace output ports — they exist on every node', () => {
    expect(() =>
      validateNodeKind(baseKind({ outputs: [{ name: 'out', schema: { type: 'string' } }] })),
    ).toThrow(/"out" is implicit on every node/)
    expect(() =>
      validateNodeKind(baseKind({ outputs: [{ name: 'trace', schema: { type: 'string' } }] })),
    ).toThrow(/"trace" is implicit on every node/)
  })

  it('refuses duplicate ports, ports without a schema, and repeated effect names', () => {
    expect(() =>
      validateNodeKind(
        baseKind({
          inputs: [
            { name: 'a', schema: { type: 'string' } },
            { name: 'a', schema: { type: 'number' } },
          ],
        }),
      ),
    ).toThrow(/duplicate inputs port "a"/)
    expect(() =>
      validateNodeKind(baseKind({ inputs: [{ name: 'a', schema: 'nope' as never }] })),
    ).toThrow(/needs a JSON Schema/)
    expect(() => validateNodeKind(baseKind({ effects: ['hub', 'hub'] }))).toThrow(/must not repeat/)
  })

  it('refuses an unknown onCrash or budget mode — the two fields replay and the pool key on', () => {
    expect(() => validateNodeKind(baseKind({ onCrash: 'retry' as never }))).toThrow(
      /onCrash must be/,
    )
    expect(() => validateNodeKind(baseKind({ budget: 'free' as never }))).toThrow(/budget must be/)
  })

  it('names the kind handle and the context in every refusal', () => {
    expect(() =>
      validateNodeKind(baseKind({ onCrash: 'x' as never }), 'createGraphEngine'),
    ).toThrow(/^createGraphEngine: kind "script\/v1": /)
  })
})

describe('effects are narrowed to the declaration', () => {
  it('hands a kind exactly what it declared, frozen; nothing else is reachable', () => {
    const ctx = narrowEffects(['hub', 'notify'] as const, { hub: 'H', notify: 'N', d1: 'D' }, 't')
    expect(ctx).toEqual({ hub: 'H', notify: 'N' })
    expect((ctx as Record<string, unknown>).d1).toBeUndefined()
    expect(Object.isFrozen(ctx)).toBe(true)
  })

  it('refuses BEFORE the node runs when the host lacks a declared effect, listing what the host has', () => {
    expect(() =>
      narrowEffects(['hub', 'sandbox'] as const, { hub: 'H', d1: 'D' }, 'node "n1"'),
    ).toThrow(/node "n1": host provides no effect for "sandbox"; provided: d1, hub/)
    expect(() => narrowEffects(['hub'] as const, {}, 'n')).toThrow(/provided: none/)
  })

  it('a kind with no effects gets an empty context regardless of what the host has', () => {
    expect(narrowEffects([] as const, { hub: 'H' }, 't')).toEqual({})
  })
})

describe('Registry<NodeKind> — kinds addressed by exact versioned handle', () => {
  it('registers the four core kinds and refuses an unknown or wrong-version handle by name', () => {
    const kinds = createRegistry<NodeKind>(
      'kinds',
      ['agent', 'supervisor', 'subgraph', 'script'].map((id) => baseKind({ id })),
    )
    expect(kinds.names()).toEqual(['agent/v1', 'script/v1', 'subgraph/v1', 'supervisor/v1'])
    expect(kinds.require(kindHandle({ id: 'script', version: 1 })).id).toBe('script')
    expect(() => kinds.require({ id: 'integration.invoke', version: 1 })).toThrow(
      /"integration.invoke\/v1" is not registered; registered: agent\/v1, script\/v1, subgraph\/v1, supervisor\/v1/,
    )
    expect(() => kinds.require({ id: 'script', version: 2 })).toThrow(
      /"script\/v2" is not registered/,
    )
  })

  it('a host-registered kind sits beside the core ones in the SAME registry — no tier, only location', () => {
    const kinds = createRegistry<NodeKind>('kinds', [baseKind({ id: 'agent' })])
    kinds.register(baseKind({ id: 'integration.invoke', effects: ['hub'] }))
    expect(kinds.names()).toEqual(['agent/v1', 'integration.invoke/v1'])
    expect(kinds.require({ id: 'integration.invoke', version: 1 }).effects).toEqual(['hub'])
  })
})
