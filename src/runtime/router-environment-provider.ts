import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { ConfigError } from '../errors'
import { inlineEnvironmentProvider } from './inline-environment-provider'
import { type RouterToolsSeam, routerToolsInlineExecutor, type ToolSpec } from './supervise/runtime'

export interface RouterEnvironmentProviderOptions {
  routerBaseUrl: string
  routerKey: string
  model: string
  name?: string
  tools?: ReadonlyArray<ToolSpec>
  executeToolCall?: RouterToolsSeam['executeToolCall']
  onToolStep?: RouterToolsSeam['onToolStep']
  maxTurns?: number
}

/** Run profiles through an OpenAI-compatible router on the current process. */
export function routerEnvironmentProvider(
  options: RouterEnvironmentProviderOptions,
): AgentEnvironmentProvider {
  const tools = options.tools ?? []
  if (tools.length > 0 && !options.executeToolCall) {
    throw new ConfigError('routerEnvironmentProvider: tools require executeToolCall')
  }
  const execution: RouterToolsSeam = {
    routerBaseUrl: options.routerBaseUrl,
    routerKey: options.routerKey,
    model: options.model,
    tools,
    executeToolCall:
      options.executeToolCall ??
      (() => Promise.reject(new ConfigError('routerEnvironmentProvider: no tools configured'))),
    ...(options.onToolStep ? { onToolStep: options.onToolStep } : {}),
    ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
  }
  return inlineEnvironmentProvider(
    (spec, context) =>
      routerToolsInlineExecutor(spec, {
        ...context,
        seams: { ...context.seams, 'router-tools': execution },
      }),
    { name: options.name ?? 'router' },
  )
}
