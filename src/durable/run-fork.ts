import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  type AgentProfile,
  type AgentProfileDiff,
  canonicalCandidateDigest,
  type Sha256Digest,
  sha256Bytes,
} from '@tangle-network/agent-interface'
import { applyExactAgentProfileDiff } from '../candidate-execution/profile'
import { RuntimeRunStateError, ValidationError } from '../errors'
import { authoredProfileDigest } from '../runtime/supervise/materialization'
import { type SuperviseOptions, superviseRootProfile } from '../runtime/supervise/supervise'
import type { AgentExecutionRef, SpawnEvent } from '../runtime/supervise/types'
import { contentAddress } from './content-address'
import { isNoEntError } from './jsonl-file'
import { readSettleRecord, SETTLE_RECORD_FILE } from './settle-record'
import { FileSpawnJournal, loadSpawnForest } from './spawn-journal'

/**
 * Start a run as a version of a settled run: the parent's recorded root inputs plus one change.
 *
 * The call's `profile`, `task` and `budget` must be the parent's, byte for byte, as its sealed
 * journal records them. Runtime applies `change` to that profile and runs the result in a new
 * run directory. The parent directory is read and never written.
 */
export interface PursuitFork {
  /** The settled parent's run directory. */
  readonly runDir: string
  /** The sha256 of the parent's `result.json` bytes: the sealed point the fork starts from. */
  readonly settleDigest: Sha256Digest
  /** The one change, applied to the parent's root profile. Its `id` is recorded. */
  readonly change: AgentProfileDiff
}

/**
 * The `execution.correlation` keys a fork records on its root. Runtime writes them; a caller that
 * supplies one is refused. `lineageRootRunId` is the first run of the chain of parents, so the
 * spend of every version of one lineage groups under one id.
 */
export const RUN_FORK_CORRELATION_KEYS = Object.freeze([
  'forkParentRunId',
  'forkParentSettleDigest',
  'forkProfileDiffId',
  'lineageRootRunId',
] as const)

/** What `supervisePursuit` executes for a fork: the changed profile and the attributed execution. */
export interface PreparedRunFork {
  readonly profile: AgentProfile
  readonly execution: AgentExecutionRef
}

type SpawnedEvent = Extract<SpawnEvent, { kind: 'spawned' }>

/**
 * Verify the parent and derive the fork's profile and attribution. It reads only the parent, so
 * a refused fork spends nothing and writes nothing.
 */
export async function prepareRunFork(
  profile: AgentProfile,
  task: unknown,
  opts: SuperviseOptions & { readonly runId?: string; readonly runDir: string },
  fork: PursuitFork,
): Promise<PreparedRunFork> {
  const change = fork.change
  if (typeof change?.id !== 'string' || change.id.trim().length === 0) {
    throw new ValidationError('supervisePursuit fork: change.id must be a non-empty string')
  }
  const parentDir = await realDirectory(fork.runDir, 'fork.runDir')
  const forkDir = await realDirectory(opts.runDir, 'runDir', true)
  // A fork at, inside or around the parent's directory would write into the parent.
  if (contains(parentDir, forkDir) || contains(forkDir, parentDir)) {
    throw new ValidationError(
      `supervisePursuit fork: runDir ${forkDir} overlaps the parent's runDir ${parentDir}; a fork needs its own directory outside the parent's`,
    )
  }

  // The seal: the exact bytes Runtime wrote once at the parent's settle.
  let bytes: Uint8Array
  try {
    bytes = await readFile(resolve(parentDir, SETTLE_RECORD_FILE))
  } catch (error) {
    if (!isNoEntError(error)) throw error
    throw new RuntimeRunStateError(
      `supervisePursuit fork: ${parentDir} holds no ${SETTLE_RECORD_FILE}; only a settled run is forked`,
    )
  }
  const observed = sha256Bytes(bytes)
  if (observed !== fork.settleDigest) {
    throw new RuntimeRunStateError(
      `supervisePursuit fork: ${SETTLE_RECORD_FILE} hashes to ${observed}, not the requested ${fork.settleDigest}`,
    )
  }
  const settled = await readSettleRecord(parentDir)
  if (settled === undefined) {
    throw new RuntimeRunStateError(`supervisePursuit fork: ${parentDir} lost its settle record`)
  }
  const parentRunId = settled.tree.root
  if ((opts.runId ?? 'supervise') === parentRunId) {
    throw new ValidationError(
      `supervisePursuit fork: runId '${parentRunId}' is the parent's; a fork needs its own runId`,
    )
  }

  // Certainty: a node the parent never settled may still act, so a fork could duplicate it.
  const forest = await loadSpawnForest(
    new FileSpawnJournal(resolve(parentDir, 'spawn-journal.jsonl')),
    parentRunId,
  )
  const uncertain = [
    ...forest.inDoubt.map((node) => `${node.nodeId} (no terminal record)`),
    ...forest.missingTrees.map((tree) => `${tree.ownerNodeId} (tree ${tree.root} never begun)`),
    ...(settled.teardownUnconfirmed ?? []).map((node) => `${node.id} (teardown unconfirmed)`),
  ]
  if (uncertain.length > 0 || settled.tree.inFlight > 0) {
    throw new RuntimeRunStateError(
      `supervisePursuit fork: run '${parentRunId}' has uncertain nodes: ${uncertain.join(', ') || `${settled.tree.inFlight} in flight`}`,
    )
  }

  // Inputs: the fork differs from its parent by the change alone.
  const root = forest.trees[0]?.events.find(
    (event): event is SpawnedEvent => event.kind === 'spawned' && event.parent === undefined,
  )
  const recorded = root?.identity
  if (recorded?.profileDigest === undefined || recorded.taskDigest === undefined) {
    throw new RuntimeRunStateError(
      `supervisePursuit fork: run '${parentRunId}' records no root profile and task digest`,
    )
  }
  const mismatches = [
    authoredProfileDigest(superviseRootProfile(profile, opts.profileGuidance)) !==
    recorded.profileDigest
      ? `profile is not the parent's ${recorded.profileDigest}`
      : undefined,
    digestOrUndefined(task) !== recorded.taskDigest
      ? `task is not the parent's ${recorded.taskDigest}`
      : undefined,
    contentAddress(root?.budget) !== contentAddress(opts.budget)
      ? "budget is not the parent's"
      : undefined,
  ].filter((mismatch): mismatch is string => mismatch !== undefined)
  if (mismatches.length > 0) {
    throw new ValidationError(`supervisePursuit fork: ${mismatches.join('; ')}`)
  }

  const forked = applyExactAgentProfileDiff(profile, change, 'supervisePursuit fork')
  if (
    authoredProfileDigest(superviseRootProfile(forked, opts.profileGuidance)) ===
    recorded.profileDigest
  ) {
    throw new ValidationError(
      `supervisePursuit fork: change '${change.id}' leaves the parent's profile unchanged`,
    )
  }

  const supplied = opts.execution?.correlation ?? {}
  const owned = RUN_FORK_CORRELATION_KEYS.filter((key) => Object.hasOwn(supplied, key))
  if (owned.length > 0) {
    throw new ValidationError(
      `supervisePursuit fork: execution.correlation cannot set ${owned.join(', ')}; Runtime records them`,
    )
  }
  return Object.freeze({
    profile: forked,
    execution: Object.freeze({
      ...opts.execution,
      correlation: Object.freeze({
        ...supplied,
        forkParentRunId: parentRunId,
        forkParentSettleDigest: fork.settleDigest,
        forkProfileDiffId: change.id,
        lineageRootRunId: recorded.correlation?.lineageRootRunId ?? parentRunId,
      }),
    }),
  })
}

function digestOrUndefined(value: unknown): Sha256Digest | undefined {
  try {
    return canonicalCandidateDigest(value)
  } catch {
    return undefined
  }
}

/**
 * Resolve a directory through symlinks. The fork's own directory may not exist yet; it resolves
 * through its nearest existing ancestor, so a symlinked ancestor cannot hide an overlap.
 */
async function realDirectory(path: string, name: string, mayBeAbsent = false): Promise<string> {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new ValidationError(`supervisePursuit fork: ${name} must be a non-empty string`)
  }
  const absolute = resolve(path.trim())
  try {
    return await realpath(absolute)
  } catch (error) {
    const ancestor = dirname(absolute)
    if (!mayBeAbsent || !isNoEntError(error) || ancestor === absolute) throw error
    return join(await realDirectory(ancestor, name, true), basename(absolute))
  }
}

/** Whether `inner` is `outer` or lies beneath it. */
function contains(outer: string, inner: string): boolean {
  const path = relative(outer, inner)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}
