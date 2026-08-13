import { describe, expect, it } from 'vitest'

/**
 * A cascaded abort must carry the upstream reason. When it does not, every downstream
 * worker's `down` record reads "execution aborted" — the generic AbortError message the
 * runtime emits when `signal.reason` is empty — and a whole class of child mortality
 * becomes undiagnosable from the journal alone.
 *
 * These tests pin the CONTRACT at the level any linking helper must satisfy, using the same
 * shape the runtime's `linkSignals` / `mergeAbortSignals` / sandbox cascade implement.
 */

/** The shape under test: link two signals so either firing aborts the result WITH its reason. */
function link(a: AbortSignal, b: AbortSignal): AbortSignal {
  const reasonOf = (signal: AbortSignal): unknown => {
    const reason = signal.reason
    if (typeof reason === 'string' && reason.length > 0) return reason
    if (reason instanceof Error && reason.name !== 'AbortError' && reason.message.length > 0) {
      return reason.message
    }
    return 'aborted by parent scope'
  }
  const c = new AbortController()
  if (a.aborted || b.aborted) c.abort(reasonOf(a.aborted ? a : b))
  else {
    a.addEventListener('abort', () => c.abort(reasonOf(a)), { once: true })
    b.addEventListener('abort', () => c.abort(reasonOf(b)), { once: true })
  }
  return c.signal
}

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
})
