import type {
  AgentProfile,
  CreateSandboxOptions,
  PromptOptions,
  SandboxEvent,
  TaskOptions,
} from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import {
  extractLlmCallEvent,
  type LoopSandboxClient,
  type LoopSandboxPlacement,
  type OutputAdapter,
} from '../runtime'
import { createSandboxForSpec, describeSandboxPlacement } from '../runtime/run-loop'
import type {
  WorkflowAgentDelegate,
  WorkflowAgentOptions,
  WorkflowDelegateContext,
  WorkflowDelegateResult,
  WorkflowTokenUsage,
} from './types'

export type WorkflowSandboxAgentStream = 'prompt' | 'task'

export type WorkflowSandboxAgentProfileResolver =
  | AgentProfile
  | ((prompt: string, options: WorkflowAgentOptions, ctx: WorkflowDelegateContext) => AgentProfile)

export type WorkflowSandboxPromptOptionsResolver<TOptions extends PromptOptions> =
  | TOptions
  | ((prompt: string, options: WorkflowAgentOptions, ctx: WorkflowDelegateContext) => TOptions)

export interface WorkflowSandboxAgentTrace<TOutput = unknown> {
  prompt: string
  options: WorkflowAgentOptions
  ctx: WorkflowDelegateContext
  profile: AgentProfile
  output: TOutput
  events: SandboxEvent[]
  stream: WorkflowSandboxAgentStream
  placement: LoopSandboxPlacement
  costUsd: number
  tokenUsage: WorkflowTokenUsage
}

export interface CreateSandboxWorkflowAgentDelegateOptions<TOutput = unknown> {
  client: LoopSandboxClient
  profile: WorkflowSandboxAgentProfileResolver
  output?: OutputAdapter<TOutput>
  stream?: WorkflowSandboxAgentStream
  sandboxOverrides?: Partial<Omit<CreateSandboxOptions, 'backend'>> & {
    backend?: Omit<NonNullable<CreateSandboxOptions['backend']>, 'profile'>
  }
  promptOptions?: WorkflowSandboxPromptOptionsResolver<PromptOptions>
  taskOptions?: WorkflowSandboxPromptOptionsResolver<TaskOptions>
  deleteAfter?: boolean
  includeEventsInTrace?: boolean
  toTrace?: (trace: WorkflowSandboxAgentTrace<TOutput>) => unknown
}

export interface WorkflowSandboxAgentDefaultTrace {
  stream: WorkflowSandboxAgentStream
  placement: LoopSandboxPlacement['kind']
  sandboxId?: string
  fleetId?: string
  machineId?: string
  profileName?: string
  eventCount: number
  eventTypes: string[]
  events?: SandboxEvent[]
}

export function createSandboxWorkflowAgentDelegate<TOutput = unknown>(
  options: CreateSandboxWorkflowAgentDelegateOptions<TOutput>,
): WorkflowAgentDelegate {
  return async (prompt, agentOptions, ctx): Promise<WorkflowDelegateResult> => {
    if (!options.client || typeof options.client.create !== 'function') {
      throw new ValidationError('workflow sandbox agent: client.create is required')
    }
    const profile = resolveProfile(options.profile, prompt, agentOptions, ctx)
    const agentRunName = agentOptions.label ?? profile.name ?? 'workflow-agent'
    const box = await createSandboxForSpec(
      options.client,
      {
        profile,
        name: agentRunName,
        taskToPrompt: (value: string) => value,
        sandboxOverrides: options.sandboxOverrides,
      },
      ctx.signal,
    )
    const placement = describeSandboxPlacement(options.client, box)
    const stream = options.stream ?? 'prompt'
    const events: SandboxEvent[] = []
    const tokenUsage: WorkflowTokenUsage = { input: 0, output: 0 }
    let costUsd = 0

    try {
      const source =
        stream === 'task'
          ? box.streamTask(prompt, {
              ...resolveStreamOptions(options.taskOptions, prompt, agentOptions, ctx),
              signal: ctx.signal,
            })
          : box.streamPrompt(prompt, {
              ...resolveStreamOptions(options.promptOptions, prompt, agentOptions, ctx),
              signal: ctx.signal,
            })

      for await (const event of source) {
        events.push(event)
        const llmCall = extractLlmCallEvent(event, agentRunName)
        if (!llmCall) continue
        costUsd += llmCall.costUsd ?? 0
        tokenUsage.input += llmCall.tokensIn ?? 0
        tokenUsage.output += llmCall.tokensOut ?? 0
      }

      const output = options.output
        ? options.output.parse(events)
        : (parseSandboxAgentDefaultOutput(events) as TOutput)
      const trace = {
        prompt,
        options: agentOptions,
        ctx,
        profile,
        output,
        events,
        stream,
        placement,
        costUsd,
        tokenUsage,
      } satisfies WorkflowSandboxAgentTrace<TOutput>
      return {
        output,
        costUsd,
        tokenUsage,
        trace: options.toTrace ? options.toTrace(trace) : defaultTrace(trace, options),
      }
    } finally {
      if (options.deleteAfter) await box.delete()
    }
  }
}

export function parseSandboxAgentDefaultOutput(events: SandboxEvent[]): unknown {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    const data = asRecord(event?.data)
    const text = firstString(data, ['finalText', 'response', 'text', 'output', 'content'])
    if (text !== undefined) return text
    if ('result' in data) return data.result
  }
  throw new ValidationError(
    'workflow sandbox agent emitted no parseable terminal output; pass an output adapter',
  )
}

function resolveProfile(
  resolver: WorkflowSandboxAgentProfileResolver,
  prompt: string,
  options: WorkflowAgentOptions,
  ctx: WorkflowDelegateContext,
): AgentProfile {
  return typeof resolver === 'function' ? resolver(prompt, options, ctx) : resolver
}

function resolveStreamOptions<TOptions extends PromptOptions>(
  resolver: WorkflowSandboxPromptOptionsResolver<TOptions> | undefined,
  prompt: string,
  options: WorkflowAgentOptions,
  ctx: WorkflowDelegateContext,
): TOptions | undefined {
  return typeof resolver === 'function' ? resolver(prompt, options, ctx) : resolver
}

function defaultTrace<TOutput>(
  trace: WorkflowSandboxAgentTrace<TOutput>,
  options: CreateSandboxWorkflowAgentDelegateOptions<TOutput>,
): WorkflowSandboxAgentDefaultTrace {
  return {
    stream: trace.stream,
    placement: trace.placement.kind,
    sandboxId: trace.placement.sandboxId,
    fleetId: trace.placement.fleetId,
    machineId: trace.placement.machineId,
    profileName: trace.profile.name,
    eventCount: trace.events.length,
    eventTypes: trace.events.map((event) => String(event.type ?? '')),
    ...(options.includeEventsInTrace ? { events: trace.events } : {}),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function firstString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string') return value
  }
  return undefined
}
