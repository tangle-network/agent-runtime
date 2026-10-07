import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AgentProfile,
  AgentWorkspaceBranching,
  ForkedEnvironmentRef,
  Sha256Digest,
  WorkspaceForkRequest,
} from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import {
  captureAgentCandidateWorkspaceTreeToArtifacts,
  verifyAgentCandidateWorkspaceTree,
} from '../../src/candidate-execution/workspace-streams'
import { createPrivateCasArtifactPort } from '../../src/runtime/private-cas'
import type { ProviderWorkspaceRetentionPort } from '../../src/runtime/provider-workspace-retention'
import { makeTempRoot } from './temp-root'

export const captureProfile: AgentProfile = { name: 'checkpoint-capture-owner' }

/**
 * Forks and checkpoint captures for a provider fixture: `fork` creates an environment holding a
 * copy of the checkpoint's files, and the port stores a fork's files as a tree in a real private
 * CAS, so a test can read every captured checkpoint back by its digest.
 */
export function checkpointCaptureFixture(options: {
  readonly provider: string
  /** The files a checkpoint holds, or undefined once the provider has deleted it. */
  readonly snapshotFiles: (checkpointId: string) => ReadonlyMap<string, string> | undefined
  readonly failFork?: () => boolean
  readonly failCapture?: () => boolean
  /** The destroy goes unanswered, as when the coordinator dies between capture and teardown. */
  readonly failDestroy?: () => boolean
}) {
  const root = makeTempRoot('checkpoint-capture-')
  const cas = createPrivateCasArtifactPort(join(root, 'cas'), 'checkpoint-capture')
  const forks = new Map<
    string,
    { readonly files: ReadonlyMap<string, string>; readonly ref: ForkedEnvironmentRef }
  >()
  const destroyed = new Set<string>()
  let created = 0
  let captures = 0
  const outcome = (request: WorkspaceForkRequest) => ({
    idempotencyKey: request.idempotencyKey,
    requestDigest: request.requestDigest,
  })
  const branching: Pick<AgentWorkspaceBranching, 'fork' | 'lookupFork' | 'destroyFork'> = {
    fork: async (request) => {
      const known = [...forks.values()].find(
        (fork) => fork.ref.idempotencyKey === request.idempotencyKey,
      )
      if (known !== undefined)
        return { status: 'replayed', ...outcome(request), environment: known.ref }
      if (options.failFork?.() === true)
        return {
          status: 'unknown',
          ...outcome(request),
          message: 'fork refused by the test',
          retryable: true,
        }
      const files = options.snapshotFiles(request.checkpoint.checkpointId)
      if (files === undefined)
        return {
          status: 'unknown',
          ...outcome(request),
          message: 'Requested checkpoint is absent',
          retryable: true,
        }
      const ref: ForkedEnvironmentRef = {
        provider: options.provider,
        environmentId: `fork-${++created}`,
        sourceEnvironmentId: request.checkpoint.source.environmentId,
        source: request.checkpoint.source,
        sourceCheckpointId: request.checkpoint.checkpointId,
        idempotencyKey: request.idempotencyKey,
        requestDigest: request.requestDigest,
        createdAt: new Date(0).toISOString(),
        placement: request.placement,
        confidentialRequested: false,
      }
      forks.set(ref.environmentId, { files: new Map(files), ref })
      return { status: 'created', ...outcome(request), environment: ref }
    },
    lookupFork: async (input) => {
      const known = [...forks.values()].find(
        (fork) => fork.ref.idempotencyKey === input.idempotencyKey,
      )
      return known === undefined
        ? { status: 'not_found', ...input }
        : { status: 'found', ...input, environment: known.ref }
    },
    destroyFork: async (request) => {
      if (options.failDestroy?.() === true) throw new Error('destroy unanswered in the test')
      destroyed.add(request.targetId)
      return { ...request, status: forks.has(request.targetId) ? 'deleted' : 'already_absent' }
    },
  }
  const port: ProviderWorkspaceRetentionPort = {
    timeoutMs: 60_000,
    artifacts: cas,
    capture: async () => {
      throw new Error('not used')
    },
    captureCheckpoint: async ({ environment, executionId, signal }) => {
      if (options.failCapture?.() === true) throw new Error('capture refused by the test')
      const fork = forks.get(environment.id)
      if (fork === undefined || destroyed.has(environment.id))
        throw new Error(`no live fork ${environment.id}`)
      const directory = join(root, `capture-${++captures}`)
      mkdirSync(directory, { recursive: true })
      for (const [path, content] of fork.files) {
        mkdirSync(dirname(join(directory, path)), { recursive: true })
        writeFileSync(join(directory, path), content, { mode: 0o644 })
      }
      try {
        return await captureAgentCandidateWorkspaceTreeToArtifacts(directory, {
          artifactPersistence: { outputArtifacts: cas, executionId, signal },
        })
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  }
  return {
    cas,
    port,
    branching,
    forks,
    destroyed,
    /** The live fork environment of this id, or null. */
    forkEnvironment(id: string): AgentEnvironment | null {
      if (!forks.has(id) || destroyed.has(id)) return null
      return {
        id,
        provider: options.provider,
        status: async () => 'running',
        async *stream() {},
      }
    },
    /** Every file of the tree this digest names, read back from the store. */
    async restore(tree: {
      readonly digest: Sha256Digest
      readonly manifest: Parameters<typeof cas.read>[0]
    }): Promise<Map<string, string>> {
      const material = await verifyAgentCandidateWorkspaceTree(tree, cas)
      const files = new Map<string, string>()
      for (const file of material.files) {
        const ref = await cas.locate!({ sha256: file.sha256, byteLength: file.byteLength })
        if (ref === undefined) throw new Error(`missing ${file.path}`)
        files.set(file.path, Buffer.from(await cas.read(ref)).toString('utf8'))
      }
      return files
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
