import { randomUUID } from 'node:crypto'
import { ValidationError } from '../../errors'
import type { CodeModeToolsOptions } from '../code-mode'
import { assertRouterAutoDeclaration } from '../router-auto-evidence'
import { linkAbort } from './abortable'
import { localAbortCancellation } from './executor-local-cancellation'
import { readSeam } from './executor-seams'
import { createInbox } from './inbox'
import { attestRuntimeOwnedExecutor, newExecutionAttemptId } from './materialization'
import type { ProfileCodeModeSettings, ProfileModelExecutionSettings } from './model-policy'
import { routerRequestIdentity } from './router-executor-request'
import { exactRouterModel, routerProfileExecution } from './router-profile-execution'
import { runRouterToolLoop } from './router-tool-loop'
import { createRouterTranscript } from './router-transcript'
import { type RouterToolsSeam, routerToolsSeamKey } from './runtime-seams'
import type {
  Executor,
  ExecutorCancellation,
  ExecutorFactory,
  ExecutorResult,
  Runtime,
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
        artifact = await runRouterToolLoop(
          {
            seam,
            spec,
            model,
            profileExecution,
            codeModeConfig,
            enabledToolNames,
            maxTurns,
            requestIdentity,
            executor,
            inbox,
            transcript,
            attemptId,
            controller,
          },
          task,
          signal,
        )
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
