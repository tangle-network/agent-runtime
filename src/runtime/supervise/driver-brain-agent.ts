import { ValidationError } from '../../errors'
import { normalizeAnalyzeOnSettle } from '../../mcp/tools/coordination-analysts'
import type { CoordinationTools } from '../../mcp/tools/coordination-contracts'
import { coordinationVerbNames } from '../../mcp/tools/coordination-events'
import { safeJsonText } from '../../mcp/tools/coordination-json'
import { runBrainLoop, type ToolLoopMessageRecord } from '../tool-loop'
import { errorMessage } from '../util'
import type { PriorCoordination } from './coordination-log'
import type { DriverAgentOptions } from './driver-agent-options'
import { DriverBrainTurns, type DriverControlPasses } from './driver-brain-turns'
import { createCancelAcknowledger, createSteerAcknowledger } from './driver-control-acknowledgers'
import { hasPriorCoordination, priorCoordinationBrief, resumeBrief } from './driver-prompt-context'
import { openDriverToolSurface } from './driver-tool-surface'
import { bestDelivered, runFinalizer, runTree } from './finalizer'
import { isRuntimeFlowBrain } from './flow-brain'
import { createInbox, type Inbox } from './inbox'
import { createRouterTranscript } from './router-transcript'
import type { Agent, Scope } from './types'

/**
 * Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a
 * `driverChild` (`driver-executor.ts`) to run it inside a nested scope, recursively.
 */
export function driverAgent(opts: DriverAgentOptions): Agent<unknown, unknown> {
  assertDriverAgentOptions(opts)
  // maxTurns=0 is no turn-count cap. The conserved pool, deadline, abort, and explicit stop remain
  // the caller-visible bounds; Runtime does not substitute a hidden sentinel.
  const maxTurns = opts.maxTurns ?? 0
  // A flow root: Runtime schedules its work from graph data and its brain makes no model call.
  const runtimeScheduled = isRuntimeFlowBrain(opts.brain)
  if (opts.routeFlow !== undefined && !runtimeScheduled) {
    throw new ValidationError(
      'driverAgent: routeFlow is runtime-owned — runGraph sets it for a graph with entry, together with the flow brain',
    )
  }
  const now = opts.now ?? Date.now
  const inbox = opts.inbox ?? createInbox()
  const transcript = opts.transcript ?? createRouterTranscript()

  return {
    name: opts.name,
    deliver(message): boolean {
      return inbox.deliver(message)
    },
    // The conversation this agent had, read at settle so it settles like a harness leaf (#1377).
    harnessTranscript: () => transcript.capture(),
    async act(task, scope: Scope<unknown>): Promise<unknown> {
      const surface = await openDriverToolSurface(opts, scope)
      const { coord } = surface
      const controls = driverControlPasses(opts, coord, scope, inbox, now)
      const system =
        typeof opts.systemPrompt === 'function' ? opts.systemPrompt(task) : opts.systemPrompt
      const turns = new DriverBrainTurns({
        opts,
        scope,
        surface,
        inbox,
        transcript,
        controls,
        runtimeScheduled,
        now,
      })
      const compaction = turns.compaction()
      const analysisFailed = async (error: unknown): Promise<never> => {
        await coord.finishAnalysis({
          status: 'down',
          reason: errorMessage(error),
        })
        throw error
      }
      await runBrainLoop({
        chat: turns.chat,
        tools: surface.toolSpecs,
        ...(compaction ? { compaction } : {}),
        execute: (name, args) => turns.execute(name, args),
        initialMessages: driverInitialMessages(opts, system, task, scope),
        maxTurns,
        hooks: {
          beforeTurn: (_turn, messages) => turns.beforeTurn(messages),
          afterFinal: () => turns.afterFinal(),
          stopBefore: () => turns.stopBefore(),
        },
      }).catch((error: unknown) => {
        turns.releaseLeases()
        return analysisFailed(error)
      })
      // This manager takes no further turn: report anything still held as failed.
      inbox.failPending('the manager finished before a model turn read the message')
      // Drain every settled child the brain never pulled (a verified delivery must not be lost to
      // pull discipline); non-blocking, live children are the supervisor's to tear down.
      await coord.drainResolved()
      // Final acknowledgement pass, so a cancellation whose worker settled after the last pass still
      // records its effect, then expiry: run end closes every open owned request (`not_live` never
      // applied, `unknown` issued-but-unproven), so no pending request aborts a later spawn by label.
      await controls.steerAcknowledger?.pass('final')
      controls.acknowledger?.pass('final')
      controls.acknowledger?.finish()
      // Direct work is eligible only through `submit_result`, after the same injected independent
      // check workers face. Raw driver prose remains ineligible. The first passing submission wins;
      // otherwise finalize over delivered children as before.
      const submitted = coord.submittedResult()
      if (submitted) {
        opts.onAcceptedSubmission?.(submitted.result)
        await coord.finishAnalysis({ status: 'done', output: submitted.result })
        return submitted.result
      }
      const result = await runFinalizer(opts.finalizer ?? bestDelivered, {
        settled: coord.settled(),
        blobs: opts.blobs,
        tree: runTree(scope),
        budget: scope.budget,
        ...(opts.deliverable ? { deliverable: opts.deliverable } : {}),
      }).catch(analysisFailed)
      await coord.finishAnalysis({ status: 'done', output: result })
      return result
    },
  }
}

/** Refuse a half-wired or colliding driver at construction, never inside a turn. */
function assertDriverAgentOptions(opts: DriverAgentOptions): void {
  if (typeof opts.brain !== 'function') {
    throw new ValidationError('driverAgent: opts.brain must be a function')
  }
  if (!Array.isArray(opts.toolNames)) {
    throw new ValidationError('driverAgent: toolNames must name every granted tool explicitly')
  }
  if (new Set(opts.toolNames).size !== opts.toolNames.length) {
    throw new ValidationError('driverAgent: toolNames contains a duplicate name')
  }
  // Fail loud on a half-wired work-tool seam: extra tool specs with no executor (or an executor
  // with no specs the model can see) is a silent no-op the house rules forbid.
  if ((opts.extraTools?.length ?? 0) > 0 && typeof opts.executeExtraTool !== 'function') {
    throw new ValidationError(
      'driverAgent: extraTools requires executeExtraTool (how to run a work-tool call)',
    )
  }
  // Fail loud on a half-wired analyst seam: analyze-on-settle with no lens registry is a silent
  // no-op. Only LENS routes resolve against the registry; an agent route carries its own profile.
  if (
    (opts.analyzeOnSettle ?? [])
      .map(normalizeAnalyzeOnSettle)
      .some((route) => route.agent === undefined) &&
    !opts.analysts
  ) {
    throw new ValidationError(
      'driverAgent: analyzeOnSettle requires analysts (the lens registry the kinds resolve against)',
    )
  }
  // A work tool shadowing a coordination verb would leave the driver unable to coordinate; checked
  // at construction, since act() would swallow the throw into a quiet no-winner.
  const reserved = new Set<string>(coordinationVerbNames)
  for (const tool of opts.nodeTools ?? []) {
    if (reserved.has(tool.name)) {
      throw new ValidationError(
        `driverAgent: node tool "${tool.name}" collides with a coordination verb or another node tool`,
      )
    }
    reserved.add(tool.name)
  }
  for (const t of opts.extraTools ?? []) {
    if (reserved.has(t.name)) {
      throw new ValidationError(
        `driverAgent: extra work tool "${t.name}" collides with a coordination verb or node tool`,
      )
    }
    reserved.add(t.name)
  }
  // Fail loud on a nonsensical cap: a negative maxTurns would silently run zero turns and
  // finalize an empty no-winner — a silent zero the house rules forbid.
  if (opts.maxTurns !== undefined && opts.maxTurns < 0) {
    throw new ValidationError(
      'driverAgent: maxTurns must be >= 0 (0 lifts the turn cap; bounds become the conserved pool + deadline + abort)',
    )
  }
}

/**
 * The worker-cancel and steer acknowledgers, mounted only for a durable run that named its layout
 * dir. They run inside the existing turn loop — the one place that already runs every turn and
 * already holds the child handles — so external cancellation needs no second lifetime.
 */
function driverControlPasses(
  opts: DriverAgentOptions,
  coord: CoordinationTools,
  scope: Scope<unknown>,
  inbox: Inbox,
  now: () => number,
): DriverControlPasses {
  const acknowledger =
    opts.controlDir === undefined
      ? undefined
      : createCancelAcknowledger({
          dir: opts.controlDir,
          coord,
          scope,
          now,
          ownerId: scope.view.root,
          controlScope: opts.controlScope ?? 'run',
          ...(opts.abortRun ? { abortRun: opts.abortRun } : {}),
        })
  const steerAcknowledger =
    opts.steerDir === undefined && opts.controlDir === undefined
      ? undefined
      : createSteerAcknowledger({
          dir: opts.steerDir ?? opts.controlDir!,
          coord,
          now,
          ownerId: scope.view.root,
          signal: scope.signal,
          ...(opts.controlScope === 'subtree' ? {} : { deliverRoot: inbox.deliver }),
        })
  return { acknowledger, steerAcknowledger }
}

function driverInitialMessages(
  opts: DriverAgentOptions,
  system: string,
  task: unknown,
  scope: Scope<unknown>,
): ToolLoopMessageRecord[] {
  return [
    { role: 'system', content: system },
    { role: 'user', content: safeJsonText(task) },
    // The resume brief: a resumed run's FIRST context carries committed settlements, key states,
    // re-armed waits, carried-over questions/findings and spend already paid, so the brain
    // continues from unresolved work instead of re-planning (and re-paying).
    ...(scope.resume
      ? [{ role: 'user', content: resumeBrief(scope.resume, scope.view, opts.priorCoordination) }]
      : hasPriorCoordination(opts.priorCoordination)
        ? [
            {
              role: 'user',
              content: priorCoordinationBrief(opts.priorCoordination as PriorCoordination),
            },
          ]
        : []),
  ]
}
