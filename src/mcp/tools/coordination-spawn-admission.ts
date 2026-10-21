import type { Handle, Settled } from '../../runtime'
import { isLiveNodeStatus } from '../../runtime/supervise/node-status'
import type { PeerMailbox } from '../../runtime/supervise/peer-mail'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import { emptyPreflightCounts, spawnRefusalReason } from './coordination-budget'
import { mergeBudget } from './coordination-budget-override'
import type {
  CoordinationToolsOptions,
  ResolvedContinuity,
  SettledWorker,
  SpawnAdmission,
  WorkerSpawnContext,
} from './coordination-contracts'
import type { ContinuityMode } from './coordination-messages'
import { modelSubstitutionReport } from './coordination-model-attribution'

type AdmissionDeps = {
  readonly opts: CoordinationToolsOptions
  readonly ledger: ReadonlyArray<SettledWorker>
  readonly liveWorkerCount: () => number
  readonly freeWorkerSlots: () => number | null
  readonly queuedWorkerCount: () => number
  readonly watchWorker: (id: string) => void
  readonly peerMail: () => PeerMailbox | undefined
  readonly projectSettled: (settled: Settled<unknown>, resumed?: boolean) => SettledWorker
}

/** The spawn bookkeeping one manager owns; every function below reads and writes it by reference. */
type AdmissionState = AdmissionDeps & {
  // Worker id → the AUTHORED profile name it was spawned from. The stable identity an
  // `AnalyzeOnSettleRoute` names (`to`/`over`): labels are the driver's free-text choice, while
  // the profile name is what a graph pins a node by. Recorded at spawn, dropped never (a settled
  // source can still be matched by `over` after it is gone).
  readonly profileNameByWorker: Map<string, string>
  // Assignment id → the worker spawned under it, which a child manager's question names.
  readonly workerByAssignment: Map<string, string>
  // Worker id → the live child Handle from its spawn. `Handle.abort` is the ONLY per-child abort
  // (its controller cascades to that child's subtree and no sibling), and the scope does not
  // re-expose it, so `abortWorker` must keep the handle from the spawn that minted it. Entries
  // are never deleted (liveness is re-checked against the view at abort time); the map is
  // bounded by the run's spawn count, like `profileNameByWorker`.
  readonly liveHandles: Map<string, Handle<unknown>>
  // `Scope` advances its node/cursor ordinals on resume, but assignment identity belongs to this
  // manager. Seed it independently from durable evidence so a restarted manager never calls new
  // work `ordinal:0` when a prior process already used that assignment. Use the maximum rather
  // than the number of rows: journals can contain gaps, keyed assignments, and legacy/custom ids.
  readonly unkeyedAssignment: { next: number }
  readonly preflightCounts: ReturnType<typeof emptyPreflightCounts>
}

export function createSpawnAdmission(deps: AdmissionDeps) {
  const state: AdmissionState = {
    ...deps,
    profileNameByWorker: new Map(),
    workerByAssignment: new Map(),
    liveHandles: new Map(),
    unkeyedAssignment: { next: nextUnkeyedAssignmentOrdinal(deps.opts.scope) },
    preflightCounts: emptyPreflightCounts(),
  }
  return {
    profileNameByWorker: state.profileNameByWorker,
    workerByAssignment: state.workerByAssignment,
    preflightCounts: state.preflightCounts,
    nodeForWorker: (id: string) => nodeForWorker(state, id),
    workerRouteNames: (workerId: string) => workerRouteNames(state, workerId),
    liveWorkerIdNamed: (destination: string) => liveWorkerIdNamed(state, destination),
    resolveContinuity: (
      requested: ContinuityMode | undefined,
      profileName: string | undefined,
      key: string | undefined,
    ) => resolveContinuity(state, requested, profileName, key),
    admitSpawn: (input: SpawnAdmission) => admitSpawn(state, input),
    abortWorker: (ref: string, reason?: string) => abortWorker(state, ref, reason),
  }
}

const nodeForWorker = ({ opts }: AdmissionState, id: string) =>
  opts.scope.view.nodes.find((node) => node.id === id) ??
  opts.scope.resume?.view.nodes.find((node) => node.id === id)

// The names an analyst route may know a worker by: its authored profile name (the stable node
// identity) and its spawn label (the driver's free-text choice).
// A named profile is the worker's route identity. The label is the driver's free text and
// defaults to the profile name, or 'worker' for an unnamed profile, so matching it for a named
// profile would make a route over a node named 'worker' cover every unlabelled worker. It names
// only a worker without a profile name.
function workerRouteNames(state: AdmissionState, workerId: string): Set<string> {
  const profileName = state.profileNameByWorker.get(workerId)
  if (profileName !== undefined) return new Set([profileName])
  const label = nodeForWorker(state, workerId)?.label
  return new Set(label === undefined ? [] : [label])
}

/** The LIVE worker a route destination names, by profile name first, label second. */
function liveWorkerIdNamed(
  { opts, profileNameByWorker }: AdmissionState,
  destination: string,
): string | undefined {
  const live = opts.scope.view.nodes.filter((node) => isLiveNodeStatus(node.status))
  return (
    live.find((node) => profileNameByWorker.get(node.id) === destination)?.id ??
    live.find((node) => node.label === destination)?.id
  )
}

// ── Continuity: how a spawn continues a node's prior work ──
// Node identity is the PROFILE NAME only (never the label): resume re-attaches to a specific
// prior session, and the label is the driver's free-text choice. All three reads are
// process-local by construction — `profileNameByWorker` records only this process's spawns —
// which is the documented resume boundary (a prior process's workers are not resume targets).
function liveWorkerForNode({ opts, profileNameByWorker }: AdmissionState, name: string) {
  return opts.scope.view.nodes.find(
    (node) => isLiveNodeStatus(node.status) && profileNameByWorker.get(node.id) === name,
  )?.id
}

function latestSettledWorkerForNode(
  { ledger, profileNameByWorker }: AdmissionState,
  name: string,
): string | undefined {
  for (let i = ledger.length - 1; i >= 0; i -= 1) {
    const worker = ledger[i] as SettledWorker
    if (profileNameByWorker.get(worker.id) === name) return worker.id
  }
  return undefined
}

function nodeSpawnCount({ profileNameByWorker }: AdmissionState, name: string): number {
  let count = 0
  for (const profileName of profileNameByWorker.values()) if (profileName === name) count += 1
  return count
}

/**
 * Resolve the EFFECTIVE continuity of one spawn: the per-call request wins, else the profile
 * name's declared default, else `'fresh'`. Every refusal is loud and actionable:
 *   - an EXPLICIT `'resume'` with no settled prior worker refuses (`resume-no-prior`) — the
 *     DECLARED default degrades to `'fresh'` instead, so a resume edge's first traversal is
 *     simply the first spawn;
 *   - resume while a prior worker of the node is still LIVE refuses (`resume-while-live`) —
 *     that is what steer is for, and the error says so;
 *   - resume under a semantic `key` refuses (`resume-with-key`) — a key makes an assignment
 *     run-once, resume explicitly runs the node again.
 */
function resolveContinuity(
  state: AdmissionState,
  requested: ContinuityMode | undefined,
  profileName: string | undefined,
  key: string | undefined,
): ResolvedContinuity {
  const declared =
    profileName === undefined ? 'fresh' : (state.opts.continuityByProfile?.[profileName] ?? 'fresh')
  const wantsResume = requested === 'resume' || (requested === undefined && declared === 'resume')
  if (!wantsResume) return { continuity: 'fresh' }
  if (profileName === undefined || profileName.length === 0) {
    return {
      error: 'resume-unnamed-profile',
      hint:
        'Resume targets a node by profile.name — the stable node identity — and this profile ' +
        'has none. Name the profile, or spawn fresh.',
    }
  }
  if (key !== undefined) {
    return {
      error: 'resume-with-key',
      hint:
        'A semantic key makes an assignment run-once (a completed key returns its committed ' +
        'result instead of running again); resume explicitly runs the node AGAIN. Drop the ' +
        'key to resume, or keep the key and spawn fresh.',
    }
  }
  const live = liveWorkerForNode(state, profileName)
  if (live !== undefined) {
    return {
      error: 'resume-while-live',
      hint:
        `Worker '${live}' on node '${profileName}' is still LIVE — resume re-attaches to a ` +
        'SETTLED session. To redirect the live worker, use steer_agent (that is the ' +
        "live-worker channel); to run a parallel sibling instead, pass continuity: 'fresh'.",
    }
  }
  const prior = latestSettledWorkerForNode(state, profileName)
  if (prior === undefined) {
    // The DECLARED default asked for resume-when-possible; with nothing to resume this is the
    // node's effective first spawn. Only an explicit per-call demand fails loud here.
    if (requested === undefined) return { continuity: 'fresh' }
    return {
      error: 'resume-no-prior',
      hint:
        `Node '${profileName}' has no settled prior worker in this process to resume — ` +
        'resume continues a FINISHED session. Spawn the node fresh first (omit continuity or ' +
        "pass 'fresh').",
    }
  }
  return {
    continuity: 'resume',
    resume: { ofWorker: prior, sequence: nodeSpawnCount(state, profileName) + 1 },
  }
}

/**
 * The ONE pre-journal point that may ask the backend a question: everything after it —
 * assignment, budget reservation, `Scope.spawn` — is synchronous and commits state.
 * Returns the refusal body, or `undefined` when the spawn may proceed.
 */
async function preflightRefusal(
  state: AdmissionState,
  input: SpawnAdmission,
  label: string,
  task: ReturnType<typeof detachedFrozen>,
): Promise<unknown> {
  const { opts } = state
  if (!opts.preflightSpawn) return undefined
  const { key } = input
  // The gate judges the profile that will RUN, which the caller resolved.
  const refusal = await opts.preflightSpawn(input.preflightProfile(), {
    label,
    ...(key !== undefined ? { key } : {}),
    task,
  })
  if (!refusal) return undefined
  state.preflightCounts[refusal.cause] += 1
  return {
    error: 'preflight-refused' as const,
    reason: `the spawn pre-flight refused this profile (${refusal.cause}): ${refusal.detail}`,
    cause: refusal.cause,
    detail: refusal.detail,
    live: state.liveWorkerCount(),
    freeSlots: state.freeWorkerSlots(),
  }
}

type SpawnResult = ReturnType<Scope<unknown>['spawn']>

async function admitSpawn(state: AdmissionState, input: SpawnAdmission): Promise<unknown> {
  const { opts, peerMail } = state
  const { profile, key, continuity, successorOf } = input
  const a = input.args
  const task = detachedFrozen(input.task)
  const label = typeof a.label === 'string' ? a.label : input.defaultLabel
  const refused = await preflightRefusal(state, input, label, task)
  if (refused !== undefined) return refused
  const budget = Object.freeze(
    a.budget === undefined ? opts.perWorker : mergeBudget(opts.perWorker, a.budget),
  )
  const assignmentId =
    key !== undefined ? `key:${key}` : `ordinal:${state.unkeyedAssignment.next++}`
  // Minted BEFORE the worker exists, because the agent factory runs inside `scope.spawn` and
  // the node id is not known until after it. The capability is bound to the concrete worker
  // below, and sends nothing until then.
  const peerMailUrl = peerMail()?.mintCapability(assignmentId)
  const context: WorkerSpawnContext = Object.freeze({
    assignmentId,
    parentNodeId: opts.scope.view.root,
    budget,
    task,
    label,
    ...(key !== undefined ? { key } : {}),
    continuity: continuity.continuity,
    ...(continuity.continuity === 'resume' ? { resume: continuity.resume } : {}),
    ...(successorOf !== undefined ? { successorOf } : {}),
    ...(peerMailUrl !== undefined ? { peerMailUrl } : {}),
    ...(input.map !== undefined ? { map: input.map } : {}),
    ...(input.route !== undefined ? { route: input.route } : {}),
  })
  const res = opts.scope.spawn(() => opts.makeWorkerAgent(profile, context), task, {
    budget,
    label,
    assignmentId,
    ...(key !== undefined ? { key } : {}),
    ...(successorOf !== undefined ? { successorOf } : {}),
    // A re-spawned key that names a budget asks for more: a result that ended over its budget,
    // with its environment still held, continues in the same session.
    ...(key !== undefined && a.budget !== undefined ? { continueHeld: true } : {}),
  })
  // A keyed spawn that resolved to committed work: NOTHING ran — return the finished result
  // (it is already in the settled ledger, seeded from the resumed scope or recorded when the
  // cursor yielded it), so the driver folds it in without waiting for a wake.
  if (res.ok && res.prior?.state === 'completed') {
    return Promise.resolve(committedSpawnReport(state, res.prior.settled))
  }
  if (res.ok) recordSpawnedWorker(state, res.handle, profile.name, assignmentId)
  return Promise.resolve(
    res.ok ? startedSpawnReport(state, input, res, assignmentId) : refusedSpawnReport(state, res),
  )
}

function committedSpawnReport(state: AdmissionState, s: Settled<unknown>) {
  const { id, status, resumed: _resumed, ...evidence } = state.projectSettled(s)
  return {
    workerId: id,
    resumed: 'completed' as const,
    status,
    ...evidence,
    ...(evidence.outRef === undefined
      ? {}
      : {
          outputRead: { tool: 'observe_agent', arguments: { workerId: id } },
        }),
    live: state.liveWorkerCount(),
    freeSlots: state.freeWorkerSlots(),
  }
}

function recordSpawnedWorker(
  state: AdmissionState,
  handle: Handle<unknown>,
  profileName: unknown,
  assignmentId: string,
): void {
  state.watchWorker(handle.id)
  state.liveHandles.set(handle.id, handle)
  // The capability becomes a sender only now, when there is a concrete worker to speak as.
  state.peerMail()?.bindCapability(assignmentId, handle.id)
  if (typeof profileName === 'string' && profileName.length > 0) {
    state.profileNameByWorker.set(handle.id, profileName)
  }
  state.workerByAssignment.set(assignmentId, handle.id)
}

// Report the REMAINING capacity alongside the spawn, so one tool call tells the driver
// both "it started" and "you can still open N more" — the feedback that lets it fill
// slots instead of opening one worker per turn. `null` = uncapped. A fresh spawn under a
// key with a failed prior attempt carries that history (`resumed`/`priorWorkerId`), so a
// re-run is always explicit. An in-doubt prior is refused above and never duplicated.
function startedSpawnReport(
  state: AdmissionState,
  input: SpawnAdmission,
  res: Extract<SpawnResult, { ok: true }>,
  assignmentId: string,
) {
  const { continuity, successorOf } = input
  // A `completed` key returned earlier, so any prior still attached here is a real re-run:
  // `retried` means the prior attempt reached a terminal down receipt.
  const priorHistory =
    res.prior !== undefined && res.prior.state !== 'completed'
      ? {
          resumed: res.prior.state,
          priorWorkerId: res.prior.priorId,
          ...(res.prior.state === 'retried' ? { priorReason: res.prior.reason } : {}),
        }
      : {}
  return {
    workerId: res.handle.id,
    assignmentId: res.handle.assignmentId ?? assignmentId,
    ...(res.handle.identity === undefined ? {} : { identity: res.handle.identity }),
    ...(res.handle.modelSubstitution === undefined
      ? {}
      : modelSubstitutionReport(res.handle.modelSubstitution)),
    ...(res.handle.materialization === undefined
      ? {}
      : { materialization: res.handle.materialization }),
    ...(res.handle.executionBindings === undefined
      ? {}
      : { executionBindings: res.handle.executionBindings }),
    // The EFFECTIVE continuity of this spawn, with the resume lineage when it
    // re-attached — so the driver's transcript states how the node continued.
    continuity: continuity.continuity,
    ...(continuity.continuity === 'resume' ? { resume: continuity.resume } : {}),
    ...(successorOf !== undefined ? { successorOf } : {}),
    status: res.handle.status,
    live: state.liveWorkerCount(),
    queued: state.queuedWorkerCount(),
    freeSlots: state.freeWorkerSlots(),
    ...priorHistory,
    // The receipt for every resource the server read by path: the manager can check
    // the sha256 against its own file instead of trusting that the bytes arrived.
    ...(input.resourcesFromPath.length === 0 ? {} : { resourcesFromPath: input.resourcesFromPath }),
    ...input.accepted,
  }
}

// A refusal a driver can ACT on: each kind says what happened and what to do next.
// `usd-unbudgeted` is the one rejection no retry can clear, so it says so: without
// that, a driver reads "budget" and walks its request down until it gives up.
function refusedSpawnReport(state: AdmissionState, res: Extract<SpawnResult, { ok: false }>) {
  return {
    error: res.reason,
    reason: spawnRefusalReason(res.reason, res.shortfalls, {
      usdUnbudgeted:
        "this run's root budget declares no maxUsd, so a child budget naming maxUsd can never be admitted at any amount — spawn with a budget that omits maxUsd",
      inDoubt:
        'this key has a prior worker recorded as started without a terminal receipt; no replacement was started because that remote worker may still be running — inspect or recover the exact prior execution before retrying',
      // Nothing is exhausted and nothing was cancelled: this run's driver already
      // finished and the supervisor is joining. A caller that reaches here is working
      // past the end of its own request; the honest report is that the stage never
      // started, not that it failed.
      scopeSettled:
        'this run has already reached its join barrier — its driver returned and the supervisor is settling, so no further worker can be started, joined, or paid for; record this stage as not started',
    }),
    ...(res.shortfalls === undefined ? {} : { shortfalls: res.shortfalls }),
    ...(res.reason === 'usd-unbudgeted'
      ? {
          hint:
            "This run's root budget declares no maxUsd, so a child budget naming maxUsd " +
            'can never be admitted — at any amount. Retrying with a smaller maxUsd will ' +
            'fail identically. Spawn with a budget that omits maxUsd, or ask the caller ' +
            'to give the run a root maxUsd.',
        }
      : res.reason === 'in-doubt'
        ? {
            hint: 'Do not retry this key. Use the recorded prior worker identity to inspect or recover that exact execution. A terminal receipt or explicit recovery is required before replacement work can start.',
          }
        : {}),
    live: state.liveWorkerCount(),
    freeSlots: state.freeWorkerSlots(),
  }
}

// Per-child abort by stable reference. Resolution order matches the steer destination rule
// (profile name before label) with the exact workerId first; only LIVE workers resolve, so an
// already-settled or unknown reference returns `undefined` instead of a false "aborted".
function abortWorker(
  { opts, profileNameByWorker, liveHandles }: AdmissionState,
  ref: string,
  reason?: string,
): { readonly id: string; readonly label: string } | undefined {
  const live = opts.scope.view.nodes.filter((node) => isLiveNodeStatus(node.status))
  const target =
    live.find((node) => node.id === ref) ??
    live.find((node) => profileNameByWorker.get(node.id) === ref) ??
    live.find((node) => node.label === ref)
  if (target === undefined) return undefined
  const handle = liveHandles.get(target.id)
  if (handle === undefined) return undefined
  handle.abort(reason)
  return { id: target.id, label: target.label }
}

import type { Scope } from '../../runtime'

function nextUnkeyedAssignmentOrdinal(scope: Scope<unknown>): number {
  let next = 0
  const views = [scope.resume?.view, scope.view]
  for (const view of views) {
    if (view === undefined) continue
    for (const node of view.nodes) {
      const match = /^ordinal:(\d+)$/.exec(node.assignmentId ?? '')
      if (match === null) continue
      const ordinal = Number(match[1])
      if (!Number.isSafeInteger(ordinal)) {
        throw new Error(
          `coordination: durable assignment id '${node.assignmentId}' exceeds the safe ordinal range`,
        )
      }
      next = Math.max(next, ordinal + 1)
    }
  }
  if (!Number.isSafeInteger(next)) {
    throw new Error('coordination: durable assignment ordinal space is exhausted')
  }
  return next
}
