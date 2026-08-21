import { describe, expect, it } from 'vitest'
import { abortError, linkAbort } from './abortable'

/**
 * A cascaded abort must carry the upstream reason. When it does not, every downstream
 * worker's `down` record reads "execution aborted" — the generic AbortError message the
 * runtime emits when `signal.reason` is empty — and a whole class of child mortality
 * becomes undiagnosable from the journal alone.
 *
 * These tests run against `linkAbort`, the cascade every executor composes, so the contract
 * is pinned on the shipped path rather than on a copy of it.
 */
const link = (a: AbortSignal, b: AbortSignal): AbortSignal => linkAbort(a, b).signal

describe('cascaded abort reasons', () => {
  it('forwards a string reason from whichever signal fired', () => {
    const parent = new AbortController()
    const scope = new AbortController()
    const linked = link(parent.signal, scope.signal)
    parent.abort('root driver failed; child settle grace expired')
    expect(linked.aborted).toBe(true)
    expect(linked.reason).toBe('root driver failed; child settle grace expired')
  })

  it('forwards the reason when the OTHER signal fires', () => {
    const parent = new AbortController()
    const scope = new AbortController()
    const linked = link(parent.signal, scope.signal)
    scope.abort('budget exhausted')
    expect(linked.reason).toBe('budget exhausted')
  })

  it('forwards a reason that was already set before linking', () => {
    const parent = new AbortController()
    parent.abort('executor torn down')
    const linked = link(parent.signal, new AbortController().signal)
    expect(linked.reason).toBe('executor torn down')
  })

  it('unwraps an Error reason to its message rather than dropping it', () => {
    const parent = new AbortController()
    parent.abort(new Error('bridge stream error: pi exit 1'))
    const linked = link(parent.signal, new AbortController().signal)
    expect(linked.reason).toBe('bridge stream error: pi exit 1')
  })

  it('names the fallback instead of leaving the reason empty', () => {
    // A bare abort() sets a DOMException whose message is the platform placeholder
    // ("This operation was aborted") — no more diagnostic than the generic death it
    // replaces, so the helper must treat it as reasonless and name the scope instead.
    const parent = new AbortController()
    const linked = link(parent.signal, new AbortController().signal)
    parent.abort()
    expect(linked.reason).toBe('aborted by parent scope')
    expect(String(linked.reason)).not.toBe('execution aborted')
  })

  it('carries the upstream reason into the AbortError a worker settles with', () => {
    // The end of the chain: the cascade feeds `abortError`, whose message becomes the `down`
    // record. A dropped reason surfaced here as the caller's fallback, naming no cause.
    const parent = new AbortController()
    const linked = link(parent.signal, new AbortController().signal)
    parent.abort('pool starved before the child could start')
    expect(abortError(linked, 'execution aborted').message).toBe(
      'pool starved before the child could start',
    )
  })

  it('stops listening to its sources once released', () => {
    // A link whose sources outlive it (a long-lived executor context signal) must be able to
    // detach, or every turn leaks a listener onto the same signal.
    const parent = new AbortController()
    const linked = linkAbort(parent.signal)
    linked.release()
    parent.abort('too late')
    expect(linked.signal.aborted).toBe(false)
  })
})
