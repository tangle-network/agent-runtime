import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import {
  AGENT_WORKSPACE_LEASE_PHASES,
  type AgentWorkspaceExecutionBindingRequest,
  type AgentWorkspaceLeaseAuthorization,
  type AgentWorkspaceLeasePhase,
  type AgentWorkspaceLeaseRecord,
  type AgentWorkspaceLeaseRecordMaterial,
  type AgentWorkspaceLeaseRenewalRequest,
  type AgentWorkspaceSealRequest,
  buildAgentWorkspaceLeaseRecord,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'

import {
  DurableRecordPublicationUncertainError,
  isNodeError,
  syncDirectory,
  writeDurableRecordIfAbsent,
} from '../durable/atomic-record'
import type { FilesystemSnapshotLimits } from '../filesystem-snapshot'
import {
  assertDisjointPrivateWorkspaceRoots,
  assertLocalPrivateWorkspaceSourcePolicyMaterial,
  captureStableLocalPrivateWorkspaceSource,
  copyLocalPrivateWorkspaceSource,
  digestLocalPrivateWorkspace,
  digestPreparedLocalPrivateWorkspace,
  type LocalPrivateWorkspaceSourcePolicyInput,
  type LocalPrivateWorkspaceSourcePolicyMaterial,
  localPrivateWorkspaceSourcePolicyDigest,
  sourcePolicyInputFromMaterial,
} from './private-workspace-source'

const stateKind = 'local-private-workspace-state' as const
const requestKind = 'local-private-workspace-request' as const
const allocationKind = 'local-private-workspace-allocation' as const
const leasePrefix = 'local-workspace.'
const ownerTokenPrefix = 'local-workspace-owner.'
const stateFilePattern = /^state-([0-9]{8})\.json$/
const stateTemporaryFilePattern = /^\.local-workspace-state-[0-9]+-[a-f0-9-]{36}\.tmp$/

export type LocalPrivateWorkspacePhase = AgentWorkspaceLeasePhase
export type LocalPrivateWorkspaceRecord = AgentWorkspaceLeaseRecord

export interface PrepareLocalPrivateWorkspaceInput {
  readonly sourceRoot: string
  readonly idempotencyKey: string
  readonly ownerId: string
  /** Caller-retained capability; only its digest is persisted. */
  readonly ownerToken: string
  readonly expiresAtMs: number
  readonly sourcePolicy?: LocalPrivateWorkspaceSourcePolicyInput
}

export type LocalPrivateWorkspaceAuthorization = AgentWorkspaceLeaseAuthorization
export type SealLocalPrivateWorkspaceInput = AgentWorkspaceSealRequest
export type BindLocalPrivateWorkspaceExecutionInput = AgentWorkspaceExecutionBindingRequest
export type RenewLocalPrivateWorkspaceInput = AgentWorkspaceLeaseRenewalRequest

export interface DestroyLocalPrivateWorkspaceResult {
  readonly destroyed: boolean
  readonly record: LocalPrivateWorkspaceRecord
}

export interface ReapExpiredLocalPrivateWorkspacesResult {
  readonly destroyed: readonly LocalPrivateWorkspaceRecord[]
  readonly failed: readonly {
    readonly leaseId: string
    readonly error: string
  }[]
  readonly skipped: readonly string[]
  readonly orphanDirectoriesRemoved: readonly string[]
}

export interface CreateLocalPrivateWorkspaceManagerOptions {
  /** Private manager-owned root. It must be disjoint from every captured source. */
  readonly root: string
  readonly now?: () => number
  readonly limits?: Partial<FilesystemSnapshotLimits>
  readonly maxLeaseDurationMs?: number
  readonly cleanupClaimDurationMs?: number
  readonly orphanGraceMs?: number
  /** Test seam; production defaults to recursive `rm`. */
  readonly removeWorkspace?: (root: string) => Promise<void>
  /** Test seam for deterministic mutation between the two real capture passes. */
  readonly afterSourceCapturePass?: (pass: 1 | 2) => void | Promise<void>
}

export interface LocalPrivateWorkspaceManager {
  prepare(input: PrepareLocalPrivateWorkspaceInput): Promise<LocalPrivateWorkspaceRecord>
  get(leaseId: string): Promise<LocalPrivateWorkspaceRecord | undefined>
  getLocalSourceSnapshotPolicy(
    authorization: LocalPrivateWorkspaceAuthorization,
  ): Promise<LocalPrivateWorkspaceSourcePolicyMaterial | undefined>
  list(): Promise<readonly LocalPrivateWorkspaceRecord[]>
  renew(input: RenewLocalPrivateWorkspaceInput): Promise<LocalPrivateWorkspaceRecord>
  sealWorkspace(input: SealLocalPrivateWorkspaceInput): Promise<LocalPrivateWorkspaceRecord>
  bindExecutionReceipt(
    input: BindLocalPrivateWorkspaceExecutionInput,
  ): Promise<LocalPrivateWorkspaceRecord>
  requireExecutionBound(
    authorization: LocalPrivateWorkspaceAuthorization,
  ): Promise<LocalPrivateWorkspaceRecord>
  destroy(
    authorization: LocalPrivateWorkspaceAuthorization,
  ): Promise<DestroyLocalPrivateWorkspaceResult>
  reapExpired(): Promise<ReapExpiredLocalPrivateWorkspacesResult>
}

interface PersistedWorkspaceState {
  readonly kind: typeof stateKind
  readonly schemaVersion: 1
  readonly generation: number
  readonly previousStateDigest: `sha256:${string}` | null
  readonly stateDigest: `sha256:${string}`
  readonly phase: LocalPrivateWorkspacePhase
  readonly leaseId: string
  readonly idempotencyDigest: `sha256:${string}`
  readonly requestDigest: `sha256:${string}`
  readonly ownerId: string
  readonly ownerTokenDigest: `sha256:${string}`
  readonly sourceRoot: string
  readonly workspaceRoot: string
  readonly workspaceIdentityDigest: `sha256:${string}`
  readonly sourceSnapshotDigest: `sha256:${string}`
  readonly localSourceSnapshotPolicy: LocalPrivateWorkspaceSourcePolicyMaterial
  readonly preparedWorkspaceDigest?: `sha256:${string}`
  readonly profileActivationDigest?: `sha256:${string}`
  readonly executionPreparationDigest?: `sha256:${string}`
  readonly createdAtMs: number
  readonly updatedAtMs: number
  readonly initialExpiresAtMs: number
  readonly expiresAtMs: number
  readonly cleanupAttempts: number
  readonly cleanupOwnerId?: string
  readonly cleanupClaimExpiresAtMs?: number
  readonly cleanupReason?: 'explicit' | 'expired' | 'orphan-recovery'
  readonly cleanupError?: string
  readonly destroyedAtMs?: number
}

interface UnsignedWorkspaceState extends Omit<PersistedWorkspaceState, 'stateDigest'> {}

const defaultLimits: FilesystemSnapshotLimits = Object.freeze({
  maxFiles: 200_000,
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalFileBytes: 2 * 1024 * 1024 * 1024,
  maxPathBytes: 16 * 1024,
})

/**
 * Local copy-only workspace provider with a durable linear state journal.
 * Profile files are applied by the caller after `prepare`; `sealWorkspace`
 * recomputes their exact filesystem result before execution can be bound.
 *
 * This prevents accidental workspace sharing between local workers. It is not
 * an operating-system security boundary: processes with host filesystem access
 * can still read or mutate another allocation.
 */
export function createLocalPrivateWorkspaceManager(
  options: CreateLocalPrivateWorkspaceManagerOptions,
): LocalPrivateWorkspaceManager {
  const root = resolveRequiredPath(options.root, 'local private workspace manager root')
  const leasesRoot = join(root, 'leases')
  const workspacesRoot = join(root, 'workspaces')
  const stagingRoot = join(root, 'staging')
  const now = options.now ?? Date.now
  const limits = resolveLimits(options.limits)
  const maxLeaseDurationMs = positiveInteger(
    options.maxLeaseDurationMs ?? 24 * 60 * 60 * 1000,
    'maxLeaseDurationMs',
  )
  const cleanupClaimDurationMs = positiveInteger(
    options.cleanupClaimDurationMs ?? 30_000,
    'cleanupClaimDurationMs',
  )
  const orphanGraceMs = nonNegativeInteger(options.orphanGraceMs ?? 60_000, 'orphanGraceMs')
  const removeWorkspace =
    options.removeWorkspace ??
    ((workspaceRoot: string) => rm(workspaceRoot, { recursive: true, force: true }))
  const managerInstanceId = `workspace-manager.${randomUUID()}`

  async function initialize(): Promise<void> {
    await mkdir(root, { recursive: true, mode: 0o700 })
    if ((await realpath(root)) !== root) {
      throw new Error('local private workspace manager root has a symlinked path component')
    }
    await Promise.all([
      mkdir(leasesRoot, { recursive: true, mode: 0o700 }),
      mkdir(workspacesRoot, { recursive: true, mode: 0o700 }),
      mkdir(stagingRoot, { recursive: true, mode: 0o700 }),
    ])
    await Promise.all([
      assertRealDirectChildDirectory(leasesRoot, root, 'lease root'),
      assertRealDirectChildDirectory(workspacesRoot, root, 'allocation root'),
      assertRealDirectChildDirectory(stagingRoot, root, 'staging root'),
    ])
  }

  async function prepare(
    input: PrepareLocalPrivateWorkspaceInput,
  ): Promise<LocalPrivateWorkspaceRecord> {
    await initialize()
    const currentTime = checkedClock(now())
    const ownerId = boundedIdentifier(input.ownerId, 'ownerId')
    const ownerTokenDigest = tokenDigest(input.ownerToken)
    const idempotencyKey = boundedIdentifier(input.idempotencyKey, 'idempotencyKey')
    const expiresAtMs = checkedExpiry(input.expiresAtMs, currentTime, maxLeaseDurationMs, 'prepare')
    const sourceRoot = resolveRequiredPath(input.sourceRoot, 'sourceRoot')
    assertDisjointPrivateWorkspaceRoots(sourceRoot, root)
    const source = await captureStableLocalPrivateWorkspaceSource(sourceRoot, {
      limits,
      ...(input.sourcePolicy ? { sourcePolicy: input.sourcePolicy } : {}),
      ...(options.afterSourceCapturePass
        ? { afterCapturePass: options.afterSourceCapturePass }
        : {}),
    })
    const idempotencyDigest = sha256(Buffer.from(idempotencyKey, 'utf8'))
    const sourceSnapshotPolicyDigest = localPrivateWorkspaceSourcePolicyDigest(
      source.material.policy,
    )
    const leaseId = leaseIdFromIdempotencyDigest(idempotencyDigest)
    const requestDigest = canonicalDigest({
      kind: requestKind,
      schemaVersion: 1,
      idempotencyDigest,
      sourceRoot,
      sourceSnapshotDigest: source.digest,
      sourceSnapshotPolicyDigest,
      ownerId,
      ownerTokenDigest,
      expiresAtMs,
    })
    const existing = await readLatestState(leaseId)
    if (existing) {
      assertPrepareReplay(existing, requestDigest, ownerTokenDigest)
      await assertWorkspacePresent(existing, workspacesRoot)
      return publicRecord(existing)
    }

    const staging = await mkdtemp(join(stagingRoot, '.preparing-'))
    let allocationRoot: string | undefined
    try {
      await copyLocalPrivateWorkspaceSource(source, staging)
      const copiedDigest = await digestLocalPrivateWorkspace(
        staging,
        limits,
        sourcePolicyInputFromMaterial(source.material.policy),
      )
      if (copiedDigest !== source.digest) {
        throw new Error('local private workspace copy does not match the frozen source snapshot')
      }
      if (checkedClock(now()) >= expiresAtMs) {
        throw new Error('local private workspace lease expired during preparation')
      }
      allocationRoot = join(workspacesRoot, randomUUID())
      await rename(staging, allocationRoot)
      await syncDirectory(workspacesRoot)
      const workspaceIdentityDigest = canonicalDigest({
        kind: allocationKind,
        provider: 'agent-runtime/local-private-workspace',
        leaseId,
        root: allocationRoot,
      })
      const initial = sealState({
        kind: stateKind,
        schemaVersion: 1,
        generation: 0,
        previousStateDigest: null,
        phase: 'copy-ready',
        leaseId,
        idempotencyDigest,
        requestDigest,
        ownerId,
        ownerTokenDigest,
        sourceRoot,
        workspaceRoot: allocationRoot,
        workspaceIdentityDigest,
        sourceSnapshotDigest: source.digest,
        localSourceSnapshotPolicy: source.material.policy,
        createdAtMs: currentTime,
        updatedAtMs: currentTime,
        initialExpiresAtMs: expiresAtMs,
        expiresAtMs,
        cleanupAttempts: 0,
      })
      const initialRecord = publicRecord(initial)
      let initialized: boolean
      try {
        initialized = await appendInitialState(initial)
      } catch (error) {
        if (!(error instanceof DurableRecordPublicationUncertainError)) throw error
        const publishedAllocationRoot = allocationRoot
        allocationRoot = undefined
        const published = await requireLatestState(leaseId)
        if (
          published.stateDigest !== initial.stateDigest ||
          published.workspaceRoot !== publishedAllocationRoot
        ) {
          throw new Error(
            'local private workspace initial state publication became ambiguous; allocation preserved for recovery',
            { cause: error },
          )
        }
        await syncDirectory(leaseDirectory(leaseId))
        return publicRecord(published)
      }
      if (initialized) return initialRecord

      const winner = await requireLatestState(leaseId)
      assertPrepareReplay(winner, requestDigest, ownerTokenDigest)
      await removeAndProveAbsent(allocationRoot)
      allocationRoot = undefined
      await assertWorkspacePresent(winner, workspacesRoot)
      return publicRecord(winner)
    } catch (error) {
      const cleanupErrors: unknown[] = []
      if (allocationRoot) {
        try {
          await removeAndProveAbsent(allocationRoot)
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      } else {
        try {
          await rm(staging, { recursive: true, force: true })
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          'local private workspace preparation and rollback both failed',
        )
      }
      throw error
    }
  }

  async function get(leaseIdInput: string): Promise<LocalPrivateWorkspaceRecord | undefined> {
    await initialize()
    const state = await readLatestState(checkedLeaseId(leaseIdInput))
    return state ? publicRecord(state) : undefined
  }

  async function getLocalSourceSnapshotPolicy(
    authorization: LocalPrivateWorkspaceAuthorization,
  ): Promise<LocalPrivateWorkspaceSourcePolicyMaterial | undefined> {
    await initialize()
    const state = await readLatestState(checkedLeaseId(authorization.leaseId))
    if (state) assertAuthorized(state, tokenDigest(authorization.ownerToken))
    return state?.localSourceSnapshotPolicy
  }

  async function list(): Promise<readonly LocalPrivateWorkspaceRecord[]> {
    await initialize()
    const directories = await readdir(leasesRoot, { withFileTypes: true })
    const records: LocalPrivateWorkspaceRecord[] = []
    for (const directory of directories.sort((left, right) => compare(left.name, right.name))) {
      if (!directory.isDirectory() || !/^[a-f0-9]{64}$/.test(directory.name)) {
        throw new Error(`local private workspace lease directory is invalid: ${directory.name}`)
      }
      const leaseId = leaseIdFromIdempotencyDigest(`sha256:${directory.name}`)
      const state = await readLatestState(leaseId)
      if (state) records.push(publicRecord(state))
    }
    return Object.freeze(records.sort((left, right) => compare(left.leaseId, right.leaseId)))
  }

  async function renew(
    input: RenewLocalPrivateWorkspaceInput,
  ): Promise<LocalPrivateWorkspaceRecord> {
    await initialize()
    const leaseId = checkedLeaseId(input.leaseId)
    const ownerTokenDigest = tokenDigest(input.ownerToken)
    while (true) {
      const state = await requireLatestState(leaseId)
      assertAuthorized(state, ownerTokenDigest)
      assertUsablePhase(state, 'renew')
      const currentTime = checkedClock(now())
      if (currentTime >= state.expiresAtMs) {
        throw new Error('local private workspace lease has expired')
      }
      const expiresAtMs = checkedExpiry(input.expiresAtMs, currentTime, maxLeaseDurationMs, 'renew')
      if (expiresAtMs === state.expiresAtMs) return publicRecord(state)
      if (expiresAtMs <= state.expiresAtMs) {
        throw new Error('local private workspace renewal must extend the current expiry')
      }
      const next = nextState(state, {
        phase: state.phase,
        updatedAtMs: currentTime,
        expiresAtMs,
      })
      if (await appendNextState(state, next)) return publicRecord(next)
    }
  }

  async function sealWorkspace(
    input: SealLocalPrivateWorkspaceInput,
  ): Promise<LocalPrivateWorkspaceRecord> {
    await initialize()
    const leaseId = checkedLeaseId(input.leaseId)
    const ownerTokenDigest = tokenDigest(input.ownerToken)
    const profileActivationDigest = checkedDigest(
      input.profileActivationDigest,
      'profileActivationDigest',
    )
    while (true) {
      const state = await requireLatestState(leaseId)
      assertAuthorized(state, ownerTokenDigest)
      assertUnexpired(state, now())
      if (!['copy-ready', 'workspace-sealed', 'execution-bound'].includes(state.phase)) {
        throw new Error(`local private workspace cannot be sealed from phase ${state.phase}`)
      }
      const preparedWorkspaceDigest = await digestPreparedLocalPrivateWorkspace(
        state.workspaceRoot,
        limits,
        state.localSourceSnapshotPolicy,
      )
      assertUnexpired(state, now())
      if (state.phase !== 'copy-ready') {
        if (
          state.profileActivationDigest !== profileActivationDigest ||
          state.preparedWorkspaceDigest !== preparedWorkspaceDigest
        ) {
          throw new Error('local private workspace seal replay does not match durable preparation')
        }
        return publicRecord(state)
      }
      const currentTime = checkedClock(now())
      const next = nextState(state, {
        phase: 'workspace-sealed',
        updatedAtMs: currentTime,
        preparedWorkspaceDigest,
        profileActivationDigest,
      })
      if (await appendNextState(state, next)) return publicRecord(next)
    }
  }

  async function bindExecutionReceipt(
    input: BindLocalPrivateWorkspaceExecutionInput,
  ): Promise<LocalPrivateWorkspaceRecord> {
    await initialize()
    const leaseId = checkedLeaseId(input.leaseId)
    const ownerTokenDigest = tokenDigest(input.ownerToken)
    const executionPreparationDigest = checkedDigest(
      input.executionPreparationDigest,
      'executionPreparationDigest',
    )
    while (true) {
      const state = await requireLatestState(leaseId)
      assertAuthorized(state, ownerTokenDigest)
      assertUnexpired(state, now())
      if (!['workspace-sealed', 'execution-bound'].includes(state.phase)) {
        throw new Error(`local private workspace cannot bind execution from phase ${state.phase}`)
      }
      const actualDigest = await digestPreparedLocalPrivateWorkspace(
        state.workspaceRoot,
        limits,
        state.localSourceSnapshotPolicy,
      )
      if (actualDigest !== state.preparedWorkspaceDigest) {
        throw new Error('local private workspace changed after its preparation was sealed')
      }
      assertUnexpired(state, now())
      if (state.phase === 'execution-bound') {
        if (state.executionPreparationDigest !== executionPreparationDigest) {
          throw new Error('local private workspace execution binding conflicts with durable state')
        }
        return publicRecord(state)
      }
      const next = nextState(state, {
        phase: 'execution-bound',
        updatedAtMs: checkedClock(now()),
        executionPreparationDigest,
      })
      if (await appendNextState(state, next)) return publicRecord(next)
    }
  }

  async function requireExecutionBound(
    authorization: LocalPrivateWorkspaceAuthorization,
  ): Promise<LocalPrivateWorkspaceRecord> {
    await initialize()
    const state = await requireLatestState(checkedLeaseId(authorization.leaseId))
    assertAuthorized(state, tokenDigest(authorization.ownerToken))
    assertUnexpired(state, now())
    if (state.phase !== 'execution-bound') {
      throw new Error('local private workspace is not bound to an execution preparation receipt')
    }
    const actualDigest = await digestPreparedLocalPrivateWorkspace(
      state.workspaceRoot,
      limits,
      state.localSourceSnapshotPolicy,
    )
    if (actualDigest !== state.preparedWorkspaceDigest) {
      throw new Error('local private workspace changed after execution binding')
    }
    assertUnexpired(state, now())
    return publicRecord(state)
  }

  async function destroy(
    authorization: LocalPrivateWorkspaceAuthorization,
  ): Promise<DestroyLocalPrivateWorkspaceResult> {
    await initialize()
    const leaseId = checkedLeaseId(authorization.leaseId)
    const ownerTokenDigest = tokenDigest(authorization.ownerToken)
    const initial = await requireLatestState(leaseId)
    assertAuthorized(initial, ownerTokenDigest)
    if (initial.phase === 'destroyed') {
      return Object.freeze({ destroyed: false, record: publicRecord(initial) })
    }
    const claimed = await claimCleanup(leaseId, 'explicit')
    if (!claimed) {
      throw new Error('local private workspace cleanup is owned by another live manager')
    }
    if (claimed.phase === 'destroyed') {
      return Object.freeze({ destroyed: false, record: publicRecord(claimed) })
    }
    return Object.freeze({ destroyed: true, record: await executeCleanup(claimed) })
  }

  async function reapExpired(): Promise<ReapExpiredLocalPrivateWorkspacesResult> {
    await initialize()
    const destroyed: LocalPrivateWorkspaceRecord[] = []
    const failed: Array<{ leaseId: string; error: string }> = []
    const skipped: string[] = []
    const states = await listStates()
    const currentTime = checkedClock(now())
    for (const state of states) {
      if (state.phase === 'destroyed') continue
      const shouldRecoverCleanup =
        ['destroying', 'cleanup-failed'].includes(state.phase) &&
        (state.cleanupClaimExpiresAtMs ?? 0) <= currentTime
      const isExpired = state.expiresAtMs <= currentTime
      if (!shouldRecoverCleanup && !isExpired) continue
      try {
        const claimed = await claimCleanup(state.leaseId, isExpired ? 'expired' : 'orphan-recovery')
        if (!claimed) {
          skipped.push(state.leaseId)
          continue
        }
        destroyed.push(await executeCleanup(claimed))
      } catch (error) {
        failed.push({ leaseId: state.leaseId, error: errorMessage(error) })
      }
    }
    const orphanDirectoriesRemoved = await removeOrphanDirectories(await listStates(), currentTime)
    return Object.freeze({
      destroyed: Object.freeze(destroyed),
      failed: Object.freeze(failed),
      skipped: Object.freeze(skipped),
      orphanDirectoriesRemoved: Object.freeze(orphanDirectoriesRemoved),
    })
  }

  async function claimCleanup(
    leaseId: string,
    reason: PersistedWorkspaceState['cleanupReason'],
  ): Promise<PersistedWorkspaceState | undefined> {
    while (true) {
      const state = await requireLatestState(leaseId)
      if (state.phase === 'destroyed') return state
      const currentTime = checkedClock(now())
      if (
        state.phase === 'destroying' &&
        state.cleanupOwnerId !== managerInstanceId &&
        (state.cleanupClaimExpiresAtMs ?? 0) > currentTime
      ) {
        return undefined
      }
      if (state.phase === 'destroying' && state.cleanupOwnerId === managerInstanceId) return state
      if (
        ![
          'copy-ready',
          'workspace-sealed',
          'execution-bound',
          'destroying',
          'cleanup-failed',
        ].includes(state.phase)
      ) {
        throw new Error(`local private workspace cannot enter cleanup from phase ${state.phase}`)
      }
      const next = nextState(state, {
        phase: 'destroying',
        updatedAtMs: currentTime,
        cleanupAttempts: state.cleanupAttempts + 1,
        cleanupOwnerId: managerInstanceId,
        cleanupClaimExpiresAtMs: currentTime + cleanupClaimDurationMs,
        cleanupReason: reason,
        cleanupError: undefined,
      })
      if (await appendNextState(state, next)) return next
    }
  }

  async function executeCleanup(
    claimed: PersistedWorkspaceState,
  ): Promise<LocalPrivateWorkspaceRecord> {
    if (claimed.phase === 'destroyed') return publicRecord(claimed)
    if (claimed.phase !== 'destroying' || claimed.cleanupOwnerId !== managerInstanceId) {
      throw new Error('local private workspace cleanup claim is not owned by this manager')
    }
    try {
      await removeAndProveAbsent(claimed.workspaceRoot)
    } catch (error) {
      const failed = await appendCleanupFailure(claimed.leaseId, error)
      throw new LocalPrivateWorkspaceCleanupError(publicRecord(failed), error)
    }
    while (true) {
      const state = await requireLatestState(claimed.leaseId)
      if (state.phase === 'destroyed') return publicRecord(state)
      if (state.phase !== 'destroying' || state.cleanupOwnerId !== managerInstanceId) {
        throw new Error('local private workspace cleanup ownership changed before completion')
      }
      const currentTime = checkedClock(now())
      const next = nextState(state, {
        phase: 'destroyed',
        updatedAtMs: currentTime,
        destroyedAtMs: currentTime,
        cleanupOwnerId: undefined,
        cleanupClaimExpiresAtMs: undefined,
        cleanupError: undefined,
      })
      if (await appendNextState(state, next)) return publicRecord(next)
    }
  }

  async function appendCleanupFailure(
    leaseId: string,
    error: unknown,
  ): Promise<PersistedWorkspaceState> {
    while (true) {
      const state = await requireLatestState(leaseId)
      if (state.phase === 'cleanup-failed') return state
      if (state.phase !== 'destroying' || state.cleanupOwnerId !== managerInstanceId) {
        throw new Error('local private workspace cleanup ownership changed while recording failure')
      }
      const next = nextState(state, {
        phase: 'cleanup-failed',
        updatedAtMs: checkedClock(now()),
        cleanupOwnerId: undefined,
        cleanupClaimExpiresAtMs: undefined,
        cleanupError: errorMessage(error).slice(0, 2_000),
      })
      if (await appendNextState(state, next)) return next
    }
  }

  async function removeAndProveAbsent(workspaceRoot: string): Promise<void> {
    await assertManagedWorkspacePathOnDisk(workspaceRoot, workspacesRoot)
    await removeWorkspace(workspaceRoot)
    const remaining = await optionalLstat(workspaceRoot)
    if (remaining) throw new Error('local private workspace cleanup returned while files remain')
    await syncDirectory(workspacesRoot)
  }

  async function removeOrphanDirectories(
    states: readonly PersistedWorkspaceState[],
    currentTime: number,
  ): Promise<string[]> {
    const referenced = new Set(states.map((state) => resolve(state.workspaceRoot)))
    const removed: string[] = []
    for (const entry of await readdir(workspacesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        throw new Error(`local private workspace root contains a non-directory: ${entry.name}`)
      }
      const path = join(workspacesRoot, entry.name)
      assertCanonicalManagedWorkspacePath(path, workspacesRoot)
      if (referenced.has(path)) continue
      const details = await stat(path)
      if (details.mtimeMs + orphanGraceMs > currentTime) continue
      await removeAndProveAbsent(path)
      removed.push(path)
    }
    return removed.sort(compare)
  }

  async function listStates(): Promise<readonly PersistedWorkspaceState[]> {
    const records = await list()
    return await Promise.all(records.map((record) => requireLatestState(record.leaseId)))
  }

  async function appendInitialState(state: PersistedWorkspaceState): Promise<boolean> {
    const directory = leaseDirectory(state.leaseId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await assertRealDirectChildDirectory(directory, leasesRoot, 'lease directory')
    return writeDurableRecordIfAbsent(directory, statePath(directory, 0), state, {
      temporaryPrefix: 'local-workspace-state',
    })
  }

  async function appendNextState(
    expected: PersistedWorkspaceState,
    next: PersistedWorkspaceState,
  ): Promise<boolean> {
    if (
      next.generation !== expected.generation + 1 ||
      next.previousStateDigest !== expected.stateDigest
    ) {
      throw new Error('local private workspace transition does not extend the expected state')
    }
    const directory = leaseDirectory(expected.leaseId)
    await assertRealDirectChildDirectory(directory, leasesRoot, 'lease directory')
    return writeDurableRecordIfAbsent(directory, statePath(directory, next.generation), next, {
      temporaryPrefix: 'local-workspace-state',
    })
  }

  async function readLatestState(leaseId: string): Promise<PersistedWorkspaceState | undefined> {
    const directory = leaseDirectory(leaseId)
    const directoryStats = await optionalLstat(directory)
    if (!directoryStats) return undefined
    await assertRealDirectChildDirectory(directory, leasesRoot, 'lease directory')
    const files = await readdir(directory)
    const unexpectedFile = files.find(
      (file) => !stateFilePattern.test(file) && !stateTemporaryFilePattern.test(file),
    )
    if (unexpectedFile) {
      throw new Error(
        `local private workspace lease ${leaseId} contains an unknown durable file: ${unexpectedFile}`,
      )
    }
    const generations = files
      .map((file) => stateFilePattern.exec(file))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
      .sort((left, right) => left - right)
    if (generations.length === 0) return undefined
    let previous: PersistedWorkspaceState | undefined
    for (let index = 0; index < generations.length; index++) {
      if (generations[index] !== index) {
        throw new Error(`local private workspace lease ${leaseId} has a state gap`)
      }
      const state = parseState(
        JSON.parse(await readBoundedStateFile(statePath(directory, index))) as unknown,
        workspacesRoot,
      )
      if (state.leaseId !== leaseId || state.generation !== index) {
        throw new Error(
          `local private workspace lease ${leaseId} state path does not match content`,
        )
      }
      if (state.previousStateDigest !== (previous?.stateDigest ?? null)) {
        throw new Error(`local private workspace lease ${leaseId} state chain is broken`)
      }
      if (previous) assertStateTransition(previous, state)
      previous = state
    }
    return previous
  }

  function requireLatestState(leaseId: string): Promise<PersistedWorkspaceState> {
    return readLatestState(leaseId).then((state) => {
      if (!state) throw new Error(`local private workspace lease does not exist: ${leaseId}`)
      return state
    })
  }

  function leaseDirectory(leaseId: string): string {
    return join(leasesRoot, checkedLeaseId(leaseId).slice(leasePrefix.length))
  }

  return Object.freeze({
    prepare,
    get,
    getLocalSourceSnapshotPolicy,
    list,
    renew,
    sealWorkspace,
    bindExecutionReceipt,
    requireExecutionBound,
    destroy,
    reapExpired,
  })
}

/** The same idempotency key was reused for a different frozen request. */
export class LocalPrivateWorkspaceIdempotencyConflictError extends Error {
  readonly code = 'idempotency_conflict' as const

  constructor(leaseId: string) {
    super(`local private workspace idempotency key conflicts with durable lease ${leaseId}`)
    this.name = 'LocalPrivateWorkspaceIdempotencyConflictError'
  }
}

/** Workspace removal failed and durable state records a retryable cleanup failure. */
export class LocalPrivateWorkspaceCleanupError extends Error {
  readonly code = 'cleanup_failed' as const
  readonly record: LocalPrivateWorkspaceRecord

  constructor(record: LocalPrivateWorkspaceRecord, cause: unknown) {
    super(`local private workspace cleanup failed for ${record.leaseId}`, { cause })
    this.name = 'LocalPrivateWorkspaceCleanupError'
    this.record = record
  }
}

/** Mint a caller-retained 256-bit capability for one or more authorized lease calls. */
export function createLocalPrivateWorkspaceOwnerToken(): string {
  return `${ownerTokenPrefix}${randomBytes(32).toString('base64url')}`
}

function nextState(
  previous: PersistedWorkspaceState,
  changes: Partial<UnsignedWorkspaceState> & Pick<UnsignedWorkspaceState, 'phase' | 'updatedAtMs'>,
): PersistedWorkspaceState {
  const merged = {
    ...previous,
    ...changes,
    generation: previous.generation + 1,
    previousStateDigest: previous.stateDigest,
  }
  const { stateDigest: _stateDigest, ...unsigned } = merged
  return sealState(unsigned)
}

function sealState(state: UnsignedWorkspaceState): PersistedWorkspaceState {
  const normalized = Object.fromEntries(
    Object.entries(state).filter(([, value]) => value !== undefined),
  ) as unknown as UnsignedWorkspaceState
  return deepFreeze({ ...normalized, stateDigest: canonicalDigest(normalized) })
}

function parseState(value: unknown, workspacesRoot: string): PersistedWorkspaceState {
  if (!isRecord(value)) throw new Error('local private workspace state is not an object')
  assertStateKeys(value)
  if (
    value.kind !== stateKind ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    (value.generation as number) > 99_999_999 ||
    typeof value.stateDigest !== 'string' ||
    !isDigest(value.stateDigest)
  ) {
    throw new Error('local private workspace state header is invalid')
  }
  const state = value as unknown as PersistedWorkspaceState
  const { stateDigest: _digest, ...unsigned } = state
  if (canonicalDigest(unsigned) !== state.stateDigest) {
    throw new Error('local private workspace state digest does not match')
  }
  if (!isWorkspacePhase(state.phase)) {
    throw new Error('local private workspace state phase is invalid')
  }
  checkedLeaseId(state.leaseId)
  checkedDigest(state.idempotencyDigest, 'idempotencyDigest')
  if (leaseIdFromIdempotencyDigest(state.idempotencyDigest) !== state.leaseId) {
    throw new Error('local private workspace leaseId does not match idempotencyDigest')
  }
  checkedDigest(state.requestDigest, 'requestDigest')
  boundedIdentifier(state.ownerId, 'ownerId')
  checkedDigest(state.ownerTokenDigest, 'ownerTokenDigest')
  checkedDigest(state.workspaceIdentityDigest, 'workspaceIdentityDigest')
  checkedDigest(state.sourceSnapshotDigest, 'sourceSnapshotDigest')
  assertLocalPrivateWorkspaceSourcePolicyMaterial(state.localSourceSnapshotPolicy)
  assertCanonicalAbsolutePath(state.sourceRoot, 'sourceRoot')
  assertCanonicalManagedWorkspacePath(state.workspaceRoot, workspacesRoot)
  if (
    canonicalDigest({
      kind: allocationKind,
      provider: 'agent-runtime/local-private-workspace',
      leaseId: state.leaseId,
      root: state.workspaceRoot,
    }) !== state.workspaceIdentityDigest
  ) {
    throw new Error('local private workspace allocation identity does not match its fields')
  }
  if (state.preparedWorkspaceDigest !== undefined) {
    checkedDigest(state.preparedWorkspaceDigest, 'preparedWorkspaceDigest')
  }
  if (state.profileActivationDigest !== undefined) {
    checkedDigest(state.profileActivationDigest, 'profileActivationDigest')
  }
  if (state.executionPreparationDigest !== undefined) {
    checkedDigest(state.executionPreparationDigest, 'executionPreparationDigest')
  }
  assertStateTimesAndPhase(state)
  return deepFreeze(state)
}

const requiredStateKeys = Object.freeze([
  'cleanupAttempts',
  'createdAtMs',
  'expiresAtMs',
  'generation',
  'idempotencyDigest',
  'initialExpiresAtMs',
  'kind',
  'leaseId',
  'localSourceSnapshotPolicy',
  'ownerId',
  'ownerTokenDigest',
  'phase',
  'previousStateDigest',
  'requestDigest',
  'schemaVersion',
  'sourceRoot',
  'sourceSnapshotDigest',
  'stateDigest',
  'updatedAtMs',
  'workspaceIdentityDigest',
  'workspaceRoot',
])

const optionalStateKeys = new Set([
  'cleanupClaimExpiresAtMs',
  'cleanupError',
  'cleanupOwnerId',
  'cleanupReason',
  'destroyedAtMs',
  'executionPreparationDigest',
  'preparedWorkspaceDigest',
  'profileActivationDigest',
])

function assertStateKeys(value: Record<string, unknown>): void {
  const actual = new Set(Object.keys(value))
  for (const key of requiredStateKeys) {
    if (!actual.has(key)) throw new Error(`local private workspace state is missing field: ${key}`)
  }
  for (const key of actual) {
    if (!requiredStateKeys.includes(key) && !optionalStateKeys.has(key)) {
      throw new Error(`local private workspace state has unknown field: ${key}`)
    }
  }
}

function assertStateTimesAndPhase(state: PersistedWorkspaceState): void {
  for (const [label, value] of [
    ['createdAtMs', state.createdAtMs],
    ['updatedAtMs', state.updatedAtMs],
    ['initialExpiresAtMs', state.initialExpiresAtMs],
    ['expiresAtMs', state.expiresAtMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`local private workspace state ${label} is invalid`)
    }
  }
  if (
    state.updatedAtMs < state.createdAtMs ||
    state.initialExpiresAtMs <= state.createdAtMs ||
    state.expiresAtMs < state.initialExpiresAtMs ||
    !Number.isSafeInteger(state.cleanupAttempts) ||
    state.cleanupAttempts < 0
  ) {
    throw new Error('local private workspace state timeline is invalid')
  }
  if (
    (state.generation === 0 && state.previousStateDigest !== null) ||
    (state.generation > 0 &&
      (typeof state.previousStateDigest !== 'string' || !isDigest(state.previousStateDigest)))
  ) {
    throw new Error('local private workspace state predecessor is invalid')
  }

  const hasPrepared = state.preparedWorkspaceDigest !== undefined
  const hasProfile = state.profileActivationDigest !== undefined
  const hasExecution = state.executionPreparationDigest !== undefined
  if (hasPrepared !== hasProfile || (hasExecution && !hasPrepared)) {
    throw new Error('local private workspace state identity tier is incomplete')
  }
  const cleanupOwner = state.cleanupOwnerId !== undefined
  const cleanupExpiry = state.cleanupClaimExpiresAtMs !== undefined
  const cleanupReason = state.cleanupReason !== undefined
  const cleanupError = state.cleanupError !== undefined
  const destroyedAt = state.destroyedAtMs !== undefined

  if (cleanupOwner) boundedIdentifier(state.cleanupOwnerId as string, 'cleanupOwnerId')
  if (cleanupExpiry) {
    if (
      !Number.isSafeInteger(state.cleanupClaimExpiresAtMs) ||
      (state.cleanupClaimExpiresAtMs as number) <= state.updatedAtMs
    ) {
      throw new Error('local private workspace cleanup claim expiry is invalid')
    }
  }
  if (cleanupReason && !['explicit', 'expired', 'orphan-recovery'].includes(state.cleanupReason!)) {
    throw new Error('local private workspace cleanup reason is invalid')
  }
  if (
    cleanupError &&
    (typeof state.cleanupError !== 'string' ||
      state.cleanupError.length === 0 ||
      state.cleanupError.length > 2_000)
  ) {
    throw new Error('local private workspace cleanup error is invalid')
  }
  if (destroyedAt && state.destroyedAtMs !== state.updatedAtMs) {
    throw new Error('local private workspace destroyed timestamp is invalid')
  }

  switch (state.phase) {
    case 'copy-ready':
      if (
        hasPrepared ||
        cleanupOwner ||
        cleanupExpiry ||
        cleanupReason ||
        cleanupError ||
        destroyedAt ||
        state.cleanupAttempts !== 0
      ) {
        throw new Error('local private workspace copy-ready state fields are invalid')
      }
      break
    case 'workspace-sealed':
      if (
        !hasPrepared ||
        hasExecution ||
        cleanupOwner ||
        cleanupExpiry ||
        cleanupReason ||
        cleanupError ||
        destroyedAt ||
        state.cleanupAttempts !== 0
      ) {
        throw new Error('local private workspace sealed state fields are invalid')
      }
      break
    case 'execution-bound':
      if (
        !hasExecution ||
        cleanupOwner ||
        cleanupExpiry ||
        cleanupReason ||
        cleanupError ||
        destroyedAt ||
        state.cleanupAttempts !== 0
      ) {
        throw new Error('local private workspace bound state fields are invalid')
      }
      break
    case 'destroying':
      if (
        !cleanupOwner ||
        !cleanupExpiry ||
        !cleanupReason ||
        cleanupError ||
        destroyedAt ||
        state.cleanupAttempts < 1
      ) {
        throw new Error('local private workspace destroying state fields are invalid')
      }
      break
    case 'cleanup-failed':
      if (
        cleanupOwner ||
        cleanupExpiry ||
        !cleanupReason ||
        !cleanupError ||
        destroyedAt ||
        state.cleanupAttempts < 1
      ) {
        throw new Error('local private workspace cleanup-failed state fields are invalid')
      }
      break
    case 'destroyed':
      if (
        cleanupOwner ||
        cleanupExpiry ||
        !cleanupReason ||
        cleanupError ||
        !destroyedAt ||
        state.cleanupAttempts < 1
      ) {
        throw new Error('local private workspace destroyed state fields are invalid')
      }
      break
  }
}

function assertStateTransition(
  previous: PersistedWorkspaceState,
  next: PersistedWorkspaceState,
): void {
  if (
    next.generation !== previous.generation + 1 ||
    next.previousStateDigest !== previous.stateDigest ||
    next.updatedAtMs < previous.updatedAtMs
  ) {
    throw new Error('local private workspace state transition order is invalid')
  }
  for (const key of [
    'kind',
    'schemaVersion',
    'leaseId',
    'idempotencyDigest',
    'requestDigest',
    'ownerId',
    'ownerTokenDigest',
    'sourceRoot',
    'workspaceRoot',
    'workspaceIdentityDigest',
    'sourceSnapshotDigest',
    'createdAtMs',
    'initialExpiresAtMs',
  ] as const) {
    if (next[key] !== previous[key]) {
      throw new Error(`local private workspace state transition changed immutable field: ${key}`)
    }
  }
  if (
    localPrivateWorkspaceSourcePolicyDigest(next.localSourceSnapshotPolicy) !==
    localPrivateWorkspaceSourcePolicyDigest(previous.localSourceSnapshotPolicy)
  ) {
    throw new Error('local private workspace state transition changed source policy')
  }
  const allowed: Readonly<
    Record<LocalPrivateWorkspacePhase, readonly LocalPrivateWorkspacePhase[]>
  > = {
    'copy-ready': ['copy-ready', 'workspace-sealed', 'destroying'],
    'workspace-sealed': ['workspace-sealed', 'execution-bound', 'destroying'],
    'execution-bound': ['execution-bound', 'destroying'],
    destroying: ['destroying', 'cleanup-failed', 'destroyed'],
    'cleanup-failed': ['destroying'],
    destroyed: [],
  }
  if (!(allowed[previous.phase] ?? []).includes(next.phase)) {
    throw new Error(
      `local private workspace state transition ${previous.phase} -> ${next.phase} is invalid`,
    )
  }
  if (next.expiresAtMs !== previous.expiresAtMs) {
    if (
      next.phase !== previous.phase ||
      !['copy-ready', 'workspace-sealed', 'execution-bound'].includes(next.phase) ||
      next.expiresAtMs <= previous.expiresAtMs
    ) {
      throw new Error('local private workspace state transition changed expiry illegally')
    }
  }
  if (next.phase === 'workspace-sealed' && previous.phase === 'copy-ready') {
    if (!next.preparedWorkspaceDigest || !next.profileActivationDigest) {
      throw new Error('local private workspace seal transition omitted preparation identity')
    }
  } else if (next.phase === 'execution-bound' && previous.phase === 'workspace-sealed') {
    if (
      next.preparedWorkspaceDigest !== previous.preparedWorkspaceDigest ||
      next.profileActivationDigest !== previous.profileActivationDigest ||
      !next.executionPreparationDigest
    ) {
      throw new Error('local private workspace bind transition changed preparation identity')
    }
  } else if (
    next.preparedWorkspaceDigest !== previous.preparedWorkspaceDigest ||
    next.profileActivationDigest !== previous.profileActivationDigest ||
    next.executionPreparationDigest !== previous.executionPreparationDigest
  ) {
    throw new Error('local private workspace state transition changed sealed identity')
  }
  const enteringCleanup = next.phase === 'destroying' && previous.phase !== 'destroying'
  const reclaimingCleanup = next.phase === 'destroying' && previous.phase === 'destroying'
  const expectedAttempts =
    enteringCleanup || reclaimingCleanup ? previous.cleanupAttempts + 1 : previous.cleanupAttempts
  if (next.cleanupAttempts !== expectedAttempts) {
    throw new Error('local private workspace state transition cleanup attempts are invalid')
  }
}

function publicRecord(state: PersistedWorkspaceState): LocalPrivateWorkspaceRecord {
  const sourceSnapshotPolicyDigest = localPrivateWorkspaceSourcePolicyDigest(
    state.localSourceSnapshotPolicy,
  )
  const material = {
    kind: 'agent-workspace-lease',
    schemaVersion: 1,
    phase: state.phase,
    leaseId: state.leaseId,
    ownerId: state.ownerId,
    isolation: 'per-run',
    workspace: {
      provider: 'agent-runtime/local-private-workspace',
      root: state.workspaceRoot,
      identityDigest: state.workspaceIdentityDigest,
    },
    sourceSnapshotDigest: state.sourceSnapshotDigest,
    ...(state.preparedWorkspaceDigest
      ? { preparedWorkspaceDigest: state.preparedWorkspaceDigest }
      : {}),
    ...(state.profileActivationDigest
      ? { profileActivationDigest: state.profileActivationDigest }
      : {}),
    ...(state.executionPreparationDigest
      ? { executionPreparationDigest: state.executionPreparationDigest }
      : {}),
    createdAtMs: state.createdAtMs,
    updatedAtMs: state.updatedAtMs,
    expiresAtMs: state.expiresAtMs,
    cleanupAttempts: state.cleanupAttempts,
    sourceSnapshotPolicy: {
      kind: 'provider-declared',
      name: 'agent-runtime/local-private-workspace-source',
      version: 1,
      digest: sourceSnapshotPolicyDigest,
    },
    ...(state.phase === 'cleanup-failed'
      ? { cleanupError: 'workspace cleanup failed; inspect provider-private diagnostics' }
      : {}),
  } as AgentWorkspaceLeaseRecordMaterial
  return deepFreeze(buildAgentWorkspaceLeaseRecord(material))
}

function assertPrepareReplay(
  state: PersistedWorkspaceState,
  requestDigest: `sha256:${string}`,
  ownerTokenDigest: `sha256:${string}`,
): void {
  if (
    state.requestDigest !== requestDigest ||
    !sameDigest(state.ownerTokenDigest, ownerTokenDigest)
  ) {
    throw new LocalPrivateWorkspaceIdempotencyConflictError(state.leaseId)
  }
  if (!['copy-ready', 'workspace-sealed', 'execution-bound'].includes(state.phase)) {
    throw new Error(
      `local private workspace idempotent replay names terminal phase ${state.phase}; use a new key`,
    )
  }
}

function assertAuthorized(
  state: PersistedWorkspaceState,
  ownerTokenDigest: `sha256:${string}`,
): void {
  if (!sameDigest(state.ownerTokenDigest, ownerTokenDigest)) {
    throw new Error('local private workspace owner token is invalid')
  }
}

function assertUsablePhase(state: PersistedWorkspaceState, operation: string): void {
  if (!['copy-ready', 'workspace-sealed', 'execution-bound'].includes(state.phase)) {
    throw new Error(`local private workspace cannot ${operation} from phase ${state.phase}`)
  }
}

function assertUnexpired(state: PersistedWorkspaceState, nowInput: number): void {
  const currentTime = checkedClock(nowInput)
  if (currentTime >= state.expiresAtMs) {
    throw new Error('local private workspace lease has expired')
  }
}

async function assertWorkspacePresent(
  state: PersistedWorkspaceState,
  workspacesRoot: string,
): Promise<void> {
  await assertManagedWorkspacePathOnDisk(state.workspaceRoot, workspacesRoot)
  const details = await optionalLstat(state.workspaceRoot)
  if (!details?.isDirectory() || details.isSymbolicLink()) {
    throw new Error(
      `local private workspace durable state points to a missing allocation: ${state.leaseId}`,
    )
  }
}

function assertCanonicalAbsolutePath(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    resolve(value) !== value
  ) {
    throw new Error(`local private workspace state ${label} is not a canonical absolute path`)
  }
}

function assertCanonicalManagedWorkspacePath(value: string, workspacesRoot: string): void {
  assertCanonicalAbsolutePath(value, 'workspaceRoot')
  if (
    dirname(value) !== workspacesRoot ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(basename(value))
  ) {
    throw new Error(
      'local private workspace state workspaceRoot is outside the manager allocation root',
    )
  }
}

async function assertManagedWorkspacePathOnDisk(
  workspaceRoot: string,
  workspacesRoot: string,
): Promise<void> {
  assertCanonicalManagedWorkspacePath(workspaceRoot, workspacesRoot)
  const parent = await lstat(workspacesRoot)
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (await realpath(workspacesRoot)) !== workspacesRoot
  ) {
    throw new Error('local private workspace manager allocation root is not a real directory')
  }
  const allocation = await optionalLstat(workspaceRoot)
  if (!allocation) return
  if (
    !allocation.isDirectory() ||
    allocation.isSymbolicLink() ||
    (await realpath(workspaceRoot)) !== workspaceRoot
  ) {
    throw new Error('local private workspace allocation path is not a real managed directory')
  }
}

async function assertRealDirectChildDirectory(
  path: string,
  parent: string,
  label: string,
): Promise<void> {
  if (dirname(path) !== parent) {
    throw new Error(`local private workspace ${label} is not a direct managed child`)
  }
  const details = await lstat(path)
  if (!details.isDirectory() || details.isSymbolicLink() || (await realpath(path)) !== path) {
    throw new Error(`local private workspace ${label} is not a real directory`)
  }
}

async function readBoundedStateFile(path: string): Promise<string> {
  const details = await lstat(path)
  if (!details.isFile() || details.isSymbolicLink() || details.size > 1024 * 1024) {
    throw new Error('local private workspace durable state file is unsafe')
  }
  return await readFile(path, 'utf8')
}

function leaseIdFromIdempotencyDigest(digest: `sha256:${string}`): string {
  return `${leasePrefix}${digest.slice('sha256:'.length)}`
}

function checkedLeaseId(value: string): string {
  if (!new RegExp(`^${leasePrefix.replace('.', '\\.')}[a-f0-9]{64}$`).test(value)) {
    throw new Error('local private workspace leaseId is invalid')
  }
  return value
}

function tokenDigest(token: string): `sha256:${string}` {
  if (
    typeof token !== 'string' ||
    !new RegExp(`^${ownerTokenPrefix.replace('.', '\\.')}[A-Za-z0-9_-]{43}$`).test(token)
  ) {
    throw new Error('local private workspace ownerToken must be a minted 256-bit capability')
  }
  return sha256(Buffer.from(token, 'utf8'))
}

function sameDigest(left: `sha256:${string}`, right: `sha256:${string}`): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
}

function statePath(directory: string, generation: number): string {
  return join(directory, `state-${String(generation).padStart(8, '0')}.json`)
}

function canonicalDigest(value: unknown): `sha256:${string}` {
  return canonicalCandidateDigest(value)
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function checkedDigest(value: string, label: string): `sha256:${string}` {
  if (!isDigest(value)) throw new Error(`local private workspace ${label} is invalid`)
  return value
}

function isDigest(value: string): value is `sha256:${string}` {
  return /^sha256:[a-f0-9]{64}$/.test(value)
}

function checkedClock(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('local private workspace clock returned an invalid timestamp')
  }
  return value
}

function checkedExpiry(
  value: number,
  now: number,
  maxLeaseDurationMs: number,
  operation: string,
): number {
  if (!Number.isSafeInteger(value) || value <= now || value > now + maxLeaseDurationMs) {
    throw new Error(
      `local private workspace ${operation} expiry must be in the future and within maxLeaseDurationMs`,
    )
  }
  return value
}

function boundedIdentifier(value: string, label: string, maxLength = 512): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    hasControlCharacter(value)
  ) {
    throw new Error(`local private workspace ${label} is invalid`)
  }
  return value
}

function resolveRequiredPath(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(`${label} is invalid`)
  }
  return resolve(value)
}

function resolveLimits(
  overrides: Partial<FilesystemSnapshotLimits> | undefined,
): FilesystemSnapshotLimits {
  const limits = { ...defaultLimits, ...overrides }
  for (const [name, value] of Object.entries(limits)) positiveInteger(value, name)
  return Object.freeze(limits)
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`local private workspace ${label} must be a positive safe integer`)
  }
  return value
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`local private workspace ${label} must be a non-negative safe integer`)
  }
  return value
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

async function optionalLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return undefined
    throw error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isWorkspacePhase(value: unknown): value is LocalPrivateWorkspacePhase {
  return typeof value === 'string' && AGENT_WORKSPACE_LEASE_PHASES.includes(value as never)
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value as object)) return value
  seen.add(value as object)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen)
  return Object.freeze(value)
}

export {
  type LocalPrivateWorkspaceRootEntryDisposition,
  LocalPrivateWorkspaceSourceChangedError,
  type LocalPrivateWorkspaceSourcePolicyInput,
  type LocalPrivateWorkspaceSourcePolicyMaterial,
} from './private-workspace-source'
