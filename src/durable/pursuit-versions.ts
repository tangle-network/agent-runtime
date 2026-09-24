import { mkdir, open, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  type AgentCandidateLineage,
  type AgentProfile,
  type AgentProfileDiff,
  type Sha256Digest,
  sha256Bytes,
} from '@tangle-network/agent-interface'
import { applyExactAgentProfileDiff } from '../candidate-execution/profile'
import { ConfigError, RuntimeRunStateError, ValidationError } from '../errors'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import type { AgentExecutionRef, Budget, SupervisedResult } from '../runtime/supervise/types'
import { contentAddress } from './content-address'
import {
  isNoEntError,
  parseCommittedJsonLines,
  prepareJsonlAppend,
  writeAllBytes,
} from './jsonl-file'
import { FileObserverJournal } from './observer-journal'
import { projectPursuit } from './observer-projection'
import { type PursuitFork, prepareRunFork } from './run-fork'
import { acquireRunDirectoryLock } from './run-lock'
import { readSettleRecord, SETTLE_RECORD_FILE } from './settle-record'
import type { SupervisedPursuitResult, SupervisePursuitOptions } from './supervise-pursuit'

/**
 * Continue a pursuit across versions: after each version settles, an outside judge scores it, and
 * the next version forks from the best version so far with one change, until the stop rule ends
 * the chain. Each version is one `supervisePursuit` run in its own directory; the fork records its
 * parent, the parent's seal, the change and the lineage root on the version's root.
 */
export interface PursuitVersions {
  /** Scores each settled version from outside its tree. A string names `registry.versionJudges`. */
  readonly judge: VersionJudge | string
  /** The change the next version applies to the best version's profile. A string names
   *  `registry.nextVersions`. */
  readonly next: NextPursuitVersion | string
  /** When the chain stops. Every cap is required: a chain without one is refused. */
  readonly stop: PursuitVersionStop
  /**
   * Where a later version executes. Omit it to run each version in this process through
   * `supervisePursuit({ fork })`, the same placement as the first. A caller that places versions
   * elsewhere executes exactly `version.profile` on `version.task` under `version.budget`, with
   * `version.execution` as the root's attribution, and returns once `version.runDir` holds the
   * version's settle record and observer journal. It is called again for the same version after
   * a restart, so it must attach to a version it already started rather than start a second one.
   */
  readonly run?: RunPursuitVersion
  /**
   * A version's dollars as the caller measured them, such as the provider's charge to the keys the
   * version used. Omit it to use the version's settled `spentTotal.usd`, which is an estimate
   * when `usdKnown` is false. `null` means unknown, and stops the chain.
   */
  readonly usd?: (version: SettledPursuitVersion, signal: AbortSignal) => Promise<number | null>
}

/** The chain's stop rule. The chain never starts a version once any cap is reached. */
export interface PursuitVersionStop {
  /** Stop after this many consecutive versions that did not improve on the best score. */
  readonly patience: number
  /** At most this many versions, the first included. */
  readonly maxVersions: number
  /**
   * The chain's total dollars, the first version included, summed from each version's settled
   * `spentTotal.usd`. The chain checks it between versions; a version's own budget, or the
   * caller's spend watcher, bounds that version in flight. A version whose dollars are not a
   * number stops the chain, since the chain can no longer prove it is under the cap.
   */
  readonly maxUsd: number
  /** The chain's wall clock, from its first version's start. A running version is aborted at it. */
  readonly deadlineMs: number
  /** A version improves when its score exceeds the best by more than this. Default 0. */
  readonly minImprovement?: number
}

/** An outside judge. Runtime calls it after a version's settle record exists, never inside the
 *  version's tree, and gives it no handle into that tree. Place it where you like, such as its own
 *  sandbox through . */
export interface VersionJudge {
  /** The sha256 of the judge's code and configuration. Every verdict must carry it, and a chain
   *  whose ledger was judged under another digest is refused. */
  readonly digest: Sha256Digest
  judge(version: SettledPursuitVersion, signal: AbortSignal): Promise<VersionVerdict>
}

export interface VersionVerdict {
  /** Higher is better. `null` when the judge could not score the version, which never counts as
   *  an improvement. */
  readonly score: number | null
  /** Must equal `VersionJudge.digest`. */
  readonly judgeDigest: Sha256Digest
  /** What the judge measured, retained verbatim in the ledger. JSON values only. */
  readonly detail?: unknown
}

/** A settled version, as the judge and `next` read it. */
export interface SettledPursuitVersion {
  /** 1 for the first version. */
  readonly version: number
  readonly runId: string
  readonly runDir: string
  /** The sha256 of the version's `result.json` bytes. */
  readonly settleDigest: Sha256Digest
  readonly result: SupervisedResult<unknown>
  /** The profile the version executed: the first version's, or its parent's plus its change. */
  readonly profile: AgentProfile
  readonly parent?: PursuitVersionParent
  readonly change?: AgentProfileDiff
}

export interface PursuitVersionParent {
  readonly version: number
  readonly runId: string
  readonly settleDigest: Sha256Digest
}

export interface JudgedPursuitVersion extends SettledPursuitVersion {
  readonly verdict: VersionVerdict
  /** Whether its score beat every earlier version's by more than `minImprovement`. */
  readonly improved: boolean
  /** The version's dollars: `versions.usd`'s measurement, or its settled `spentTotal.usd`;
   *  `null` when that is not a number. */
  readonly usd: number | null
  /** False when the figure is Runtime's estimate or unknown. */
  readonly usdKnown: boolean
  /** Who measured `usd`: the caller's `versions.usd`, or Runtime's settled `spentTotal`. */
  readonly usdSource: 'caller' | 'runtime'
  /** Where the version came from: its parent run and its change. Absent for a first version that
   *  is not a fork. */
  readonly lineage?: AgentCandidateLineage
}

export interface NextPursuitVersionInput {
  /** The version the next one forks from: the highest score, the earliest on a tie. */
  readonly best: JudgedPursuitVersion
  readonly last: JudgedPursuitVersion
  readonly versions: readonly JudgedPursuitVersion[]
}

/** Build the one change the next version applies to `best.profile`. Its `id` must be non-empty. */
export type NextPursuitVersion = (
  input: NextPursuitVersionInput,
  signal: AbortSignal,
) => AgentProfileDiff | Promise<AgentProfileDiff>

/** One version, ready to execute. */
export interface PreparedPursuitVersion {
  readonly version: number
  readonly runId: string
  readonly runDir: string
  readonly pursuitId: string
  /** The profile to execute, the change already applied. */
  readonly profile: AgentProfile
  readonly task: unknown
  readonly budget: Budget
  /** The root's attribution, with the fork's parent, seal, change and lineage root. */
  readonly execution: AgentExecutionRef
  /** The fork Runtime verified, for a placement that runs `supervisePursuit({ fork })` itself
   *  with the parent's profile, `parentProfile`. */
  readonly fork: PursuitFork
  readonly parentProfile: AgentProfile
}

export type RunPursuitVersion = (
  version: PreparedPursuitVersion,
  signal: AbortSignal,
) => Promise<void>

export type PursuitVersionStopReason =
  | 'no-improvement'
  | 'max-versions'
  | 'max-usd'
  | 'spend-unknown'
  | 'deadline'
  | 'aborted'

/** The chain's record, returned beside the best version's result and kept in `versions.jsonl`. */
export interface PursuitVersionsRecord {
  /** `<runDir>.versions`, beside the first version's directory. */
  readonly lineageDir: string
  readonly judgeDigest: Sha256Digest
  readonly stop: PursuitVersionStop
  /** ISO instant the first version started. */
  readonly startedAt: string
  readonly versions: readonly JudgedPursuitVersion[]
  /** The best version's number. */
  readonly best: number
  /** Sum of the versions' `usd`; a floor when any version's dollars are unknown. */
  readonly spentUsd: number
  readonly stopped: { readonly reason: PursuitVersionStopReason; readonly at: string }
}

/** The registry tables `versions.judge` and `versions.next` resolve a name against. */
export interface PursuitVersionRegistry {
  readonly versionJudges?: { resolve(name: string): VersionJudge | undefined }
  readonly nextVersions?: { resolve(name: string): NextPursuitVersion | undefined }
}

/** The longest delay Node's setTimeout honors. */
const MAX_TIMER_MS = 2_147_483_647

/** The ledger file inside the lineage directory. */
export const PURSUIT_VERSIONS_FILE = 'versions.jsonl'

type RunOne = (
  profile: SupervisorProfile,
  task: unknown,
  opts: SupervisePursuitOptions,
) => Promise<SupervisedPursuitResult<SupervisedResult<unknown>>>

type LedgerLine =
  | {
      kind: 'chain'
      pursuitId: string
      runId: string
      runDir: string
      judgeDigest: Sha256Digest
      stop: PursuitVersionStop
      startedAt: string
    }
  | {
      kind: 'start'
      version: number
      runId: string
      runDir: string
      parent: PursuitVersionParent
      change: AgentProfileDiff
    }
  | {
      kind: 'judged'
      version: number
      runId: string
      runDir: string
      settleDigest: Sha256Digest
      parent?: PursuitVersionParent
      changeId?: string
      verdict: VersionVerdict
      improved: boolean
      usd: number | null
      usdKnown: boolean
      usdSource: 'caller' | 'runtime'
      lineage?: AgentCandidateLineage
    }
  | {
      kind: 'stopped'
      reason: PursuitVersionStopReason
      at: string
      best: number
      spentUsd: number
    }

interface VersionSpec {
  readonly version: number
  readonly runId: string
  readonly runDir: string
  readonly parent?: PursuitVersionParent
  readonly change?: AgentProfileDiff
}

/** The `<runDir>.v<n>` directory and `<runId>.v<n>` id of version `n`, beside the first. */
export function pursuitVersionRun(
  runDir: string,
  runId: string,
  version: number,
): { runDir: string; runId: string } {
  return version === 1
    ? { runDir, runId }
    : { runDir: `${runDir}.v${version}`, runId: `${runId}.v${version}` }
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
  const { judge, next, stop, run } = versions as Record<string, unknown>
  if (typeof judge === 'string') {
    if (judge.trim().length === 0) fail('judge must name a registry entry')
  } else if (
    typeof judge !== 'object' ||
    judge === null ||
    typeof (judge as VersionJudge).judge !== 'function'
  ) {
    fail('judge must be a VersionJudge or a registry name')
  } else if (!isSha256((judge as VersionJudge).digest)) {
    fail('judge.digest must be a sha256 digest (sha256:<64 hex>)')
  }
  if (typeof next === 'string' ? next.trim().length === 0 : typeof next !== 'function') {
    fail('next must be a function or a registry name')
  }
  if (run !== undefined && typeof run !== 'function') fail('run must be a function when set')
  const { usd } = versions as Record<string, unknown>
  if (usd !== undefined && typeof usd !== 'function') fail('usd must be a function when set')
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
    if (
      typeof rule[key] !== 'number' ||
      !Number.isFinite(rule[key]) ||
      (rule[key] as number) <= 0
    ) {
      fail(`stop.${key} must be a finite number above 0`)
    }
  }
  if (
    rule.minImprovement !== undefined &&
    (typeof rule.minImprovement !== 'number' ||
      !Number.isFinite(rule.minImprovement) ||
      rule.minImprovement < 0)
  ) {
    fail('stop.minImprovement must be a finite number of at least 0')
  }
}

/** Run a version chain. `supervisePursuit` calls this when `versions` is set. */
export async function runPursuitVersions(
  profile: SupervisorProfile,
  task: unknown,
  opts: SupervisePursuitOptions & { readonly versions: PursuitVersions },
  runOne: RunOne,
): Promise<
  SupervisedPursuitResult<SupervisedResult<unknown>> & { versions: PursuitVersionsRecord }
> {
  const { versions, ...rest } = opts
  assertPursuitVersions(versions)
  for (const key of ['journal', 'blobs', 'rootHandle', 'steerDir'] as const) {
    if (rest[key] !== undefined) {
      throw new ValidationError(
        `supervisePursuit versions: ${key} names one run, and a version chain has one per version; omit it`,
      )
    }
  }
  const registry = rest.registry
  const judge = resolveNamed('judge', 'versionJudges', versions.judge, registry?.versionJudges)
  if (!isSha256(judge.digest)) {
    throw new ValidationError('supervisePursuit versions: judge.digest must be a sha256 digest')
  }
  const next = resolveNamed('next', 'nextVersions', versions.next, registry?.nextVersions)
  const stop = versions.stop
  const minImprovement = stop.minImprovement ?? 0
  const now = rest.now ?? Date.now
  const pursuitId = rest.pursuitId.trim()
  const runDir = resolve(rest.runDir.trim())
  const runId = rest.runId ?? 'supervise'
  const { fork: firstFork, signal: callerSignal, ...base } = rest
  const lineageDir = `${runDir}.versions`
  const ledgerPath = resolve(lineageDir, PURSUIT_VERSIONS_FILE)

  // The first version's executed profile; later versions derive theirs from their parent's.
  const firstProfile = (
    firstFork === undefined
      ? profile
      : applyExactAgentProfileDiff(profile, firstFork.change, 'supervisePursuit versions')
  ) as AgentProfile

  await mkdir(lineageDir, { recursive: true })
  const lock = await acquireRunDirectoryLock(lineageDir, `${runId}:versions`, now)
  try {
    const ledger = await readLedger(ledgerPath)
    let chain = ledger.find((line) => line.kind === 'chain')
    if (chain === undefined) {
      const settledFirst = await readSettleRecord(runDir)
      const elapsed = settledFirst?.spentTotal?.ms
      const startedAt = new Date(
        now() - (typeof elapsed === 'number' && Number.isFinite(elapsed) ? elapsed : 0),
      ).toISOString()
      chain = {
        kind: 'chain',
        pursuitId,
        runId,
        runDir,
        judgeDigest: judge.digest,
        stop: canonicalStop(stop),
        startedAt,
      }
      await appendLedger(ledgerPath, chain)
    } else {
      const mismatch = [
        chain.pursuitId !== pursuitId ? `pursuitId '${chain.pursuitId}'` : undefined,
        chain.runId !== runId ? `runId '${chain.runId}'` : undefined,
        chain.runDir !== runDir ? `runDir '${chain.runDir}'` : undefined,
        chain.judgeDigest !== judge.digest ? `judge digest ${chain.judgeDigest}` : undefined,
        contentAddress(chain.stop) !== contentAddress(canonicalStop(stop))
          ? 'another stop rule'
          : undefined,
      ].filter((item): item is string => item !== undefined)
      if (mismatch.length > 0) {
        throw new ValidationError(
          `supervisePursuit versions: ${ledgerPath} records a chain with ${mismatch.join(', ')}; a chain keeps its identity, judge and stop rule`,
        )
      }
    }
    const startedAtMs = Date.parse(chain.startedAt)

    // The chain's deadline aborts a running version; the caller's signal still cancels everything.
    const deadline = new AbortController()
    // A timer longer than 2^31 - 1 ms fires at once in Node, so a long chain re-arms in steps.
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      const remaining = startedAtMs + stop.deadlineMs - now()
      if (remaining <= 0) {
        deadline.abort(new Error('the version chain reached its deadline'))
        return
      }
      timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS))
      timer.unref?.()
    }
    arm()
    const signal =
      callerSignal === undefined
        ? deadline.signal
        : AbortSignal.any([callerSignal, deadline.signal])

    try {
      const judged: JudgedPursuitVersion[] = []
      const profiles = new Map<number, AgentProfile>([[1, firstProfile]])
      let pending: VersionSpec | undefined = { version: 1, runId, runDir }
      let stopped: Extract<LedgerLine, { kind: 'stopped' }> | undefined

      // Replay the ledger: judged versions are read back, never re-run or re-judged.
      for (const line of ledger) {
        if (line.kind === 'start') {
          const parentProfile = profiles.get(line.parent.version)
          if (parentProfile === undefined) {
            throw new RuntimeRunStateError(
              `supervisePursuit versions: ${ledgerPath} starts version ${line.version} from unknown version ${line.parent.version}`,
            )
          }
          profiles.set(
            line.version,
            applyExactAgentProfileDiff(parentProfile, line.change, 'supervisePursuit versions'),
          )
          pending = {
            version: line.version,
            runId: line.runId,
            runDir: line.runDir,
            parent: line.parent,
            change: line.change,
          }
        } else if (line.kind === 'judged') {
          if (line.version !== judged.length + 1 || line.version !== pending?.version) {
            throw new RuntimeRunStateError(
              `supervisePursuit versions: ${ledgerPath} judges version ${line.version} out of order`,
            )
          }
          if (line.verdict.judgeDigest !== judge.digest) {
            throw new ValidationError(
              `supervisePursuit versions: version ${line.version} was judged under ${line.verdict.judgeDigest}, not ${judge.digest}`,
            )
          }
          const settled = await readSettled(pending, profiles)
          if (settled.settleDigest !== line.settleDigest) {
            throw new RuntimeRunStateError(
              `supervisePursuit versions: version ${line.version}'s result.json changed after it was judged`,
            )
          }
          judged.push(
            Object.freeze({
              ...settled,
              verdict: line.verdict,
              improved: line.improved,
              usd: line.usd,
              usdKnown: line.usdKnown,
              usdSource: line.usdSource,
              ...(line.lineage === undefined ? {} : { lineage: line.lineage }),
            }),
          )
          pending = undefined
        } else if (line.kind === 'stopped') {
          stopped = line
        }
      }

      while (stopped === undefined) {
        if (pending !== undefined) {
          const spec = pending
          const settled = await settle(spec)
          const verdict = await judgeVersion(settled)
          const bestScore = bestOf(judged)?.verdict.score
          const improved =
            isFiniteNumber(verdict.score) &&
            (!isFiniteNumber(bestScore) || verdict.score > bestScore + minImprovement)
          const spent = settled.result.spentTotal
          const measured =
            versions.usd === undefined ? undefined : await versions.usd(settled, signal)
          const usdSource = measured === undefined ? 'runtime' : 'caller'
          const usd =
            measured === undefined
              ? isFiniteNumber(spent?.usd)
                ? spent.usd
                : null
              : isFiniteNumber(measured)
                ? measured
                : null
          const usdKnown = usd !== null && (measured !== undefined || spent?.usdKnown !== false)
          const lineage = versionLineage(spec, firstFork)
          const entry: Extract<LedgerLine, { kind: 'judged' }> = {
            kind: 'judged',
            version: spec.version,
            runId: spec.runId,
            runDir: spec.runDir,
            settleDigest: settled.settleDigest,
            ...(spec.parent === undefined ? {} : { parent: spec.parent }),
            ...(spec.change?.id === undefined ? {} : { changeId: spec.change.id }),
            verdict,
            improved,
            usd,
            usdKnown,
            usdSource,
            ...(lineage === undefined ? {} : { lineage }),
          }
          await appendLedger(ledgerPath, entry)
          judged.push(
            Object.freeze({
              ...settled,
              verdict,
              improved,
              usd,
              usdKnown,
              usdSource,
              ...(lineage === undefined ? {} : { lineage }),
            }),
          )
          pending = undefined
        }

        const reason = stopReason(judged)
        if (reason !== undefined) {
          stopped = {
            kind: 'stopped',
            reason,
            at: new Date(now()).toISOString(),
            best: (bestOf(judged) ?? judged[0]!).version,
            spentUsd: spentOf(judged),
          }
          await appendLedger(ledgerPath, stopped)
          break
        }

        const best = bestOf(judged) ?? judged[0]!
        const last = judged[judged.length - 1]!
        const change = await next({ best, last, versions: Object.freeze([...judged]) }, signal)
        if (typeof change?.id !== 'string' || change.id.trim().length === 0) {
          throw new ValidationError(
            'supervisePursuit versions: next must return a change with an id',
          )
        }
        const version = judged.length + 1
        const names = pursuitVersionRun(runDir, runId, version)
        const spec: VersionSpec = {
          version,
          ...names,
          parent: { version: best.version, runId: best.runId, settleDigest: best.settleDigest },
          change,
        }
        // Applying the change here refuses a malformed one before the ledger records it.
        profiles.set(
          version,
          applyExactAgentProfileDiff(best.profile, change, 'supervisePursuit versions'),
        )
        await appendLedger(ledgerPath, {
          kind: 'start',
          version,
          runId: spec.runId,
          runDir: spec.runDir,
          parent: spec.parent!,
          change,
        })
        pending = spec
      }

      const bestVersion = judged.find((item) => item.version === stopped.best) ?? judged[0]!
      const record: PursuitVersionsRecord = Object.freeze({
        lineageDir,
        judgeDigest: judge.digest,
        stop: canonicalStop(stop),
        startedAt: chain.startedAt,
        versions: Object.freeze([...judged]),
        best: bestVersion.version,
        spentUsd: stopped.spentUsd,
        stopped: Object.freeze({ reason: stopped.reason, at: stopped.at }),
      })
      const observerPath = resolve(bestVersion.runDir, 'observer.jsonl')
      return Object.freeze({
        result: bestVersion.result,
        pursuit: projectPursuit(await new FileObserverJournal(observerPath, pursuitId).read()),
        observerPath,
        settlePath: resolve(bestVersion.runDir, SETTLE_RECORD_FILE),
        versions: record,
      })

      /** Run the version unless its directory already settled, then read it back. */
      async function settle(spec: VersionSpec): Promise<SettledPursuitVersion> {
        if ((await readSettleRecord(spec.runDir)) === undefined) {
          if (signal.aborted) {
            throw new RuntimeRunStateError(
              `supervisePursuit versions: version ${spec.version} was not started: ${abortMessage(signal)}`,
            )
          }
          if (spec.parent === undefined || spec.change === undefined) {
            await runOne(profile, task, {
              ...base,
              ...(firstFork === undefined ? {} : { fork: firstFork }),
              signal,
            })
          } else {
            const parent = judged.find((item) => item.version === spec.parent!.version)
            if (parent === undefined) {
              throw new RuntimeRunStateError(
                `supervisePursuit versions: version ${spec.version}'s parent ${spec.parent.version} is not judged`,
              )
            }
            // A version starts a new tree and never replays its parent's children, so a parent
            // that settled with a child still in doubt (a deadline or a driver failure leaves
            // them) is forked, and the version's root records those nodes.
            const fork: PursuitFork = {
              runDir: parent.runDir,
              settleDigest: parent.settleDigest,
              change: spec.change,
              acceptUncertain: true,
            }
            const options: SupervisePursuitOptions = {
              ...base,
              runId: spec.runId,
              runDir: spec.runDir,
              fork,
              signal,
            }
            if (versions.run === undefined) {
              await runOne(parent.profile, task, options)
            } else {
              // Runtime verifies the fork here, where the parent's records are, before placing it.
              const prepared = await prepareRunFork(parent.profile, task, options, fork)
              await versions.run(
                Object.freeze({
                  version: spec.version,
                  runId: spec.runId,
                  runDir: spec.runDir,
                  pursuitId,
                  profile: prepared.profile,
                  task,
                  budget: base.budget,
                  execution: prepared.execution,
                  fork,
                  parentProfile: parent.profile,
                }),
                signal,
              )
            }
          }
        }
        const settled = await readSettled(spec, profiles)
        if (settled === undefined) {
          throw new RuntimeRunStateError(
            `supervisePursuit versions: version ${spec.version} returned without a settle record in ${spec.runDir}`,
          )
        }
        return settled
      }

      async function judgeVersion(settled: SettledPursuitVersion): Promise<VersionVerdict> {
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

      function stopReason(
        done: readonly JudgedPursuitVersion[],
      ): PursuitVersionStopReason | undefined {
        if (callerSignal?.aborted) return 'aborted'
        if (done.length >= stop.maxVersions) return 'max-versions'
        let stale = 0
        for (let index = done.length - 1; index >= 0 && !done[index]!.improved; index -= 1) {
          stale += 1
        }
        if (stale >= stop.patience) return 'no-improvement'
        if (done.some((item) => item.usd === null)) return 'spend-unknown'
        if (spentOf(done) >= stop.maxUsd) return 'max-usd'
        if (deadline.signal.aborted || now() - startedAtMs >= stop.deadlineMs) return 'deadline'
        return undefined
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  } finally {
    await lock.release()
  }
}

async function readSettled(
  spec: VersionSpec,
  profiles: ReadonlyMap<number, AgentProfile>,
): Promise<SettledPursuitVersion> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(resolve(spec.runDir, SETTLE_RECORD_FILE))
  } catch (error) {
    if (!isNoEntError(error)) throw error
    throw new RuntimeRunStateError(
      `supervisePursuit versions: version ${spec.version} has no settle record in ${spec.runDir}`,
    )
  }
  const result = (await readSettleRecord(spec.runDir)) as SupervisedResult<unknown>
  const profile = profiles.get(spec.version)
  if (profile === undefined) {
    throw new RuntimeRunStateError(
      `supervisePursuit versions: version ${spec.version} has no recorded profile`,
    )
  }
  return Object.freeze({
    version: spec.version,
    runId: spec.runId,
    runDir: spec.runDir,
    settleDigest: sha256Bytes(bytes),
    result,
    profile,
    ...(spec.parent === undefined ? {} : { parent: spec.parent }),
    ...(spec.change === undefined ? {} : { change: spec.change }),
  })
}

function versionLineage(
  spec: VersionSpec,
  firstFork: PursuitFork | undefined,
): AgentCandidateLineage | undefined {
  if (spec.parent !== undefined && spec.change !== undefined) {
    return {
      source: lineageSource(spec.change),
      runIds: [spec.parent.runId],
      profileDiffIds: [spec.change.id as string],
    }
  }
  if (firstFork !== undefined) {
    return {
      source: lineageSource(firstFork.change),
      profileDiffIds: [firstFork.change.id as string],
    }
  }
  return undefined
}

/** The change's author, in the lineage's words. A trace-derived change is a compound of runs. */
function lineageSource(change: AgentProfileDiff): AgentCandidateLineage['source'] {
  const kind = change.source?.kind
  return kind === 'human' || kind === 'optimizer' || kind === 'frontier-author' ? kind : 'compound'
}

function bestOf(done: readonly JudgedPursuitVersion[]): JudgedPursuitVersion | undefined {
  let best: JudgedPursuitVersion | undefined
  for (const item of done) {
    if (!isFiniteNumber(item.verdict.score)) continue
    if (best === undefined || item.verdict.score > (best.verdict.score as number)) best = item
  }
  return best
}

function spentOf(done: readonly JudgedPursuitVersion[]): number {
  return done.reduce((sum, item) => sum + (item.usd ?? 0), 0)
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

function resolveNamed<T>(
  option: 'judge' | 'next',
  table: 'versionJudges' | 'nextVersions',
  value: T | string,
  registry: { resolve(name: string): T | undefined } | undefined,
): T {
  if (typeof value !== 'string') return value
  if (registry === undefined) {
    throw new ConfigError(
      `supervisePursuit versions: ${option} = ${JSON.stringify(value)} names a registry entry, but no registry.${table} was provided`,
    )
  }
  const entry = registry.resolve(value)
  if (entry === undefined) {
    throw new ConfigError(
      `supervisePursuit versions: ${option} = ${JSON.stringify(value)} is not in registry.${table}`,
    )
  }
  return entry
}

async function readLedger(path: string): Promise<LedgerLine[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNoEntError(error)) return []
    throw error
  }
  return parseCommittedJsonLines<LedgerLine>(text, path)
}

async function appendLedger(path: string, line: LedgerLine): Promise<void> {
  const endsWithRecord = await prepareJsonlAppend(path)
  const handle = await open(path, 'a')
  try {
    await writeAllBytes(handle, `${endsWithRecord ? '\n' : ''}${JSON.stringify(line)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function isSha256(value: unknown): value is Sha256Digest {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function abortMessage(signal: AbortSignal): string {
  const reason = signal.reason
  return reason instanceof Error ? reason.message : String(reason ?? 'aborted')
}
