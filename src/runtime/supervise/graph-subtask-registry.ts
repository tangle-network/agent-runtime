import { isRecord } from '@tangle-network/agent-core'
import { agentProfileSchema, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { loadSpawnForest } from '../../durable/spawn-journal/spawn-forest'
import { ValidationError } from '../../errors'
import { assertJsonData } from '../../json-data'
import type { GraphSubtasks } from '../../mcp/tools/coordination-contracts'
import type { DeliverableSpec } from './completion-gate'
import {
  graphDigest,
  graphRegistry,
  graphRunsFor,
  listGraphRuns,
  lookupGraph,
  recordStoredGraphRun,
  type StoredGraphInput,
  taskShapeDigest,
} from './graph-registry'
import {
  type GraphSubtaskRegistration,
  graphSubtaskOf,
  graphSubtaskRegistrationOf,
} from './graph-topology'
import { captureDeliverable } from './supervise-option-capture'
import type { SuperviseOptions } from './supervise-options'
import { resolveNamed } from './supervise-registry'
import { terminalAccounting } from './supervisor-accounting'
import type { ObserveSupervisorNodeEvent } from './supervisor-agent-contracts'
import { ownSubmissionDeliverable } from './supervisor-agent-profile'
import type { ResultBlobStore, SpawnJournal } from './types'

function taskShape(value: unknown): Record<string, unknown> {
  assertJsonData(value, 'graph registry taskShape')
  if (!isRecord(value)) throw new ValidationError('graph registry taskShape must be an object')
  return value
}

/** Read operations over the existing registry; execution remains the manager's native run_graph. */
export function graphSubtaskRegistryReads(dir: string): Pick<GraphSubtasks, 'lookup' | 'history'> {
  const registry = graphRegistry(dir)
  return {
    lookup: async (value) => {
      const selection = await lookupGraph(registry, taskShapeDigest(taskShape(value)))
      return selection.kind === 'replay'
        ? {
            decision: 'replay',
            graphDigest: selection.graph.digest,
            ...(selection.graph.deliverable.checkRef === undefined
              ? { requiresCheckBinding: true }
              : { checkRef: selection.graph.deliverable.checkRef }),
            record: selection.record,
          }
        : { decision: 'author', reason: selection.reason }
    },
    history: async (value) => ({
      runs:
        value === undefined
          ? await listGraphRuns(registry)
          : await graphRunsFor(registry, taskShapeDigest(taskShape(value))),
    }),
  }
}

/** Validate registration before admission. No task shape means no reuse record. */
export function graphSubtaskRegistration(
  input: Parameters<GraphSubtasks['prepare']>[0],
  options: Pick<SuperviseOptions, 'graphRegistry' | 'registry'>,
  storedCheckRef?: string,
): GraphSubtaskRegistration | undefined {
  const checkRef = input.checkRef === undefined ? storedCheckRef : input.checkRef
  if (checkRef !== undefined && (typeof checkRef !== 'string' || checkRef.trim().length === 0))
    throw new ValidationError('run_graph: checkRef must name an environment deliverable')
  if (input.taskShape !== undefined && options.graphRegistry === undefined)
    throw new ValidationError('run_graph: taskShape recording requires opts.graphRegistry')
  if (input.taskShape === undefined && checkRef === undefined) return undefined
  if (!input.deliverable)
    throw new ValidationError('run_graph: registration requires its deliverable task')
  const registration: GraphSubtaskRegistration = {
    deliverable: input.deliverable,
    ...(input.taskShape === undefined ? {} : { taskShape: taskShape(input.taskShape) }),
    ...(checkRef === undefined ? {} : { checkRef }),
    ...(input.graphDigest === undefined ? {} : { sourceGraphDigest: input.graphDigest }),
  }
  graphSubtaskDeliverable(registration, options.registry)
  return registration
}

/** The existing completion gate judges the graph's final deliverable, outside its authored nodes. */
export function graphSubtaskDeliverable(
  registration: GraphSubtaskRegistration | undefined,
  registry: SuperviseOptions['registry'],
): DeliverableSpec<unknown> | undefined {
  if (registration?.checkRef === undefined) return undefined
  const selected = resolveNamed(
    'deliverable',
    'deliverables',
    registration.checkRef,
    registry?.deliverables,
  )!
  if (selected.check === ownSubmissionDeliverable.check)
    throw new ValidationError('run_graph: a self-submission check cannot establish graph delivery')
  const check = captureDeliverable(selected, `run_graph checkRef ${registration.checkRef}`)
  return {
    ...check,
    check: (out, context) => {
      if (!isRecord(out) || !Object.hasOwn(out, 'deliverable'))
        throw new ValidationError('run_graph: its completion check needs the graph output')
      return check.check(out.deliverable, context)
    },
  }
}

/** Join a committed graph settlement to its admitted profile and owned journal, including replay.
 * The registry is a derived record, never a second execution or recovery store. */
export function graphSubtaskRegistryObserver(
  dir: string,
  journal: SpawnJournal,
  blobs: ResultBlobStore,
  runId: string,
): ObserveSupervisorNodeEvent {
  const registry = graphRegistry(dir)
  return async (_context, event) => {
    if (event.type !== 'settled') return
    const forest = await loadSpawnForest(journal, runId)
    const entry = forest.events.find(
      ({ event: candidate }) =>
        candidate.kind === 'spawned' &&
        candidate.id === event.worker.id &&
        candidate.parent !== undefined,
    )
    if (entry?.event.kind !== 'spawned' || entry.event.profileRef === undefined) return
    const spawn = entry.event
    const profileRef = entry.event.profileRef
    const raw = await blobs.get(profileRef)
    if (raw === undefined || contentAddress(raw) !== profileRef)
      throw new ValidationError('graph registry: admitted profile bytes are unavailable or changed')
    const profile = agentProfileSchema.parse(raw)
    const registration = graphSubtaskRegistrationOf(profile)
    if (registration?.taskShape === undefined) return
    if (spawn.attemptId === undefined)
      throw new ValidationError('graph registry: graph admission has no retained attempt identity')
    if (canonicalAgentProfileDigest(profile) !== spawn.identity?.profileDigest)
      throw new ValidationError('graph registry: graph profile differs from its admitted identity')
    const topology = graphSubtaskOf(profile)!
    const terminal = forest.events
      .filter(
        ({ treeRoot, event: candidate }) =>
          treeRoot === entry.treeRoot &&
          candidate.id === spawn.id &&
          (candidate.kind === 'settled' || candidate.kind === 'cancelled'),
      )
      .at(-1)?.event
    if (terminal?.kind !== 'settled' && terminal?.kind !== 'cancelled')
      throw new ValidationError('graph registry: settlement has no committed terminal record')
    const valid = terminal.kind === 'settled' ? terminal.verdict?.valid : undefined
    const elapsed = Date.parse(terminal.at) - Date.parse(spawn.at)
    const accounting =
      spawn.ownedTreeRoot !== undefined &&
      (await journal.loadTree(spawn.ownedTreeRoot)) !== undefined
        ? await terminalAccounting(journal, spawn.ownedTreeRoot, elapsed, profile)
        : undefined
    const spent = accounting?.spentTotal
    const unknowns = [
      ...(spent === undefined ? ['graph scope accounting is unavailable'] : []),
      ...(spent !== undefined && spent.tokensKnown !== true
        ? ['token accounting is incomplete']
        : []),
      ...(spent !== undefined && spent.usdKnown !== true
        ? ['dollar accounting is incomplete']
        : []),
      ...(registration.checkRef === undefined ? ['no environment completion check was bound'] : []),
      ...(registration.checkRef !== undefined && valid !== true
        ? ['the completion verdict does not distinguish rejection from an unavailable check']
        : []),
    ]
    const definition: StoredGraphInput = {
      ...topology,
      budget: spawn.budget,
      deliverable: {
        describe: registration.deliverable,
        ...(registration.checkRef === undefined ? {} : { checkRef: registration.checkRef }),
      },
    }
    const edges = forest.events.flatMap(({ event: candidate }) =>
      candidate.kind === 'edge' && candidate.graph === spawn.id ? [candidate] : [],
    )
    await recordStoredGraphRun(registry, definition, {
      graphDigest: graphDigest(definition),
      taskDigest: taskShapeDigest(registration.taskShape),
      startedAt: spawn.at,
      finishedAt: terminal.at,
      source: {
        kind: 'runtime-graph-subtask',
        id: spawn.attemptId,
      },
      traceRunId: runId,
      outcome:
        terminal.kind === 'cancelled' || terminal.status === 'down'
          ? {
              kind: 'no-winner',
              reason: terminal.reason ?? 'graph execution ended without a result',
            }
          : registration.checkRef === undefined || valid === undefined
            ? { kind: 'unknown', reason: 'graph completed without independent acceptance evidence' }
            : valid
              ? { kind: 'delivered' }
              : { kind: 'no-winner', reason: 'the environment check did not establish delivery' },
      cost: {
        ms: elapsed,
        ...(spent === undefined ? {} : { iterations: spent.iterations }),
        ...(spent?.tokensKnown === true
          ? {
              tokens: spent.tokens.input + spent.tokens.output,
              inputTokens: spent.tokens.input,
              outputTokens: spent.tokens.output,
            }
          : {}),
        ...(spent?.usdKnown === true ? { usd: spent.usd } : {}),
      },
      traversals: edges.length,
      evidence: [
        { kind: 'admitted-profile', url: profileRef },
        ...(terminal.outRef === undefined ? [] : [{ kind: 'graph-result', url: terminal.outRef }]),
        ...(registration.sourceGraphDigest === undefined
          ? []
          : [{ kind: 'source-graph', url: registration.sourceGraphDigest }]),
      ],
      ...(unknowns.length === 0 ? {} : { unknowns }),
    })
  }
}
