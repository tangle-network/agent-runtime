import { agentProfileSchema } from '@tangle-network/agent-interface'
import { isLiveNodeStatus } from '../../runtime/supervise/node-status'
import { runtimeGraphMetadataKey } from '../../runtime/supervise/provider-visible-profile'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { McpToolDescriptor } from '../server'
import { spawnBudgetArg } from './coordination-budget'
import type { CoordinationTools, CoordinationToolsOptions } from './coordination-contracts'
import { obj, parseContinuity, str } from './coordination-input'
import { downMessageRefusalReasons } from './coordination-messages'
import {
  profileTableRefusal,
  spawnProfileArg,
  spawnProfileArgWithTable,
} from './coordination-profile-schema'
import type { createSpawnAdmission } from './coordination-spawn-admission'
import { idArg } from './coordination-worker-argument'
import type { createWorkerObservation } from './coordination-worker-observation'
import {
  type ResolveSpawnResourcePathsResult,
  resolveSpawnResourcePaths,
} from './spawn-resource-paths'
import type { createWorkerOutputReader } from './worker-output'
import { WORKER_OUTPUT_PAGE_CHARS, workerOutputReadOptions } from './worker-output'
export function createWorkerTools({
  opts,
  profileTable,
  spawn,
  workers,
  descendantOutRefs,
  readWorkerOutput,
  redactJournalEvent,
  steerWorker,
}: {
  readonly opts: CoordinationToolsOptions
  readonly profileTable: CoordinationToolsOptions['profiles']
  readonly spawn: ReturnType<typeof createSpawnAdmission>
  readonly workers: ReturnType<typeof createWorkerObservation>
  readonly descendantOutRefs: ReadonlySet<string>
  readonly redactJournalEvent: (value: unknown) => unknown
  readonly readWorkerOutput: ReturnType<typeof createWorkerOutputReader>
  readonly steerWorker: CoordinationTools['steerWorker']
}): McpToolDescriptor[] {
  return [
    {
      name: 'spawn_worker',
      description:
        'Start a worker the driver will drive. `profile` is the worker or another driver; ' +
        '`task` is what it should do. Reserves budget from the conserved pool and fails closed. ' +
        'Pass an optional `budget` (per-field) to give a sub-task more or less than the default — ' +
        'it merges over the per-worker default; the conserved pool is still the hard fence. Each ' +
        'worker reserves its whole budget when it starts, so the pool divided by the per-worker ' +
        'budget is how many run at once: to run a wide team at once, give each worker less. When ' +
        'every worker slot is busy, or the pool cannot cover the budget until your running workers ' +
        'return what they hold, the worker is admitted with `status: "queued"` and starts on its ' +
        'own when a slot and its budget free — it is never refused for concurrency, so spawn all ' +
        'the work you want done, then end your turn: you are woken with each result. A queued worker whose budget ' +
        'never frees settles down as budget-exhausted. ' +
        'Pass a `key` naming the assignment to make it run-once ACROSS restarts: a key that ' +
        'already completed returns the finished result (`resumed: "completed"` — no work re-runs, ' +
        'nothing is spent). A keyed worker that settled with a `budgetStop` keeps its session for ' +
        'a while: spawn the same key with a larger `budget` and a new worker continues that same ' +
        'session where it stopped (`resumed: "continued"`, `priorWorkerId`), or cancel_worker the ' +
        'stopped worker to release it. A key whose prior attempt failed (`down`) spawns fresh and says so ' +
        '(`resumed: "retried"`), and a key the process died with IN FLIGHT retries under the same ' +
        'key when the executor provably died with the process (an inline worker — the same ' +
        '`resumed: "retried"`, naming the interruption). A key with no terminal receipt whose ' +
        'execution may still exist elsewhere (sandbox, CLI bridge, router) is refused ' +
        '(`error: "in-doubt"`) until its exact prior execution is recovered. A key still running ' +
        'is refused (`error: "duplicate-key"`). ' +
        'Returns `freeSlots`: how many MORE workers start at once (`null` = no slot bound), and ' +
        '`queued`: how many of your workers wait for a slot. Parallel workers finish the run ' +
        'sooner than one at a time.' +
        (profileTable === undefined
          ? ''
          : " This run has a profiles table: pass `profile` as one of the table's names to run " +
            'that exact profile, or write a new profile under a name the table does not hold.'),
      inputSchema: {
        type: 'object',
        properties: {
          profile:
            profileTable === undefined ? spawnProfileArg() : spawnProfileArgWithTable(profileTable),
          task: { description: 'The task the worker should perform.' },
          label: {
            type: 'string',
            description: 'Optional trace label; defaults to the profile name.',
          },
          key: {
            type: 'string',
            description:
              'Optional semantic name for this assignment (e.g. "summarize-ch3"). The same key ' +
              'never runs twice: completed keys return their committed result, even after a ' +
              'coordinator restart.',
          },
          continuity: {
            type: 'string',
            enum: ['fresh', 'resume'],
            description:
              'How this spawn continues the node\'s prior work. "fresh" (the default) starts a ' +
              'brand-new session. "resume" re-attaches to the node\'s most recent SETTLED ' +
              'worker: a NEW live worker is spawned whose session continues where that worker ' +
              'stopped (the backend receives the prior workerId and the resume sequence). ' +
              'Resume fails closed when the node has no settled prior worker ' +
              '(`error: "resume-no-prior"` — spawn it fresh first), while a prior worker of the ' +
              'node is still live (`error: "resume-while-live"` — steer_agent is the ' +
              'live-worker channel), and under a `key` (`error: "resume-with-key"` — keys are ' +
              "run-once, resume runs again). Omit to use the run's declared default for this " +
              'profile name.',
          },
          successorOf: {
            type: 'string',
            description:
              'The workerId of a SETTLED worker you spawned that this new worker replaces — for ' +
              'example one that failed, stalled, or finished with a weak result, restarted with a ' +
              'changed profile or task. The run record then names the predecessor on the new ' +
              'worker. Refused for an id you did not spawn (`error: "successor-unknown"`) and for ' +
              'a worker still live (`error: "successor-live"` — end your turn until it settles). ' +
              'Put what the successor needs from its predecessor in `task`.',
          },
          budget: spawnBudgetArg,
        },
        required: ['profile', 'task'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const key = a.key === undefined ? undefined : str(a.key, 'key')
        // A name selects a profiles-table entry: its exact validated profile stands in for an
        // authored one, and every step below treats it the same way.
        const tableRefusal = profileTableRefusal(profileTable, a.profile)
        if (tableRefusal !== undefined) {
          return {
            error: 'invalid-profile' as const,
            reason: tableRefusal,
            issues: [{ path: 'profile', message: tableRefusal }],
          }
        }
        const tableEntry = typeof a.profile === 'string' ? profileTable?.get(a.profile) : undefined
        // A resource named by path is read here, under the manager's workspace root, so the
        // canonical schema validates the inline resource its bytes make and the journal records
        // exactly what the child received. A table entry carries its own bytes.
        const resourcePaths: ResolveSpawnResourcePathsResult =
          tableEntry === undefined
            ? await resolveSpawnResourcePaths(
                a.profile,
                opts.spawnResourceReader ?? opts.spawnResourceRoot,
              )
            : { ok: true as const, profile: tableEntry.profile, resolved: [] }
        if (!resourcePaths.ok) {
          return {
            error: 'invalid-profile' as const,
            reason: `resources.${resourcePaths.at}: ${resourcePaths.reason}`,
            issues: [{ path: `resources.${resourcePaths.at}`, message: resourcePaths.reason }],
          }
        }
        const parsedProfile = agentProfileSchema.safeParse(resourcePaths.profile)
        if (!parsedProfile.success) {
          return Promise.resolve({
            error: 'invalid-profile' as const,
            reason: `the profile you wrote is not a valid AgentProfile: ${parsedProfile.error.issues
              .map((issue) => `${issue.path.join('.') || 'profile'} ${issue.message}`)
              .join('; ')}`,
            issues: parsedProfile.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          })
        }
        // Only run_graph starts a graph: the topology a graph root carries is Runtime's to write,
        // so a profile that carries one would start a graph without the run_graph grant.
        if (parsedProfile.data.metadata?.[runtimeGraphMetadataKey] !== undefined) {
          const reason = `metadata.${runtimeGraphMetadataKey} is written by Runtime for the root of a run_graph subtask; call run_graph to run a graph`
          return {
            error: 'invalid-profile' as const,
            reason,
            issues: [{ path: `metadata.${runtimeGraphMetadataKey}`, message: reason }],
          }
        }
        const profile = detachedFrozen(
          opts.composeSpawnProfile
            ? agentProfileSchema.parse(opts.composeSpawnProfile(parsedProfile.data))
            : parsedProfile.data,
        )
        // Continuity resolves BEFORE any assignment is minted or budget reserved, so a refused
        // resume touches nothing — same fail-closed discipline as the fences above.
        const continuity = spawn.resolveContinuity(parseContinuity(a.continuity), profile.name, key)
        if ('error' in continuity) {
          return Promise.resolve({
            // `reason` is the contract every refusal carries; `hint` is retained under its old name
            // for readers that already key on it, and both are the same sentence by construction so
            // they cannot drift.
            error: continuity.error,
            reason: continuity.hint,
            hint: continuity.hint,
            live: workers.liveWorkerCount(),
            freeSlots: workers.freeWorkerSlots(),
          })
        }
        // A successor names a settled worker of this manager, so the relation the journal records
        // is true: never an unknown id, and never a worker still running beside its replacement.
        const successorOf =
          a.successorOf === undefined ? undefined : str(a.successorOf, 'successorOf')
        if (successorOf !== undefined) {
          const predecessor = spawn.nodeForWorker(successorOf)
          if (predecessor === undefined || predecessor.parent !== opts.scope.view.root) {
            return {
              error: 'successor-unknown' as const,
              reason: `'${successorOf}' is not a worker this manager spawned — successorOf takes a workerId from one of your own spawn_worker results`,
              live: workers.liveWorkerCount(),
              freeSlots: workers.freeWorkerSlots(),
            }
          }
          if (isLiveNodeStatus(predecessor.status)) {
            return {
              error: 'successor-live' as const,
              reason: `worker '${successorOf}' has not settled — end your turn until it does, then spawn its successor (steer_agent redirects a live worker instead)`,
              live: workers.liveWorkerCount(),
              freeSlots: workers.freeWorkerSlots(),
            }
          }
        }
        return spawn.admitSpawn({
          profile,
          args: a,
          task: a.task,
          key,
          continuity,
          successorOf,
          // The gate judges the profile that will RUN. A pinning layer resolves the authored stub
          // to its canonical profile here, so the backend is asked about the real model and tools.
          preflightProfile: () =>
            opts.resolveSpawnProfile ? detachedFrozen(opts.resolveSpawnProfile(profile)) : profile,
          resourcesFromPath: resourcePaths.resolved,
          // magnetar-rust-20261018b's 13 workers were all labelled 'worker', so no view showed a role.
          defaultLabel:
            typeof profile.name === 'string' && profile.name.length > 0 ? profile.name : 'worker',
        })
      },
    },
    {
      name: 'observe_agent',
      description:
        'Inspect a worker WHILE IT RUNS, not only after it finishes: status, spend so far, and ' +
        '`progress` — how long since it last did anything (`idleMs`), whether that counts as ' +
        'stalled, how many turns it has taken, the last tools/files it touched ' +
        '(`recentActivity`), what its executor CHANGED about the profile you gave it ' +
        '(`derived` — an MCP config it materialized, an extension it had to add), whether a ' +
        'steer can even reach it (`steerable`), and how many ' +
        'steers it has not yet read (`pendingMessages`). For a worker that leads its own team, ' +
        '`progress.team` counts the agents below it (working, queued, done, down) and its idle ' +
        'clock reads the newest activity anywhere in that team, so a lead whose workers are busy ' +
        'is not stalled. A queued worker waits for a worker slot and is never stalled. ' +
        'A worker whose executor has FINISHED ' +
        'but whose settlement you have not yet drained reports `settlementPending` with its ' +
        'terminal kind; its `status` still reads running until your next wake ' +
        'delivers it, so end your turn rather than observing again. The settled output ' +
        'artifact is returned once drained. Select a field with `outputPath`, for example ["content"] ' +
        'to read a provider result without its event history. Omit it to read the complete artifact. ' +
        'Large outputs return a bounded JSON `outputPage`; ' +
        'repeat with `outputOffset: outputPage.nextOffset` until it is null, concatenate page text, ' +
        'then parse the JSON. Offsets and limits count UTF-16 characters. The full artifact stays ' +
        'retained; an outRef is a content address, not a workspace path. Use this BEFORE steer_agent: a steer is only worth ' +
        'sending when the progress says the worker is on the wrong path or has stopped making any.',
      inputSchema: {
        type: 'object',
        properties: {
          events: {
            type: 'boolean',
            description: 'Read bounded live output for an owned descendant.',
          },
          tree: {
            type: 'boolean',
            description: "Read this manager's complete owned tree without reading state files.",
          },
          eventCursor: {
            type: 'object',
            properties: {
              epoch: { type: 'string', minLength: 1 },
              next: { type: 'integer', minimum: 0 },
            },
            required: ['epoch', 'next'],
            additionalProperties: false,
          },

          workerId: idArg,
          outRef: {
            type: 'string',
            description:
              'Instead of workerId: the content address of a result listed in a settled ' +
              "worker's `subtree.results` or authorized for your analyst assignment, to read it in full.",
          },
          outputPath: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Own field names from the artifact root; array indices use strings. Default: the complete artifact.',
          },
          outputOffset: {
            type: 'integer',
            minimum: 0,
            description: 'Start at this retained JSON character offset; default 0.',
          },
          outputLimit: {
            type: 'integer',
            minimum: 1,
            maximum: WORKER_OUTPUT_PAGE_CHARS,
            description: `Maximum JSON characters per page; default ${WORKER_OUTPUT_PAGE_CHARS}.`,
          },
        },
      },
      handler: async (raw) => {
        const args = obj(raw)
        if (args.tree === true) {
          const tree = opts.scope.observeTree?.() ?? opts.scope.view
          return redactJournalEvent({
            tree: {
              root: tree.root,
              inFlight: tree.inFlight,
              nodes: tree.nodes.map((node) => ({
                id: node.id,
                parent: node.parent,
                label: node.label,
                status: node.status,
                runtime: node.runtime,
                spawnedAt: node.spawnedAt,
                settledAt: node.settledAt,
              })),
            },
          })
        }
        const eventCursor =
          args.eventCursor === undefined
            ? undefined
            : (() => {
                const cursor = obj(args.eventCursor)
                if (
                  typeof cursor.epoch !== 'string' ||
                  cursor.epoch.length === 0 ||
                  !Number.isSafeInteger(cursor.next) ||
                  Number(cursor.next) < 0
                )
                  throw new Error('eventCursor must name an epoch and a non-negative safe integer')
                return { epoch: cursor.epoch, next: Number(cursor.next) }
              })()
        if (args.events === true) {
          const id = str(args.workerId, 'workerId')
          const node = (opts.scope.observeTree?.() ?? opts.scope.view).nodes.find(
            (candidate) => candidate.id === id,
          )
          if (!node) return { error: 'unknown-worker' as const }
          return redactJournalEvent({
            id: node.id,
            parent: node.parent,
            label: node.label,
            status: node.status,
            runtime: node.runtime,
            events: opts.scope.observeEvents?.(id, eventCursor) ?? {
              status: 'unavailable',
              reason: 'not-captured',
            },
          })
        }
        const outputRead = workerOutputReadOptions(args)
        if (args.outRef !== undefined && args.workerId === undefined) {
          const outRef = str(args.outRef, 'outRef')
          if (!descendantOutRefs.has(outRef)) {
            return {
              error: 'unknown-result' as const,
              reason:
                'this outRef was not authorized as assignment evidence or listed in a subtree summary; pass an authorized source ref, a subtree.results outRef, or observe your own worker by workerId',
            }
          }
          return { outRef, ...(await readWorkerOutput(outRef, outputRead)) }
        }
        const id = str(args.workerId, 'workerId')
        const node = opts.scope.view.nodes.find((n) => n.id === id)
        if (!node) {
          // A worker from a PRIOR process of this run: not in the live nursery, but its committed
          // record is on the resumed view — observable like any settled worker, marked `resumed`.
          const resumed = opts.scope.resume?.view.nodes.find((n) => n.id === id)
          if (!resumed)
            return {
              error: 'unknown-worker' as const,
              reason: `no worker of this manager has the id ${JSON.stringify(id)}; spawn_worker returns the ids you may observe`,
            }
          return {
            ...workers.projectNodeEvidence(resumed, true),
            outRef: resumed.outRef ?? null,
            ...(await readWorkerOutput(resumed.outRef, outputRead)),
            progress: null,
          }
        }
        const progress = workers.readProgress(id)
        // Finished-but-undrained is the one state a polling manager cannot otherwise see: the
        // executor is gone, the settlement sits in the inbox, and `status` still says running.
        // Say so in the fields the manager reads, and point at the call that resolves it.
        const pending = node.settlementPending
        return {
          ...workers.projectNodeEvidence(node),
          events: opts.scope.observeEvents?.(node.id, eventCursor) ?? {
            status: 'unavailable',
            reason: 'not-captured',
          },
          outRef: node.outRef ?? null,
          ...(await readWorkerOutput(node.outRef, outputRead)),
          progress: progress ?? null,
          ...(pending
            ? {
                settlementPending: pending,
                hint: `this worker has finished (${pending.kind}); its settlement is queued for your next wake — end your turn to receive it, observing again will not change this`,
              }
            : {}),
        }
      },
    },
    {
      name: 'steer_agent',
      description:
        'Send a message DOWN to a still-LIVE worker (parent→child): a new instruction, a course ' +
        'correction, or a continuation. The worker reads it at its next step boundary — and before ' +
        'it may settle, so it cannot finish while a message it never read is pending. A worker that ' +
        'already settled is gone (returns delivered:false) — spawn a fresh one instead.',
      inputSchema: {
        type: 'object',
        properties: {
          workerId: idArg,
          instruction: { type: 'string', description: 'What the worker should do next.' },
          interrupt: {
            type: 'boolean',
            description:
              'true = forceful: abort the worker’s in-flight inference so it re-plans on the NEXT ' +
              'turn (a tool already mid-execution finishes first; only the owned tool-loop honors this). ' +
              'false/omitted = queued: it flushes at the next step boundary (and before it may settle).',
          },
        },
        required: ['workerId', 'instruction'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const workerId = str(a.workerId, 'workerId')
        const instruction = str(a.instruction, 'instruction')
        const delivery = await steerWorker(workerId, instruction, {
          interrupt: a.interrupt === true,
        })
        if (delivery.delivered) {
          return { delivered: true, progress: workers.readProgress(workerId) ?? null }
        }
        return {
          delivered: false,
          outcome: delivery.outcome,
          reason: downMessageRefusalReasons[delivery.outcome],
          progress: workers.readProgress(workerId) ?? null,
        }
      },
    },
    {
      name: 'cancel_worker',
      description:
        'Cancel one of YOUR live workers — running, or queued for a worker slot — and every worker ' +
        'it leads. Its unspent budget returns to your pool when it settles, so this is how you ' +
        'take back what a stalled or no-longer-needed worker holds (for example when spawn_worker ' +
        'is refused budget-exhausted while workers you no longer need hold the budget). The ' +
        'cancelled worker still settles `down`, delivered in your next wake with what it spent. ' +
        'For a worker that settled with a `budgetStop` and still holds its session, this releases ' +
        'that session instead (`released: true`). ' +
        'Refused (`error: "not-live"`) for a worker that already settled or is not yours.',
      inputSchema: {
        type: 'object',
        properties: {
          workerId: idArg,
          reason: {
            type: 'string',
            description: 'Why it is cancelled; recorded on its settlement.',
          },
        },
        required: ['workerId'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const workerId = str(a.workerId, 'workerId')
        const why = a.reason === undefined ? 'cancelled by its manager' : str(a.reason, 'reason')
        // Exact ids only: a label or profile name could name a sibling the manager did not mean.
        const own = opts.scope.view.nodes.some(
          (node) => node.id === workerId && isLiveNodeStatus(node.status),
        )
        const cancelled = own ? spawn.abortWorker(workerId, why) : undefined
        if (
          cancelled === undefined &&
          opts.scope.view.nodes.some(
            (node) => node.id === workerId && node.parent === opts.scope.view.root,
          ) &&
          (await opts.scope.releaseHeld?.(workerId, 'cancel-worker')) === true
        ) {
          return {
            released: true,
            workerId,
            live: workers.liveWorkerCount(),
            queued: workers.queuedWorkerCount(),
          }
        }
        if (cancelled === undefined) {
          return {
            error: 'not-live' as const,
            reason: `'${workerId}' is not a live worker you spawned; only your own running or queued workers can be cancelled`,
            live: workers.liveWorkerCount(),
            queued: workers.queuedWorkerCount(),
          }
        }
        return {
          cancelled: true,
          workerId: cancelled.id,
          label: cancelled.label,
          live: workers.liveWorkerCount(),
          queued: workers.queuedWorkerCount(),
        }
      },
    },
  ]
}
