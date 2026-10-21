import { ValidationError } from '../../errors'
import { priceTokens } from '../../pricing/router-prices'
import {
  type CodeModeToolContext,
  type CodeModeToolsOptions,
  codeModeArguments,
  codeModeModelOutput,
  createCodeModeTools,
  toolResultText,
} from '../code-mode'
import { assertRouterAutoResponse } from '../router-auto-evidence'
import { routerChatWithTools, streamRouterChatWithTools } from '../router-client'
import {
  type RouterResponseReceipt,
  routerTransportAttemptsFromError,
} from '../router-http-transport'
import type { ToolSpec } from '../router-request-body'
import type { PromptCacheUsage } from '../router-response'
import { addTokenUsage, promptCacheTokenClasses, zeroTokenUsage } from '../util'
import { linkAbort } from './abortable'
import { contentRef } from './executor-outcome'
import type { Inbox, InboxLease } from './inbox'
import {
  recordRuntimeOwnedProviderAttemptStart,
  recordRuntimeOwnedProviderModel,
} from './materialization'
import { addResourceSpend } from './resources'
import {
  assertObservedRouterModel,
  routerGenerationOptions,
  type routerRequestIdentity,
  routerTransportConfig,
  routerTurnRequestIdentity,
  throwRouterTransportFailure,
} from './router-executor-request'
import { type RouterProfileExecution, taskToMessages } from './router-profile-execution'
import type { RouterTranscript } from './router-transcript'
import type { RouterToolsSeam } from './runtime-seams'
import { taskToPrompt } from './task-prompt'
import type { AgentSpec, Executor, ExecutorResult, ExecutorToolCall, Spend } from './types'

type RouterTurnResult = Awaited<ReturnType<typeof routerChatWithTools>>
type ToolCall = RouterTurnResult['toolCalls'][number]
type Message = Record<string, unknown>

/** What one router tool loop reads and never changes: the seam, the profile's decisions, the owners. */
export interface RouterToolLoopEnv {
  readonly seam: RouterToolsSeam
  readonly spec: AgentSpec
  readonly model: string
  readonly profileExecution: RouterProfileExecution
  readonly codeModeConfig: Omit<CodeModeToolsOptions, 'wasm' | 'workerUrl'> | undefined
  readonly enabledToolNames: ReadonlySet<string>
  readonly maxTurns: number
  readonly requestIdentity: ReturnType<typeof routerRequestIdentity>
  readonly executor: Executor<unknown>
  readonly inbox: Inbox
  readonly transcript: RouterTranscript
  readonly attemptId: string
  /** The executor-level abort: cancel and teardown fire it. */
  readonly controller: ReturnType<typeof linkAbort>
}

/** The loop's mutable ledger: the conversation, the spend it accumulated, and the calls it ran. */
interface LoopState {
  readonly messages: Message[]
  readonly tokens: ReturnType<typeof zeroTokenUsage>
  tokensKnown: boolean
  billedUsd: number
  usdKnown: boolean
  turns: number
  resources: Spend['resources']
  transportAttempts: number
  observedModel: string | undefined
  readonly providerResponses: RouterResponseReceipt[]
  reasoningTokens: number
  reasoningKnown: boolean
  readonly promptCache: Record<string, number | string>
  lastText: string
  // Every call this loop decided to make, in order, with the detail the terminal artifact publishes.
  readonly executedToolCalls: ExecutorToolCall[]
  readonly leases: InboxLease[]
}

/** The action space the model is shown, and the code-mode programs behind it. */
interface ActionSpace {
  readonly codeMode: ReturnType<typeof createCodeModeTools> | undefined
  readonly presentedTools: ReadonlyArray<ToolSpec>
  readonly modelToolNames: ReadonlySet<string>
  readonly codeByName: ReadonlyMap<
    string,
    NonNullable<ReturnType<typeof createCodeModeTools>>['tools'][number]
  >
}

/** One model turn's abort: fires on the external signal or a fresh forceful interrupt. */
interface TurnAbort {
  readonly controller: AbortController
  readonly interrupt: AbortSignal
  readonly cleanup: () => void
}

function mergePromptCache(
  target: Record<string, number | string>,
  cache: PromptCacheUsage | undefined,
): void {
  if (!cache) return
  for (const key of ['readTokens', 'writeTokens', 'missTokens', 'readSavingsUsd'] as const) {
    const value = cache[key]
    if (value !== undefined) target[key] = (Number(target[key]) || 0) + value
  }
  if (cache.status !== undefined) target.status = cache.status
}

/** Drive the multi-turn tool loop for one `execute()` and publish its terminal artifact. */
export async function runRouterToolLoop(
  env: RouterToolLoopEnv,
  task: unknown,
  signal: AbortSignal,
): Promise<ExecutorResult<unknown>> {
  const { seam, spec, profileExecution, inbox } = env
  const started = Date.now()
  const state = newLoopState(
    seam.initialMessages
      ? taskToMessages(
          {
            messages: [...seam.initialMessages, { role: 'user', content: taskToPrompt(task) }],
          },
          spec,
          profileExecution.systemPrompt,
        )
      : taskToMessages(task, spec, profileExecution.systemPrompt),
  )
  // Merged ONCE so listeners are not re-registered on these long-lived signals every turn.
  const external = linkAbort(signal, env.controller.signal).signal
  const actions = buildActionSpace(env, state, task, external)

  try {
    for (let t = 0; env.maxTurns === 0 || t < env.maxTurns; t += 1) {
      flushInbox(env, state)
      const turn = startTurn(inbox, external)
      const res = await requestModelTurn(env, state, actions, turn, signal, t)
      if (res === undefined) continue // a forceful interrupt aborted it: re-plan with the steer
      recordModelReceipt(env, state, res, t)
      const toolCalls = res.toolCalls
      if (toolCalls.length === 0) {
        // Only authority messages require another turn; peer mail cannot keep a finished worker running.
        if (inbox.pendingAuthority() > 0) continue
        state.messages.push({ role: 'assistant', content: res.content ?? '' })
        break
      }
      state.messages.push({
        role: 'assistant',
        content: res.content ?? '',
        tool_calls: toolCalls.map((tc) => ({
          ...tc.providerFields,
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
      })
      await runToolCalls(env, state, actions, turn, external, task, toolCalls)
    }
  } finally {
    // This execution never sends `messages` again: report what it still holds as failed.
    inbox.failPending('the worker execution ended before a model turn read the message')
    const saved = structuredClone(state.messages) as ReadonlyArray<
      Readonly<Record<string, unknown>>
    >
    if (actions.codeMode) {
      await seam.onMessages?.(saved, { codeModeStore: actions.codeMode.snapshotStore() })
    } else await seam.onMessages?.(saved)
  }
  return settleLoop(env, state, actions, started)
}

function newLoopState(messages: Message[]): LoopState {
  return {
    messages,
    tokens: zeroTokenUsage(),
    tokensKnown: true,
    billedUsd: 0,
    usdKnown: true,
    turns: 0,
    resources: undefined,
    transportAttempts: 0,
    observedModel: undefined,
    providerResponses: [],
    reasoningTokens: 0,
    reasoningKnown: true,
    promptCache: {},
    lastText: '',
    executedToolCalls: [],
    leases: [],
  }
}

/** Fold queued down-messages into one operator turn; it stays in `messages` so an interrupted
 *  request re-sends it, and the leases commit once a request carrying them returns. */
function flushInbox(env: RouterToolLoopEnv, state: LoopState): void {
  const lease = env.inbox.take()
  if (lease.messages.length === 0) return
  state.messages.push({ role: 'user', content: env.inbox.fold(lease.messages) })
  state.leases.push(lease)
}

/** A forceful message aborts THIS turn so the worker re-plans. The controller fires on `external`
 *  OR a fresh interrupt; `cleanup` removes its `external` listener so nothing accumulates. */
function startTurn(inbox: Inbox, external: AbortSignal): TurnAbort {
  const interrupt = inbox.freshInterrupt()
  const controller = new AbortController()
  const abortTurn = () => controller.abort()
  if (external.aborted) controller.abort()
  else external.addEventListener('abort', abortTurn)
  interrupt.addEventListener('abort', abortTurn, { once: true })
  return { controller, interrupt, cleanup: () => external.removeEventListener('abort', abortTurn) }
}

/** Direct calls and calls made inside a program cross this one authorized handler and observer. */
async function executeGranted(
  env: RouterToolLoopEnv,
  state: LoopState,
  task: unknown,
  external: AbortSignal,
  name: string,
  raw: unknown,
  context: CodeModeToolContext,
): Promise<unknown> {
  const { seam } = env
  external.throwIfAborted()
  context.signal.throwIfAborted()
  if (!env.enabledToolNames.has(name)) throw new ValidationError(`tool ${name} is not granted`)
  const args = codeModeArguments(raw)
  if (context.callId !== context.parentCallId) {
    state.executedToolCalls.push({ id: context.callId, name, arguments: JSON.stringify(args) })
  }
  const startedAt = Date.now()
  let status: 'ok' | 'error' = 'ok'
  try {
    return await seam.executeToolCall(name, args, task, context)
  } catch (error) {
    status = 'error'
    throw error
  } finally {
    const endedAt = Date.now()
    try {
      seam.onToolStep?.({
        toolName: name,
        args,
        status,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
      })
    } catch {
      /* Monitoring cannot change whether the original operation ran. */
    }
  }
}

/** The profile chooses the action space; the host keeps restored state, direct-only tools and ceilings. */
function buildActionSpace(
  env: RouterToolLoopEnv,
  state: LoopState,
  task: unknown,
  external: AbortSignal,
): ActionSpace {
  const { seam } = env
  const codeMode = env.codeModeConfig
    ? createCodeModeTools(
        seam.tools.map(({ function: tool }) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters as Record<string, unknown>,
          outputSchema: tool.outputSchema,
          execute: (args, context) =>
            executeGranted(env, state, task, external, tool.name, args, context),
        })),
        env.codeModeConfig,
      )
    : undefined
  const presentedTools: ReadonlyArray<ToolSpec> = codeMode
    ? codeMode.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }))
    : seam.tools
  return {
    codeMode,
    presentedTools,
    modelToolNames: new Set(presentedTools.map((tool) => tool.function.name)),
    codeByName: new Map(codeMode?.tools.map((tool) => [tool.name, tool]) ?? []),
  }
}

/** One request to the router; `undefined` means a forceful interrupt aborted it and the loop re-plans. */
async function requestModelTurn(
  env: RouterToolLoopEnv,
  state: LoopState,
  actions: ActionSpace,
  turn: TurnAbort,
  signal: AbortSignal,
  t: number,
): Promise<RouterTurnResult | undefined> {
  const { seam, profileExecution, transcript } = env
  transcript.observe(state.messages)
  try {
    recordRuntimeOwnedProviderAttemptStart(env.executor)
    const res = await (profileExecution.stream === true
      ? streamRouterChatWithTools
      : routerChatWithTools)(
      routerTransportConfig(seam, env.model, profileExecution.retry),
      state.messages,
      actions.presentedTools,
      {
        ...(profileExecution.temperature !== undefined
          ? { temperature: profileExecution.temperature }
          : {}),
        signal: turn.controller.signal,
        onResponse: async (receipt: RouterResponseReceipt) => {
          state.providerResponses.push(receipt)
          transcript.response(receipt)
          await seam.onProviderResponse?.(structuredClone(receipt))
        },
        ...(profileExecution.toolChoice ? { toolChoice: profileExecution.toolChoice } : {}),
        ...routerGenerationOptions(profileExecution),
        ...routerTurnRequestIdentity(env.requestIdentity, t),
      },
    )
    turn.cleanup()
    return res
  } catch (e) {
    turn.cleanup()
    // Re-plan ONLY for a real AbortError caused by a forceful inbox message (not the external
    // teardown/budget signal). The request reached the transport, so count its iteration and
    // attempts; with no terminal receipt its totals are unknown, and free would overspend the
    // pool. Any other error, including a network fault coincident with an interrupt, is fatal.
    const interruptAbort =
      e instanceof DOMException &&
      e.name === 'AbortError' &&
      turn.interrupt.aborted &&
      !signal.aborted &&
      !env.controller.signal.aborted
    if (!interruptAbort) throwRouterTransportFailure('routerToolsInlineExecutor', e)
    recordInterruptedTurn(state, e)
    return undefined
  }
}

function recordInterruptedTurn(state: LoopState, error: unknown): void {
  state.turns += 1
  state.resources = addResourceSpend(
    Object.fromEntries(
      Object.entries(state.resources ?? {}).map(([name, value]) => [
        name,
        { ...value, known: false },
      ]),
    ),
  ).resources
  state.transportAttempts += routerTransportAttemptsFromError(error) ?? 1
  state.tokensKnown = false
  state.usdKnown = false
  state.reasoningKnown = false
}

/** The inference completed: commit the leases it carried, count the turn, merge its terminal receipt. */
function recordModelReceipt(
  env: RouterToolLoopEnv,
  state: LoopState,
  res: RouterTurnResult,
  t: number,
): void {
  for (const lease of state.leases.splice(0)) {
    for (const message of lease.messages) lease.commit(`${env.attemptId}#turn-${t}`, message.id)
  }
  state.turns += 1
  env.transcript.reply({ content: res.content, toolCalls: res.toolCalls })
  const priorResources = state.resources
  state.resources = addResourceSpend(state.resources, res.resources).resources
  state.resources = addResourceSpend(
    Object.fromEntries(
      Object.entries(state.resources ?? {}).map(([name, value]) => [
        name,
        {
          ...value,
          known:
            value.known &&
            res.resources?.[name] !== undefined &&
            (state.turns === 1 || priorResources?.[name] !== undefined),
        },
      ]),
    ),
  ).resources
  state.transportAttempts += res.transportAttempts
  if (res.model !== undefined) recordRuntimeOwnedProviderModel(env.executor, res.model)
  if (env.model === 'tangle/auto') {
    assertRouterAutoResponse(env.profileExecution.extraBody?.auto, res.response, res.model)
    // Auto reports final-generation usage only. Child usage stays unknown here.
    state.tokensKnown = false
    state.reasoningKnown = false
    state.usdKnown = false
  } else assertObservedRouterModel(res.model, env.model, 'routerToolsInlineExecutor')
  if (res.model !== undefined) state.observedModel = res.model
  mergePromptCache(state.promptCache, res.cache)
  if (res.usage) {
    addTokenUsage(state.tokens, {
      input: res.usage.input,
      output: res.usage.output,
      ...promptCacheTokenClasses(res.usage.input, res.cache),
    })
    if (res.usage.reasoning !== undefined) state.reasoningTokens += res.usage.reasoning
    else state.reasoningKnown = false
  } else {
    addTokenUsage(state.tokens, promptCacheTokenClasses(undefined, res.cache))
    state.tokensKnown = false
    state.reasoningKnown = false
  }
  if (res.billedCostUsd !== undefined) state.billedUsd += res.billedCostUsd
  else state.usdKnown = false
  if (res.content) state.lastText = res.content
}

/** Run each call the model made on the host and fold the results back as `tool` messages. */
async function runToolCalls(
  env: RouterToolLoopEnv,
  state: LoopState,
  actions: ActionSpace,
  turn: TurnAbort,
  external: AbortSignal,
  task: unknown,
  toolCalls: ReadonlyArray<ToolCall>,
): Promise<void> {
  const images: Array<{ type: 'image_url'; image_url: { url: string } }> = []
  for (let i = 0; i < toolCalls.length; i += 1) {
    const tc = toolCalls[i]
    const id = tc?.id ?? `call_${i}`
    const toolName = tc?.name ?? ''
    state.executedToolCalls.push({ id, name: toolName, arguments: tc?.arguments ?? '' })
    if (!actions.modelToolNames.has(toolName)) {
      state.messages.push({
        role: 'tool',
        tool_call_id: id,
        content: `error: tool ${JSON.stringify(toolName)} is not enabled by AgentProfile.tools`,
      })
      try {
        env.seam.onToolStep?.({ toolName, args: {}, status: 'error' })
      } catch {
        // Monitoring cannot authorize or execute a refused tool call.
      }
      continue
    }
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc?.arguments ?? '{}') as Record<string, unknown>
    } catch {
      // Malformed args are a real outcome: feed the error back so the model can correct.
      state.messages.push({
        role: 'tool',
        tool_call_id: id,
        content: 'error: tool arguments were not valid JSON',
      })
      continue
    }
    let result: unknown
    let succeeded = true
    try {
      // The per-turn interrupt signal rides too: a forceful steer_agent({interrupt:true}) during
      // a codemode program must revoke it and its nested effects at once, not at the 5-minute bound.
      const context = {
        signal: AbortSignal.any([external, turn.controller.signal]),
        callId: id,
        parentCallId: id,
      }
      result = actions.codeMode
        ? await actions.codeByName.get(toolName)!.execute(args, context)
        : await executeGranted(env, state, task, external, toolName, args, context)
    } catch (e) {
      succeeded = false
      result = `error: ${e instanceof Error ? e.message : String(e)}`
    }
    const projected =
      succeeded && actions.codeMode && toolName === 'codemode'
        ? codeModeModelOutput(result)
        : undefined
    if (projected) images.push(...projected.images)
    state.messages.push({
      role: 'tool',
      tool_call_id: id,
      content: projected?.text ?? toolResultText(result),
    })
  }
  if (images.length)
    state.messages.push({
      role: 'user',
      content: [{ type: 'text', text: 'Images emitted by codemode:' }, ...images],
    })
}

/** Price the spend and publish the terminal artifact. */
function settleLoop(
  env: RouterToolLoopEnv,
  state: LoopState,
  actions: ActionSpace,
  started: number,
): ExecutorResult<unknown> {
  const { tokens, turns } = state
  const estimatedUsd = priceTokens({
    model: env.model,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    ...(tokens.cacheRead === undefined ? {} : { cacheReadTokens: tokens.cacheRead }),
    ...(tokens.cacheWrite === undefined ? {} : { cacheWriteTokens: tokens.cacheWrite }),
  })
  const spent: Spend = {
    ...addResourceSpend(state.resources),
    iterations: turns,
    tokens,
    ...(state.tokensKnown ? {} : { tokensKnown: false }),
    usd: state.billedUsd,
    ...(state.usdKnown ? {} : { usdKnown: false }),
    ms: Date.now() - started,
  }
  const out = {
    content: state.lastText,
    ...(actions.codeMode
      ? {
          codeModeStore: actions.codeMode.snapshotStore(),
          modelToolNames: [...actions.modelToolNames],
        }
      : {}),
    ...(state.observedModel !== undefined ? { model: state.observedModel } : {}),
    messages: state.messages,
    turns,
    toolCalls: state.executedToolCalls,
    transportAttempts: state.transportAttempts,
    providerResponses: state.providerResponses,
    ...(estimatedUsd !== undefined ? { estimatedCostUsd: estimatedUsd } : {}),
    ...(Object.keys(state.promptCache).length > 0 ? { promptCache: state.promptCache } : {}),
    ...(state.reasoningKnown && turns > 0 ? { reasoningTokens: state.reasoningTokens } : {}),
  } as unknown
  return {
    outRef: contentRef('router-tools', { model: env.model, content: state.lastText }),
    out,
    spent,
  }
}
