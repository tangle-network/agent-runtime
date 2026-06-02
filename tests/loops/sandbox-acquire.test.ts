import type { CreateSandboxOptions, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { acquireSandbox } from '../../src/loops'

// Deterministic clock: time only advances when the code sleeps.
function clock() {
  let t = 0
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
  }
}

function box(
  over: Partial<{ id: string; name: string; status: string; error: string }> & {
    refresh?: () => Promise<void>
  },
): SandboxInstance {
  return { id: 'sbx', name: 'n', ...over } as unknown as SandboxInstance
}

const OPTS: CreateSandboxOptions = {
  name: 'sbx-1',
  environment: 'universal',
} as CreateSandboxOptions

describe('acquireSandbox — cold-start resilience', () => {
  it('returns immediately when create yields a statusless instance (fake-compat)', async () => {
    const b = box({ name: 'sbx-1' })
    const got = await acquireSandbox({ create: async () => b }, OPTS, clock())
    expect(got).toBe(b)
  })

  it('waits through provisioning until running via refresh()', async () => {
    let status = 'provisioning'
    const b = box({
      name: 'sbx-1',
      status,
      refresh: async () => {
        status = 'running'
      },
    })
    Object.defineProperty(b, 'status', { get: () => status })
    const got = await acquireSandbox({ create: async () => b }, OPTS, clock())
    expect((got as unknown as { status: string }).status).toBe('running')
  })

  it('RECOVERS a gateway-timed-out create by finding the named sandbox (the 522 case)', async () => {
    let createCalls = 0
    const ready = box({ id: 'sbx-9', name: 'sbx-1', status: 'running' })
    const client = {
      create: async () => {
        createCalls += 1
        throw Object.assign(new Error('Failed to create sandbox'), {
          name: 'ServerError',
          status: 522,
        })
      },
      list: async () => [box({ id: 'other', name: 'zzz', status: 'running' }), ready],
    }
    const got = await acquireSandbox(client, OPTS, clock())
    expect(createCalls).toBe(1) // did NOT blindly retry create
    expect(got).toBe(ready) // attached the provisioning sandbox by name
  })

  it('fails loud on a non-retryable error (auth) — no polling', async () => {
    let listed = false
    const client = {
      create: async () => {
        throw Object.assign(new Error('unauthorized'), { name: 'AuthError', status: 401 })
      },
      list: async () => {
        listed = true
        return []
      },
    }
    await expect(acquireSandbox(client, OPTS, clock())).rejects.toThrow(/unauthorized/)
    expect(listed).toBe(false)
  })

  it('throws when the sandbox reaches a terminal status', async () => {
    const b = box({ name: 'sbx-1', status: 'failed', error: 'boom' })
    await expect(acquireSandbox({ create: async () => b }, OPTS, clock())).rejects.toThrow(
      /failed.*boom/,
    )
  })

  it('retries create on gateway failure and times out loud if no host ever comes up', async () => {
    let creates = 0
    const client = {
      create: async () => {
        creates += 1
        throw Object.assign(new Error('522 gateway'), { status: 522 })
      },
      list: async () => [], // orchestrator rolled back — nothing to attach to
    }
    await expect(
      acquireSandbox(client, OPTS, { ...clock(), readyTimeoutMs: 10_000, pollIntervalMs: 3000 }),
    ).rejects.toThrow(/could not acquire a running sandbox "sbx-1"/)
    expect(creates).toBeGreaterThan(1) // retried create, not a single wait-then-fail
  })

  it('honors an aborted signal', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      acquireSandbox({ create: async () => box({ name: 'sbx-1' }) }, OPTS, {
        ...clock(),
        signal: ctrl.signal,
      }),
    ).rejects.toThrow(/aborted/)
  })

  it('tears down a created box that never reaches running on abort (no leak)', async () => {
    // Regression: an abort firing while waiting for `running` must delete the
    // already-created box, or the loop leaks a live sandbox per aborted acquire.
    const ctrl = new AbortController()
    let deleted = false
    let polls = 0
    const provisioning = box({
      id: 'sbx-9',
      name: 'sbx-1',
      status: 'provisioning',
      refresh: async () => {},
    })
    Object.defineProperty(provisioning, 'status', { get: () => 'provisioning' })
    ;(provisioning as unknown as { delete: () => Promise<void> }).delete = async () => {
      deleted = true
    }
    const c = clock()
    await expect(
      acquireSandbox({ create: async () => provisioning }, OPTS, {
        ...c,
        signal: ctrl.signal,
        // Abort mid-wait: the second poll throwIfAborted must tear the box down.
        sleep: async (ms: number) => {
          polls += 1
          if (polls === 1) ctrl.abort()
          await c.sleep(ms)
        },
      }),
    ).rejects.toThrow(/aborted/)
    expect(deleted).toBe(true)
  })

  it('tears down a list()-recovered box that never reaches running on abort (no leak)', async () => {
    const ctrl = new AbortController()
    let deleted = false
    const recovered = box({ id: 'sbx-r', name: 'sbx-1', status: 'provisioning' })
    Object.defineProperty(recovered, 'status', { get: () => 'provisioning' })
    ;(
      recovered as unknown as { delete: () => Promise<void>; refresh: () => Promise<void> }
    ).delete = async () => {
      deleted = true
    }
    ;(recovered as unknown as { refresh: () => Promise<void> }).refresh = async () => {}
    const c = clock()
    let polls = 0
    const client = {
      create: async () => {
        throw Object.assign(new Error('522 gateway'), { status: 522 })
      },
      list: async () => [recovered],
    }
    await expect(
      acquireSandbox(client, OPTS, {
        ...c,
        signal: ctrl.signal,
        sleep: async (ms: number) => {
          polls += 1
          if (polls === 1) ctrl.abort()
          await c.sleep(ms)
        },
      }),
    ).rejects.toThrow(/aborted/)
    expect(deleted).toBe(true)
  })
})
