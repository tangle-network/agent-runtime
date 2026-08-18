import { describe, expect, it } from 'vitest'
import { abortError, runAbortable } from './abortable'

const settle = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()))

describe('abortError', () => {
  it('carries the signal string reason', () => {
    const controller = new AbortController()
    controller.abort('root cancelled the branch')
    const error = abortError(controller.signal, 'supervisor aborted')
    expect(error.name).toBe('AbortError')
    expect(error.message).toBe('root cancelled the branch')
  })

  it('falls back when the reason is absent, empty, or not a string', () => {
    const noReason = new AbortController()
    noReason.abort()
    expect(abortError(noReason.signal, 'supervisor aborted').message).toBe('supervisor aborted')

    const empty = new AbortController()
    empty.abort('')
    expect(abortError(empty.signal, 'driver aborted').message).toBe('driver aborted')

    const object = new AbortController()
    object.abort({ why: 'budget' })
    expect(abortError(object.signal, 'execution aborted').message).toBe('execution aborted')
  })
})

describe('runAbortable', () => {
  it('refuses an already-aborted signal without invoking the action', async () => {
    const controller = new AbortController()
    controller.abort('already gone')
    let invoked = false
    await expect(
      runAbortable(
        async () => {
          invoked = true
          return 'value'
        },
        controller.signal,
        'supervisor aborted',
      ),
    ).rejects.toMatchObject({ name: 'AbortError', message: 'already gone' })
    expect(invoked).toBe(false)
  })

  it('returns the action value and removes the abort listener', async () => {
    const controller = new AbortController()
    await expect(
      runAbortable(async () => 42, controller.signal, 'supervisor aborted'),
    ).resolves.toBe(42)
    // A later abort must find no listener left to reject an already-settled promise.
    expect(() => controller.abort('late')).not.toThrow()
  })

  it('propagates the action rejection unchanged', async () => {
    const controller = new AbortController()
    const failure = new Error('provider refused')
    await expect(
      runAbortable(
        async () => {
          throw failure
        },
        controller.signal,
        'supervisor aborted',
      ),
    ).rejects.toBe(failure)
  })

  it('propagates a synchronous throw as the rejection, not as an abort', async () => {
    const controller = new AbortController()
    const failure = new Error('built the task wrong')
    await expect(
      runAbortable(
        (() => {
          throw failure
        }) as () => Promise<never>,
        controller.signal,
        'supervisor aborted',
      ),
    ).rejects.toBe(failure)
  })

  it('rejects with the abort once the signal fires first', async () => {
    const controller = new AbortController()
    const pending = runAbortable(
      () => new Promise<string>(() => undefined),
      controller.signal,
      'driver aborted',
    )
    controller.abort('budget exhausted')
    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      message: 'budget exhausted',
    })
  })

  it('lets a result the action already produced win a later abort', async () => {
    const controller = new AbortController()
    const pending = runAbortable(
      async () => 'terminal receipt',
      controller.signal,
      'driver aborted',
    )
    await settle()
    controller.abort('root stopped')
    await expect(pending).resolves.toBe('terminal receipt')
  })

  it('outranks an abort listener the action registers itself', async () => {
    // This function subscribes before it calls `act()`, so its own handler runs first.
    // A caller that needs the action to observe the abort must await a live promise instead.
    const controller = new AbortController()
    const pending = runAbortable(
      () =>
        new Promise<string>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve('terminal receipt'), {
            once: true,
          })
        }),
      controller.signal,
      'driver aborted',
    )
    const outcome = pending.then(
      (value) => value,
      (error: Error) => error,
    )
    controller.abort('root stopped')
    await expect(outcome).resolves.toMatchObject({ name: 'AbortError', message: 'root stopped' })
  })

  it('rejects an action that ignores the signal, and only once', async () => {
    const controller = new AbortController()
    let resolveWork: (value: string) => void = () => undefined
    const pending = runAbortable(
      () =>
        new Promise<string>((resolve) => {
          resolveWork = resolve
        }),
      controller.signal,
      'supervisor aborted',
    )
    // Attach the outcome handler before the abort so the rejection is never unobserved.
    const outcome = pending.then(
      () => 'resolved' as const,
      (error: Error) => error,
    )
    controller.abort('root stopped')
    await settle()
    // The abort already won; a later resolution must not overwrite it.
    resolveWork('too late')
    await expect(outcome).resolves.toMatchObject({ name: 'AbortError', message: 'root stopped' })
  })
})
