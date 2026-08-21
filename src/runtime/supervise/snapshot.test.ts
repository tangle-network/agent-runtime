import { describe, expect, it } from 'vitest'
import { detachedFrozen, detachedSnapshot } from './snapshot'

describe('detaching an untrusted value at a decision boundary', () => {
  it('freezes a nested payload without mutating the caller', () => {
    const input = { task: { goal: 'ship' }, tags: ['a'] }
    const frozen = detachedSnapshot(input, 'test')
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.task)).toBe(true)
    input.task.goal = 'changed'
    expect(frozen.task.goal).toBe('ship')
  })

  it('carries binary through instead of throwing on it', () => {
    // `Object.freeze` rejects any non-empty TypedArray or Buffer with
    // `TypeError: Cannot freeze array buffer views with elements`, so a payload carrying bytes
    // took down the boundary that was supposed to protect it. The clone has already detached
    // those bytes from the caller, which is what this boundary is for.
    const payload = { name: 'w', blob: Buffer.from('hello'), counts: new Uint8Array([1, 2, 3]) }
    const frozen = detachedFrozen(payload)
    expect(Object.isFrozen(frozen)).toBe(true)
    // structuredClone yields a Uint8Array for a Buffer; the bytes are what matter here.
    expect(Buffer.from(frozen.blob).toString('utf8')).toBe('hello')
    expect([...frozen.counts]).toEqual([1, 2, 3])
    payload.counts[0] = 99
    expect(frozen.counts[0]).toBe(1)
  })

  it('refuses a value that cannot be structured-cloned, naming its context', () => {
    expect(() => detachedSnapshot({ fn: () => 1 }, 'spawn profile')).toThrow(
      /spawn profile: input must be structured-cloneable/,
    )
  })
})
