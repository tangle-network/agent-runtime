/**
 * Steerable provider worker: one environment, one server-side session, many turns.
 *
 * Turn zero sends the task. Later turns send only newly delivered steering
 * messages through the same session id, preserving provider-side context.
 * Interrupting a turn aborts it and immediately folds the queued correction
 * into the next turn.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../../errors'
import { extractLlmCallEvent, notifyAgentEnvironmentEventObserver } from '../environment-events'
import { createEnvironmentLineage, type EnvironmentLineageHandle } from '../environment-lineage'
import type { AgentRunSpec, ExecCtx } from '../types'
import { zeroTokenUsage } from '../util'
import type { Inbox } from './inbox'
import {
  type ActivityLog,
  type ActivityNote,
  createActivityLog,
  type ExecutorProgress,
} from './progress'
import { createPushTraceSource, decodeToolPart, type TraceSource } from './trace-source'
import type { Spend, UsageEvent } from './types'

export const DEFAULT_ENVIRONMENT_STEERING_MAX_TURNS = 24

type TurnOptions = Omit<AgentTurnInput, 'prompt' | 'parts' | 'sessionId' | 'signal'>

export interface EnvironmentSteeringOptions {
  /** Turn zero plus folded steering turns. Default 24. */
  readonly maxTurns?: number
  /** Recent tool and turn notes exposed by `progress()`. Default 12. */
  readonly activityWindow?: number
  /** Abort an individual turn after this many milliseconds. */
  readonly turnTimeoutMs?: number
  /** Provider-neutral fields forwarded on every turn. */
  readonly turn?: TurnOptions
}

export interface SteerableEnvironmentSession {
  stream(task: unknown, signal: AbortSignal): AsyncIterable<UsageEvent>
  progress(): ExecutorProgress
  traceSource(): TraceSource
  artifact(): { outRef: string; out: unknown; spent: Spend } | undefined
  teardown(): Promise<void>
}

export interface SteerableEnvironmentArgs {
  readonly controller: AbortController
  readonly profile: AgentProfile
  readonly backend?: string
  readonly provider: AgentEnvironmentProvider
  readonly environment?: AgentRunSpec<unknown>['environment']
  readonly inbox: Inbox
  readonly taskToPrompt: (task: unknown) => string
  readonly options?: EnvironmentSteeringOptions
  readonly loopCtx?: Partial<Omit<ExecCtx, 'environmentProvider' | 'signal'>>
  readonly contentRef: (prefix: string, value: unknown) => string
  readonly now?: () => number
}

/** One steerable environment worker. The session starts when `stream()` is drained. */
export function createSteerableEnvironmentSession(
  args: SteerableEnvironmentArgs,
): SteerableEnvironmentSession {
  assertSteerableEnvironmentProvider(args.provider)
  const now = args.now ?? Date.now
  const maxTurns = Math.max(
    1,
    Math.floor(args.options?.maxTurns ?? DEFAULT_ENVIRONMENT_STEERING_MAX_TURNS),
  )
  const activity: ActivityLog = createActivityLog(args.options?.activityWindow ?? 12)
  const trace = createPushTraceSource({
    runId: `environment-${args.provider.name}-${now()}`,
    now,
  })

  const state = {
    turns: 0,
    lastText: '',
    seenToolCalls: new Set<string>(),
    artifact: undefined as { outRef: string; out: unknown; spent: Spend } | undefined,
    teardown: undefined as (() => Promise<void>) | undefined,
    note: 'starting',
  }

  const recordEvent = (event: AgentEnvironmentEvent, turn: number, agentRunName: string): void => {
    notifyAgentEnvironmentEventObserver(event, args.loopCtx?.onEnvironmentEvent, {
      iterationIndex: turn,
      agentRunName,
    })
    const at = now()
    const part = event.data.part
    if (part !== undefined) {
      const step = decodeToolPart(part, args.backend ?? args.provider.name)
      if (step) {
        const key = step.callId ?? `${step.toolName}:${activity.size()}`
        if (!state.seenToolCalls.has(key)) {
          state.seenToolCalls.add(key)
          trace.record(step)
          const detail = describeArgs(step.args)
          const note: ActivityNote = {
            at,
            kind: 'tool',
            label: step.toolName,
            ...(step.status ? { status: step.status } : {}),
            ...(detail ? { detail } : {}),
          }
          activity.push(note)
        }
      }
    }
    const text = readFinalText(event)
    if (text) state.lastText = text
  }

  async function* stream(task: unknown, signal: AbortSignal): AsyncIterable<UsageEvent> {
    const capabilities = await args.provider.capabilities()
    if (!capabilities.sessions.continue) {
      throw new ValidationError(
        `steerable environment worker: provider "${args.provider.name}" does not support session continuation`,
      )
    }
    const lineage = createEnvironmentLineage(args.provider, capabilities, { maxConcurrency: 1 })
    state.teardown = () => lineage.teardown()

    const agentRunName = args.profile.name ?? args.backend ?? args.provider.name
    const environment = {
      ...(args.environment ?? {}),
      ...(args.backend ? { backend: args.backend } : {}),
    }
    const spec: AgentRunSpec<unknown> = {
      profile: args.profile,
      taskToPrompt: args.taskToPrompt,
      name: agentRunName,
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
    }

    const started = now()
    const tokens = zeroTokenUsage()
    let usd = 0
    let sawLlmCall = false
    let usdKnown = true
    let handle: EnvironmentLineageHandle | undefined
    let nextPrompt: string | undefined = args.taskToPrompt(task)

    try {
      for (let turn = 0; turn < maxTurns; turn += 1) {
        const pending = args.inbox.drain()
        if (pending.length > 0) {
          const folded = args.inbox.fold(pending)
          nextPrompt = turn === 0 && nextPrompt ? `${nextPrompt}\n\n${folded}` : folded
          activity.push({
            at: now(),
            kind: 'note',
            label: 'steer-folded',
            detail: `${pending.length} message(s)`,
          })
        }
        if (nextPrompt === undefined) break

        const prompt = nextPrompt
        nextPrompt = undefined
        state.note = `turn ${turn}`

        const interruptSignal = args.inbox.freshInterrupt()
        const turnController = new AbortController()
        const abortTurn = () => turnController.abort()
        if (signal.aborted || args.controller.signal.aborted) {
          turnController.abort()
        } else {
          signal.addEventListener('abort', abortTurn)
          args.controller.signal.addEventListener('abort', abortTurn)
        }
        interruptSignal.addEventListener('abort', abortTurn, { once: true })
        const timer = args.options?.turnTimeoutMs
          ? setTimeout(abortTurn, args.options.turnTimeoutMs)
          : undefined
        const cleanupTurn = () => {
          signal.removeEventListener('abort', abortTurn)
          args.controller.signal.removeEventListener('abort', abortTurn)
          if (timer) clearTimeout(timer)
        }

        let events: AsyncIterable<AgentEnvironmentEvent>
        try {
          if (!handle) {
            const opened = await lineage.start(
              spec,
              prompt,
              turnController.signal,
              args.options?.turn,
            )
            handle = opened.handle
            events = opened.events
          } else {
            events = await lineage.continue(
              handle,
              prompt,
              turnController.signal,
              args.options?.turn,
            )
          }
          for await (const event of events) {
            recordEvent(event, turn, agentRunName)
            const call = extractLlmCallEvent(event, agentRunName)
            if (!call) continue
            sawLlmCall = true
            args.loopCtx?.runHandle?.observe(call)
            const input = call.tokensIn ?? 0
            const output = call.tokensOut ?? 0
            if (input || output) {
              tokens.input += input
              tokens.output += output
              yield { kind: 'tokens', input, output }
            }
            if (typeof call.costUsd === 'number') {
              usd += call.costUsd
              if (call.costUsd > 0) yield { kind: 'cost', usd: call.costUsd }
            } else {
              usdKnown = false
            }
          }
        } catch (error) {
          cleanupTurn()
          if (isInterruptAbort(error, interruptSignal, signal, args.controller.signal)) {
            activity.push({
              at: now(),
              kind: 'note',
              label: 'interrupted',
              detail: 'replanning',
            })
            continue
          }
          throw error
        }
        cleanupTurn()

        state.turns += 1
        activity.push({ at: now(), kind: 'turn', label: `turn ${turn}` })
        yield { kind: 'iteration' }
        if (args.inbox.pending() === 0) break
      }
      if (args.inbox.pending() > 0) {
        throw new ValidationError(
          `steerable environment worker: maxTurns ${maxTurns} reached with ${args.inbox.pending()} unread message(s)`,
        )
      }
    } finally {
      state.note = 'settled'
      await lineage.teardown().catch(() => {})
      state.teardown = undefined
    }

    const spent: Spend = {
      iterations: state.turns,
      tokens,
      usd,
      ...(usdKnown && (sawLlmCall || state.turns === 0) ? {} : { usdKnown: false }),
      ms: now() - started,
    }
    const out = {
      content: state.lastText,
      turns: state.turns,
      toolCalls: activity
        .read()
        .filter((note) => note.kind === 'tool')
        .map((note) => note.label),
    }
    state.artifact = {
      outRef: args.contentRef('environment-steerable', {
        provider: args.provider.name,
        ...(args.backend ? { backend: args.backend } : {}),
        out,
      }),
      out,
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

function isInterruptAbort(
  error: unknown,
  interrupt: AbortSignal,
  external: AbortSignal,
  owned: AbortSignal,
): boolean {
  const aborted =
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError')
  return aborted && interrupt.aborted && !external.aborted && !owned.aborted
}

function readFinalText(event: AgentEnvironmentEvent): string | undefined {
  const finalText = event.data.finalText
  if (typeof finalText === 'string' && finalText.length > 0) return finalText
  const text = event.data.text
  return typeof text === 'string' && text.length > 0 ? text : undefined
}

function describeArgs(argsValue: unknown): string | undefined {
  if (!argsValue || typeof argsValue !== 'object') return undefined
  const args = argsValue as Record<string, unknown>
  for (const key of ['filePath', 'file_path', 'path', 'file', 'command', 'cmd', 'pattern']) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 120 ? `${value.slice(0, 117)}...` : value
    }
  }
  return undefined
}

/** Assert that supervision received a provider capable of creating environments. */
export function assertSteerableEnvironmentProvider(
  provider: AgentEnvironmentProvider | undefined,
): void {
  if (!provider || typeof provider.create !== 'function') {
    throw new ValidationError(
      'steerable environment worker: AgentEnvironmentProvider.create required',
    )
  }
}
