/**
 * Shared-box placement: many harness workers in one Sandbox box, each as its own process.
 *
 * The default provider placement gives every worker its own Sandbox box. A box costs a create
 * call, a sidecar, an egress proxy, a preview link and a memory reservation sized for the box,
 * while one opencode worker uses about half a gigabyte. This module packs workers into a small
 * pool of boxes instead. Each worker runs `opencode run` as a separate process with its own
 * working directory and its own HOME, so each worker has its own harness session, its own
 * materialized profile and its own transcript files.
 *
 * Why processes and not sidecar sessions: the sidecar serves every session in one box from one
 * workspace and writes each session's profile into the same files. Measured 2026-09-24 on
 * sandbox-ff52a989e7c9: eight concurrent sessions with different instructions, and seven of eight
 * answered with another session's instructions. A process with its own directory, its own HOME and
 * `OPENCODE_DISABLE_PROJECT_CONFIG` reads only its own configuration: sixteen of sixteen concurrent
 * workers answered with their own instructions and wrote only into their own directory.
 *
 * The boundary is cooperative, not a security boundary. Every worker runs as the same Linux user,
 * so a worker can read a co-tenant's files through its shell. A profile that writes a repository,
 * runs untrusted code, holds a credential of its own, or must stay blind to its siblings keeps a
 * dedicated box: {@link SharedBoxPlacement.refusal} names the profile features this placement
 * cannot carry, and Runtime then uses the dedicated provider.
 *
 * A worker whose model provider refuses a turn for capacity keeps its process's session and
 * directory, pauses by the driver's rule, and continues the same opencode session, the way a
 * dedicated leaf does (`ProviderExecutorOptions.unavailablePause`). Measured 2026-09-24: 15 of 23
 * down children of play anomaly-referee-v3d ended on `provider_quota_exhausted`, and opencode
 * itself gives up on a refused model after about 70 seconds of its own retries.
 *
 * The workers of one box share the box's router key. Each worker names itself to the router with
 * the `x-tangle-client` header, which the router stores as `clientName` on every usage row, so a
 * keeper can price one worker from the key's per-client rows (`tangle-admin router-spend --key
 * <box key>`). A request without the header stays charged to the box.
 *
 * `workersPerBox` is the one structural cap, and it protects the box. A Tangle box has a fixed
 * 512-task pids limit. An idle box uses about 118 tasks and one opencode worker about 34, so
 * twelve workers reach the limit. At that limit the sidecar's own process spawn fails with EAGAIN
 * and the sidecar restarts, which ends every worker in the box (measured on the same box: 28
 * workers crashed the sidecar twice; 16 workers crashed it once).
 */

import { randomUUID } from 'node:crypto'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import type { CreateSandboxOptions } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import { TRANSIENT_BASE_DELAY_MS, transientRetry } from './shared-box-retry'
import {
  assertWorkerCreateInput,
  createWorker,
  HARNESS,
  isUnsafeRelativePath,
  SHARED_PROVIDER_NAME,
  type SharedBoxHandle,
  sharedBoxCapabilities,
  sharedBoxRefusal,
  sharedWorkerClientName,
  workerProfile,
} from './shared-box-worker'
import type { UnavailablePausePolicy } from './supervise/upstream-unavailable'
import type { SandboxClient } from './types'

/**
 * The most workers one default box carries at once.
 *
 * It keeps a worker count that the 512-task pids limit of a Tangle box can hold with headroom
 * for the sidecar's own processes and the workers' tool shells: 118 idle tasks plus 8 workers at
 * about 34 tasks each is 390. Memory is not the binding limit: 8 workers used about 4 GB in a
 * 16 GB box. Raise it only for a box whose pids limit was raised with it.
 */
export const DEFAULT_SHARED_BOX_WORKERS = 8

/** The box shape the default placement creates: memory for 8 workers at about 0.5 GB each plus
 *  the sidecar, and 4 cores, because the workers wait on the model most of the time. */
export const DEFAULT_SHARED_BOX_RESOURCES = Object.freeze({ cpuCores: 4, memoryMB: 8192 })

const DEFAULT_WORKER_ROOT = '/home/agent/workers'

/** Options for {@link sharedBoxPlacement}. */
export interface SharedBoxPlacementOptions {
  /** The Sandbox client that creates and deletes the shared boxes. */
  client: SandboxClient
  /**
   * Create options for every shared box: resources, egress, secrets, lifetime and billing.
   * Runtime owns `backend`, so the box's sidecar never serves a worker turn.
   */
  box?: Omit<CreateSandboxOptions, 'backend'>
  /** The most workers one box carries at once. Defaults to {@link DEFAULT_SHARED_BOX_WORKERS}. */
  workersPerBox?: number
  /** Absolute directory in each box that holds one directory per worker. */
  workerRoot?: string
  /** First wait before repeating a Sandbox call that failed transiently; doubles per attempt. */
  retryDelayMs?: number
  /**
   * How a worker waits out a model provider that cannot serve now: a quota, a rate limit, an
   * overload, or the router's own refused credential (`unavailableSignalOfFailure`). The worker
   * pauses 15 s, doubling to 5 min, the rule a driver and a dedicated leaf follow, then continues
   * its own opencode session in its own directory. Only cancellation, the turn's `timeoutMs` and
   * the node's deadline and budget, which abort the turn, end the pauses. `false` ends the turn on
   * the refused run.
   */
  unavailablePause?: UnavailablePausePolicy | false
}

/** Counts that show how the pool placed its workers. */
export interface SharedBoxStats {
  readonly boxesCreated: number
  readonly boxesLive: number
  readonly workersPlaced: number
  readonly workersLive: number
  /** The most workers any one box carried at the same time. */
  readonly peakWorkersPerBox: number
  /** Every box this pool created, with the workers it served. */
  readonly boxes: ReadonlyArray<{
    readonly id: string
    readonly workersServed: number
    readonly deleted: boolean
    /** Milliseconds from the create request to a box that runs processes. */
    readonly createMs: number
  }>
}

/** What {@link SharedBoxPlacement.close} did to each box. */
export interface SharedBoxCloseReceipt {
  readonly boxId: string
  readonly deleted: boolean
  readonly error?: string
}

/** Who a shared worker is, for the router rows its model calls leave on the box's key. */
export interface SharedWorkerIdentity {
  /** The supervised node the worker runs. Absent for a worker outside a supervised tree. */
  readonly nodeId?: string
}

/** A shared-box placement: the provider Runtime uses for a profile the placement accepts. */
export interface SharedBoxPlacement {
  /**
   * The environment provider that places one accepted worker in a shared box. A worker with a
   * `nodeId` sends `x-tangle-client: agent-runtime-node/<nodeId>` on its router calls; without
   * one, its calls carry no client name and stay charged to the box.
   */
  providerFor(worker?: SharedWorkerIdentity): AgentEnvironmentProvider
  /** Public identity of this placement, recorded on every execution it serves. */
  readonly identity: { readonly id: string; readonly digest: string }
  /** Why a shared box cannot carry this profile, or `undefined` when it can. */
  refusal(profile: AgentProfile): string | undefined
  stats(): SharedBoxStats
  /** Delete every box this placement created and still holds. Call it when the run settles. */
  close(): Promise<ReadonlyArray<SharedBoxCloseReceipt>>
}

/**
 * Place accepted workers as processes in a pool of shared Sandbox boxes.
 *
 * The pool fills a box before it creates the next one and deletes a box when its last worker
 * releases it. Runtime reaches this placement through `createExecutor({ backend: 'provider',
 * shared })`: a profile that {@link SharedBoxPlacement.refusal} accepts runs here, and every other
 * profile keeps the dedicated provider.
 */
export function sharedBoxPlacement(options: SharedBoxPlacementOptions): SharedBoxPlacement {
  const workersPerBox = options.workersPerBox ?? DEFAULT_SHARED_BOX_WORKERS
  if (!Number.isSafeInteger(workersPerBox) || workersPerBox < 1) {
    throw new ValidationError('sharedBoxPlacement: workersPerBox must be a positive integer')
  }
  const workerRoot = options.workerRoot ?? DEFAULT_WORKER_ROOT
  if (!workerRoot.startsWith('/') || isUnsafeRelativePath(workerRoot.slice(1))) {
    throw new ValidationError('sharedBoxPlacement: workerRoot must be an absolute, normalized path')
  }
  const boxOptions: CreateSandboxOptions = {
    resources: { ...DEFAULT_SHARED_BOX_RESOURCES },
    ...(options.box ?? {}),
  }
  if ((boxOptions as { backend?: unknown }).backend !== undefined) {
    throw new ValidationError('sharedBoxPlacement: box.backend is owned by Runtime')
  }
  const identity = {
    id: 'shared-box',
    digest: canonicalCandidateDigest({
      kind: 'shared-box-placement.v1',
      harness: HARNESS,
      workersPerBox,
      workerRoot,
      box: publicBoxOptions(boxOptions),
    }),
  }
  const retryDelayMs = options.retryDelayMs ?? TRANSIENT_BASE_DELAY_MS
  const pool = createBoxPool(options.client, boxOptions, workersPerBox, retryDelayMs)
  const providerFor = (worker: SharedWorkerIdentity = {}): AgentEnvironmentProvider => {
    const clientName =
      worker.nodeId === undefined ? undefined : sharedWorkerClientName(worker.nodeId)
    return {
      name: SHARED_PROVIDER_NAME,
      capabilities: sharedBoxCapabilities,
      async create(input): Promise<AgentEnvironment> {
        const profile = workerProfile(input)
        const refusal = sharedBoxRefusal(profile)
        if (refusal !== undefined) {
          throw new ValidationError(`sharedBoxPlacement: ${refusal}`)
        }
        assertWorkerCreateInput(input)
        input.signal?.throwIfAborted()
        const lease = await pool.acquire()
        try {
          input.signal?.throwIfAborted()
          return await createWorker(lease, workerRoot, profile, {
            retryDelayMs,
            clientName,
            name: input.name,
            metadata: input.metadata,
            unavailablePause: options.unavailablePause ?? {},
          })
        } catch (error) {
          await lease.release()
          throw error
        }
      },
    }
  }
  return {
    providerFor,
    identity,
    refusal: sharedBoxRefusal,
    stats: () => pool.stats(),
    close: () => pool.close(),
  }
}

function publicBoxOptions(box: CreateSandboxOptions): unknown {
  const { env, secrets, ...rest } = box as CreateSandboxOptions & {
    env?: Record<string, string>
    secrets?: unknown
  }
  return {
    ...rest,
    ...(env === undefined ? {} : { environmentVariableNames: Object.keys(env).sort() }),
    ...(secrets === undefined ? {} : { secrets }),
  }
}

// ── The box pool ─────────────────────────────────────────────────────────────────────────────

interface PooledBox {
  readonly seq: number
  readonly ready: Promise<SharedBoxHandle>
  id?: string
  createMs?: number
  workers: number
  served: number
  retired: boolean
  deleted: boolean
}

export interface BoxLease {
  readonly box: SharedBoxHandle
  release(): Promise<void>
}

function createBoxPool(
  client: SandboxClient,
  boxOptions: CreateSandboxOptions,
  workersPerBox: number,
  retryDelayMs: number,
) {
  // One key per box, so a create repeated after a lost answer returns the same box.
  const poolId = randomUUID()
  const boxes: PooledBox[] = []
  const history: PooledBox[] = []
  let seq = 0
  let placed = 0
  let peak = 0
  let closing = false

  const retire = async (entry: PooledBox): Promise<SharedBoxCloseReceipt | undefined> => {
    if (entry.retired) return undefined
    entry.retired = true
    const index = boxes.indexOf(entry)
    if (index >= 0) boxes.splice(index, 1)
    let handle: SharedBoxHandle
    try {
      handle = await entry.ready
    } catch {
      return undefined
    }
    try {
      await transientRetry(() => handle.delete(), { delayMs: retryDelayMs })
      entry.deleted = true
      return { boxId: handle.id, deleted: true }
    } catch (error) {
      return {
        boxId: handle.id,
        deleted: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    async acquire(): Promise<BoxLease> {
      if (closing) throw new ValidationError('sharedBoxPlacement: the placement is closed')
      let entry = boxes.find((candidate) => !candidate.retired && candidate.workers < workersPerBox)
      if (entry === undefined) {
        const boxSeq = seq++
        const request = {
          ...boxOptions,
          name: boxOptions.name ?? `shared-box-${poolId.slice(0, 8)}-${boxSeq}`,
          idempotencyKey: `shared-box-${poolId}-${boxSeq}`,
          // The box's own sidecar never serves a worker turn. It still needs a harness to
          // start, and a minimal profile keeps its workspace free of worker instructions.
          backend: { type: HARNESS, profile: { name: 'shared-box', harness: HARNESS } },
        } as CreateSandboxOptions
        const requestedAt = Date.now()
        const created: PooledBox = {
          seq: boxSeq,
          ready: transientRetry(() => client.create(request), { delayMs: retryDelayMs }).then(
            (box) => box as unknown as SharedBoxHandle,
          ),
          workers: 0,
          served: 0,
          retired: false,
          deleted: false,
        }
        created.ready.then(
          (box) => {
            created.id = box.id
            created.createMs = Date.now() - requestedAt
          },
          () => {
            // Every waiting lease sees the same rejection through `ready`.
            const index = boxes.indexOf(created)
            if (index >= 0) boxes.splice(index, 1)
            created.retired = true
          },
        )
        boxes.push(created)
        history.push(created)
        entry = created
      }
      const leased = entry
      leased.workers += 1
      leased.served += 1
      placed += 1
      peak = Math.max(peak, leased.workers)
      let box: SharedBoxHandle
      try {
        box = await leased.ready
      } catch (error) {
        leased.workers -= 1
        throw error
      }
      let released = false
      return {
        box,
        async release(): Promise<void> {
          if (released) return
          released = true
          leased.workers -= 1
          if (leased.workers === 0 && !closing) await retire(leased)
        },
      }
    },
    stats(): SharedBoxStats {
      return {
        boxesCreated: history.length,
        boxesLive: history.filter((entry) => !entry.retired).length,
        workersPlaced: placed,
        workersLive: history.reduce((sum, entry) => sum + entry.workers, 0),
        peakWorkersPerBox: peak,
        boxes: history
          .filter((entry) => entry.id !== undefined)
          .map((entry) => ({
            id: entry.id!,
            workersServed: entry.served,
            deleted: entry.deleted,
            createMs: entry.createMs ?? 0,
          })),
      }
    },
    async close(): Promise<ReadonlyArray<SharedBoxCloseReceipt>> {
      closing = true
      const receipts = await Promise.all(history.map((entry) => retire(entry)))
      return receipts.filter((receipt): receipt is SharedBoxCloseReceipt => receipt !== undefined)
    },
  }
}
