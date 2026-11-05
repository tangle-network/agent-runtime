import { defaultRedactor } from '../../redact'
import { notifyRuntimeHookEvent, type RuntimeHooks } from '../../runtime-hooks'
import type { RetainedRunAdmission } from '../retained-run-types'
import type { ExecutorContext, ExecutorNodeContext, ExecutorProgressEvent } from './types'

export const executorObservationSeamKey = 'runtime.executionObservation'
export interface ExecutorObservation {
  progress(event: ExecutorProgressEvent): void
  event(target: 'agent.model' | 'agent.tool_call', payload: Record<string, unknown>): void
}

export function executorObservation(
  ctx: Pick<ExecutorContext, 'seams'>,
): ExecutorObservation | undefined {
  return ctx.seams[executorObservationSeamKey] as ExecutorObservation | undefined
}

/** Promise and streaming executors share their owner's existing observation channel. */
export function createExecutorObservation(
  hooks: RuntimeHooks | undefined,
  node: Pick<ExecutorNodeContext, 'rootId' | 'parentId' | 'nodeId' | 'attemptId'>,
  onProgress: (event: ExecutorProgressEvent) => void,
): ExecutorObservation {
  let sequence = 0
  return {
    progress: onProgress,
    event(target, payload) {
      notifyRuntimeHookEvent(hooks, {
        id: `${node.nodeId}:${node.attemptId}:${target}:${sequence++}`,
        runId: node.rootId,
        parentId: node.nodeId,
        target,
        phase: 'after',
        timestamp: Date.now(),
        payload: defaultRedactor({ ...payload, attemptId: node.attemptId }),
      })
    },
  }
}

/** Observe completed HTTP work without copying customer payloads into trace metadata. */
export async function observeModelRequest<
  T extends {
    model?: string
    usage?: { input: number; output: number }
    billedCostUsd?: number
    content?: string | null
  },
>(
  observation: ExecutorObservation | undefined,
  model: string,
  request: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await request()
    observation?.event('agent.model', {
      model: result.model ?? model,
      startedAt,
      endedAt: Date.now(),
      status: 'ok',
      ...(result.usage && model !== 'tangle/auto'
        ? { tokensIn: result.usage.input, tokensOut: result.usage.output }
        : {}),
      ...(result.billedCostUsd === undefined || model === 'tangle/auto'
        ? {}
        : { costUsd: result.billedCostUsd }),
    })
    if (result.content) observation?.progress({ kind: 'text_delta', text: result.content })
    return result
  } catch (error) {
    observation?.event('agent.model', {
      model,
      startedAt,
      endedAt: Date.now(),
      status: 'error',
      error: { type: error instanceof Error ? error.name : 'Error' },
    })
    throw error
  }
}

/** Only a native call id can prove a tool duration; legacy results remain instant observations. */
export function createToolProgressObserver(observation: ExecutorObservation) {
  const calls = new Map<string, number>()
  return (event: ExecutorProgressEvent, at: number): void => {
    if (event.kind !== 'tool_call' && event.kind !== 'tool_result') return
    if (event.kind === 'tool_call') {
      if (event.toolCallId !== undefined && !calls.has(event.toolCallId))
        calls.set(event.toolCallId, at)
      return
    }
    const startedAt = event.toolCallId === undefined ? undefined : calls.get(event.toolCallId)
    if (event.toolCallId !== undefined) calls.delete(event.toolCallId)
    observation.event('agent.tool_call', {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      startedAt: startedAt ?? at,
      endedAt: at,
      durationKnown: startedAt !== undefined,
      status: event.status,
      ...(event.error ? { error: event.error } : {}),
    })
  }
}

/** Call only after the exact dispatched admission's journal write has acknowledged. */
export function notifyExecutionAdmitted(
  hooks: RuntimeHooks | undefined,
  runId: string,
  nodeId: string,
  admission: RetainedRunAdmission,
  now: () => number,
): void {
  if (admission.phase !== 'dispatched' || admission.controlRef.sessionId === undefined) return
  notifyRuntimeHookEvent(hooks, {
    id: `${nodeId}:admitted:${admission.controlRef.executionId}`,
    runId,
    parentId: nodeId,
    target: 'agent.execution',
    phase: 'after',
    timestamp: now(),
    payload: {
      nodeId,
      controlRef: { ...admission.controlRef },
      sessionId: admission.controlRef.sessionId,
    },
  })
}
