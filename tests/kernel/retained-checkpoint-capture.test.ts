import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkspaceCheckpointRef } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureAgentCandidateWorkspaceTreeToArtifacts,
  verifyAgentCandidateWorkspaceTree,
} from '../../src/candidate-execution/workspace-streams'
import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import { createPrivateCasArtifactPort } from '../../src/runtime/private-cas'
import { captureProviderCheckpointWorkspace } from '../../src/runtime/provider-workspace-retention'
import {
  bindScopeRetainedOwnerProvider,
  noteScopeRetainedOwnerCoordination,
  registerScopeRetainedOwner,
  releaseScopeRetainedOwnerEnvironment,
  scopeRetainedOwnerCheckpointing,
  scopeRetainedOwnerContext,
} from '../../src/runtime/supervise/retained-scope-owner'
import type { Scope, SpawnEvent } from '../../src/runtime/supervise/types'
import { WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS } from '../../src/runtime/supervise/workspace-checkpoint'
import { captureProfile, checkpointCaptureFixture } from '../helpers/checkpoint-capture'
import { makeTempRoot } from '../helpers/temp-root'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

type Capture = Extract<SpawnEvent, { kind: 'workspace-checkpoint-capture' }>
type Cleanup = Extract<SpawnEvent, { kind: 'workspace-checkpoint-cleanup' }>

/** A deterministic generator, so a failing sequence names the seed that reproduces it. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One retained owner on a provider whose checkpoints are real copies of its workspace. Knobs make
 * the provider fail forks, captures, deletes and fork destroys; `crash` drops every in-memory
 * owner state and registers the owner again from its journal, as a restarted coordinator does.
 */
function ownerModel(options: { capture?: boolean; maxConcurrentCaptures?: number } = {}) {
  const provider = 'model-provider'
  const source = {
    runId: 'model-run',
    provider,
    environmentId: 'model-source',
    sessionId: 'model-session',
    executionId: 'model-execution',
    requestDigest: `sha256:${'a'.repeat(64)}` as const,
  }
  const files = new Map<string, string>([['notes.md', 'first line\n']])
  /** Checkpoints the provider holds now. */
  const snapshots = new Map<string, ReadonlyMap<string, string>>()
  /** Every checkpoint that ever existed, with the files it held. */
  const ever = new Map<string, ReadonlyMap<string, string>>()
  const knobs = {
    fork: false,
    capture: false,
    destroy: false,
    delete: 'ok' as 'ok' | 'unanswered-kept' | 'unanswered-deleted',
  }
  const capture = checkpointCaptureFixture({
    provider,
    snapshotFiles: (id) => snapshots.get(id),
    failFork: () => knobs.fork,
    failCapture: () => knobs.capture,
    failDestroy: () => knobs.destroy,
  })
  const capturePort = { ...capture.port, maxConcurrentCaptures: options.maxConcurrentCaptures }
  cleanups.push(() => capture.cleanup())
  const events: SpawnEvent[] = []
  let clock = 0
  let created = 0
  let live = true
  const deletes: string[] = []
  const environment: AgentEnvironment = {
    id: source.environmentId,
    provider,
    status: async () => 'running',
    async *stream() {},
    write: async (path, content) => {
      files.set(path, String(content))
    },
    destroy: async () => {
      live = false
    },
    workspaceBranching: {
      checkpoint: async (input) => {
        const checkpointId = `checkpoint-${++created}`
        const copy = new Map(files)
        snapshots.set(checkpointId, copy)
        ever.set(checkpointId, copy)
        const checkpoint: WorkspaceCheckpointRef = {
          checkpointId,
          provider,
          source,
          idempotencyKey: input.idempotencyKey,
          requestDigest: input.requestDigest,
          createdAt: new Date(clock).toISOString(),
        }
        return {
          status: 'created',
          idempotencyKey: input.idempotencyKey,
          requestDigest: input.requestDigest,
          checkpoint,
        }
      },
      lookupCheckpoint: async (input) => ({ ...input, status: 'not_found' }),
      deleteCheckpoint: async (input) => {
        deletes.push(input.targetId)
        if (knobs.delete === 'unanswered-kept')
          return { ...input, status: 'unknown', message: 'unanswered', retryable: true }
        snapshots.delete(input.targetId)
        if (knobs.delete === 'unanswered-deleted')
          return { ...input, status: 'unknown', message: 'unanswered', retryable: true }
        return { ...input, status: 'deleted' }
      },
      ...capture.branching,
    },
  }
  const environmentProvider: AgentEnvironmentProvider = {
    name: provider,
    capabilities: async () => ({ create: { workspaceCheckpoint: true } }),
    create: async () => {
      throw new Error('not used')
    },
    get: async (id) =>
      id === source.environmentId ? (live ? environment : null) : capture.forkEnvironment(id),
  }
  let scope = { signal: new AbortController().signal } as Scope<unknown>
  const register = () => {
    registerScopeRetainedOwner(scope, {
      rootId: source.runId,
      nodeId: source.runId,
      priorEvents: [...events],
      now: () => clock,
      blobs: new InMemoryResultBlobStore(),
      journal: {
        beginTree: async () => {},
        loadTree: async () => [...events],
        appendEvent: async (_root, event) => {
          events.push(event)
        },
      },
    })
    bindScopeRetainedOwnerProvider(
      scope,
      environmentProvider,
      options.capture === false ? undefined : { port: capturePort, profile: captureProfile },
    )
  }
  return {
    events,
    snapshots,
    ever,
    files,
    knobs,
    capture,
    capturePort,
    deletes,
    live: () => live,
    async start() {
      register()
      const context = scopeRetainedOwnerContext(scope)!
      await context.onAdmission({
        phase: 'environment',
        provider,
        environmentId: source.environmentId,
        sessionId: source.sessionId,
        executionId: source.executionId,
        idempotencyKey: 'model-input',
        turnId: 'model-turn',
      })
      await context.onAdmission({
        phase: 'dispatched',
        controlRef: source,
        idempotencyKey: 'model-input',
        turnId: 'model-turn',
      })
    },
    /** A coordination call after the checkpoint interval: one checkpoint, then rotation. */
    async coordinate() {
      clock += WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS + 1
      noteScopeRetainedOwnerCoordination(scope)
      await scopeRetainedOwnerCheckpointing(scope)
    },
    crash() {
      scope = { signal: new AbortController().signal } as Scope<unknown>
      register()
    },
    release() {
      return releaseScopeRetainedOwnerEnvironment(scope)
    },
  }
}

type Model = ReturnType<typeof ownerModel>

/**
 * The invariant: every checkpoint that ever existed is still held by the provider, or a journaled
 * capture names a tree in the run's store whose files are exactly the checkpoint's. And no cleanup
 * confirmed a delete without naming that tree.
 */
async function assertNothingLost(model: Model): Promise<void> {
  const captures = model.events.filter(
    (event): event is Capture => event.kind === 'workspace-checkpoint-capture',
  )
  for (const [checkpointId, files] of model.ever) {
    if (model.snapshots.has(checkpointId)) continue
    const captured = captures.find((event) => event.checkpointId === checkpointId)
    expect(captured, `checkpoint ${checkpointId} was deleted without a capture`).toBeDefined()
    expect(await model.capture.restore(captured!.tree)).toEqual(new Map(files))
  }
  for (const cleanup of model.events.filter(
    (event): event is Cleanup => event.kind === 'workspace-checkpoint-cleanup',
  )) {
    if (cleanup.refused !== undefined) {
      expect(cleanup.confirmed).toBe(false)
      expect(cleanup.capturedDigest).toBeUndefined()
      continue
    }
    const captured = captures.find((event) => event.checkpointId === cleanup.checkpointId)
    expect(cleanup.capturedDigest).toBe(captured?.tree.digest)
  }
  for (const target of model.deletes) {
    expect(
      captures.some((event) => event.checkpointId === target),
      `delete of ${target} was asked for before its capture`,
    ).toBe(true)
  }
}

describe('checkpoint capture before cleanup', () => {
  it('waits for capture capacity before creating a checkpoint fork', async () => {
    const model = ownerModel({ maxConcurrentCaptures: 1 })
    await model.start()
    await model.coordinate()
    await model.coordinate()

    let releaseSlot!: () => void
    const held = new Promise<void>((resolve) => {
      releaseSlot = resolve
    })
    let slotGranted!: () => void
    const granted = new Promise<void>((resolve) => {
      slotGranted = resolve
    })
    const holder = captureProviderCheckpointWorkspace(
      model.capturePort,
      async () => {
        slotGranted()
        await held
        throw new Error('released test slot')
      },
      undefined,
    )
    await granted

    const rotation = model.coordinate()
    await vi.waitFor(() => {
      expect(
        model.events.some(
          (event) =>
            event.kind === 'workspace-checkpoint' &&
            event.checkpoint.checkpointId === 'checkpoint-3',
        ),
      ).toBe(true)
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(model.capture.forks.size).toBe(0)
    expect(model.events.some((event) => event.kind === 'workspace-checkpoint-fork-requested')).toBe(
      false,
    )

    releaseSlot()
    await expect(holder).rejects.toThrow('released test slot')
    await rotation
    expect(model.capture.forks.size).toBe(1)
    await assertNothingLost(model)
  })

  it('stores a workspace tree once per file content, and reads it back by digest', async () => {
    const root = makeTempRoot('workspace-tree-')
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const cas = createPrivateCasArtifactPort(join(root, 'cas'), 'tree-test')
    const write = (directory: string, entries: Record<string, string>) => {
      for (const [path, content] of Object.entries(entries)) {
        mkdirSync(join(directory, path, '..'), { recursive: true })
        writeFileSync(join(directory, path), content, { mode: 0o644 })
      }
    }
    const shared = 'x'.repeat(10_000)
    write(join(root, 'one'), { 'big.bin': shared, 'notes/a.md': 'first' })
    write(join(root, 'two'), { 'big.bin': shared, 'notes/a.md': 'second' })
    const persist = (directory: string) =>
      captureAgentCandidateWorkspaceTreeToArtifacts(directory, {
        artifactPersistence: { outputArtifacts: cas, executionId: 'tree-test:1' },
      })
    const first = await persist(join(root, 'one'))
    const second = await persist(join(root, 'two'))
    expect(first).toMatchObject({ files: 2, bytes: 10_005, storedBytes: 10_005 })
    // Only the changed file is new; the shared one is the object the first tree stored.
    expect(second).toMatchObject({ files: 2, bytes: 10_006, storedBytes: 6 })
    expect(second.digest).not.toBe(first.digest)
    const again = await persist(join(root, 'one'))
    expect(again).toMatchObject({ digest: first.digest, storedBytes: 0 })
    // A store whose buffered read refuses still verifies the tree through its stream.
    const streamed = { ...cas, read: () => Promise.reject(new Error('buffered read refused')) }
    expect((await verifyAgentCandidateWorkspaceTree(second, streamed)).files).toHaveLength(2)
  })

  it('captures a checkpoint from its fork before rotation deletes it, and records the digest', async () => {
    const model = ownerModel()
    await model.start()
    for (let turn = 0; turn < 3; turn++) {
      model.files.set('notes.md', `turn ${turn}\n`)
      await model.coordinate()
    }
    // Two newest kept; the oldest was captured, its fork destroyed, then deleted.
    expect([...model.snapshots.keys()]).toEqual(['checkpoint-2', 'checkpoint-3'])
    const captured = model.events.find(
      (event): event is Capture => event.kind === 'workspace-checkpoint-capture',
    )!
    expect(captured).toMatchObject({
      checkpointId: 'checkpoint-1',
      fork: { environmentId: 'fork-1' },
    })
    expect(await model.capture.restore(captured.tree)).toEqual(
      new Map(model.ever.get('checkpoint-1')),
    )
    expect(model.capture.destroyed.has('fork-1')).toBe(true)
    expect(model.events).toContainEqual(
      expect.objectContaining({
        kind: 'workspace-checkpoint-cleanup',
        checkpointId: 'checkpoint-1',
        confirmed: true,
        capturedDigest: captured.tree.digest,
      }),
    )
    expect(await model.release()).toEqual([])
    expect(model.snapshots.size).toBe(0)
    await assertNothingLost(model)
  })

  it('keeps every checkpoint when the owner has no capture, and still releases the source', async () => {
    const model = ownerModel({ capture: false })
    await model.start()
    for (let turn = 0; turn < 4; turn++) await model.coordinate()
    expect(model.snapshots.size).toBe(4)
    expect(model.deletes).toEqual([])
    const teardown = await model.release()
    expect(teardown).toContainEqual(
      expect.objectContaining({
        label: 'scope owner workspace checkpoint',
        detail: expect.stringContaining('checkpoint kept uncaptured: checkpoint-1'),
      }),
    )
    // A snapshot outlives its box, and nothing could ever capture it here, so the box goes.
    expect(model.live()).toBe(false)
    expect(model.snapshots.size).toBe(4)
    await assertNothingLost(model)
  })

  it('keeps a checkpoint whose capture failed and its source, then captures it at release', async () => {
    const model = ownerModel()
    await model.start()
    model.knobs.capture = true
    for (let turn = 0; turn < 4; turn++) await model.coordinate()
    expect(model.deletes).toEqual([])
    expect(model.events).toContainEqual(
      expect.objectContaining({
        kind: 'workspace-checkpoint-cleanup',
        checkpointId: 'checkpoint-1',
        confirmed: false,
        refused: expect.stringContaining('capture refused by the test'),
      }),
    )
    // Rotation does not fork a refused checkpoint again in this process.
    const forksBefore = model.capture.forks.size
    await model.coordinate()
    expect(model.capture.forks.size).toBe(forksBefore + 1)
    const kept = await model.release()
    expect(kept).toContainEqual(
      expect.objectContaining({
        kept: [expect.objectContaining({ environmentId: 'model-source' })],
        detail: expect.stringContaining('checkpoint kept uncaptured'),
      }),
    )
    expect(model.live()).toBe(true)
    model.knobs.capture = false
    model.crash()
    expect(await model.release()).toEqual([])
    expect(model.snapshots.size).toBe(0)
    expect(model.live()).toBe(false)
    expect([...model.capture.forks.keys()].every((id) => model.capture.destroyed.has(id))).toBe(
      true,
    )
    await assertNothingLost(model)
  })

  it('destroys at release a capture fork whose teardown went unanswered', async () => {
    const model = ownerModel()
    await model.start()
    model.knobs.destroy = true
    for (let turn = 0; turn < 3; turn++) await model.coordinate()
    expect(model.capture.destroyed.size).toBe(0)
    model.knobs.destroy = false
    model.crash()
    expect(await model.release()).toEqual([])
    expect([...model.capture.forks.keys()].every((id) => model.capture.destroyed.has(id))).toBe(
      true,
    )
    await assertNothingLost(model)
  })

  it('loses no checkpoint over any sequence of work, checkpoints, failures and crashes', async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const random = mulberry32(seed)
      const model = ownerModel()
      const trail: string[] = []
      try {
        await model.start()
        for (let step = 0; step < 24; step++) {
          const roll = random()
          if (roll < 0.3) {
            const path = `work/file-${Math.floor(random() * 4)}.md`
            model.files.set(path, `${seed}:${step}:${random().toString(36)}\n`)
            trail.push(`edit ${path}`)
          } else if (roll < 0.75) {
            trail.push('coordinate')
            await model.coordinate()
          } else if (roll < 0.85) {
            trail.push('crash')
            model.crash()
          } else {
            model.knobs.fork = random() < 0.25
            model.knobs.capture = random() < 0.25
            model.knobs.destroy = random() < 0.25
            const deletes = ['ok', 'unanswered-kept', 'unanswered-deleted'] as const
            model.knobs.delete = deletes[Math.floor(random() * 3)]!
            trail.push(`knobs ${JSON.stringify(model.knobs)}`)
          }
          await assertNothingLost(model)
        }
        // A healthy provider at the end: the release captures and deletes every checkpoint left.
        Object.assign(model.knobs, { fork: false, capture: false, destroy: false, delete: 'ok' })
        trail.push('release')
        await model.release()
        model.crash()
        await model.release()
        await assertNothingLost(model)
        expect(model.snapshots.size).toBe(0)
        expect([...model.capture.forks.keys()].every((id) => model.capture.destroyed.has(id))).toBe(
          true,
        )
      } catch (error) {
        throw new Error(
          `seed ${seed} failed after: ${trail.join(' > ')}\n${error instanceof Error ? error.stack : String(error)}`,
        )
      }
    }
  }, 180_000)
})
