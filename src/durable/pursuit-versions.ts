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

import { resolve } from 'node:path'
import {
  developmentClaim,
  incumbent,
  openSearchLedger,
  runSearch,
  type SearchArtifactCodec,
  type SearchAudit,
  type SearchCloseReason,
  type SearchExecutor,
  type SearchHistoryReceipt,
  type SearchProposerPort,
  SearchRecorder,
  type SearchSourceRef,
  uniform,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfile,
  type AgentProfileDiff,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { applyExactAgentProfileDiff } from '../candidate-execution/profile'
import { RuntimeRunStateError, ValidationError } from '../errors'
import { isFiniteNumber } from '../finite-number'
import type { CheckVerdict } from '../runtime/supervise/completion-gate'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import type { SupervisedResult } from '../runtime/supervise/types'
import { errorMessage } from '../runtime/util'
import { FileObserverJournal } from './observer-journal'
import { projectPursuit } from './observer-projection'
import {
  exists,
  FREE,
  isSha256,
  jsonProfile,
  loadNode,
  pursuitValueDigest,
  pursuitVersionsLedgerPath,
  settledElapsed,
  type VersionNode,
  versionFailure,
} from './pursuit-version-evidence'
import { reviewOfBest } from './pursuit-version-review'
import { type RunOne, VersionChainRun, versionExecutionIdentity } from './pursuit-version-run'
import { readSettleRecord, SETTLE_RECORD_FILE } from './settle-record'
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

/** The chain's stop rule. The chain starts no version its caps do not admit. */
export interface PursuitVersionStop {
  /** Stop after this many proposed versions in a row that did not take the lead. */
  readonly patience: number
  /** At most this many versions, the first included. A change the chain refuses counts as one. */
  readonly maxVersions: number
  /**
   * The chain's dollars: a version starts only while settled spend plus a hold for it stays
   * within this. A version's unknown spend counts as its proven floor. The hold is the version's
   * own `budget.maxUsd`, which bounds it in flight; without one it is 0 until 20 versions
   * settled, then 1.5 times the p99 of their spend.
   */
  readonly maxUsd: number
  /** The chain's wall clock, from its first version's start. A running version is aborted at it. */
  readonly deadlineMs: number
  /** A version takes the lead when its score beats the kept version's by more than this.
   *  Default 0. */
  readonly minImprovement?: number
  /**
   * Stop after this many versions in a row failed identically: each run ended `driver-failed`
   * with the same error, or the judge could not score it. Such a failure repeats whatever the
   * next change is (a refused workspace file, a broken credential), so neither patience nor a
   * version cap should be what stops it. Default 3.
   */
  readonly identicalFailures?: number
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
   *  unscored, and an unscored version never takes the lead. */
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
  /** Present when the chain stopped because its last `versions` versions failed identically
   *  (`stop.identicalFailures`); `reason` is then `converged`. */
  readonly identicalFailures?: { readonly versions: number; readonly failure: string }
  /** The kept version's number: the kernel's leader when the chain closed. */
  readonly best: number
  /** Every judged version, first first. */
  readonly versions: readonly JudgedPursuitVersion[]
  /** Known dollars, proven floors of unknown ones, and the counts of each. */
  readonly spend: SearchAudit['spend']
  /** A bounded receipt over the exact ledger bytes. */
  readonly receipt: SearchHistoryReceipt
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
  const known = new Set([
    'patience',
    'maxVersions',
    'maxUsd',
    'deadlineMs',
    'minImprovement',
    'identicalFailures',
  ])
  const unknown = Object.keys(rule).filter((key) => !known.has(key))
  if (unknown.length > 0) fail(`stop has unknown fields: ${unknown.join(', ')}`)
  for (const key of ['patience', 'maxVersions'] as const) {
    if (!Number.isInteger(rule[key]) || (rule[key] as number) < 1) {
      fail(`stop.${key} must be an integer of at least 1`)
    }
  }
  if (
    rule.identicalFailures !== undefined &&
    (!Number.isInteger(rule.identicalFailures) || (rule.identicalFailures as number) < 1)
  ) {
    fail('stop.identicalFailures must be an integer of at least 1')
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
    'a scored winner passes; a scored no-winner fails with its reason; an unscored version is a final error; a run that throws fails the call and leaves its cell open',
  deadline: 'the chain deadline aborts a running version; its judge still runs',
  failures:
    'before proposing, the chain closes converged when its last stop.identicalFailures judged versions failed identically: driver-failed with the same error name and message, digits, hex runs and absolute paths normalized, or unscored by the judge',
  directories: 'version n runs at <runDir>.v<n> with run id <runId>.v<n>; version 1 at <runDir>',
} as const

const VERSION_CHAIN_URI = 'npm:@tangle-network/agent-runtime#supervisePursuit.versions'
/** The pursuit task's one train task. */
const TASK_ID = 'pursuit'
const LANE = 'in-process'
/** The longest delay Node's setTimeout honors. */
const MAX_TIMER_MS = 2_147_483_647
/** 9999-12-31T23:59:59.999Z: the latest instant the ledger's four-digit-year timestamps hold, so
 *  a deadline such as `Number.MAX_SAFE_INTEGER` means no deadline rather than an invalid date. */
const LATEST_DEADLINE_MS = 253_402_300_799_999

type ChainBase = Omit<SupervisePursuitOptions, 'versions' | 'fork' | 'signal'>

/** Refuse a chain call that no version could satisfy, before any compute. */
function assertChainCall(versions: PursuitVersions, base: ChainBase): void {
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
  const { stop } = versions
  if (base.budget.maxUsd !== undefined && base.budget.maxUsd > stop.maxUsd) {
    throw new ValidationError(
      `supervisePursuit versions: budget.maxUsd ${base.budget.maxUsd} is above stop.maxUsd ${stop.maxUsd}, so no version could start`,
    )
  }
}

/** Run a version chain. `supervisePursuit` calls this when `versions` is set. */
export async function runPursuitVersions(
  profile: SupervisorProfile,
  task: unknown,
  opts: SupervisePursuitOptions & { readonly versions: PursuitVersions },
  runOne: RunOne,
): Promise<SupervisedPursuitResult<SupervisedResult<unknown>> & { versions: PursuitVersionChain }> {
  const { versions, fork: firstFork, signal: callerSignal, ...base } = opts
  assertChainCall(versions, base)
  const { judge, stop } = versions
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
  const firstProfile = jsonProfile(
    firstFork === undefined
      ? profile
      : applyExactAgentProfileDiff(profile, firstFork.change, 'supervisePursuit versions'),
  )
  const taskRevision = pursuitValueDigest(task, 'task')
  const ledger = openSearchLedger({ path: ledgerPath, searchId })
  const deadline = await chainDeadline((await ledger.state()).header, now, runDir, stop)
  const policy = incumbent({
    patience: stop.patience,
    ...(stop.minImprovement === undefined ? {} : { minImprovement: stop.minImprovement }),
  })
  const allocation = uniform()
  const recorder = await openVersionRecorder({
    ledger,
    now,
    pursuitId,
    taskRevision,
    judge,
    stop,
    policy,
    allocation,
    deadline,
    firstProfile,
  })

  const clock = armChainDeadline(deadline, now)
  const chain = new VersionChainRun({
    profile,
    task,
    base,
    firstFork,
    runOne,
    judge,
    recorder,
    expired: clock.signal,
    pursuitId,
    runDir,
    runId,
    ledgerPath,
    searchId,
    taskRevision,
  })
  const failureLimit = stop.identicalFailures ?? DEFAULT_IDENTICAL_FAILURES
  try {
    const closed = await runSearch({
      recorder,
      root: { profile: firstProfile, refusal: null },
      codec: versionCodec,
      policy,
      allocation,
      proposer: versionProposer(versions.next, next, chain, failureLimit),
      executor: versionExecutor(chain, base.budget.maxUsd),
      admit: (node) => node.refusal,
      ...(callerSignal === undefined ? {} : { signal: callerSignal }),
      now,
    })
    const judged = await chain.judgedVersions(await chain.versionsOf())
    // A converged chain whose last versions share a failure stopped by the identical-failure rule.
    const failed =
      closed.reason === 'converged' ? identicalFailureStreak(judged, failureLimit) : null
    const stopped = failed === null ? null : { versions: failureLimit, failure: failed }
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
        ...(stopped === null ? {} : { identicalFailures: stopped }),
        best: best.version,
        versions: Object.freeze(judged),
        spend: closed.state.audit.spend,
        receipt: recorder.receipt({ producerId: 'pursuit-versions', runId }),
      }),
    })
  } finally {
    clock.cancel()
  }
}

interface VersionRecorderInput {
  ledger: ReturnType<typeof openSearchLedger>
  now: () => number
  pursuitId: string
  taskRevision: string
  judge: VersionJudge
  stop: PursuitVersionStop
  policy: { name: string }
  allocation: { name: string }
  deadline: string
  firstProfile: AgentProfile
}

/** Open the chain's search recorder: its subject, process revision, splits, policy and budget. */
function openVersionRecorder(input: VersionRecorderInput): Promise<SearchRecorder> {
  const { ledger, now, pursuitId, taskRevision, judge, stop, policy, allocation, deadline } = input
  return SearchRecorder.open(
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
      identity: versionExecutionIdentity(pursuitId, taskRevision, input.firstProfile),
    },
  )
}

/**
 * The chain's clock starts with its first version, or when the chain opened on a first version
 * that had already settled. A resumed chain keeps the deadline its ledger recorded.
 */
async function chainDeadline(
  opened: { budget: { deadline: string | null } } | null | undefined,
  now: () => number,
  runDir: string,
  stop: PursuitVersionStop,
): Promise<string> {
  return (
    opened?.budget.deadline ??
    new Date(
      Math.min(
        now() - settledElapsed(await readSettleRecord(runDir)) + stop.deadlineMs,
        LATEST_DEADLINE_MS,
      ),
    ).toISOString()
  )
}

/**
 * The chain's deadline aborts a running version. A timer longer than 2^31 - 1 ms fires at once
 * in Node, so a long chain re-arms in steps.
 */
function armChainDeadline(
  deadline: string,
  now: () => number,
): { signal: AbortSignal; cancel(): void } {
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
  return {
    signal: expired.signal,
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}

const versionCodec: SearchArtifactCodec<VersionNode> = {
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

function versionExecutor(
  chain: VersionChainRun,
  maxUsd: number | undefined,
): SearchExecutor<VersionNode> {
  return {
    // A version's budget.maxUsd bounds it in flight, so it is the hard hold. Without one the
    // hold is the kernel's estimate: 0 until 20 versions settled, then 1.5 times their p99.
    lanes: () => [
      maxUsd === undefined
        ? { name: LANE, capacity: 1, costCap: 'estimate', cellUsd: 0 }
        : { name: LANE, capacity: 1, costCap: 'hard', cellUsd: maxUsd },
    ],
    place: () => LANE,
    // A version that settled is read back from its directory by `run`, so nothing is adopted.
    adopt: async () => null,
    run: (work) => chain.runCell(work),
  }
}

/** The proposer: the caller's `next` (or the review of the kept version) as the one edge. */
function versionProposer(
  nextOption: PursuitVersions['next'],
  next: NextPursuitVersion,
  chain: VersionChainRun,
  failureLimit: number,
): SearchProposerPort<VersionNode> {
  const reviewing = nextOption === 'review-of-best'
  const proposerSource: SearchSourceRef = {
    uri: reviewing ? `${VERSION_CHAIN_URI}.review-of-best` : `${VERSION_CHAIN_URI}.next`,
    revision: canonicalCandidateDigest({
      next: reviewing ? 'review-of-best' : Function.prototype.toString.call(nextOption),
    }),
  }
  return {
    name: reviewing ? 'review-of-best' : 'next',
    kind: 'optimizer',
    source: proposerSource,
    execution: { kind: 'deterministic', source: proposerSource },
    childrenPerProposal: 1,
    async propose(request) {
      const parent = request.parents[0]!
      const judged = await chain.judgedVersions(await chain.versionsOf())
      const failure = identicalFailureStreak(judged, failureLimit)
      if (failure !== null) {
        return {
          children: [],
          stop: `the last ${failureLimit} versions failed identically: ${failure}`,
          accounting: FREE,
        }
      }
      const best = judged.find((version) => version.nodeId === parent.nodeId)
      if (best === undefined || parent.artifact.profile === null) {
        throw new RuntimeRunStateError(
          `supervisePursuit versions: the kept version ${parent.nodeId} has no judged run to fork from`,
        )
      }
      const returned = await next(
        { best, last: judged.at(-1)!, versions: Object.freeze(judged) },
        request.signal,
      )
      if (typeof returned?.id !== 'string' || returned.id.trim().length === 0) {
        throw new ValidationError('supervisePursuit versions: next must return a change with an id')
      }
      // The ledger stores the change as JSON, so it is taken as JSON: an undefined entry is absent.
      const change = JSON.parse(JSON.stringify(returned)) as AgentProfileDiff
      const child = childNode(parent.artifact.profile, change)
      return {
        children: [
          {
            artifact: child,
            label: change.title ?? returned.id,
            rationale: (change.source?.notes ?? []).join('\n'),
          },
        ],
        accounting: reviewing
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
}

/** The node a change makes, or the refused node when it does not apply to the parent. */
function childNode(parentProfile: AgentProfile, change: AgentProfileDiff): VersionNode {
  const parentDigest = canonicalAgentProfileDigest(parentProfile)
  try {
    return {
      profile: applyExactAgentProfileDiff(parentProfile, change, 'supervisePursuit versions'),
      change,
      parentDigest,
      refusal: null,
    }
  } catch (error) {
    return { profile: null, change, parentDigest, refusal: errorMessage(error) }
  }
}

function canonicalStop(stop: PursuitVersionStop): PursuitVersionStop {
  return {
    patience: stop.patience,
    maxVersions: stop.maxVersions,
    maxUsd: stop.maxUsd,
    deadlineMs: stop.deadlineMs,
    ...(stop.minImprovement === undefined ? {} : { minImprovement: stop.minImprovement }),
    identicalFailures: stop.identicalFailures ?? DEFAULT_IDENTICAL_FAILURES,
  }
}

const DEFAULT_IDENTICAL_FAILURES = 3

/** The failure the last `count` judged versions share, or null when they do not all share one. */
export function identicalFailureStreak(
  versions: readonly JudgedPursuitVersion[],
  count: number,
): string | null {
  if (versions.length < count) return null
  const failures = versions.slice(-count).map(versionFailure)
  const [first] = failures
  return first !== null && first !== undefined && failures.every((failure) => failure === first)
    ? first
    : null
}
