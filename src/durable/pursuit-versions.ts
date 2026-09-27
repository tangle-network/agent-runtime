/**
 * The pursuit version chain, on Eval's search kernel (`runSearch`).
 *
 * A version is a search node: the exact AgentProfile it executes, content-addressed by
 * `canonicalAgentProfileDigest`. Every later version is an edge from the version the chain keeps,
 * whose diff is the one change `next` returned, and one cell: a `supervisePursuit` run of the
 * version, forked from its parent's sealed `result.json`, then scored by the outside judge. The
 * policy is the kernel's hill climb, `incumbent({ patience, minImprovement })`. The search ledger
 * at `<runDir>.search/ledger.jsonl` is the chain's only record and its only checkpoint: a call on
 * a closed chain reads it back, and a call on an open chain continues it.
 */

import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  developmentClaim,
  incumbent,
  openSearchLedger,
  parseSearchLedgerLine,
  runSearch,
  type SearchArtifactCodec,
  type SearchArtifactRef,
  type SearchAttemptAccounting,
  type SearchAudit,
  type SearchCellResult,
  type SearchCellSettledEvent,
  type SearchCloseReason,
  type SearchExecutionIdentity,
  type SearchExecutor,
  type SearchHistoryReceipt,
  type SearchNode,
  type SearchProposerPort,
  SearchRecorder,
  type SearchSourceRef,
  type SearchTaskOutcome,
  uniform,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfile,
  type AgentProfileDiff,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  type Sha256Digest,
  sha256Bytes,
} from '@tangle-network/agent-interface'
import { applyExactAgentProfileDiff } from '../candidate-execution/profile'
import { RuntimeRunStateError, ValidationError } from '../errors'
import { type CheckVerdict, failedItems } from '../runtime/supervise/continuation'
import { authoredProfileDigest } from '../runtime/supervise/materialization'
import { superviseRootProfile } from '../runtime/supervise/supervise'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import type { SpawnEvent, Spend, SupervisedResult } from '../runtime/supervise/types'
import { isNoEntError } from './jsonl-file'
import { FileObserverJournal } from './observer-journal'
import { projectPursuit } from './observer-projection'
import type { PursuitFork } from './run-fork'
import { readSettleRecord, SETTLE_RECORD_FILE } from './settle-record'
import { FileSpawnJournal } from './spawn-journal'
import type { SupervisedPursuitResult, SupervisePursuitOptions } from './supervise-pursuit'

/**
 * Continue a pursuit across versions: after each version settles, an outside judge scores it, and
 * the next version forks from the version the chain keeps with one change, until the stop rule
 * ends the chain.
 */
export interface PursuitVersions {
  /** Scores each settled version from outside its tree: the run's declared check
   *  (`declaredCheckJudge`), or any judge with a digest. */
  readonly judge: VersionJudge
  /** The change the next version applies to the kept version's profile. `'review-of-best'`
   *  mounts the kept version's verdict under `inputs/review/`, replaces any earlier review, and
   *  gives the next version's continuation note the kept version's per-item verdict as its bar. */
  readonly next: NextPursuitVersion | 'review-of-best'
  /** When the chain stops. Every cap is required: a chain without one is refused. */
  readonly stop: PursuitVersionStop
}

/** The chain's stop rule. The chain never starts a version once a cap is reached. */
export interface PursuitVersionStop {
  /** Stop after this many proposed versions in a row that did not take the lead. */
  readonly patience: number
  /** At most this many versions, the first included. A change the chain refuses counts as one. */
  readonly maxVersions: number
  /**
   * The chain's dollars: settled versions' spend plus a hold for the next one. A version's
   * unknown spend counts as its proven floor. A version's own `budget.maxUsd` is the hold, and
   * bounds that version in flight; without it the hold is 0.
   */
  readonly maxUsd: number
  /** The chain's wall clock, from its first version's start. A running version is aborted at it. */
  readonly deadlineMs: number
  /** A version takes the lead when its score beats the kept version's by more than this.
   *  Default 0. */
  readonly minImprovement?: number
}

/** An outside judge. Runtime calls it after a version's settle record exists, never inside the
 *  version's tree, and gives it no handle into that tree. Place it where you like, such as its own
 *  sandbox through `runIsolatedCheck({ box })`. */
export interface VersionJudge {
  /** The sha256 of the judge's code and configuration. Every verdict must carry it, and a chain
   *  whose ledger was opened under another digest is refused. */
  readonly digest: Sha256Digest
  judge(version: SettledPursuitVersion, signal: AbortSignal): Promise<VersionVerdict>
}

export interface VersionVerdict {
  /** Higher is better. `null` when the judge could not score the version: the cell is recorded
   *  unscored and retried, and an unscored version never takes the lead. */
  readonly score: number | null
  /** Must equal `VersionJudge.digest`. */
  readonly judgeDigest: Sha256Digest
  /** What the judge measured, retained verbatim in the ledger. JSON values only. */
  readonly detail?: unknown
  /** The check's per-item verdict, when the judge is a check: what `'review-of-best'` mounts and
   *  what the next version's bar compares against. */
  readonly check?: CheckVerdict
}

/** A settled version, as the judge and `next` read it. */
export interface SettledPursuitVersion {
  /** 1 for the first version: the node's registration ordinal plus 1. */
  readonly version: number
  /** The version's node in the chain's search ledger. */
  readonly nodeId: string
  readonly runId: string
  readonly runDir: string
  /** The sha256 of the version's `result.json` bytes: its seal. */
  readonly settleDigest: Sha256Digest
  readonly result: SupervisedResult<unknown>
  /** The profile the version executed: the first version's, or its parent's plus its change. */
  readonly profile: AgentProfile
  /** The version it forked from. Absent for the first version. */
  readonly parent?: {
    readonly version: number
    readonly runId: string
    readonly settleDigest: Sha256Digest
  }
  readonly change?: AgentProfileDiff
}

export interface JudgedPursuitVersion extends SettledPursuitVersion {
  readonly verdict: VersionVerdict
}

export interface NextPursuitVersionInput {
  /** The version the next one forks from: the version the chain keeps. */
  readonly best: JudgedPursuitVersion
  /** The most recently judged version. */
  readonly last: JudgedPursuitVersion
  /** Every judged version, first first. */
  readonly versions: readonly JudgedPursuitVersion[]
}

/** Build the one change the next version applies to `best.profile`. Its `id` must be non-empty. */
export type NextPursuitVersion = (
  input: NextPursuitVersionInput,
  signal: AbortSignal,
) => AgentProfileDiff | Promise<AgentProfileDiff>

/** The chain as its search ledger records it, returned beside the kept version's result. */
export interface PursuitVersionChain {
  /** `<runDir>.search/ledger.jsonl`: the chain's only record and checkpoint. */
  readonly ledgerPath: string
  readonly searchId: string
  /** Why the chain stopped: the kernel's close reason (`patience`, `max-nodes`, `budget`,
   *  `deadline` or `converged`). */
  readonly reason: SearchCloseReason
  /** The kept version's number: the kernel's leader when the chain closed. */
  readonly best: number
  /** Every judged version, first first. */
  readonly versions: readonly JudgedPursuitVersion[]
  /** Known dollars, proven floors of unknown ones, and the counts of each. */
  readonly spend: SearchAudit['spend']
  /** A bounded receipt over the exact ledger bytes. */
  readonly receipt: SearchHistoryReceipt
}

/** Where `'review-of-best'` mounts a review: `inputs/review/version-<n>.md`. One review lives in
 *  a profile at a time. */
export const REVIEW_DIR = 'inputs/review/'

/** The chain's directory beside the first version's: the ledger and its content blobs. */
export function pursuitVersionsLedgerPath(runDir: string): string {
  return resolve(`${resolve(runDir.trim())}.search`, 'ledger.jsonl')
}

/**
 * Validate a `versions` option before any compute. The same check runs inside `supervisePursuit`;
 * a caller that records the option as data can run it at preflight.
 */
export function assertPursuitVersions(versions: unknown): asserts versions is PursuitVersions {
  const fail = (message: string): never => {
    throw new ValidationError(`supervisePursuit versions: ${message}`)
  }
  if (typeof versions !== 'object' || versions === null) fail('must be an object')
  const option = versions as Record<string, unknown>
  const extra = Object.keys(option).filter((key) => !['judge', 'next', 'stop'].includes(key))
  if (extra.length > 0) fail(`unknown fields: ${extra.join(', ')}`)
  const { judge, next, stop } = option
  if (
    typeof judge !== 'object' ||
    judge === null ||
    typeof (judge as VersionJudge).judge !== 'function'
  ) {
    fail('judge must be a VersionJudge, such as declaredCheckJudge(check)')
  } else if (!isSha256((judge as VersionJudge).digest)) {
    fail('judge.digest must be a sha256 digest (sha256:<64 hex>)')
  }
  if (next !== 'review-of-best' && typeof next !== 'function') {
    fail("next must be a function or 'review-of-best'")
  }
  if (typeof stop !== 'object' || stop === null) fail('stop must be an object')
  const rule = stop as Record<string, unknown>
  const known = new Set(['patience', 'maxVersions', 'maxUsd', 'deadlineMs', 'minImprovement'])
  const unknown = Object.keys(rule).filter((key) => !known.has(key))
  if (unknown.length > 0) fail(`stop has unknown fields: ${unknown.join(', ')}`)
  for (const key of ['patience', 'maxVersions'] as const) {
    if (!Number.isInteger(rule[key]) || (rule[key] as number) < 1) {
      fail(`stop.${key} must be an integer of at least 1`)
    }
  }
  for (const key of ['maxUsd', 'deadlineMs'] as const) {
    if (!isFiniteNumber(rule[key]) || (rule[key] as number) <= 0) {
      fail(`stop.${key} must be a finite number above 0`)
    }
  }
  if (
    rule.minImprovement !== undefined &&
    (!isFiniteNumber(rule.minImprovement) || rule.minImprovement < 0)
  ) {
    fail('stop.minImprovement must be a finite number of at least 0')
  }
}

/** Every rule the chain adds to the kernel's. Its digest, with the stop rule, is the process
 *  revision the ledger records, so a changed rule or stop rule is a different search. */
const VERSION_CHAIN_DEFINITION = {
  name: 'agent-runtime.pursuit-versions.2026-09',
  node: 'the exact AgentProfile a version executes, content-addressed by canonicalAgentProfileDigest; a change that does not apply is a node addressed by its parent digest and change, and refused',
  edge: 'one change from the kept version, stored as its Interface profile diff',
  cell: 'one supervisePursuit run of the version on the pursuit task, forked from its parent sealed result.json, then scored by the outside judge; a settled version directory is read back after its root identity and fork seal are checked',
  outcome:
    'a scored winner passes; a scored no-winner fails with its reason; an unscored version is a retryable error; a run that throws fails the call and leaves its cell open',
  deadline: 'the chain deadline aborts a running version; its judge still runs',
  directories: 'version n runs at <runDir>.v<n> with run id <runId>.v<n>; version 1 at <runDir>',
} as const

const VERSION_CHAIN_URI = 'npm:@tangle-network/agent-runtime#supervisePursuit.versions'
/** The pursuit task's one train task. */
const TASK_ID = 'pursuit'
const LANE = 'in-process'
/** The longest delay Node's setTimeout honors. */
const MAX_TIMER_MS = 2_147_483_647

type RunOne = (
  profile: SupervisorProfile,
  task: unknown,
  opts: SupervisePursuitOptions,
) => Promise<SupervisedPursuitResult<SupervisedResult<unknown>>>

/** A search node's artifact: a version's profile, or a change that did not apply. */
interface VersionNode {
  readonly profile: AgentProfile | null
  /** The change from the parent; set on a node a proposal returned in this process. */
  readonly change?: AgentProfileDiff
  readonly parentDigest?: Sha256Digest
  readonly refusal: string | null
}

/** One node of the chain, as the ledger records it. */
interface VersionRecord {
  readonly nodeId: string
  readonly version: number
  readonly runId: string
  readonly runDir: string
  /** Null for a change that did not apply. */
  readonly profile: AgentProfile | null
  readonly parentNodeId: string | null
  /** The change from the parent, from the node's first edge. */
  readonly change?: AgentProfileDiff
  /** The latest settled attempt's seal and verdict. */
  readonly seal?: SearchArtifactRef
  readonly verdict?: VersionVerdict
  /** Every seal an attempt recorded: a version's spend is recorded once, by the first. */
  readonly seals: ReadonlySet<string>
}

/** Run a version chain. `supervisePursuit` calls this when `versions` is set. */
export async function runPursuitVersions(
  profile: SupervisorProfile,
  task: unknown,
  opts: SupervisePursuitOptions & { readonly versions: PursuitVersions },
  runOne: RunOne,
): Promise<SupervisedPursuitResult<SupervisedResult<unknown>> & { versions: PursuitVersionChain }> {
  const { versions, fork: firstFork, signal: callerSignal, ...base } = opts
  assertPursuitVersions(versions)
  for (const key of ['journal', 'blobs', 'rootHandle', 'steerDir'] as const) {
    if (base[key] !== undefined) {
      throw new ValidationError(
        `supervisePursuit versions: ${key} names one run, and a version chain has one per version; omit it`,
      )
    }
  }
  if (versions.next === 'review-of-best' && base.continuation?.profile.review === undefined) {
    throw new ValidationError(
      "supervisePursuit versions: next 'review-of-best' needs continuation.profile.review, the words the next version reads about its review",
    )
  }
  const { judge, stop } = versions
  if (base.budget.maxUsd !== undefined && base.budget.maxUsd > stop.maxUsd) {
    throw new ValidationError(
      `supervisePursuit versions: budget.maxUsd ${base.budget.maxUsd} is above stop.maxUsd ${stop.maxUsd}, so no version could start`,
    )
  }
  const next: NextPursuitVersion =
    versions.next === 'review-of-best'
      ? reviewOfBest(base.runId ?? 'supervise', base.continuation?.profile.review ?? '')
      : versions.next
  const now = base.now ?? Date.now
  const pursuitId = base.pursuitId.trim()
  const runDir = resolve(base.runDir.trim())
  const runId = base.runId ?? 'supervise'
  const ledgerPath = pursuitVersionsLedgerPath(runDir)
  const searchId = `versions:${pursuitId}:${runId}`
  const retired = resolve(`${runDir}.versions`, 'versions.jsonl')
  if (await exists(retired)) {
    throw new ValidationError(
      `supervisePursuit versions: ${retired} holds a chain in the retired versions.jsonl format; finish it on the agent-runtime release that wrote it, or start a new chain in another runDir`,
    )
  }

  // The first version's executed profile; later versions derive theirs from their parent's.
  const firstProfile = (
    firstFork === undefined
      ? profile
      : applyExactAgentProfileDiff(profile, firstFork.change, 'supervisePursuit versions')
  ) as AgentProfile
  const taskRevision = digestOf(task, 'task')
  const identity = (nodeProfile: AgentProfile): SearchExecutionIdentity => ({
    model: {
      provider: 'agent-runtime',
      alias: 'supervisePursuit',
      unknown: "a version runs every model its tree chose; the version's settle record names them",
    },
    agent: {
      uri: `agent-profile:${pursuitId}`,
      revision: canonicalAgentProfileDigest(nodeProfile),
    },
    benchmark: { uri: `pursuit:${pursuitId}`, revision: taskRevision },
  })

  const ledger = openSearchLedger({ path: ledgerPath, searchId })
  const opened = (await ledger.state()).header
  // The chain's clock starts with its first version, or when the chain opened on a first version
  // that had already settled. A resumed chain keeps the deadline its ledger recorded.
  const deadline =
    opened?.budget.deadline ??
    new Date(now() - settledElapsed(await readSettleRecord(runDir)) + stop.deadlineMs).toISOString()
  const policy = incumbent({
    patience: stop.patience,
    ...(stop.minImprovement === undefined ? {} : { minImprovement: stop.minImprovement }),
  })
  const allocation = uniform()
  const recorder = await SearchRecorder.open(
    { ledger, now },
    {
      subject: pursuitId,
      process: {
        name: 'pursuit-versions',
        executionRef: {
          uri: VERSION_CHAIN_URI,
          revision: canonicalCandidateDigest({
            ...VERSION_CHAIN_DEFINITION,
            stop: canonicalStop(stop),
          }),
        },
      },
      artifactKind: 'agent-profile',
      objective: {
        metric: 'version-judge-score',
        direction: 'maximize',
        judge: { uri: 'agent-runtime:version-judge', revision: judge.digest },
        claim: developmentClaim(pursuitId),
      },
      splits: {
        train: [
          {
            taskId: TASK_ID,
            unitId: TASK_ID,
            source: { uri: `pursuit:${pursuitId}`, revision: taskRevision },
          },
        ],
        selection: [],
        test: [],
        heldOutUnits: true,
      },
      policy: { expansion: policy.name, allocation: allocation.name, seed: 0 },
      budget: {
        maxUsd: stop.maxUsd,
        maxCells: null,
        maxNodes: stop.maxVersions,
        deadline,
        maxConcurrency: 1,
        reservedClaimUsd: 0,
      },
      containment: null,
      derivedFrom: null,
      identity: identity(firstProfile),
    },
  )

  // The chain's deadline aborts a running version. A timer longer than 2^31 - 1 ms fires at once
  // in Node, so a long chain re-arms in steps.
  const deadlineAt = Date.parse(deadline)
  const expired = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    const remaining = deadlineAt - now()
    if (remaining <= 0) {
      expired.abort(new Error('the version chain reached its deadline'))
      return
    }
    timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS))
    timer.unref?.()
  }
  arm()

  const codec: SearchArtifactCodec<VersionNode> = {
    node(store, node) {
      if (node.profile !== null) {
        const artifact = store.blob('agent-profile', {
          kind: 'agent-profile',
          profile: node.profile,
        })
        return {
          artifactDigest: canonicalAgentProfileDigest(node.profile),
          artifact,
          surfaces: [{ surfaceId: 'profile', kind: 'agent-profile', artifact }],
        }
      }
      const refused = {
        kind: 'unapplied-change',
        parentDigest: node.parentDigest ?? null,
        change: node.change ?? null,
      }
      const artifact = store.blob('change', { ...refused, refusal: node.refusal })
      return {
        artifactDigest: canonicalCandidateDigest(refused),
        artifact,
        surfaces: [{ surfaceId: 'profile', kind: 'agent-profile', artifact }],
      }
    },
    diff(store, parent, child) {
      if (parent.profile === null || child.profile === null || child.change === undefined) {
        return { unknown: 'a refused change has no profile to diff' }
      }
      const from = canonicalAgentProfileDigest(parent.profile)
      if (child.parentDigest !== from) {
        return { unknown: 'the change was written against another parent' }
      }
      return store.blob('diff', {
        kind: 'agent-profile-diff',
        from,
        to: canonicalAgentProfileDigest(child.profile),
        diffs: [child.change],
      })
    },
    load(store, node) {
      return loadNode(store, node)
    },
  }

  const executor: SearchExecutor<VersionNode> = {
    lanes: () => [
      { name: LANE, capacity: 1, costCap: 'estimate', cellUsd: base.budget.maxUsd ?? 0 },
    ],
    place: () => LANE,
    // A version that settled is read back from its directory by `run`, so nothing is adopted.
    adopt: async () => null,
    async run(work) {
      const chain = await versionsOf()
      const record = chain.get(work.nodeId)
      if (record?.profile == null) {
        throw new RuntimeRunStateError(`version node ${work.nodeId} has no profile to run`)
      }
      const parent = record.parentNodeId === null ? undefined : chain.get(record.parentNodeId)
      if (parent !== undefined && (parent.seal === undefined || parent.profile === null)) {
        throw new RuntimeRunStateError(`version ${record.version}'s parent has no sealed result`)
      }
      // A version whose run throws fails the call and leaves its cell open: Runtime's driver
      // retry already ran, and calling again resumes the version in its own directory.
      if ((await readSettleRecord(record.runDir)) === undefined) {
        await runVersion(record, parent, AbortSignal.any([work.signal, expired.signal]))
      }
      const { settled, byteLength } = await readVersion(record, parent)
      // A retried cell reads the same sealed run back and only judges it again; the run's spend
      // was recorded by the attempt that first recorded its seal.
      const charged = !record.seals.has(settled.settleDigest)
      const verdict = await judgeVersion(settled, work.signal)
      return cellResult(settled, byteLength, verdict, work.lane, charged)
    },
  }

  const proposerSource: SearchSourceRef = {
    uri:
      versions.next === 'review-of-best'
        ? `${VERSION_CHAIN_URI}.review-of-best`
        : `${VERSION_CHAIN_URI}.next`,
    revision: canonicalCandidateDigest({
      next:
        versions.next === 'review-of-best'
          ? 'review-of-best'
          : Function.prototype.toString.call(versions.next),
    }),
  }
  const proposer: SearchProposerPort<VersionNode> = {
    name: versions.next === 'review-of-best' ? 'review-of-best' : 'next',
    kind: 'optimizer',
    source: proposerSource,
    execution: { kind: 'deterministic', source: proposerSource },
    childrenPerProposal: 1,
    async propose(request) {
      const parent = request.parents[0]!
      const judged = await judgedVersions(await versionsOf())
      const best = judged.find((version) => version.nodeId === parent.nodeId)
      if (best === undefined || parent.artifact.profile === null) {
        throw new RuntimeRunStateError(
          `supervisePursuit versions: the kept version ${parent.nodeId} has no judged run to fork from`,
        )
      }
      const change = await next(
        { best, last: judged.at(-1)!, versions: Object.freeze(judged) },
        request.signal,
      )
      if (typeof change?.id !== 'string' || change.id.trim().length === 0) {
        throw new ValidationError('supervisePursuit versions: next must return a change with an id')
      }
      const parentDigest = canonicalAgentProfileDigest(parent.artifact.profile)
      let child: VersionNode
      try {
        child = {
          profile: applyExactAgentProfileDiff(
            parent.artifact.profile,
            change,
            'supervisePursuit versions',
          ),
          change,
          parentDigest,
          refusal: null,
        }
      } catch (error) {
        child = { profile: null, change, parentDigest, refusal: errorMessage(error) }
      }
      return {
        children: [
          {
            artifact: child,
            label: change.title ?? change.id,
            rationale: (change.source?.notes ?? []).join('\n'),
          },
        ],
        accounting:
          versions.next === 'review-of-best'
            ? FREE
            : {
                tokens: { status: 'unknown', reason: "the caller's next reports no usage" },
                cost: {
                  status: 'unknown',
                  knownLowerBoundUsd: 0,
                  reason: "the caller's next reports no spend",
                },
              },
      }
    },
  }

  try {
    const closed = await runSearch({
      recorder,
      root: { profile: firstProfile, refusal: null },
      codec,
      policy,
      allocation,
      proposer,
      executor,
      admit: (node) => node.refusal,
      ...(callerSignal === undefined ? {} : { signal: callerSignal }),
      now,
    })
    const judged = await judgedVersions(await versionsOf())
    const best = judged.find((version) => version.nodeId === closed.leader)
    if (best === undefined) {
      throw new RuntimeRunStateError(
        `supervisePursuit versions: the chain in ${ledgerPath} closed (${closed.reason}) without a judged version to keep`,
      )
    }
    const observerPath = resolve(best.runDir, 'observer.jsonl')
    return Object.freeze({
      result: best.result,
      pursuit: projectPursuit(await new FileObserverJournal(observerPath, pursuitId).read()),
      observerPath,
      settlePath: resolve(best.runDir, SETTLE_RECORD_FILE),
      versions: Object.freeze({
        ledgerPath,
        searchId,
        reason: closed.reason,
        best: best.version,
        versions: Object.freeze(judged),
        spend: closed.state.audit.spend,
        receipt: recorder.receipt({ producerId: 'pursuit-versions', runId }),
      }),
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }

  /** Run one version: the first as the call's own run, a later one as a fork of its parent. */
  async function runVersion(
    record: VersionRecord,
    parent: VersionRecord | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    if (parent === undefined || record.change === undefined) {
      await runOne(profile, task, {
        ...base,
        runId: record.runId,
        runDir: record.runDir,
        ...(firstFork === undefined ? {} : { fork: firstFork }),
        signal,
      })
      return
    }
    // A version starts a new tree and never replays its parent's children, so a parent that
    // settled with a child still in doubt (a deadline or a driver failure leaves them) is forked,
    // and the version's root records those nodes.
    const fork: PursuitFork = {
      runDir: parent.runDir,
      settleDigest: parent.seal!.sha256 as Sha256Digest,
      change: record.change,
      acceptUncertain: true,
    }
    // The version's continuation note states the bar against the version it forks from.
    const check = parent.verdict?.check
    await runOne(parent.profile!, task, {
      ...base,
      ...(base.continuation !== undefined && check !== undefined
        ? {
            continuation: {
              ...base.continuation,
              best: { label: `v${parent.version}`, verdict: check },
            },
          }
        : {}),
      runId: record.runId,
      runDir: record.runDir,
      fork,
      signal,
    })
  }

  /**
   * Read a settled version back and check it is this node's run: its root ran the node's profile
   * and, for a fork, recorded the parent's seal and the change. A directory that holds another
   * run is refused, never adopted.
   */
  async function readVersion(
    record: VersionRecord,
    parent: VersionRecord | undefined,
  ): Promise<{ settled: SettledPursuitVersion; byteLength: number }> {
    const { bytes, result } = await readSealed(record.runDir, record.version)
    if (result.tree.root !== record.runId) {
      throw new RuntimeRunStateError(
        `supervisePursuit versions: ${record.runDir} holds run '${result.tree.root}', not version ${record.version}'s '${record.runId}'`,
      )
    }
    const events = await new FileSpawnJournal(
      resolve(record.runDir, 'spawn-journal.jsonl'),
    ).loadTree(record.runId)
    const root = events?.find(
      (event): event is Extract<SpawnEvent, { kind: 'spawned' }> =>
        event.kind === 'spawned' && event.parent === undefined,
    )
    const ran = root?.identity?.profileDigest
    const expected = authoredProfileDigest(
      superviseRootProfile(record.profile!, base.profileGuidance),
    )
    const correlation = root?.identity?.correlation
    const fork =
      parent !== undefined
        ? { settleDigest: parent.seal?.sha256, changeId: record.change?.id }
        : firstFork === undefined
          ? undefined
          : { settleDigest: firstFork.settleDigest, changeId: firstFork.change.id }
    const mismatch = [
      ran !== expected ? `its root ran profile ${ran}, not ${expected}` : undefined,
      fork !== undefined && correlation?.forkParentSettleDigest !== fork.settleDigest
        ? `its root forked from seal ${correlation?.forkParentSettleDigest}, not ${fork.settleDigest}`
        : undefined,
      fork !== undefined && correlation?.forkProfileDiffId !== fork.changeId
        ? `its root applied change ${correlation?.forkProfileDiffId}, not ${fork.changeId}`
        : undefined,
    ].filter((item): item is string => item !== undefined)
    if (mismatch.length > 0) {
      throw new RuntimeRunStateError(
        `supervisePursuit versions: version ${record.version} at ${record.runDir} is not this chain's run: ${mismatch.join('; ')}`,
      )
    }
    const settled = versionOf(record, parent, bytes, result)
    return { settled, byteLength: bytes.byteLength }
  }

  async function judgeVersion(
    settled: SettledPursuitVersion,
    signal: AbortSignal,
  ): Promise<VersionVerdict> {
    const verdict = await judge.judge(settled, signal)
    if (typeof verdict !== 'object' || verdict === null) {
      throw new ValidationError('supervisePursuit versions: the judge returned no verdict')
    }
    if (verdict.judgeDigest !== judge.digest) {
      throw new ValidationError(
        `supervisePursuit versions: the verdict for version ${settled.version} carries ${String(verdict.judgeDigest)}, not the pinned judge ${judge.digest}`,
      )
    }
    if (verdict.score !== null && !isFiniteNumber(verdict.score)) {
      throw new ValidationError(
        'supervisePursuit versions: a verdict score must be a finite number or null',
      )
    }
    // The ledger keeps the verdict as JSON; a value JSON cannot hold is refused here.
    return JSON.parse(JSON.stringify(verdict)) as VersionVerdict
  }

  function cellResult(
    settled: SettledPursuitVersion,
    byteLength: number,
    verdict: VersionVerdict,
    lane: string,
    charged: boolean,
  ): SearchCellResult {
    const spent = settled.result.spentTotal
    const settlePath = resolve(settled.runDir, SETTLE_RECORD_FILE)
    const outcome: SearchTaskOutcome =
      verdict.score === null
        ? {
            status: 'errored',
            metrics: {},
            error: {
              code: 'unscored',
              message: `the judge could not score version ${settled.version}`,
              retryable: true,
            },
          }
        : settled.result.kind === 'winner'
          ? { status: 'passed', score: verdict.score, metrics: {} }
          : {
              status: 'failed',
              score: verdict.score,
              metrics: {},
              failure: {
                code: settled.result.reason,
                message: `version ${settled.version} settled without a winner: ${settled.result.reason}`,
              },
            }
    return {
      outcome,
      accounting: charged ? versionAccounting(spent) : FREE,
      identity: identity(settled.profile),
      boxMinutes:
        charged && isFiniteNumber(spent.boxMinutes) && spent.boxMinutesKnown !== false
          ? spent.boxMinutes
          : null,
      wallMs: charged && isFiniteNumber(spent.ms) ? Math.max(0, Math.round(spent.ms)) : null,
      placement: { lane, boxId: null },
      traceRef: {
        unknown: `version ${settled.version} is run ${settled.runId}; the chain records no trace id`,
      },
      artifacts: [
        {
          role: 'settle-record',
          uri: pathToFileURL(settlePath).href,
          sha256: settled.settleDigest,
          byteLength,
        },
        recorder.blob('verdict', {
          kind: 'version-verdict',
          version: settled.version,
          runId: settled.runId,
          verdict,
        }),
      ],
    }
  }

  /** A version as the judge and `next` read it. */
  function versionOf(
    record: VersionRecord,
    parent: VersionRecord | undefined,
    bytes: Uint8Array,
    result: SupervisedResult<unknown>,
  ): SettledPursuitVersion {
    return Object.freeze({
      version: record.version,
      nodeId: record.nodeId,
      runId: record.runId,
      runDir: record.runDir,
      settleDigest: sha256Bytes(bytes),
      result,
      profile: record.profile!,
      ...(parent?.seal === undefined
        ? {}
        : {
            parent: {
              version: parent.version,
              runId: parent.runId,
              settleDigest: parent.seal.sha256 as Sha256Digest,
            },
          }),
      ...(record.change === undefined ? {} : { change: record.change }),
    })
  }

  /** Every version whose latest settled cell carries a verdict, first first, each read back from
   *  its sealed `result.json`. */
  async function judgedVersions(
    chain: ReadonlyMap<string, VersionRecord>,
  ): Promise<JudgedPursuitVersion[]> {
    const judged: JudgedPursuitVersion[] = []
    for (const record of chain.values()) {
      if (record.seal === undefined || record.verdict === undefined) continue
      const { bytes, result } = await readSealed(record.runDir, record.version)
      if (sha256Bytes(bytes) !== record.seal.sha256) {
        throw new RuntimeRunStateError(
          `supervisePursuit versions: version ${record.version}'s result.json changed after it was judged`,
        )
      }
      const parent = record.parentNodeId === null ? undefined : chain.get(record.parentNodeId)
      judged.push(
        Object.freeze({ ...versionOf(record, parent, bytes, result), verdict: record.verdict }),
      )
    }
    return judged
  }

  /**
   * Every node of the chain, in registration order, from the ledger. The state holds cells, not
   * their events' artifacts, so each cell's seal and verdict are read from the ledger lines the
   * state verified, through Eval's own line parser.
   */
  async function versionsOf(): Promise<Map<string, VersionRecord>> {
    // Take what the state holds before any await: an append retires the view.
    const state = await recorder.state()
    const head = state.head?.sequence ?? -1
    const nodes = state.nodes().map((node) => ({
      node,
      cellId: state.cells({ nodeId: node.nodeId })[0]?.cellId,
      diff: node.edgeIds[0] === undefined ? undefined : state.edge(node.edgeIds[0])?.diffs[0],
    }))
    const attempts = new Map<string, { latest: SearchCellSettledEvent; seals: Set<string> }>()
    const text = await readFile(ledgerPath, 'utf8')
    for (const [index, line] of text.split('\n').entries()) {
      if (line.length === 0) continue
      const entry = parseSearchLedgerLine(line, searchId, { path: ledgerPath, line: index + 1 })
      if (entry.sequence > head) break
      const { event } = entry
      if (event.kind !== 'cell-settled') continue
      const seals = attempts.get(event.cellId)?.seals ?? new Set<string>()
      const seal = event.artifacts.find((artifact) => artifact.role === 'settle-record')
      if (seal !== undefined) seals.add(seal.sha256)
      attempts.set(event.cellId, { latest: event, seals })
    }
    const chain = new Map<string, VersionRecord>()
    for (const { node, cellId, diff } of nodes) {
      const settled = cellId === undefined ? undefined : attempts.get(cellId)
      const artifact = (role: string) =>
        settled?.latest.artifacts.find((candidate) => candidate.role === role)
      const seal = artifact('settle-record')
      const verdict = artifact('verdict')
      chain.set(node.nodeId, {
        nodeId: node.nodeId,
        version: node.ordinal + 1,
        ...versionRun(runDir, runId, node.ordinal + 1),
        profile: loadNode(recorder, node).profile,
        parentNodeId: node.primaryParentId,
        ...(diff === undefined || 'unknown' in diff
          ? {}
          : { change: (recorder.readBlob(diff) as { diffs: AgentProfileDiff[] }).diffs[0]! }),
        ...(seal === undefined ? {} : { seal }),
        ...(verdict === undefined
          ? {}
          : { verdict: (recorder.readBlob(verdict) as { verdict: VersionVerdict }).verdict }),
        seals: settled?.seals ?? new Set(),
      })
    }
    return chain
  }
}

/** The bytes of a version's sealed `result.json` and the record they hold. */
async function readSealed(
  runDir: string,
  version: number,
): Promise<{ bytes: Uint8Array; result: SupervisedResult<unknown> }> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(resolve(runDir, SETTLE_RECORD_FILE))
  } catch (error) {
    if (!isNoEntError(error)) throw error
    throw new RuntimeRunStateError(
      `supervisePursuit versions: version ${version} has no settle record in ${runDir}`,
    )
  }
  const result = (await readSettleRecord(runDir)) as SupervisedResult<unknown>
  return { bytes, result }
}

function loadNode(
  store: { readBlob(ref: SearchArtifactRef): unknown },
  node: SearchNode,
): VersionNode {
  const stored = store.readBlob(node.artifact) as {
    kind?: unknown
    profile?: unknown
    change?: AgentProfileDiff | null
    parentDigest?: Sha256Digest | null
    refusal?: string | null
  }
  if (stored.kind === 'agent-profile') {
    const parsed = agentProfileSchema.safeParse(stored.profile)
    if (!parsed.success) {
      throw new RuntimeRunStateError(`version node ${node.nodeId} holds an invalid AgentProfile`)
    }
    return { profile: parsed.data as AgentProfile, refusal: null }
  }
  if (stored.kind === 'unapplied-change') {
    return {
      profile: null,
      ...(stored.change ? { change: stored.change } : {}),
      ...(stored.parentDigest ? { parentDigest: stored.parentDigest } : {}),
      refusal: stored.refusal ?? 'the change did not apply',
    }
  }
  throw new RuntimeRunStateError(`version node ${node.nodeId} holds no version artifact`)
}

/** The `<runDir>.v<n>` directory and `<runId>.v<n>` id of version `n`, beside the first. */
function versionRun(runDir: string, runId: string, version: number) {
  return version === 1
    ? { runDir, runId }
    : { runDir: `${runDir}.v${version}`, runId: `${runId}.v${version}` }
}

/** A version's settled spend as the ledger's accounting. Unknown dollars carry the part a
 *  provider is known to have billed as their floor. */
function versionAccounting(spent: Spend | undefined): SearchAttemptAccounting {
  const tokensKnown =
    spent !== undefined &&
    spent.tokensKnown !== false &&
    Number.isSafeInteger(spent.tokens?.input) &&
    Number.isSafeInteger(spent.tokens?.output)
  const usdKnown = spent !== undefined && spent.usdKnown !== false && isFiniteNumber(spent.usd)
  return {
    tokens: tokensKnown
      ? {
          status: 'known',
          inputTokens: spent.tokens.input,
          outputTokens: spent.tokens.output,
          cachedTokens: spent.tokens.cacheRead ?? 0,
        }
      : { status: 'unknown', reason: "the version's settled spend names unreported tokens" },
    cost: usdKnown
      ? { status: 'known', usd: spent.usd, source: 'provider' }
      : {
          status: 'unknown',
          knownLowerBoundUsd: Math.max(
            0,
            isFiniteNumber(spent?.usd) ? spent.usd - (spent.usdEstimated ?? 0) : 0,
          ),
          reason: "the version's settled spend names unpriced or unreported work",
        },
  }
}

/** How long a version that settled before its chain opened ran, from its settle record. */
function settledElapsed(settled: SupervisedResult<unknown> | undefined): number {
  const elapsed = settled?.spentTotal?.ms
  return isFiniteNumber(elapsed) ? elapsed : 0
}

const FREE: SearchAttemptAccounting = {
  tokens: { status: 'known', inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
  cost: { status: 'known', usd: 0, source: 'free' },
}

function canonicalStop(stop: PursuitVersionStop): PursuitVersionStop {
  return {
    patience: stop.patience,
    maxVersions: stop.maxVersions,
    maxUsd: stop.maxUsd,
    deadlineMs: stop.deadlineMs,
    ...(stop.minImprovement === undefined ? {} : { minImprovement: stop.minImprovement }),
  }
}

/**
 * `'review-of-best'`: fork from the kept version with its check's verdict mounted under
 * {@link REVIEW_DIR} and the profile's review words as one instruction. The previous review's
 * mount and instruction are removed, so a profile carries one review.
 */
function reviewOfBest(runId: string, words: string): NextPursuitVersion {
  return ({ best, versions }) => {
    const n = versions.length + 1
    const verdict = best.verdict.check
    const path = `${REVIEW_DIR}version-${best.version}.md`
    const instruction = words
      .replaceAll('{version}', String(best.version))
      .replaceAll('{path}', path)
      .replaceAll('{score}', best.verdict.score === null ? 'none' : String(best.verdict.score))
      .trim()
    const page = reviewPage(best.version, best.verdict.score, verdict)
    const earlierInstructions = best.change?.set?.prompt?.instructions ?? []
    const earlierMounts = (best.profile.resources?.files ?? [])
      .map((file) => file.path)
      .filter((mounted) => mounted.startsWith(REVIEW_DIR) && mounted !== path)
    return {
      kind: 'agent-profile-diff',
      id: `${runId}-v${n}-review-of-v${best.version}`,
      title: `Version ${n}: review of version ${best.version}`,
      source: {
        kind: 'optimizer',
        notes: [`review-of-best: version ${best.version}`, `judge ${best.verdict.judgeDigest}`],
      },
      set: {
        prompt: { instructions: [instruction] },
        resources: {
          files: [{ path, resource: { kind: 'inline', name: path, content: page } }],
        },
      },
      ...(earlierInstructions.length > 0 || earlierMounts.length > 0
        ? {
            remove: {
              ...(earlierInstructions.length > 0
                ? { prompt: { instructions: [...earlierInstructions] } }
                : {}),
              ...(earlierMounts.length > 0 ? { resources: { files: earlierMounts } } : {}),
            },
          }
        : {}),
    } as AgentProfileDiff
  }
}

/** The review page: facts only, in the check's own lines. */
function reviewPage(
  version: number,
  score: number | null,
  verdict: CheckVerdict | undefined,
): string {
  if (verdict === undefined) {
    return [
      `# Version ${version}`,
      '',
      `Score: ${score ?? 'none'}. The judge reported no per-item verdict.`,
      '',
    ].join('\n')
  }
  const failing = failedItems(verdict)
  return [
    `# Version ${version}`,
    '',
    `Score: ${score ?? 'none'}.${verdict.threshold === undefined ? '' : ` The check passes at ${verdict.threshold}.`}`,
    '',
    '## Items',
    '',
    ...Object.entries(verdict.items ?? {}).map(
      ([item, value]) => `- ${item}: ${value >= 1 ? 'passes' : `fails (${value})`}`,
    ),
    '',
    ...(failing.length === 0 ? [] : ['## Failures', '', ...(verdict.failures ?? []), '']),
    ...(verdict.review === undefined ? [] : ["## The check's review", '', verdict.review, '']),
  ].join('\n')
}

function digestOf(value: unknown, name: string): Sha256Digest {
  try {
    return canonicalCandidateDigest(value)
  } catch (error) {
    throw new ValidationError(
      `supervisePursuit versions: the ${name} must be canonical JSON to pin the chain: ${errorMessage(error)}`,
    )
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if (isNoEntError(error)) return false
    throw error
  }
}

function isSha256(value: unknown): value is Sha256Digest {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
