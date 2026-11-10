import type {
  WorkspaceCheckpointLookupResult,
  WorkspaceCheckpointRef,
  WorkspaceCheckpointRequest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore } from '../../src/durable/in-memory-spawn-stores'
import {
  bindScopeRetainedOwnerProvider,
  noteScopeRetainedOwnerCoordination,
  registerScopeRetainedOwner,
  releaseScopeRetainedOwnerEnvironment,
  scopeRetainedOwnerCheckpointing,
  scopeRetainedOwnerContext,
} from '../../src/runtime/supervise/retained-scope-owner'
import type { Scope, SpawnEvent } from '../../src/runtime/supervise/types'
import { WORKSPACE_CHECKPOINT_ABSENT_AFTER_MS } from '../../src/runtime/supervise/workspace-checkpoint'
import { forbiddenCheckpointForks } from '../helpers/checkpoint-capture'

type Boundary = 'unknown-outcome' | 'late-after-cancel' | 'journal-append-failure'
type Lookup = 'found' | 'unknown' | 'not_found' | 'foreign'

function fixture(boundary: Boundary, initialLookup: Lookup = 'found') {
  const events: SpawnEvent[] = []
  const controller = new AbortController()
  const scope = { signal: controller.signal } as Scope<unknown>
  const source = {
    runId: 'intent-run',
    provider: 'intent-provider',
    environmentId: 'intent-source',
    sessionId: 'intent-session',
    executionId: 'intent-execution',
    requestDigest: `sha256:${'a'.repeat(64)}` as const,
  }
  let request: WorkspaceCheckpointRequest | undefined
  let checkpoint: WorkspaceCheckpointRef | undefined
  const files = new Map<string, string>()
  let live = true
  let deletes = 0
  let destroys = 0
  let durableBeforeEffect = false
  let failAppend = boundary === 'journal-append-failure'
  let lookup = initialLookup
  let cleanupUnknown = false
  let cleanupThrow: string | undefined
  let stopOnAbort = false
  let clock = 0
  let lateResult: (() => void) | undefined
  let checkpointStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    checkpointStarted = resolve
  })
  const environment: AgentEnvironment = {
    id: source.environmentId,
    provider: source.provider,
    status: async () => 'running',
    async *stream() {},
    write: async (path, content) => {
      files.set(path, String(content))
    },
    destroy: async () => {
      destroys += 1
      live = false
    },
    workspaceBranching: {
      checkpoint: async (input) => {
        request = input
        durableBeforeEffect = events.some(
          (event) => event.kind === 'workspace-checkpoint-requested',
        )
        checkpoint = {
          checkpointId: 'intent-snapshot',
          provider: source.provider,
          source,
          idempotencyKey: input.idempotencyKey,
          requestDigest: input.requestDigest,
          createdAt: new Date(0).toISOString(),
        }
        checkpointStarted!()
        if (boundary === 'late-after-cancel') {
          await new Promise<void>((resolve) => {
            lateResult = resolve
          })
        }
        if (boundary === 'unknown-outcome') {
          return {
            status: 'unknown',
            idempotencyKey: input.idempotencyKey,
            requestDigest: input.requestDigest,
            message: 'snapshot exists, but its create acknowledgement was lost',
            retryable: true,
          }
        }
        return {
          status: 'created',
          idempotencyKey: input.idempotencyKey,
          requestDigest: input.requestDigest,
          checkpoint,
        }
      },
      lookupCheckpoint: async (input): Promise<WorkspaceCheckpointLookupResult> => {
        expect(input).toEqual({
          idempotencyKey: request!.idempotencyKey,
          requestDigest: request!.requestDigest,
        })
        if (lookup === 'unknown') {
          return { ...input, status: 'unknown', message: 'inventory unavailable', retryable: true }
        }
        if (lookup === 'not_found') return { ...input, status: 'not_found' }
        if (!checkpoint) throw new Error('snapshot was deleted before lookup')
        return {
          ...input,
          status: 'found',
          checkpoint:
            lookup === 'foreign'
              ? { ...checkpoint, source: { ...source, environmentId: 'foreign-source' } }
              : checkpoint,
        }
      },
      deleteCheckpoint: async (input, options?: { signal?: AbortSignal }) => {
        expect(['intent-snapshot', 'older-snapshot']).toContain(input.targetId)
        deletes += 1
        if (stopOnAbort && deletes === 1) {
          await new Promise<void>((resolve) => {
            const signal = options?.signal
            if (signal === undefined || signal.aborted) resolve()
            else signal.addEventListener('abort', () => resolve(), { once: true })
          })
          return { ...input, status: 'unknown', message: 'aborted', retryable: true }
        }
        if (cleanupThrow !== undefined) throw new Error(cleanupThrow)
        if (cleanupUnknown) {
          return { ...input, status: 'unknown', message: 'storage unavailable', retryable: true }
        }
        checkpoint = undefined
        return { ...input, status: 'deleted' }
      },
      ...forbiddenCheckpointForks,
    },
  }
  const provider: AgentEnvironmentProvider = {
    name: source.provider,
    capabilities: async () => ({ create: { workspaceCheckpoint: true } }),
    create: async () => {
      throw new Error('not used')
    },
    get: async (id) =>
      id === source.environmentId && live ? environment : null,
    workspaceBranching: {
      forEnvironment: async (id) => {
        expect(id).toBe(source.environmentId)
        return live ? environment.workspaceBranching! : null
      },
    },
  }
  const register = (ownerScope: Scope<unknown>) => {
    registerScopeRetainedOwner(ownerScope, {
      rootId: source.runId,
      nodeId: source.runId,
      priorEvents: [...events],
      now: () => clock,
      blobs: new InMemoryResultBlobStore(),
      journal: {
        beginTree: async () => {},
        loadTree: async () => [...events],
        appendEvent: async (_root, event) => {
          if (failAppend && event.kind === 'workspace-checkpoint') {
            failAppend = false
            throw new Error('journal temporarily unavailable after snapshot creation')
          }
          events.push(event)
        },
      },
    })
    bindScopeRetainedOwnerProvider(ownerScope, provider)
  }
  return {
    events,
    scope,
    register,
    setLookup: (next: Lookup) => {
      lookup = next
    },
    setCleanupUnknown: (next: boolean) => {
      cleanupUnknown = next
    },
    setCleanupThrow: (message: string) => {
      cleanupThrow = message
    },
    stopDeletesWhenAborted: () => {
      stopOnAbort = true
    },
    async seedOlderCheckpoint() {
      const older: WorkspaceCheckpointRef = {
        checkpointId: 'older-snapshot',
        provider: source.provider,
        source,
        idempotencyKey: 'older-key',
        requestDigest: `sha256:${'b'.repeat(64)}`,
        createdAt: new Date(0).toISOString(),
      }
      events.push({
        kind: 'workspace-checkpoint',
        id: source.runId,
        provider: source.provider,
        environmentId: source.environmentId,
        checkpoint: older,
        seq: events.length + 1,
        at: new Date(0).toISOString(),
      })
    },
    setNow: (next: number) => {
      clock = next
    },
    state: () => ({ checkpoint, deletes, destroys, live, durableBeforeEffect }),
    async checkpoint() {
      register(scope)
      const context = scopeRetainedOwnerContext(scope)!
      await context.onAdmission({
        phase: 'environment',
        provider: provider.name,
        environmentId: source.environmentId,
        sessionId: source.sessionId,
        executionId: source.executionId,
        idempotencyKey: 'intent-input',
        turnId: 'intent-turn',
      })
      await context.onAdmission({
        phase: 'dispatched',
        controlRef: source,
        idempotencyKey: 'intent-input',
        turnId: 'intent-turn',
      })
      noteScopeRetainedOwnerCoordination(scope)
      const pending = scopeRetainedOwnerCheckpointing(scope)
      await started
      if (boundary === 'late-after-cancel') {
        controller.abort('cancel checkpoint observation')
        await pending
        lateResult!()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      } else {
        await pending
      }
    },
  }
}

describe('retained checkpoint effects with unresolved outcomes', () => {
  it('keeps cleanup authority through an unknown deletion and retries after cold resume', async () => {
    const probe = fixture('unknown-outcome')
    probe.setCleanupUnknown(true)
    await probe.checkpoint()
    const cleanup = await releaseScopeRetainedOwnerEnvironment(probe.scope)
    expect(cleanup).toContainEqual(
      expect.objectContaining({
        kept: expect.arrayContaining([
          expect.objectContaining({ environmentId: 'intent-source', keptFor: 'evidence' }),
        ]),
      }),
    )
    expect(probe.state()).toMatchObject({ deletes: 1, destroys: 0, live: true })
    // An unconfirmed delete says why: the acknowledgement the provider returned (#1594).
    expect(probe.events).toContainEqual(
      expect.objectContaining({
        kind: 'workspace-checkpoint-cleanup',
        confirmed: false,
        refused: "provider acknowledged 'unknown'",
      }),
    )
    expect(cleanup).toContainEqual(
      expect.objectContaining({
        detail: expect.stringContaining("provider acknowledged 'unknown'"),
      }),
    )
    const resumed = { signal: new AbortController().signal } as Scope<unknown>
    probe.register(resumed)
    probe.setCleanupUnknown(false)
    expect(await releaseScopeRetainedOwnerEnvironment(resumed)).toEqual([])
    expect(probe.state()).toMatchObject({ deletes: 2, destroys: 1, live: false })
    expect(probe.state().checkpoint).toBeUndefined()
  })

  it('journals the provider error text when a checkpoint delete throws', async () => {
    const probe = fixture('unknown-outcome')
    probe.setCleanupThrow('storage backend connection refused')
    await probe.checkpoint()
    const cleanup = await releaseScopeRetainedOwnerEnvironment(probe.scope)
    expect(probe.state()).toMatchObject({ deletes: 1, destroys: 0, live: true })
    expect(probe.events).toContainEqual(
      expect.objectContaining({
        kind: 'workspace-checkpoint-cleanup',
        confirmed: false,
        refused: expect.stringContaining('storage backend connection refused'),
      }),
    )
    expect(cleanup).toContainEqual(
      expect.objectContaining({
        detail: expect.stringContaining('storage backend connection refused'),
      }),
    )
  })

  it.each(['unknown-outcome', 'late-after-cancel', 'journal-append-failure'] as const)(
    'recovers and cleans a real snapshot after %s',
    async (boundary) => {
      const probe = fixture(boundary)
      await probe.checkpoint()
      expect(probe.state().checkpoint?.checkpointId).toBe('intent-snapshot')
      expect(probe.state().durableBeforeEffect).toBe(true)
      expect(await releaseScopeRetainedOwnerEnvironment(probe.scope)).toEqual([])
      expect(probe.state()).toMatchObject({ deletes: 1, destroys: 1, live: false })
      expect(probe.state().checkpoint).toBeUndefined()
      expect(probe.events).toContainEqual(
        expect.objectContaining({ kind: 'workspace-checkpoint-cleanup', confirmed: true }),
      )
    },
  )

  it.each(['unknown', 'not_found', 'foreign'] as const)(
    'preserves the source and reports the pending operation after %s lookup',
    async (lookup) => {
      const probe = fixture('unknown-outcome', lookup)
      await probe.checkpoint()
      const cleanup = await releaseScopeRetainedOwnerEnvironment(probe.scope)
      expect(cleanup.length).toBeGreaterThan(0)
      expect(cleanup).toContainEqual(
        expect.objectContaining({
          kept: expect.arrayContaining([
            expect.objectContaining({ environmentId: 'intent-source', keptFor: 'evidence' }),
          ]),
        }),
      )
      expect(probe.state()).toMatchObject({ deletes: 0, destroys: 0, live: true })
      const resumed = { signal: new AbortController().signal } as Scope<unknown>
      probe.register(resumed)
      probe.setLookup('found')
      expect(await releaseScopeRetainedOwnerEnvironment(resumed)).toEqual([])
      expect(probe.state()).toMatchObject({ deletes: 1, destroys: 1, live: false })
    },
  )

  it('releases the source when the provider answers not_found for a request no operation can still serve', async () => {
    const probe = fixture('unknown-outcome', 'not_found')
    await probe.checkpoint()
    probe.setNow(WORKSPACE_CHECKPOINT_ABSENT_AFTER_MS)
    expect(await releaseScopeRetainedOwnerEnvironment(probe.scope)).toEqual([])
    expect(probe.state()).toMatchObject({ destroys: 1, live: false })
    expect(probe.events).toContainEqual(
      expect.objectContaining({ kind: 'environment-teardown', destroyed: true }),
    )
  })

  it('stops the next checkpoint delete when cleanup is aborted', async () => {
    const probe = fixture('journal-append-failure')
    probe.stopDeletesWhenAborted()
    await probe.checkpoint()
    await probe.seedOlderCheckpoint()
    await releaseScopeRetainedOwnerEnvironment(probe.scope, { capturesMs: 0 })
    const cleanups = probe.events.filter((event) => event.kind === 'workspace-checkpoint-cleanup')
    expect(probe.state().deletes).toBe(1)
    expect(cleanups).toContainEqual(
      expect.objectContaining({ confirmed: false, refused: 'cancelled before checkpoint cleanup' }),
    )
    expect(cleanups.every((event) => event.confirmed === false)).toBe(true)
  })

  it('names what the lookup answered for a request it keeps the source for', async () => {
    const probe = fixture('unknown-outcome', 'unknown')
    await probe.checkpoint()
    probe.setNow(WORKSPACE_CHECKPOINT_ABSENT_AFTER_MS)
    const cleanup = await releaseScopeRetainedOwnerEnvironment(probe.scope)
    expect(cleanup).toContainEqual(
      expect.objectContaining({
        detail: expect.stringContaining('(lookup unknown: inventory unavailable)'),
      }),
    )
    expect(probe.state()).toMatchObject({ destroys: 0, live: true })
  })
})
