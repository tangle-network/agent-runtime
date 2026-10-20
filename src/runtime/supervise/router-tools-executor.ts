import { randomUUID } from 'node:crypto'
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
import { assertRouterAutoDeclaration, assertRouterAutoResponse } from '../router-auto-evidence'
import {
  type PromptCacheUsage,
  type RouterResponseReceipt,
  routerChatWithTools,
  routerTransportAttemptsFromError,
  streamRouterChatWithTools,
  type ToolSpec,
} from '../router-client'
import { addTokenUsage, promptCacheTokenClasses, zeroTokenUsage } from '../util'
import { linkAbort } from './abortable'
import { localAbortCancellation } from './executor-local-cancellation'
import { contentRef } from './executor-outcome'
import { readSeam } from './executor-seams'
import { createInbox, type InboxLease } from './inbox'
import {
  attestRuntimeOwnedExecutor,
  newExecutionAttemptId,
  recordRuntimeOwnedProviderAttemptStart,
  recordRuntimeOwnedProviderModel,
} from './materialization'
import type { ProfileCodeModeSettings, ProfileModelExecutionSettings } from './model-policy'
import { addResourceSpend } from './resources'
import {
  assertObservedRouterModel,
  routerRequestIdentity,
  routerTurnRequestIdentity,
  throwRouterTransportFailure,
} from './router-executor-request'
import {
  exactRouterModel,
  routerProfileExecution,
  taskToMessages,
} from './router-profile-execution'
import { createRouterTranscript } from './router-transcript'
import { type RouterToolsSeam, routerToolsSeamKey } from './runtime-seams'
import { taskToPrompt } from './task-prompt'
import type {
  Executor,
  ExecutorCancellation,
  ExecutorFactory,
  ExecutorResult,
  ExecutorToolCall,
  Runtime,
  Spend,
} from './types'

/** Compose node behavior with host state and ceilings; neither grants new tools. */
function routerCodeModeSettings(
  profile: ProfileModelExecutionSettings['codeMode'],
  host: RouterToolsSeam['codeMode'],
): Omit<CodeModeToolsOptions, 'wasm' | 'workerUrl'> | undefined {
  if (profile === false || (profile === undefined && host === undefined)) return undefined
  const environment = typeof host === 'object' ? host : {}
  const node = typeof profile === 'object' ? profile : {}
  const limits: { -readonly [Key in keyof ProfileCodeModeSettings]: ProfileCodeModeSettings[Key] } =
    {}
  for (const key of ['timeoutMs', 'memoryLimitBytes', 'concurrency', 'maxCalls'] as const) {
    const ceiling = environment[key]
    const requested = node[key]
    // Refuse an invalid host ceiling even if the node asks for a valid, smaller one.
    for (const value of [ceiling, requested]) {
      if (value === undefined || (key === 'timeoutMs' && value === Infinity)) continue
      if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        (key === 'timeoutMs' && value > 2_147_483_647)
      ) {
        throw new ValidationError(`router-tools: invalid codeMode.${key}`)
      }
    }
    const value =
      ceiling === undefined
        ? requested
        : requested === undefined
          ? ceiling
          : Math.min(ceiling, requested)
    if (value !== undefined) limits[key] = value
  }
  return {
    ...environment,
    ...limits,
    ...(environment.directTools || node.directTools
      ? {
          directTools: [
            ...new Set([...(environment.directTools ?? []), ...(node.directTools ?? [])]),
          ],
        }
      : {}),
  }
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

/**
 * The tool-using router executor. Drives the multi-turn tool loop the single-shot
 * `routerInlineExecutor` cannot express; same fail-loud + real-usage discipline.
 */
export const routerToolsInlineExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<RouterToolsSeam>(ctx, routerToolsSeamKey, 'router-tools')
  const model = exactRouterModel(spec.profile, 'routerToolsInlineExecutor')
  if (!seam.routerBaseUrl || !seam.routerKey) {
    throw new ValidationError(
      'routerToolsInlineExecutor: RouterToolsSeam.routerBaseUrl + routerKey required',
    )
  }
  const profileExecution = routerProfileExecution(
    spec.profile,
    {
      routerBaseUrl: seam.routerBaseUrl,
      routerKey: seam.routerKey,
      ...(seam.routing ? { routing: seam.routing } : {}),
      ...(seam.complete ? { complete: seam.complete } : {}),
      tools: seam.tools,
    },
    { multiTurn: true },
  )
  if (model === 'tangle/auto')
    assertRouterAutoDeclaration(profileExecution.extraBody?.auto, profileExecution.stream)
  const codeModeConfig = routerCodeModeSettings(profileExecution.codeMode, seam.codeMode)
  const enabledToolNames = new Set(seam.tools.map((tool) => tool.function.name))
  const maxTurns = profileExecution.maxTurns ?? 0
  const requestIdentity = routerRequestIdentity(ctx)

  const controller = linkAbort(ctx.signal)

  // The down-leg receive end: the driver's steer/answer/resume land here via `Scope.send`.
  const inbox = createInbox()

  let artifact: ExecutorResult<unknown> | undefined
  // The leaf's conversation across its turns and attempts, so it settles with it (#1377).
  const transcript = createRouterTranscript()
  const executionId = ctx.node?.nodeId ?? `router-tools-run-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)

  let executor!: Executor<unknown>
  executor = attestRuntimeOwnedExecutor(
    {
      runtime: 'router' as Runtime,
      deliver: (m) => inbox.deliver(m),
      harnessTranscript: () => transcript.capture(),
      async execute(task, signal): Promise<ExecutorResult<unknown>> {
        const started = Date.now()
        const messages: Array<Record<string, unknown>> = seam.initialMessages
          ? taskToMessages(
              {
                messages: [...seam.initialMessages, { role: 'user', content: taskToPrompt(task) }],
              },
              spec,
              profileExecution.systemPrompt,
            )
          : taskToMessages(task, spec, profileExecution.systemPrompt)
        const tokens = zeroTokenUsage()
        let tokensKnown = true
        let billedUsd = 0
        let usdKnown = true
        let turns = 0
        let resources: Spend['resources']
        let transportAttempts = 0
        let observedModel: string | undefined
        const providerResponses: RouterResponseReceipt[] = []
        let reasoningTokens = 0
        let reasoningKnown = true
        const promptCache: Record<string, number | string> = {}
        let lastText = ''
        // Every call this loop decided to make, in order. The count of executed calls is
        // `executedToolCalls.length`; the entries themselves keep the per-call detail the
        // terminal artifact publishes.
        const executedToolCalls: ExecutorToolCall[] = []
        // Fold any queued down-messages into the conversation as one operator turn (the boundary
        // flush). The folded turn stays in `messages`, so an interrupted request re-sends it; the
        // leases commit once a request carrying them returns.
        const leases: InboxLease[] = []
        const flush = () => {
          const lease = inbox.take()
          if (lease.messages.length === 0) return
          messages.push({ role: 'user', content: inbox.fold(lease.messages) })
          leases.push(lease)
        }

        // The external abort sources (caller signal + executor teardown), merged ONCE — so we don't
        // re-register listeners on these long-lived signals every turn.
        const external = linkAbort(signal, controller.signal).signal

        // Both direct calls and calls made inside a program cross this exact
        // authorized handler and the same existing tool-step observer.
        const executeGranted = async (
          name: string,
          raw: unknown,
          context: CodeModeToolContext,
        ): Promise<unknown> => {
          external.throwIfAborted()
          context.signal.throwIfAborted()
          if (!enabledToolNames.has(name)) throw new ValidationError(`tool ${name} is not granted`)
          const args = codeModeArguments(raw)
          if (context.callId !== context.parentCallId) {
            executedToolCalls.push({ id: context.callId, name, arguments: JSON.stringify(args) })
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
        // The profile chooses this node's action space; the host retains restored
        // state, direct-only capabilities and execution ceilings.
        const codeMode = codeModeConfig
          ? createCodeModeTools(
              seam.tools.map(({ function: tool }) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.parameters as Record<string, unknown>,
                outputSchema: tool.outputSchema,
                execute: (args, context) => executeGranted(tool.name, args, context),
              })),
              codeModeConfig,
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
        const modelToolNames = new Set(presentedTools.map((tool) => tool.function.name))
        const codeByName = new Map(codeMode?.tools.map((tool) => [tool.name, tool]) ?? [])

        try {
          for (let t = 0; maxTurns === 0 || t < maxTurns; t += 1) {
            // QUEUED messages flush at the step boundary, before this turn's inference.
            flush()
            // A forceful (interrupt) message aborts THIS turn so the worker re-plans immediately. The
            // per-turn controller fires on `external` OR a fresh interrupt; its listener on `external` is
            // removed after the turn (`cleanup`) so nothing accumulates across turns.
            const interruptSig = inbox.freshInterrupt()
            const turnController = new AbortController()
            const abortTurn = () => turnController.abort()
            if (external.aborted) turnController.abort()
            else external.addEventListener('abort', abortTurn)
            interruptSig.addEventListener('abort', abortTurn, { once: true })
            const cleanup = () => external.removeEventListener('abort', abortTurn)
            let res: Awaited<ReturnType<typeof routerChatWithTools>>
            transcript.observe(messages)
            try {
              recordRuntimeOwnedProviderAttemptStart(executor)
              res = await (profileExecution.stream === true
                ? streamRouterChatWithTools
                : routerChatWithTools)(
                {
                  routerBaseUrl: seam.routerBaseUrl,
                  routerKey: seam.routerKey,
                  ...(seam.routing ? { routing: seam.routing } : {}),
                  model,
                  ...(profileExecution.retry !== undefined
                    ? { retry: profileExecution.retry }
                    : {}),
                  ...(seam.complete ? { complete: seam.complete } : {}),
                },
                messages,
                presentedTools,
                {
                  ...(profileExecution.temperature !== undefined
                    ? { temperature: profileExecution.temperature }
                    : {}),
                  signal: turnController.signal,
                  onResponse: async (receipt: RouterResponseReceipt) => {
                    providerResponses.push(receipt)
                    transcript.response(receipt)
                    await seam.onProviderResponse?.(structuredClone(receipt))
                  },
                  ...(profileExecution.toolChoice
                    ? { toolChoice: profileExecution.toolChoice }
                    : {}),
                  ...profileExecution.tokenLimits.applied,
                  ...(profileExecution.seed !== undefined ? { seed: profileExecution.seed } : {}),
                  ...(profileExecution.reasoningEffort
                    ? { reasoningEffort: profileExecution.reasoningEffort }
                    : {}),
                  ...(profileExecution.extraBody ? { extraBody: profileExecution.extraBody } : {}),
                  ...routerTurnRequestIdentity(requestIdentity, t),
                },
              )
            } catch (e) {
              cleanup()
              // Re-plan ONLY when a forceful inbox message aborted this turn (a real AbortError, with the
              // interrupt — not the external teardown/budget signal). The request reached the transport,
              // so count its iteration and exact physical attempts. Without a terminal receipt its token,
              // reasoning, and dollar totals are unknown; treating it as free can overspend the pool.
              // Any other error — incl. a network fault coincident with an interrupt — is fatal: rethrow.
              const interruptAbort =
                e instanceof DOMException &&
                e.name === 'AbortError' &&
                interruptSig.aborted &&
                !signal.aborted &&
                !controller.signal.aborted
              if (interruptAbort) {
                turns += 1
                resources = addResourceSpend(
                  Object.fromEntries(
                    Object.entries(resources ?? {}).map(([name, value]) => [
                      name,
                      { ...value, known: false },
                    ]),
                  ),
                ).resources
                transportAttempts += routerTransportAttemptsFromError(e) ?? 1
                tokensKnown = false
                usdKnown = false
                reasoningKnown = false
                continue
              }
              throwRouterTransportFailure('routerToolsInlineExecutor', e)
            }
            cleanup()
            for (const lease of leases.splice(0)) {
              for (const message of lease.messages)
                lease.commit(`${attemptId}#turn-${t}`, message.id)
            }
            // The inference completed — count the turn and merge its terminal receipt.
            turns += 1
            transcript.reply({ content: res.content, toolCalls: res.toolCalls })
            const priorResources = resources
            resources = addResourceSpend(resources, res.resources).resources
            resources = addResourceSpend(
              Object.fromEntries(
                Object.entries(resources ?? {}).map(([name, value]) => [
                  name,
                  {
                    ...value,
                    known:
                      value.known &&
                      res.resources?.[name] !== undefined &&
                      (turns === 1 || priorResources?.[name] !== undefined),
                  },
                ]),
              ),
            ).resources
            transportAttempts += res.transportAttempts
            if (res.model !== undefined) recordRuntimeOwnedProviderModel(executor, res.model)
            if (model === 'tangle/auto') {
              assertRouterAutoResponse(profileExecution.extraBody?.auto, res.response, res.model)
              // Auto reports final-generation usage only. Child usage stays unknown here.
              tokensKnown = false
              reasoningKnown = false
              usdKnown = false
            } else assertObservedRouterModel(res.model, model, 'routerToolsInlineExecutor')
            if (res.model !== undefined) observedModel = res.model
            mergePromptCache(promptCache, res.cache)
            if (res.usage) {
              addTokenUsage(tokens, {
                input: res.usage.input,
                output: res.usage.output,
                ...promptCacheTokenClasses(res.usage.input, res.cache),
              })
              if (res.usage.reasoning !== undefined) reasoningTokens += res.usage.reasoning
              else reasoningKnown = false
            } else {
              addTokenUsage(tokens, promptCacheTokenClasses(undefined, res.cache))
              tokensKnown = false
              reasoningKnown = false
            }
            if (res.billedCostUsd !== undefined) billedUsd += res.billedCostUsd
            else usdKnown = false
            if (res.content) lastText = res.content
            const toolCalls = res.toolCalls
            if (toolCalls.length === 0) {
              // Only authority messages require another turn. Peer mail joins an already-required
              // turn at the next boundary, but cannot keep a finished worker running.
              if (inbox.pendingAuthority() > 0) continue
              messages.push({ role: 'assistant', content: res.content ?? '' })
              break
            }

            // Record the assistant turn verbatim, then run each call on the host and
            // fold the result back as a `tool` message for the next turn.
            messages.push({
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
            const images: Array<{ type: 'image_url'; image_url: { url: string } }> = []
            for (let i = 0; i < toolCalls.length; i += 1) {
              const tc = toolCalls[i]
              const id = tc?.id ?? `call_${i}`
              const toolName = tc?.name ?? ''
              executedToolCalls.push({ id, name: toolName, arguments: tc?.arguments ?? '' })
              if (!modelToolNames.has(toolName)) {
                messages.push({
                  role: 'tool',
                  tool_call_id: id,
                  content: `error: tool ${JSON.stringify(toolName)} is not enabled by AgentProfile.tools`,
                })
                try {
                  seam.onToolStep?.({ toolName, args: {}, status: 'error' })
                } catch {
                  // Monitoring cannot authorize or execute a refused tool call.
                }
                continue
              }
              let args: Record<string, unknown> = {}
              try {
                args = JSON.parse(tc?.arguments ?? '{}') as Record<string, unknown>
              } catch {
                // Malformed args are a real outcome, not an infra fault — feed the error
                // back so the model can correct, rather than aborting the whole loop.
                messages.push({
                  role: 'tool',
                  tool_call_id: id,
                  content: 'error: tool arguments were not valid JSON',
                })
                continue
              }
              let result: unknown
              let succeeded = true
              try {
                // The dispatch carries the per-turn interrupt signal TOO, not just the
                // external teardown/budget one: a forceful steer_agent({interrupt:true})
                // that lands while a codemode program runs must revoke the program and
                // its nested effects immediately (the turn re-plans), not at completion
                // or the five-minute bound.
                const context = {
                  signal: AbortSignal.any([external, turnController.signal]),
                  callId: id,
                  parentCallId: id,
                }
                result = codeMode
                  ? await codeByName.get(toolName)!.execute(args, context)
                  : await executeGranted(toolName, args, context)
              } catch (e) {
                succeeded = false
                result = `error: ${e instanceof Error ? e.message : String(e)}`
              }
              const projected =
                succeeded && codeMode && toolName === 'codemode'
                  ? codeModeModelOutput(result)
                  : undefined
              if (projected) images.push(...projected.images)
              messages.push({
                role: 'tool',
                tool_call_id: id,
                content: projected?.text ?? toolResultText(result),
              })
            }
            if (images.length)
              messages.push({
                role: 'user',
                content: [{ type: 'text', text: 'Images emitted by codemode:' }, ...images],
              })
          }
        } finally {
          // This execution never sends `messages` again: report what it still holds as failed.
          inbox.failPending('the worker execution ended before a model turn read the message')
          const saved = structuredClone(messages) as ReadonlyArray<
            Readonly<Record<string, unknown>>
          >
          if (codeMode) await seam.onMessages?.(saved, { codeModeStore: codeMode.snapshotStore() })
          else await seam.onMessages?.(saved)
        }

        const estimatedUsd = priceTokens({
          model,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          ...(tokens.cacheRead === undefined ? {} : { cacheReadTokens: tokens.cacheRead }),
          ...(tokens.cacheWrite === undefined ? {} : { cacheWriteTokens: tokens.cacheWrite }),
        })
        const spent: Spend = {
          ...addResourceSpend(resources),
          iterations: turns,
          tokens,
          ...(tokensKnown ? {} : { tokensKnown: false }),
          usd: billedUsd,
          ...(usdKnown ? {} : { usdKnown: false }),
          ms: Date.now() - started,
        }
        const out = {
          content: lastText,
          ...(codeMode
            ? { codeModeStore: codeMode.snapshotStore(), modelToolNames: [...modelToolNames] }
            : {}),
          ...(observedModel !== undefined ? { model: observedModel } : {}),
          messages,
          turns,
          toolCalls: executedToolCalls,
          transportAttempts,
          providerResponses,
          ...(estimatedUsd !== undefined ? { estimatedCostUsd: estimatedUsd } : {}),
          ...(Object.keys(promptCache).length > 0 ? { promptCache } : {}),
          ...(reasoningKnown && turns > 0 ? { reasoningTokens } : {}),
        } as unknown
        artifact = { outRef: contentRef('router-tools', { model, content: lastText }), out, spent }
        return artifact
      },
      cancel(_request): Promise<ExecutorCancellation> {
        controller.abort('executor cancelled')
        return Promise.resolve(
          localAbortCancellation(
            'the Router chat-completions API exposes no cancel operation; the in-flight turn was aborted and the provider may still bill it',
          ),
        )
      },
      teardown(_grace): Promise<{ destroyed: boolean }> {
        controller.abort('executor torn down')
        return Promise.resolve({ destroyed: true })
      },
      resultArtifact() {
        if (!artifact) {
          throw new ValidationError(
            'routerToolsInlineExecutor: resultArtifact() read before execute()',
          )
        }
        return { ...artifact, spent: artifact.spent }
      },
    },
    {
      effectiveProfile: spec.profile,
      backend: 'router-tools',
      model: { status: 'known', id: model },
      execution: {
        kind: 'run',
        id: executionId,
      },
      materializer: 'router-tools-prompt-model',
      plan: {
        kind: 'openai-tool-loop',
        model,
        provider: spec.profile.model?.provider ?? null,
        maxTurns,
        tools: seam.tools,
        ...(seam.codeMode ? { codeMode: seam.codeMode } : {}),
        temperature: profileExecution.temperature ?? null,
        tokenLimits: profileExecution.tokenLimits,
        retry: profileExecution.retry ?? null,
        toolChoice: profileExecution.toolChoice ?? null,
        extraBody: profileExecution.extraBody ?? null,
        reasoningEffort: profileExecution.reasoningEffort ?? null,
        systemPrompt: profileExecution.systemPrompt || null,
      },
    },
    {
      attemptId,
      binding: {
        endpoint: seam.routerBaseUrl,
        executionId,
        model,
      },
      descriptor: { kind: 'router-tool-loop', transport: 'http', backend: 'router-tools' },
    },
  )
  return executor
}
