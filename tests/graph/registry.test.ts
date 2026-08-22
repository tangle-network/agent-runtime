/**
 * `Registry<T>` — the one name→thing shape for the graph engine (agent-runtime#978).
 *
 * Three properties distinguish it from the fourteen predecessors, and each is pinned here so a
 * regression on any one reads as a failure, not a style change: names are enumerable; a miss is
 * refused BY NAME and lists what is registered; every registry is per-instance.
 */

import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/errors'
import {
  createRegistry,
  formatRegistryHandle,
  parseRegistryHandle,
  type Registered,
} from '../../src/runtime/graph/registry'

interface Kind extends Registered {
  readonly note: string
}
const kind = (id: string, version: number, note = id): Kind => ({ id, version, note })

describe('Registry<T>', () => {
  it('is enumerable: names() lists every registered handle, sorted, as wire spellings', () => {
    const r = createRegistry<Kind>('kinds', [kind('script', 1), kind('agent', 2), kind('agent', 1)])
    expect(r.names()).toEqual(['agent/v1', 'agent/v2', 'script/v1'])
    expect(r.entries().map((e) => e.note)).toEqual(['agent', 'agent', 'script'])
  })

  it('refuses a miss BY NAME and lists what is registered — the message alone diagnoses it', () => {
    const r = createRegistry<Kind>('kinds', [kind('agent', 1), kind('script', 1)])
    expect(() => r.require({ id: 'judge', version: 1 })).toThrow(ValidationError)
    expect(() => r.require({ id: 'judge', version: 1 })).toThrow(
      /kinds: "judge\/v1" is not registered; registered: agent\/v1, script\/v1/,
    )
    // An empty registry says so instead of listing nothing.
    expect(() => createRegistry<Kind>('kinds').require({ id: 'agent', version: 1 })).toThrow(
      /nothing is registered/,
    )
    // A caller context replaces the label so the refusal names WHO asked.
    expect(() => r.require({ id: 'judge', version: 1 }, 'compile node "n3"')).toThrow(
      /^compile node "n3": /,
    )
  })

  it('an exact version is required — a newer registered version never serves an older handle', () => {
    const r = createRegistry<Kind>('kinds', [kind('agent', 2)])
    expect(r.has({ id: 'agent', version: 2 })).toBe(true)
    expect(r.has({ id: 'agent', version: 1 })).toBe(false)
    expect(r.get({ id: 'agent', version: 1 })).toBeUndefined()
    expect(() => r.require({ id: 'agent', version: 1 })).toThrow(/"agent\/v1" is not registered/)
  })

  it('refuses a duplicate handle unless replace is explicit — shadowing is never silent', () => {
    const r = createRegistry<Kind>('kinds', [kind('agent', 1, 'first')])
    expect(() => r.register(kind('agent', 1, 'second'))).toThrow(
      /"agent\/v1" is already registered/,
    )
    expect(r.require({ id: 'agent', version: 1 }).note).toBe('first')
    r.register(kind('agent', 1, 'second'), { replace: true })
    expect(r.require({ id: 'agent', version: 1 }).note).toBe('second')
  })

  it('refuses an entry with no id or a non-positive version at registration, not at use', () => {
    const r = createRegistry<Kind>('kinds')
    expect(() => r.register({ id: '', version: 1, note: 'x' })).toThrow(/non-empty id/)
    expect(() => r.register({ id: 'agent', version: 0, note: 'x' })).toThrow(
      /positive integer version/,
    )
    expect(() => r.register({ id: 'agent', version: 1.5, note: 'x' })).toThrow(
      /positive integer version/,
    )
    expect(r.names()).toEqual([])
  })

  it('is per-instance: two registries in one process never see each other', () => {
    const a = createRegistry<Kind>('a', [kind('agent', 1)])
    const b = createRegistry<Kind>('b', [kind('script', 1)])
    expect(a.names()).toEqual(['agent/v1'])
    expect(b.names()).toEqual(['script/v1'])
    a.register(kind('judge', 1))
    expect(b.has({ id: 'judge', version: 1 })).toBe(false)
  })

  it('handle spelling round-trips and refuses anything that is not <id>/v<n>', () => {
    expect(formatRegistryHandle({ id: 'integration.invoke', version: 3 })).toBe(
      'integration.invoke/v3',
    )
    expect(parseRegistryHandle('integration.invoke/v3', 't')).toEqual({
      id: 'integration.invoke',
      version: 3,
    })
    for (const bad of [
      'agent',
      'agent/v',
      'agent/v0',
      'agent/1',
      '/v1',
      'agent/v1/extra',
      'agent v1',
    ]) {
      expect(() => parseRegistryHandle(bad, 't')).toThrow(ValidationError)
    }
  })
})
