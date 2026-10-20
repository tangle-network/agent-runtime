import { ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import { type CoordinationTools, coordinationVerbNames } from '../../mcp/tools/coordination'
import { detachedSnapshot } from './snapshot'
import type {
  CoordinationVerbs,
  ObserveSupervisorNodeEvent,
  ResolveSupervisorTools,
  SupervisorAgentDeps,
  SupervisorNodeContext,
  SupervisorNodeContextSeed,
  SupervisorToolInvocationContext,
} from './supervisor-agent-contracts'
import type { SupervisorProfile } from './supervisor-agent-profile'
import type { Scope } from './types'

/**
 * The late binding behind `context.verbs`.
 *
 * Product tools are resolved and bound BEFORE the coordination tools exist on both arms (the
 * external arm serves them from `serveCoordinationMcp`, the router arm builds them inside
 * `driverAgent.act`). So the slot is created first, handed to the tool handlers, and filled the
 * moment the coordination descriptors are built. A verb called before the fill throws instead of
 * silently doing nothing.
 */
export interface VerbSlot {
  readonly verbs: CoordinationVerbs
  readonly descriptors: () => ReadonlyArray<Omit<McpToolDescriptor, 'handler'>>
  bind(
    tools: ReadonlyArray<McpToolDescriptor>,
    coordination: Pick<CoordinationTools, 'awaitSettlement'>,
  ): void
}

export function createVerbSlot(): VerbSlot {
  let bound: ReadonlyArray<McpToolDescriptor> | undefined
  let waits: Pick<CoordinationTools, 'awaitSettlement'> | undefined
  const verb =
    (name: string) =>
    async (args: unknown): Promise<unknown> => {
      if (bound === undefined) {
        throw new ValidationError(
          `supervisorAgent: coordination verb "${name}" was called before this manager's coordination tools were bound`,
        )
      }
      const tool = bound.find((descriptor) => descriptor.name === name)
      if (tool === undefined) {
        throw new ValidationError(
          `supervisorAgent: coordination verb "${name}" is not mounted on this manager`,
        )
      }
      return tool.handler(args)
    }
  return {
    verbs: Object.freeze({
      spawnAgent: verb('spawn_worker'),
      awaitSettlement: async (args: unknown): Promise<unknown> => {
        if (waits === undefined) {
          throw new ValidationError(
            'supervisorAgent: coordination verb "awaitSettlement" was called before this manager\'s coordination tools were bound',
          )
        }
        const ids = (args as { workerIds?: unknown } | undefined)?.workerIds
        if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && id.length > 0)) {
          throw new ValidationError('awaitSettlement: workerIds must be an array of worker ids')
        }
        return { settled: await waits.awaitSettlement(ids as string[]) }
      },
      steerAgent: verb('steer_agent'),
      observeAgent: verb('observe_agent'),
      listQuestions: verb('list_questions'),
      answerQuestion: verb('answer_question'),
      runAnalyst: verb('run_analyst'),
      readJournal: verb('read_journal'),
      defineAnalyst: verb('define_analyst'),
    }),
    descriptors(): ReadonlyArray<Omit<McpToolDescriptor, 'handler'>> {
      if (bound === undefined) {
        throw new ValidationError(
          "supervisorAgent: coordinationTools() was called before this manager's coordination tools were bound",
        )
      }
      return Object.freeze(
        bound.map(({ name, description, inputSchema }) =>
          Object.freeze({ name, description, inputSchema }),
        ),
      )
    },
    bind(tools, coordination): void {
      bound = tools
      waits = coordination
    },
  }
}

export function supervisorNodeContext(
  seed: SupervisorNodeContextSeed,
  profile: SupervisorProfile,
  task: unknown,
  scope: Scope<unknown>,
): SupervisorNodeContext {
  return detachedSnapshot(
    { ...seed, nodeId: scope.view.root, profile, task },
    'supervisorAgent trusted node context',
  )
}

export async function bindSupervisorTools(
  resolveTools: ResolveSupervisorTools,
  context: SupervisorNodeContext,
  signal: AbortSignal,
  slot: VerbSlot,
): Promise<ReadonlyArray<McpToolDescriptor>> {
  const resolved = await resolveTools(context)
  if (!Array.isArray(resolved)) {
    throw new ValidationError('supervisorAgent: resolveSupervisorTools must return an array')
  }
  // Keep the durable node snapshot free of live process objects. The invocation wrapper is frozen
  // shallowly so handlers cannot replace identity or signal, while the AbortSignal itself remains
  // live and follows the manager scope's existing root/parent cascade.
  const invocationContext: SupervisorToolInvocationContext = Object.freeze({
    ...context,
    signal,
    verbs: slot.verbs,
    coordinationTools: slot.descriptors,
  })
  const names = new Set<string>(coordinationVerbNames)
  return Object.freeze(
    resolved.map((rawTool, index) => {
      if (typeof rawTool !== 'object' || rawTool === null || Array.isArray(rawTool)) {
        throw new ValidationError(
          `supervisorAgent: resolved tool at index ${index} must be a descriptor`,
        )
      }
      const { name, description, inputSchema, handler } = rawTool
      if (typeof name !== 'string' || name.length === 0) {
        throw new ValidationError(
          `supervisorAgent: resolved tool at index ${index} needs a non-empty name`,
        )
      }
      if (names.has(name)) {
        throw new ValidationError(
          `supervisorAgent: resolved tool "${name}" collides with a coordination verb or another resolved tool`,
        )
      }
      names.add(name)
      if (typeof description !== 'string' || description.length === 0) {
        throw new ValidationError(`supervisorAgent: resolved tool "${name}" needs a description`)
      }
      if (typeof inputSchema !== 'object' || inputSchema === null || Array.isArray(inputSchema)) {
        throw new ValidationError(`supervisorAgent: resolved tool "${name}" needs an inputSchema`)
      }
      if (typeof handler !== 'function') {
        throw new ValidationError(`supervisorAgent: resolved tool "${name}" needs a handler`)
      }
      const descriptor = detachedSnapshot(
        { name, description, inputSchema },
        `supervisorAgent resolved tool ${JSON.stringify(name)}`,
      )
      return Object.freeze({
        ...descriptor,
        handler: (raw: unknown) =>
          handler(
            detachedSnapshot(raw, `supervisorAgent tool ${JSON.stringify(name)} input`),
            invocationContext,
          ),
      })
    }),
  )
}

export function bindSupervisorNodeObserver(
  context: SupervisorNodeContext | undefined,
  observeNodeEvent: ObserveSupervisorNodeEvent | undefined,
  onEvent: SupervisorAgentDeps['onEvent'],
): SupervisorAgentDeps['onEvent'] {
  if (!observeNodeEvent && !onEvent) return undefined
  return async (event, record) => {
    if (observeNodeEvent) {
      if (!context) {
        throw new ValidationError('supervisorAgent: observeNodeEvent has no trusted node context')
      }
      await observeNodeEvent(context, event, record)
    }
    await onEvent?.(event, record)
  }
}
