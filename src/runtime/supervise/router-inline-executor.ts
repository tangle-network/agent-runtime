import { randomUUID } from 'node:crypto'
import { ValidationError } from '../../errors'
import {
  type RouterChatResult,
  type RouterChatToolsResult,
  routerChatWithTools,
  routerChatWithUsage,
  streamRouterChatWithTools,
  streamRouterChatWithUsage,
} from '../router-client'
import { cloneTokenUsage, promptCacheTokenClasses, zeroTokenUsage } from '../util'
import { linkAbort } from './abortable'
import { localAbortCancellation } from './executor-local-cancellation'
import { contentRef } from './executor-outcome'
import { readSeam } from './executor-seams'
import {
  attestRuntimeOwnedExecutor,
  newExecutionAttemptId,
  recordRuntimeOwnedProviderAttemptStart,
  recordRuntimeOwnedProviderModel,
} from './materialization'
import { addResourceSpend } from './resources'
import {
  assertObservedRouterModel,
  routerRequestIdentity,
  runRouterTransport,
} from './router-executor-request'
import {
  exactRouterModel,
  routerProfileExecution,
  taskToMessages,
} from './router-profile-execution'
import { createRouterTranscript } from './router-transcript'
import { type RouterSeam, routerSeamKey } from './runtime-seams'
import type {
  Executor,
  ExecutorCancellation,
  ExecutorFactory,
  ExecutorResult,
  Runtime,
  Spend,
} from './types'

export const routerInlineExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<RouterSeam>(ctx, routerSeamKey, 'router/inline')
  const model = exactRouterModel(spec.profile, 'routerInlineExecutor')
  if (!seam.routerBaseUrl || !seam.routerKey) {
    throw new ValidationError('routerInlineExecutor: RouterSeam.routerBaseUrl + routerKey required')
  }
  const profileExecution = routerProfileExecution(spec.profile, seam, { multiTurn: false })
  const requestIdentity = routerRequestIdentity(ctx)

  const controller = linkAbort(ctx.signal)

  let artifact: ExecutorResult<unknown> | undefined
  // What the leaf was sent and answered, so it settles with its conversation (#1377).
  const transcript = createRouterTranscript()
  const executionId = ctx.node?.nodeId ?? `router-request-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)

  let executor!: Executor<unknown>
  executor = attestRuntimeOwnedExecutor(
    {
      runtime: 'router' as Runtime,
      async execute(task, signal): Promise<ExecutorResult<unknown>> {
        const messages = taskToMessages(task, spec, profileExecution.systemPrompt)
        transcript.observe(messages)
        const started = Date.now()
        const linked = linkAbort(signal, controller.signal).signal
        recordRuntimeOwnedProviderAttemptStart(executor)
        const r = await runRouterTransport<RouterChatResult | RouterChatToolsResult>(
          'routerInlineExecutor',
          () =>
            seam.tools
              ? (profileExecution.stream === true
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
                  seam.tools,
                  {
                    ...(profileExecution.temperature !== undefined
                      ? { temperature: profileExecution.temperature }
                      : {}),
                    ...(linked ? { signal: linked } : {}),
                    ...(profileExecution.toolChoice
                      ? { toolChoice: profileExecution.toolChoice }
                      : {}),
                    ...profileExecution.tokenLimits.applied,
                    ...(profileExecution.seed !== undefined ? { seed: profileExecution.seed } : {}),
                    ...(profileExecution.reasoningEffort
                      ? { reasoningEffort: profileExecution.reasoningEffort }
                      : {}),
                    ...(profileExecution.extraBody
                      ? { extraBody: profileExecution.extraBody }
                      : {}),
                    ...requestIdentity,
                  },
                )
              : (profileExecution.stream === true
                  ? streamRouterChatWithUsage
                  : routerChatWithUsage)(
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
                  {
                    ...(profileExecution.temperature !== undefined
                      ? { temperature: profileExecution.temperature }
                      : {}),
                    ...(linked ? { signal: linked } : {}),
                    ...profileExecution.tokenLimits.applied,
                    ...(profileExecution.seed !== undefined ? { seed: profileExecution.seed } : {}),
                    ...(profileExecution.reasoningEffort
                      ? { reasoningEffort: profileExecution.reasoningEffort }
                      : {}),
                    ...(profileExecution.extraBody
                      ? { extraBody: profileExecution.extraBody }
                      : {}),
                    ...requestIdentity,
                  },
                ),
        )
        if (r.model !== undefined) recordRuntimeOwnedProviderModel(executor, r.model)
        transcript.reply({ content: r.content, toolCalls: 'toolCalls' in r ? r.toolCalls : [] })
        const spent: Spend = {
          ...addResourceSpend(r.resources),
          iterations: 1,
          tokens: r.usage
            ? cloneTokenUsage({
                input: r.usage.input,
                output: r.usage.output,
                ...promptCacheTokenClasses(r.usage.input, r.cache),
              })
            : zeroTokenUsage(),
          usd: r.billedCostUsd ?? 0,
          ...(r.usage ? {} : { tokensKnown: false }),
          ...(r.billedCostUsd === undefined ? { usdKnown: false } : {}),
          ms: Date.now() - started,
        }
        assertObservedRouterModel(r.model, model, 'routerInlineExecutor')
        const out = {
          content: r.content ?? '',
          ...(r.model !== undefined ? { model: r.model } : {}),
          transportAttempts: r.transportAttempts,
          ...(r.costUsd !== undefined ? { estimatedCostUsd: r.costUsd } : {}),
          ...(r.cache ? { promptCache: r.cache } : {}),
          ...(r.usage?.reasoning !== undefined ? { reasoningTokens: r.usage.reasoning } : {}),
          ...('toolCalls' in r ? { toolCalls: r.toolCalls } : {}),
          ...(r.reasoning ? { reasoning: r.reasoning } : {}),
          ...(r.finishReason
            ? { finishReason: r.finishReason }
            : 'toolCalls' in r && r.toolCalls.length > 0
              ? { finishReason: 'tool_calls' }
              : {}),
        } as unknown
        artifact = { outRef: contentRef('router', { model, out }), out, spent }
        return artifact
      },
      harnessTranscript: () => transcript.capture(),
      cancel(_request): Promise<ExecutorCancellation> {
        controller.abort('executor cancelled')
        return Promise.resolve(
          localAbortCancellation(
            'the Router chat-completions API exposes no cancel operation; the local request was aborted and the provider may still bill the completion',
          ),
        )
      },
      teardown(_grace): Promise<{ destroyed: boolean }> {
        controller.abort('executor torn down')
        return Promise.resolve({ destroyed: true })
      },
      resultArtifact() {
        if (!artifact) {
          throw new ValidationError('routerInlineExecutor: resultArtifact() read before execute()')
        }
        return { ...artifact, spent: artifact.spent }
      },
    },
    {
      effectiveProfile: spec.profile,
      backend: 'router',
      model: { status: 'known', id: model },
      execution: {
        kind: 'request',
        id: executionId,
      },
      materializer: 'router-prompt-model',
      plan: {
        kind: 'openai-chat-completion',
        model,
        provider: spec.profile.model?.provider ?? null,
        temperature: profileExecution.temperature ?? null,
        tokenLimits: profileExecution.tokenLimits,
        retry: profileExecution.retry ?? null,
        seed: profileExecution.seed ?? null,
        reasoningEffort: profileExecution.reasoningEffort ?? null,
        extraBody: profileExecution.extraBody ?? null,
        tools: seam.tools ?? null,
        toolChoice: profileExecution.toolChoice ?? null,
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
      descriptor: { kind: 'router-request', transport: 'http', backend: 'router' },
    },
  )
  return executor
}
