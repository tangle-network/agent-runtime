/**
 * One pursuit version chain at run time: running a version in its directory, reading it back
 * and checking it is this node's run, judging it, turning it into the kernel's cell result, and
 * reading the chain back from its search ledger.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  parseSearchLedgerLine,
  type SearchCellResult,
  type SearchCellSettledEvent,
  type SearchCellWork,
  type SearchExecutionIdentity,
  type SearchRecorder,
  type SearchTaskOutcome,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfile,
  type AgentProfileDiff,
  canonicalAgentProfileDigest,
  type Sha256Digest,
  sha256Bytes,
} from '@tangle-network/agent-interface'
import { RuntimeRunStateError, ValidationError } from '../errors'
import { isFiniteNumber } from '../finite-number'
import { authoredProfileDigest } from '../runtime/supervise/materialization'
import { superviseRootProfile } from '../runtime/supervise/supervise'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import type { SpawnEvent, SupervisedResult } from '../runtime/supervise/types'
import { errorMessage } from '../runtime/util'
import { contentAddress } from './content-address'
import {
  loadNode,
  readSealed,
  type VersionNode,
  type VersionRecord,
  versionAccounting,
  versionRun,
} from './pursuit-version-evidence'
import type {
  JudgedPursuitVersion,
  SettledPursuitVersion,
  VersionJudge,
  VersionVerdict,
} from './pursuit-versions'
import type { PursuitFork } from './run-fork'
import { readSettleRecord, SETTLE_RECORD_FILE } from './settle-record'
import { FileSpawnJournal } from './spawn-journal/journal-store'
import type { SupervisedPursuitResult, SupervisePursuitOptions } from './supervise-pursuit'

export type RunOne = (
  profile: SupervisorProfile,
  task: unknown,
  opts: SupervisePursuitOptions,
) => Promise<SupervisedPursuitResult<SupervisedResult<unknown>>>

/** What one chain's versions share. */
export interface VersionChainContext {
  readonly profile: SupervisorProfile
  readonly task: unknown
  /** The call's options without the fields each version sets for itself. */
  readonly base: Omit<SupervisePursuitOptions, 'versions' | 'fork' | 'signal'>
  readonly firstFork: PursuitFork | undefined
  readonly runOne: RunOne
  readonly judge: VersionJudge
  readonly recorder: SearchRecorder
  /** Aborts a running version when the chain reaches its deadline. */
  readonly expired: AbortSignal
  readonly pursuitId: string
  readonly runDir: string
  readonly runId: string
  readonly ledgerPath: string
  readonly searchId: string
  readonly taskRevision: string
}

/** The execution identity a version's node and cell record. */
export function versionExecutionIdentity(
  pursuitId: string,
  taskRevision: string,
  nodeProfile: AgentProfile,
): SearchExecutionIdentity {
  return {
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
  }
}

/** A version as the judge and `next` read it. */
function versionOf(
  record: VersionRecord,
  parent: VersionRecord | undefined,
  settleDigest: Sha256Digest,
  result: SupervisedResult<unknown>,
): SettledPursuitVersion {
  return Object.freeze({
    version: record.version,
    nodeId: record.nodeId,
    runId: record.runId,
    runDir: record.runDir,
    settleDigest,
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

function outcomeOf(settled: SettledPursuitVersion, verdict: VersionVerdict): SearchTaskOutcome {
  if (verdict.score === null) {
    return {
      status: 'errored',
      metrics: {},
      error: {
        code: 'unscored',
        message: `the judge could not score version ${settled.version}`,
        retryable: false,
      },
    }
  }
  if (settled.result.kind === 'winner') {
    return { status: 'passed', score: verdict.score, metrics: {} }
  }
  return {
    status: 'failed',
    score: verdict.score,
    metrics: {},
    failure: {
      code: settled.result.reason,
      message: `version ${settled.version} settled without a winner: ${settled.result.reason}`,
    },
  }
}

export class VersionChainRun {
  // Each sealed result.json is read and hashed once per call.
  private readonly sealed = new Map<Sha256Digest, SupervisedResult<unknown>>()

  constructor(private readonly ctx: VersionChainContext) {}

  /** Run a version if its directory holds no settle record, read it back, and judge it. */
  async runCell(work: SearchCellWork<VersionNode>): Promise<SearchCellResult> {
    const chain = await this.versionsOf()
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
      const signal = AbortSignal.any([work.signal, this.ctx.expired])
      if (signal.aborted) {
        throw new RuntimeRunStateError(
          `supervisePursuit versions: version ${record.version} was not started: ${errorMessage(signal.reason)}`,
        )
      }
      await this.runVersion(record, parent, signal)
    }
    const { settled, byteLength } = await this.readVersion(record, parent)
    const verdict = await this.judgeVersion(settled, work.signal)
    return this.cellResult(settled, byteLength, verdict, work.lane)
  }

  /** Run one version: the first as the call's own run, a later one as a fork of its parent. */
  private async runVersion(
    record: VersionRecord,
    parent: VersionRecord | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const { profile, task, base, firstFork, runOne } = this.ctx
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
  private async readVersion(
    record: VersionRecord,
    parent: VersionRecord | undefined,
  ): Promise<{ settled: SettledPursuitVersion; byteLength: number }> {
    const { base, firstFork, taskRevision } = this.ctx
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
    const ranTask = root?.identity?.taskDigest
    const correlation = root?.identity?.correlation
    const fork =
      parent !== undefined
        ? { settleDigest: parent.seal?.sha256, changeId: record.change?.id }
        : firstFork === undefined
          ? undefined
          : { settleDigest: firstFork.settleDigest, changeId: firstFork.change.id }
    const mismatch = [
      ran !== expected ? `its root ran profile ${ran}, not ${expected}` : undefined,
      ranTask !== taskRevision ? `its root ran task ${ranTask}, not ${taskRevision}` : undefined,
      contentAddress(root?.budget) !== contentAddress(base.budget)
        ? 'its root ran under another budget'
        : undefined,
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
    const settled = versionOf(record, parent, sha256Bytes(bytes), result)
    this.sealed.set(settled.settleDigest, result)
    return { settled, byteLength: bytes.byteLength }
  }

  private async judgeVersion(
    settled: SettledPursuitVersion,
    signal: AbortSignal,
  ): Promise<VersionVerdict> {
    const { judge } = this.ctx
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

  private cellResult(
    settled: SettledPursuitVersion,
    byteLength: number,
    verdict: VersionVerdict,
    lane: string,
  ): SearchCellResult {
    const spent = settled.result.spentTotal
    const settlePath = resolve(settled.runDir, SETTLE_RECORD_FILE)
    return {
      outcome: outcomeOf(settled, verdict),
      accounting: versionAccounting(spent),
      identity: versionExecutionIdentity(
        this.ctx.pursuitId,
        this.ctx.taskRevision,
        settled.profile,
      ),
      boxMinutes:
        isFiniteNumber(spent.boxMinutes) && spent.boxMinutesKnown !== false
          ? spent.boxMinutes
          : null,
      wallMs: isFiniteNumber(spent.ms) ? Math.max(0, Math.round(spent.ms)) : null,
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
        this.ctx.recorder.blob('verdict', {
          kind: 'version-verdict',
          version: settled.version,
          runId: settled.runId,
          verdict,
        }),
      ],
    }
  }

  /** Every version whose latest settled cell carries a verdict, first first, each read back from
   *  its sealed `result.json`. */
  async judgedVersions(chain: ReadonlyMap<string, VersionRecord>): Promise<JudgedPursuitVersion[]> {
    const judged: JudgedPursuitVersion[] = []
    for (const record of chain.values()) {
      if (record.seal === undefined || record.verdict === undefined) continue
      const seal = record.seal.sha256 as Sha256Digest
      let result = this.sealed.get(seal)
      if (result === undefined) {
        const read = await readSealed(record.runDir, record.version)
        if (sha256Bytes(read.bytes) !== seal) {
          throw new RuntimeRunStateError(
            `supervisePursuit versions: version ${record.version}'s result.json changed after it was judged`,
          )
        }
        result = read.result
        this.sealed.set(seal, result)
      }
      const parent = record.parentNodeId === null ? undefined : chain.get(record.parentNodeId)
      judged.push(
        Object.freeze({ ...versionOf(record, parent, seal, result), verdict: record.verdict }),
      )
    }
    return judged
  }

  /**
   * Every node of the chain, in registration order, from the ledger. The state holds cells, not
   * their events' artifacts, so each cell's seal and verdict are read from the ledger lines the
   * state verified, through Eval's own line parser.
   */
  async versionsOf(): Promise<Map<string, VersionRecord>> {
    const { recorder, ledgerPath, searchId, runDir, runId } = this.ctx
    // Take what the state holds before any await: an append retires the view.
    const state = await recorder.state()
    const head = state.head?.sequence ?? -1
    const nodes = state.nodes().map((node) => ({
      node,
      cellId: state.cells({ nodeId: node.nodeId })[0]?.cellId,
      diff: node.edgeIds[0] === undefined ? undefined : state.edge(node.edgeIds[0])?.diffs[0],
    }))
    const settledCells = new Map<string, SearchCellSettledEvent>()
    const text = await readFile(ledgerPath, 'utf8')
    for (const [index, line] of text.split('\n').entries()) {
      if (line.length === 0) continue
      const entry = parseSearchLedgerLine(line, searchId, { path: ledgerPath, line: index + 1 })
      if (entry.sequence > head) break
      if (entry.event.kind === 'cell-settled') settledCells.set(entry.event.cellId, entry.event)
    }
    const chain = new Map<string, VersionRecord>()
    for (const { node, cellId, diff } of nodes) {
      const settled = cellId === undefined ? undefined : settledCells.get(cellId)
      const artifact = (role: string) =>
        settled?.artifacts.find((candidate) => candidate.role === role)
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
      })
    }
    return chain
  }
}
