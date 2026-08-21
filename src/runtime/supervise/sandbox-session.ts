/**
 *
 * The STEERABLE sandbox worker: one box, one server-side session, MANY turns — so a message
 * from the driver has a boundary to be folded into.
 *
 * The default cloud worker was built on `singleShotDriver`: one `runAgentRounds` shot, no turn
 * boundary, and no `Executor.deliver`. `Scope.send` therefore returned `false` for it and
 * `steer_agent` reported `delivered:false` on every call — steering the DEFAULT worker was
 * mechanically impossible, not merely unused. This module is the missing continuation loop.
 *
 * Structure deliberately mirrors `streamBridgeSession` (the cli-bridge equivalent that already
 * works) so both steerable runtimes have ONE shape:
 *
 *   - turn 0 sends the task through `SandboxLineage.start` (fresh box, minted session id);
 *   - each later turn fires ONLY when the inbox has a steer/answer to fold, and goes through
 *     `SandboxLineage.continue` — the SAME box and the SAME server-side session, so the prompt
 *     carries only the new instruction and the worker keeps everything it had already learned;
 *   - a worker may not settle while a delivered steer is unread: the loop drains once more
 *     before breaking, which is what makes `steer_agent` a promise rather than a hint;
 *   - a forceful (`interrupt:true`) steer aborts the in-flight turn so the worker re-plans
 *     immediately instead of finishing a path the supervisor already rejected.
 *
 * It also produces the LIVE signal a supervisor steers FROM: every sandbox event stamps
 * activity, tool parts are decoded into the shared `ToolSpan` currency for the online detector
 * panel, and `progress()` answers turn / tool / idle / pending-steer questions synchronously.
 *
 * Reports REAL usage only — token and cost numbers come from the sandbox events themselves.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { BackendType, PromptOptions, SandboxEvent } from '@tangle-network/sandbox'
import { type AgentRunOutcome, createAgentRunOutcomeTracker } from '@tangle-network/sandbox/runtime'
import { ValidationError } from '../../errors'
import { probeSandboxCapabilities } from '../sandbox-capabilities'
import {
  assertSandboxServedModel,
  createSandboxToolPartState,
  extractLlmCallEvent,
  sandboxProgressEvents,
} from '../sandbox-events'
import { createSandboxLineage, type SandboxLineageHandle } from '../sandbox-lineage'
import { projectSandboxOutcome } from '../sandbox-outcome'
import type { AgentRunSpec, ExecCtx, SandboxClient } from '../types'
import { addTokenUsage, promptCacheTokenClasses, zeroTokenUsage } from '../util'
import type { Inbox } from './inbox'
import { concreteProfileModel } from './model-policy'
import {
  type ActivityLog,
  type ActivityNote,
  createActivityLog,
  describeToolArgs,
  type ExecutorProgress,
} from './progress'
import { createPushTraceSource, decodeToolPart, type TraceSource } from './trace-source'
import type {
  DefaultVerdict,
  ExecutorProgressEvent,
  ExecutorToolCall,
  Spend,
  UsageEvent,
} from './types'

/** Ceiling on continuation turns. Turn 0 is the task; every later turn is a folded steer, so
 *  this bounds how many times a supervisor may redirect ONE worker before it must respawn. */
export const DEFAULT_SANDBOX_STEERING_MAX_TURNS = 24

/** Opt-in configuration for the steerable sandbox worker (`SandboxSeam.steering`). Absent, the
 *  sandbox executor keeps its historical single-shot `runAgentRounds` composition verbatim. */
export interface SandboxSteeringOptions {
  /** Max turns for one worker (turn 0 + folded steers). Default {@link DEFAULT_SANDBOX_STEERING_MAX_TURNS}. */
  readonly maxTurns?: number
  /** How many recent tool/turn notes `progress()` reports. Default 12. */
  readonly activityWindow?: number
  /** Per-turn wall-clock ceiling; the turn's stream is aborted when it elapses. */
  readonly turnTimeoutMs?: number
}

/** What the steerable session exposes to its executor: the usage stream plus the live reads. */
export interface SteerableSandboxSession {
  /** Drive the worker to settlement. `signal` is the spawn-scoped abort handed to `execute`. */
  stream(task: unknown, signal: AbortSignal): AsyncIterable<UsageEvent>
  progress(): ExecutorProgress
  traceSource(): TraceSource
  artifact(): { outRef: string; out: unknown; verdict?: DefaultVerdict; spent: Spend } | undefined
  teardown(): Promise<void>
}

export interface SteerableSandboxArgs {
  readonly controller: AbortController
  readonly profile: AgentProfile
  readonly harness: BackendType
  readonly sandboxClient: SandboxClient
  readonly inbox: Inbox
  readonly taskToPrompt: (task: unknown) => string
  readonly options?: SandboxSteeringOptions
  readonly loopCtx?: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>
  /**
   * Inherited `TRACE_ID` / `PARENT_SPAN_ID` for the box, merged into `CreateSandboxOptions.env` so
   * the remote worker's own spans join the supervisor's trace under the spawning node's span.
   * Absent when the run records no spans — the create options are then untouched.
   */
  readonly traceEnv?: Record<string, string>
  readonly contentRef: (prefix: string, value: unknown) => string
  readonly now?: () => number
}

/** One steerable sandbox worker. The returned session is inert until `stream()` is drained. */
export function createSteerableSandboxSession(args: SteerableSandboxArgs): SteerableSandboxSession {
  const now = args.now ?? Date.now
  const maxTurns = args.options?.maxTurns ?? DEFAULT_SANDBOX_STEERING_MAX_TURNS
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 0) {
    throw new ValidationError(
      'steerable sandbox worker: maxTurns must be a nonnegative safe integer (0 means unbounded)',
    )
  }
  const activity: ActivityLog = createActivityLog(args.options?.activityWindow ?? 12)
  const trace = createPushTraceSource({ runId: `sandbox-${args.harness}-${now()}`, now })

  const state = {
    turns: 0,
    lastText: '',
    seenToolCalls: new Set<string>(),
    toolCalls: [] as ExecutorToolCall[],
    artifact: undefined as
      | { outRef: string; out: unknown; verdict?: DefaultVerdict; spent: Spend }
      | undefined,
    latestOutcome: undefined as AgentRunOutcome | undefined,
    teardown: undefined as (() => Promise<void>) | undefined,
    note: 'starting',
  }

  const toolParts = createSandboxToolPartState()

  /** Record one box event for the trace and the activity window, and return the live output it
   *  carries so the caller can publish it to the turn stream. */
  const recordEvent = (event: SandboxEvent): ExecutorProgressEvent[] => {
    const at = now()
    const data = (event as { data?: unknown }).data
    const part = data && typeof data === 'object' ? (data as { part?: unknown }).part : undefined
    if (part !== undefined) {
      const step = decodeToolPart(part, args.harness)
      if (step) {
        // The same call streams several frames; count it once so the detector panel and the
        // driver's activity window both see ONE entry per real tool call.
        const key = step.callId ?? `${step.toolName}:${activity.size()}`
        if (!state.seenToolCalls.has(key)) {
          state.seenToolCalls.add(key)
          trace.record(step)
          const note: ActivityNote = {
            at,
            kind: 'tool',
            label: step.toolName,
            ...(step.status ? { status: step.status } : {}),
            ...(describeToolArgs(step.args) ? { detail: describeToolArgs(step.args) } : {}),
          }
          activity.push(note)
        }
      }
    }
    const text = readFinalText(event)
    if (text) state.lastText = text
    const progress = sandboxProgressEvents(event, toolParts)
    for (const item of progress) {
      if (item.kind !== 'tool_call') continue
      state.toolCalls.push({
        ...(item.toolCallId === undefined ? {} : { id: item.toolCallId }),
        name: item.toolName,
        arguments: item.args ?? {},
      })
    }
    return progress
  }

  async function* stream(task: unknown, signal: AbortSignal): AsyncIterable<UsageEvent> {
    const capabilities = await probeSandboxCapabilities(args.sandboxClient)
    const lineage = createSandboxLineage(args.sandboxClient, capabilities, { maxConcurrency: 1 })
    state.teardown = () => lineage.teardown()

    const spec: AgentRunSpec<unknown> = {
      profile: args.profile,
      taskToPrompt: args.taskToPrompt,
      name: args.profile.name ?? String(args.harness),
      sandboxOverrides: {
        backend: { type: args.harness },
        ...(args.traceEnv && Object.keys(args.traceEnv).length > 0 ? { env: args.traceEnv } : {}),
      },
    }
    const promptOptions = readPromptOptions(args.loopCtx)
    // The exact instrument every turn of this session asks the box for (agent-runtime#892).
    const requestedModel = concreteProfileModel(args.profile)
    const requested = {
      ...(args.profile.model?.provider !== undefined
        ? { provider: args.profile.model.provider }
        : {}),
      ...(requestedModel !== undefined ? { model: requestedModel } : {}),
    }

    const started = now()
    const tokens = zeroTokenUsage()
    let tokensKnown = true
    let usd = 0
    let handle: SandboxLineageHandle | undefined
    let nextPrompt: string | undefined = args.taskToPrompt(task)

    try {
      for (let turn = 0; maxTurns === 0 || turn < maxTurns; turn += 1) {
        // Drain the down-leg FIRST. On turn 0 a steer that landed during box acquisition is
        // appended to the task; on later turns the steer IS the whole prompt, because the
        // worker's prior context lives server-side in the session.
        const pending = args.inbox.drain()
        if (pending.length > 0) {
          const folded = args.inbox.fold(pending)
          nextPrompt = turn === 0 && nextPrompt ? `${nextPrompt}\n\n${folded}` : folded
          const peerCount = pending.filter((m) => m.kind === 'mail').length
          activity.push({
            at: now(),
            kind: 'note',
            // Split the label by authority class: peer mail folded into a turn is not a steer.
            label: peerCount === pending.length ? 'peer-mail-folded' : 'steer-folded',
            detail:
              peerCount === 0
                ? `${pending.length} message(s)`
                : `${pending.length} message(s), ${peerCount} peer`,
          })
        }
        if (nextPrompt === undefined) break

        const prompt = nextPrompt
        nextPrompt = undefined
        state.note = `turn ${turn}`

        const interruptSig = args.inbox.freshInterrupt()
        const turnController = new AbortController()
        const abortTurn = () => turnController.abort()
        if (signal.aborted || args.controller.signal.aborted) turnController.abort()
        else {
          signal.addEventListener('abort', abortTurn)
          args.controller.signal.addEventListener('abort', abortTurn)
        }
        interruptSig.addEventListener('abort', abortTurn, { once: true })
        const timer = args.options?.turnTimeoutMs
          ? setTimeout(abortTurn, args.options.turnTimeoutMs)
          : undefined
        const cleanup = () => {
          signal.removeEventListener('abort', abortTurn)
          args.controller.signal.removeEventListener('abort', abortTurn)
          if (timer) clearTimeout(timer)
        }

        let events: AsyncIterable<SandboxEvent>
        let sawLlmCall = false
        const outcomeTracker = createAgentRunOutcomeTracker()
        try {
          if (!handle) {
            const opened = await lineage.start(spec, prompt, turnController.signal, promptOptions)
            handle = opened.handle
            events = opened.events
          } else {
            events = await lineage.continue(handle, prompt, turnController.signal, promptOptions)
          }
          for await (const event of events) {
            outcomeTracker.observe(event)
            for (const progress of recordEvent(event)) yield { kind: 'progress', progress }
            const call = extractLlmCallEvent(event, spec.name ?? String(args.harness))
            if (call) {
              sawLlmCall = true
              const callTokensKnown =
                call.tokensKnown !== false &&
                typeof call.tokensIn === 'number' &&
                typeof call.tokensOut === 'number'
              if (!callTokensKnown) tokensKnown = false
              const input = call.tokensIn ?? 0
              const output = call.tokensOut ?? 0
              if (input || output || !callTokensKnown) {
                const usage: Extract<UsageEvent, { kind: 'tokens' }> = {
                  kind: 'tokens',
                  input,
                  output,
                  ...(callTokensKnown ? {} : { tokensKnown: false }),
                  // Classify against THIS call's own prompt total, so the classes partition the
                  // number they belong to rather than a running sum from other calls.
                  ...promptCacheTokenClasses(call.tokensIn, call.promptCache),
                }
                addTokenUsage(tokens, usage)
                yield usage
              }
              if (typeof call.costUsd === 'number' && call.costUsd > 0) {
                usd += call.costUsd
                // Numeric sandbox cost has no billing-provenance/completeness receipt.
                yield { kind: 'cost', usd: call.costUsd, usdKnown: false }
              }
            }
            assertSandboxServedModel(event, requested)
          }
          state.latestOutcome = outcomeTracker.finish()
        } catch (e) {
          cleanup()
          // Re-plan ONLY when a forceful steer (not external teardown) aborted the turn: the
          // steer is already queued, so loop back and fold it. Anything else is fatal.
          if (isInterruptAbort(e, interruptSig, signal, args.controller.signal)) {
            activity.push({ at: now(), kind: 'note', label: 'interrupted', detail: 'replanning' })
            continue
          }
          throw e
        }
        cleanup()

        if (!sawLlmCall) {
          tokensKnown = false
          yield { kind: 'tokens', input: 0, output: 0, tokensKnown: false }
        }

        state.turns += 1
        activity.push({ at: now(), kind: 'turn', label: `turn ${turn}` })
        yield { kind: 'iteration' }

        // A worker may NOT settle while a delivered steer is unread — that is the whole
        // contract `steer_agent` reports back to the driver. Loop instead of breaking.
        // Peer mail is excluded: a sibling must not be able to deny a finished worker its
        // settlement simply by keeping mail in flight.
        if (args.inbox.pendingAuthority() === 0) break
      }
    } finally {
      state.note = 'settled'
      await lineage.teardown().catch(() => {})
      state.teardown = undefined
    }

    // Mark the dollar channel unknown even when no event carried a numeric subtotal: a completed
    // sandbox turn is not proof that the provider billed exactly zero.
    if (state.turns > 0) yield { kind: 'cost', usd: 0, usdKnown: false }
    const spent: Spend = {
      iterations: state.turns,
      tokens,
      ...(tokensKnown ? {} : { tokensKnown: false }),
      usd,
      ...(state.turns > 0 ? { usdKnown: false } : {}),
      ms: now() - started,
    }
    const out = {
      content: state.lastText,
      turns: state.turns,
      toolCalls: state.toolCalls,
      ...(state.latestOutcome ? { outcome: state.latestOutcome } : {}),
    }
    const verdict = state.latestOutcome
      ? projectSandboxOutcome(state.latestOutcome).verdict
      : undefined
    state.artifact = {
      outRef: args.contentRef('sandbox-steerable', { harness: args.harness, out }),
      out,
      ...(verdict ? { verdict } : {}),
      spent,
    }
  }

  return {
    stream,
    progress: (): ExecutorProgress => ({
      turns: state.turns,
      pendingMessages: args.inbox.pending(),
      recentActivity: activity.read(),
      note: state.note,
    }),
    traceSource: () => trace.source,
    artifact: () => state.artifact,
    async teardown() {
      await state.teardown?.().catch(() => {})
    },
  }
}

/** A forceful steer aborted this turn (and NOT an external teardown), so the loop re-plans. */
function isInterruptAbort(
  err: unknown,
  interrupt: AbortSignal,
  external: AbortSignal,
  owned: AbortSignal,
): boolean {
  const aborted =
    (err instanceof DOMException && err.name === 'AbortError') ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError')
  return aborted && interrupt.aborted && !external.aborted && !owned.aborted
}

/** The terminal text a sandbox `result` event carries, when it carries one. */
function readFinalText(event: SandboxEvent): string | undefined {
  const data = (event as { data?: unknown }).data
  if (!data || typeof data !== 'object') return undefined
  const text = (data as { finalText?: unknown; text?: unknown }).finalText
  if (typeof text === 'string' && text.length > 0) return text
  const alt = (data as { text?: unknown }).text
  return typeof alt === 'string' && alt.length > 0 ? alt : undefined
}

/** Prompt options the composed loop context already carries (agent profile / cwd), forwarded so
 *  a steerable worker runs with the same box configuration as the single-shot path. */
function readPromptOptions(
  loopCtx: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>> | undefined,
): Omit<PromptOptions, 'signal' | 'sessionId'> | undefined {
  const opts = (loopCtx as { promptOptions?: unknown } | undefined)?.promptOptions
  if (!opts || typeof opts !== 'object') return undefined
  return opts as Omit<PromptOptions, 'signal' | 'sessionId'>
}

/** Fail loud on a steering config that cannot work, before any box is created. */
export function assertSteerable(client: SandboxClient | undefined): void {
  if (!client || typeof client.create !== 'function') {
    throw new ValidationError('steerable sandbox worker: SandboxSeam.sandboxClient.create required')
  }
}
