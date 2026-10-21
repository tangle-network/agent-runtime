import { RuntimeRunStateError, ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import {
  coordinationVerbNames,
  createCoordinationTools,
  normalizeAnalyzeOnSettle,
} from '../../mcp/tools/coordination'
import { safeJsonText } from '../../mcp/tools/coordination-json'
import type { ToolSpec } from '../router-request-body'
import {
  runBrainLoop,
  type ToolLoopCallContext,
  type ToolLoopChat,
  type ToolLoopCompaction,
} from '../tool-loop'
import { errorMessage, promptCacheTokenClasses, unmeteredSpend } from '../util'
import type { PriorCoordination } from './coordination-log'
import type { DriverAgentOptions } from './driver-agent-options'
import { deadlinePassed, ownTurnsUnbounded, poolStarved } from './driver-budget-guards'
import { createCancelAcknowledger, createSteerAcknowledger } from './driver-control-acknowledgers'
import { validateDriverPromptCache } from './driver-prompt-cache'
import {
  distillInstruction,
  hasPriorCoordination,
  priorCoordinationBrief,
  resumeBrief,
  safeJson,
  summarizeRoster,
} from './driver-prompt-context'
import { runExtraTool, runTool } from './driver-tool-dispatch'
import { errMessage } from './error-message'
import { bestDelivered, runFinalizer, runTree } from './finalizer'
import { createInbox, type InboxLease } from './inbox'
import { providerAttemptEvidence } from './materialization'
import { addResourceSpend, withBudgetResources } from './resources'
import { scopeRetainedOwnerResourceReader } from './retained-scope-owner'
import { createRouterTranscript } from './router-transcript'
import { meterRuntimeOwnedProviderAttempt } from './scope'
import { createProgressTracker, progressStop } from './stop-rules'
import type { Agent, Scope, Spend } from './types'
import { composeWakeInput, deadlineWarningAt, resolveWakePolicy } from './wake'

/** How often a waiting driver applies operator cancels and steers between its turns. */
const WAITING_CONTROL_POLL_MS = 5_000

/**
 * Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a
 * `driverChild` (`driver-executor.ts`) to run it inside a nested scope, recursively.
 */
export function driverAgent(opts: DriverAgentOptions): Agent<unknown, unknown> {
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
  // Fail loud on a half-wired analyst seam (matches the extraTools pattern): analyze-on-settle with no
  // lens registry is a silent no-op the house rules forbid — the driver would get no findings, no error.
  // Only LENS routes resolve against the registry; an agent route carries its own analyst profile.
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
  // A work tool that shadows a coordination verb would leave the driver unable to coordinate.
  // Validate against the reserved verb set HERE (construction), so the conflict fails loud — not
  // buried inside act() where the supervisor would swallow the throw into a quiet no-winner.
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
  // maxTurns=0 is no turn-count cap. The conserved pool, deadline, abort, and explicit stop remain
  // the caller-visible bounds; Runtime does not substitute a hidden sentinel.
  const maxTurns = opts.maxTurns ?? 0
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
      // The manager's own environment is the source for a by-path spawn resource when no host
      // directory serves it. Every scope registers a retained owner, so the reader is derivable
      // here for the root and for a nested manager alike, and it resolves its environment lazily
      // because the environment is admitted during the first turn, after these tools exist.
      //
      // Precedence, in order: a caller-supplied reader; a host directory (a loopback bridge root
      // has one and no provider environment, so its scope's owner reader would refuse every read);
      // the scope's own environment. The host root is left in place below as before.
      const ownerReader =
        opts.spawnResourceReader ??
        (opts.spawnResourceRoot === undefined ? scopeRetainedOwnerResourceReader(scope) : undefined)
      let probeableByName: ReadonlyMap<string, McpToolDescriptor> | undefined
      const coord = createCoordinationTools({
        scope,
        blobs: opts.blobs,
        makeWorkerAgent: opts.makeWorkerAgent,
        ...(opts.graphs ? { graphs: opts.graphs } : {}),
        ...(opts.authorizeDownMessage ? { authorizeDownMessage: opts.authorizeDownMessage } : {}),
        perWorker: opts.perWorker,
        ...(opts.deliverable ? { deliverable: opts.deliverable } : {}),
        ...(opts.analysts ? { analysts: opts.analysts } : {}),
        ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
        ...(opts.mapOnSettle ? { mapOnSettle: opts.mapOnSettle } : {}),
        ...(opts.sourceEvidenceRefs ? { sourceEvidenceRefs: opts.sourceEvidenceRefs } : {}),
        ...(opts.peerAudit ? { peerAudit: opts.peerAudit } : {}),
        ...(opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {}),
        ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
        ...(opts.continuityByProfile ? { continuityByProfile: opts.continuityByProfile } : {}),
        ...(opts.preflightSpawn ? { preflightSpawn: opts.preflightSpawn } : {}),
        ...(opts.resolveSpawnProfile ? { resolveSpawnProfile: opts.resolveSpawnProfile } : {}),
        ...(opts.composeSpawnProfile ? { composeSpawnProfile: opts.composeSpawnProfile } : {}),
        ...(opts.profiles ? { profiles: opts.profiles } : {}),
        ...(opts.spawnResourceRoot ? { spawnResourceRoot: opts.spawnResourceRoot } : {}),
        ...(ownerReader ? { spawnResourceReader: ownerReader } : {}),
        ...(opts.escalateQuestion ? { escalateQuestion: opts.escalateQuestion } : {}),
        ...(opts.onChildQuestionInbox ? { onChildQuestionInbox: opts.onChildQuestionInbox } : {}),
        ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
        ...(opts.replaySettlements ? { replaySettlements: true } : {}),
        ...(opts.priorCoordination?.questions.length
          ? { priorQuestions: opts.priorCoordination.questions }
          : {}),
        ...(opts.priorCoordination?.escalations?.length
          ? { priorEscalations: opts.priorCoordination.escalations }
          : {}),
        ...(opts.priorCoordination?.records.length
          ? { priorJournal: opts.priorCoordination.records }
          : {}),
        ...(opts.priorCoordination?.analystDefinitions?.length
          ? { priorAnalystDefinitions: opts.priorCoordination.analystDefinitions }
          : {}),
        // `report_blocked` probes only what this manager was granted, under its own identity.
        resolveProbeTool: (name) => probeableByName?.get(name),
      })
      await coord.ready()
      const availableTools = [...coord.tools, ...(opts.nodeTools ?? [])]
      const availableByName = new Map(availableTools.map((tool) => [tool.name, tool]))
      const extraByName = new Map((opts.extraTools ?? []).map((tool) => [tool.name, tool]))
      const selectedNames = opts.toolNames
      const selectedTools = selectedNames.map((name) => {
        const descriptor = availableByName.get(name)
        if (descriptor !== undefined) return { kind: 'descriptor' as const, descriptor }
        const extra = extraByName.get(name)
        if (extra === undefined) {
          throw new ValidationError(
            `driverAgent: requested tool ${JSON.stringify(name)} is unavailable`,
          )
        }
        return { kind: 'extra' as const, extra }
      })
      const modelTools = selectedTools.flatMap((selected) =>
        selected.kind === 'descriptor' ? [selected.descriptor] : [],
      )
      probeableByName = new Map(modelTools.map((tool) => [tool.name, tool]))
      const selectedExtraNames = new Set(
        selectedTools.flatMap((selected) =>
          selected.kind === 'extra' ? [selected.extra.name] : [],
        ),
      )
      // Before the first brain turn: a node tool invoked on turn one must already be able to call
      // these verbs.
      opts.onCoordinationTools?.(modelTools, coord)
      // The worker-cancel acknowledger, mounted only for a durable run that named its layout dir.
      // It runs inside this existing turn loop — the one place that already runs every turn and
      // already holds the child handles — so external cancellation needs no second lifetime.
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
      const byName = new Map<string, McpToolDescriptor>(modelTools.map((tool) => [tool.name, tool]))
      const toolSpecs: ToolSpec[] = selectedTools.map((selected) =>
        selected.kind === 'descriptor'
          ? {
              type: 'function' as const,
              function: {
                name: selected.descriptor.name,
                description: selected.descriptor.description,
                parameters: selected.descriptor.inputSchema,
              },
            }
          : {
              type: 'function' as const,
              function: {
                name: selected.extra.name,
                description: selected.extra.description,
                parameters: selected.extra.parameters,
              },
            },
      )
      const system =
        typeof opts.systemPrompt === 'function' ? opts.systemPrompt(task) : opts.systemPrompt

      // Built only when a rule is configured, so a run without one allocates and evaluates nothing.
      const tracker = opts.stopRule ? createProgressTracker({ now }) : undefined
      // The pool this manager started with, for the overdraw guard in `ownTurnsUnbounded`.
      const poolTokens = scope.budget.tokensLeft + scope.budget.reservedTokens
      let driverTurns = 0
      let progressStopReason: string | undefined
      const wakePolicy = resolveWakePolicy(opts.wake)
      let deadlineWarned = false
      const startedAt = now()

      // Meter the driver's OWN inference on EVERY turn into the conserved pool — the largest single
      // token consumer in the loop, and what makes maxTurns=0 genuinely bounded (a thinking driver
      // drains the pool → poolStarved). Driver turns never consume the child-iteration budget;
      // failed inference stays visible through unknown token/USD channels and journal detail.
      //
      // There is deliberately no branch that skips `scope.meter`. A turn whose brain reported no
      // usage is metered as an UNKNOWN turn (`tokensKnown: false`), not omitted: omitting it let the
      // pool and the journal record a turn that ran as a turn that cost nothing, which is the one
      // thing this package forbids — a missing measurement is never zero. The unknown turn debits
      // the zero it actually knows and permanently marks `pool.readout().tokensKnown` false, so a
      // reader of `tokensLeft` can see the balance is a ceiling rather than a measurement. A
      // scripted/mock turn takes this path too, so offline equal-k still debits exactly zero tokens.
      let driverTurn = 0
      let driverCall = 0
      const meteredBrain = async (
        messages: ReadonlyArray<Record<string, unknown>>,
        tools: ReadonlyArray<ToolSpec>,
        detail: Record<string, unknown>,
        // A conversation turn (not a compaction) keeps its reply, and its turn event carries what
        // the turn added, so an observer journal holds the conversation while the run is live.
        conversationTurn?: (reply: Awaited<ReturnType<typeof opts.brain>>) => unknown,
      ) => {
        let res: Awaited<ReturnType<typeof opts.brain>>
        const call = driverCall
        driverCall += 1
        const callContext: ToolLoopCallContext = Object.freeze({
          signal: scope.signal,
          callId: `${scope.view.root}:brain:${crypto.randomUUID()}`,
          correlationId: scope.view.root,
        })
        try {
          res = await opts.brain(messages, tools, callContext)
        } catch (error) {
          // Calling the brain is the provider-attempt boundary. A rejection after that boundary
          // carries no trusted served identity, so preserve an empty attempt for root settlement.
          opts.onProviderModel?.(undefined)
          try {
            await meterRuntimeOwnedProviderAttempt(
              scope,
              withBudgetResources(unmeteredSpend(0), scope.budget),
              providerAttemptEvidence(undefined),
              {
                driver: opts.name,
                inferenceFailed: true,
                call,
                callId: callContext.callId,
                correlationId: callContext.correlationId,
                ...detail,
              },
            )
          } catch (meteringError) {
            // Preserve the provider diagnosis without turning an accounting refusal into a retry.
            throw new RuntimeRunStateError(
              `${errMessage(error)}; accounting failed: ${errMessage(meteringError)}`,
              { cause: error },
            )
          }
          throw error
        }
        let evidenceError: ValidationError | undefined
        opts.onProviderModel?.(res.model)
        if (opts.expectedModel !== undefined) {
          if (res.model === undefined) {
            evidenceError = new ValidationError(
              `driverAgent: Router response omitted model identity; expected ${JSON.stringify(opts.expectedModel)}`,
            )
          } else if (res.model !== opts.expectedModel) {
            evidenceError = new ValidationError(
              `driverAgent: Router response reported model ${JSON.stringify(res.model)}; expected ${JSON.stringify(opts.expectedModel)}`,
            )
          }
        }
        if (
          res.transportAttempts !== undefined &&
          (!Number.isSafeInteger(res.transportAttempts) || res.transportAttempts < 1)
        ) {
          evidenceError = new ValidationError(
            'driverAgent: transportAttempts must be a positive safe integer when reported',
          )
        }
        evidenceError = validateDriverPromptCache(res.promptCache) ?? evidenceError
        const trustedCost =
          res.costProvenance === 'provider-receipt' || res.costProvenance === 'billing-receipt'
        const cacheUsage = promptCacheTokenClasses(res.usage?.input, res.promptCache)
        const turnSpend: Spend = {
          ...addResourceSpend(res.resources),
          iterations: 0,
          tokens: {
            input: res.usage?.input ?? 0,
            output: res.usage?.output ?? 0,
            ...cacheUsage,
          },
          ...(res.usage === undefined ? { tokensKnown: false } : {}),
          usd: trustedCost ? (res.costUsd ?? 0) : 0,
          ...(trustedCost && res.costUsd !== undefined ? {} : { usdKnown: false }),
          ms: 0,
        }
        await meterRuntimeOwnedProviderAttempt(
          scope,
          withBudgetResources(turnSpend, scope.budget),
          providerAttemptEvidence(res.model),
          {
            driver: opts.name,
            call,
            callId: callContext.callId,
            correlationId: callContext.correlationId,
            toolCalls: (res.toolCalls ?? []).map((c) => c.name),
            ...(res.model !== undefined ? { model: res.model } : {}),
            ...(res.transportAttempts !== undefined
              ? { transportAttempts: res.transportAttempts }
              : {}),
            ...(res.usage?.reasoning !== undefined ? { reasoningTokens: res.usage.reasoning } : {}),
            ...(res.promptCache !== undefined ? { promptCache: res.promptCache } : {}),
            // The streamed transport says explicitly when it finished with no usage chunk (a broken
            // `include_usage` contract), which is a different fact from a brain that never reports
            // usage at all. Recorded on the turn so the journal distinguishes them.
            ...(res.usageUnknown === true ? { streamUsageMissing: true } : {}),
            ...(res.costProvenance === 'catalog-estimate' ? { estimatedCostUsd: res.costUsd } : {}),
            ...detail,
            ...(conversationTurn ? { conversation: conversationTurn(res) } : {}),
          },
        )
        if (evidenceError !== undefined) throw evidenceError
        return res
      }
      // Inbox messages folded into the conversation and not yet carried by an answered call.
      const leases: InboxLease[] = []
      const chat: ToolLoopChat = async (messages, tools) => {
        const turn = driverTurn
        // A compaction may have replaced the middle since `beforeTurn`; its note is what the model sees.
        transcript.observe(messages)
        const res = await meteredBrain(
          messages,
          tools,
          { kind: 'driver-inference', turn },
          (reply) => transcript.reply(reply),
        )
        for (const lease of leases.splice(0)) {
          for (const message of lease.messages) {
            lease.commit(`${scope.view.root}#driver-turn-${turn}`, message.id)
          }
        }
        driverTurn += 1
        return res
      }

      // Chapter-close on the brain's own window. The default distiller pairs the factual settled-worker
      // roster (from the live scope) with a brain-authored progress note; the brain call runs through
      // the metered `chat`, so the one-time O(history) distill cost debits the conserved pool like any
      // turn. It replaces the per-turn O(history) re-billing it removes.
      const compaction: ToolLoopCompaction | undefined = opts.compaction
        ? {
            thresholdTokens: opts.compaction.thresholdTokens,
            distill:
              opts.compaction.distill ??
              (async (msgs) => {
                const roster = summarizeRoster(scope.view, coord.settled())
                try {
                  const res = await meteredBrain(
                    [...msgs, { role: 'user', content: distillInstruction }],
                    [],
                    { kind: 'driver-compaction', compactingTurn: driverTurn },
                  )
                  const narrative = (res.content ?? '').trim()
                  return narrative ? `${roster}\n\n## Progress notes\n${narrative}` : roster
                } catch (e) {
                  return `${roster}\n\n## Progress notes\nSummary unavailable: ${errMessage(e)}`
                }
              }),
            ...(opts.compaction.onCompact ? { onCompact: opts.compaction.onCompact } : {}),
            ...(opts.compaction.preserveHead !== undefined
              ? { preserveHead: opts.compaction.preserveHead }
              : {}),
            ...(opts.compaction.estimateTokens
              ? { estimateTokens: opts.compaction.estimateTokens }
              : {}),
          }
        : undefined

      const analysisFailed = async (error: unknown): Promise<never> => {
        await coord.finishAnalysis({
          status: 'down',
          reason: errorMessage(error),
        })
        throw error
      }
      await runBrainLoop({
        chat,
        tools: toolSpecs,
        ...(compaction ? { compaction } : {}),
        execute: async (name, args) => {
          // WORK FIRST: a work tool the driver runs itself (act). A non-null return is handled here;
          // null/undefined means "not mine" → fall through to the coordination dispatch (spawn/await/…).
          if (opts.executeExtraTool && selectedExtraNames.has(name)) {
            const worked = await runExtraTool(opts.executeExtraTool, name, args)
            if (worked !== null && worked !== undefined) return worked
          }
          const tool = byName.get(name)
          const result = tool ? await runTool(tool, args) : { error: `unknown tool: ${name}` }
          return safeJson(result)
        },
        initialMessages: [
          { role: 'system', content: system },
          { role: 'user', content: safeJsonText(task) },
          // The resume brief: on a resumed run the brain's FIRST context already carries the
          // committed settlements, the key states, the re-armed waits, carried-over questions/
          // findings, and the spend the run already paid — so it continues from the unresolved
          // work instead of re-planning (and re-paying) from scratch.
          ...(scope.resume
            ? [
                {
                  role: 'user',
                  content: resumeBrief(scope.resume, scope.view, opts.priorCoordination),
                },
              ]
            : hasPriorCoordination(opts.priorCoordination)
              ? [
                  {
                    role: 'user',
                    content: priorCoordinationBrief(opts.priorCoordination as PriorCoordination),
                  },
                ]
              : []),
        ],
        maxTurns,
        // The conserved-pool + deadline + external-stop bound (what maxTurns=0 relies on): a driver
        // that can no longer spawn (pool starved) or has run past the deadline stops here instead of
        // burning turns. Checked before each inference turn.
        hooks: {
          beforeTurn: async (_turn, messages) => {
            driverTurns += 1
            await steerAcknowledger?.pass('turn')
            acknowledger?.pass('turn')
            const lease = inbox.take()
            if (lease.messages.length > 0) {
              messages.push({ role: 'user', content: inbox.fold(lease.messages) })
              leases.push(lease)
            }
            // Before a compaction can fold them away: the previous turn's tool results and this inbox.
            transcript.observe(messages)
          },
          // A turn without a tool call ends the turn, not the manager: while work is open, wait
          // with no model turn and continue with what happened.
          afterFinal: async () => {
            if (
              coord.isStopped() ||
              coord.submittedResult() !== undefined ||
              scope.signal.aborted
            ) {
              return undefined
            }
            if (inbox.pending() === 0 && !coord.hasOpenWork()) return undefined
            const deadlineMs = scope.budget.deadlineMs
            const warnAt = deadlineWarningAt(deadlineMs, wakePolicy, deadlineWarned, startedAt)
            // Operator controls are applied at turn boundaries; while the driver waits between turns,
            // apply them on a short clock instead. A cancelled worker then settles into the wake, and
            // a root steer reaches the inbox, which ends the wait.
            const controlClock =
              acknowledger === undefined && steerAcknowledger === undefined
                ? undefined
                : setInterval(() => {
                    void (async () => {
                      await steerAcknowledger?.pass('turn')
                      acknowledger?.pass('turn')
                    })().catch(() => undefined)
                  }, WAITING_CONTROL_POLL_MS)
            controlClock?.unref?.()
            let wake: Awaited<ReturnType<typeof coord.awaitWake>>
            try {
              wake = await coord.awaitWake({
                signal: scope.signal,
                heartbeatMs: wakePolicy.heartbeatMs,
                quietWhileProgressing: true,
                debounceMs: wakePolicy.debounceMs,
                ...(warnAt === undefined ? {} : { deadlineAt: warnAt }),
                alsoWakeOn: inbox.pending() > 0 ? Promise.resolve() : inbox.nextDelivery(),
              })
            } finally {
              if (controlClock !== undefined) clearInterval(controlClock)
            }
            if (wake === undefined) return undefined
            if (wake.reason === 'deadline') deadlineWarned = true
            return composeWakeInput(wake, {
              tools: selectedTools.map((selected) =>
                selected.kind === 'descriptor' ? selected.descriptor.name : selected.extra.name,
              ),
              deadlineMs,
              now: now(),
            })
          },
          stopBefore: () => {
            // HARD CEILINGS FIRST, and independently — a progress rule may never keep a run alive
            // past one, so they are not folded into the same expression.
            if (
              coord.isStopped() ||
              scope.signal.aborted ||
              poolStarved(scope, opts.perWorker, opts.preserveOwnerTurns) ||
              deadlinePassed(scope, now) ||
              ownTurnsUnbounded(scope, poolTokens, driverTurns, opts.maxTurns)
            ) {
              return true
            }
            if (!opts.stopRule || !tracker) return false
            const decision = progressStop(
              tracker,
              opts.stopRule,
              coord,
              scope,
              now,
              opts.stallAfterMs,
            )
            if (!decision.stop) return false
            // `stopBefore` is a predicate the loop may consult more than once; the callback is a
            // one-shot notification, so it fires on the FIRST stop only.
            if (progressStopReason === undefined) {
              progressStopReason = decision.reason
              opts.onProgressStop?.(decision.reason)
            }
            return true
          },
        },
      }).catch((error: unknown) => {
        // The conversation holding the folded messages dies with this loop; the next entry of
        // this manager takes them again.
        for (const lease of leases.splice(0)) lease.release()
        return analysisFailed(error)
      })
      // This manager takes no further turn: report anything still held as failed.
      inbox.failPending('the manager finished before a model turn read the message')
      // Drain every already-settled child the brain never pulled — a gate-verified delivery must
      // never be lost to the driver's pull discipline (e.g. a brain that spawned and stopped
      // without awaiting). Non-blocking: live children are the supervisor's to tear down.
      await coord.drainResolved()
      // Final acknowledgement pass over the drained ledger, so a cancellation whose worker
      // settled after the last turn's pass still records its terminal effect before act returns.
      // Then expiry: run end closes every owned request that is still open (`not_live` never
      // applied, `unknown` issued-but-unproven) — a reader can tell run-over from in-progress,
      // and no pending request survives to abort a future spawn that matches by label.
      await steerAcknowledger?.pass('final')
      acknowledger?.pass('final')
      acknowledger?.finish()
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
