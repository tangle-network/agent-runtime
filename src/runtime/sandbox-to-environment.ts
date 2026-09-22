import {
  type AgentRunControlRef,
  AgentRunControlRefSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentStatus,
  AgentSession,
  AgentSessionRef,
  AgentSessionStatus,
  AgentTurnInput,
  AgentTurnResult,
  CheckpointRef,
  CheckpointRequest,
  ExecRequest,
  ExecResult,
  ForkRequest,
  PlacementInfo,
} from '@tangle-network/agent-interface/environment-provider'
import type { SandboxInstance } from '@tangle-network/sandbox'
import {
  assertSandboxInputSupported,
  assertSandboxReplaySupported,
  ValidationError,
} from './environment-provider-adapters'
import {
  agentTurnResultFromPromptResult,
  environmentEventFromSandboxEvent,
  execResultFromSandboxExecResult,
  promptFromTurnInputForSandbox,
  sandboxControlRefKey,
  sessionRefFromSandboxDispatch,
} from './environment-provider-events'
import { promptFromTurnInput, promptOptionsFromTurnInput } from './environment-provider-input'
import {
  destroyBox,
  hasDispatchPrompt,
  hasExec,
  hasRead,
  hasSession,
  hasWrite,
  maybeRefresh,
  placementInfoFromLoopPlacement,
  readBoxStatus,
  sessionStatusFromUnknown,
  statusFromUnknown,
  type SandboxSessionLike,
} from './environment-provider-support'
import { abortableAsyncIterable, awaitAbortable } from './turn-timeout'
import type { SandboxClient } from './types'

export function sandboxInstanceAsEnvironment(
  box: SandboxInstance,
  providerName: string,
  client: SandboxClient,
  knownControlRefs: Map<string, AgentRunControlRef>,
  requireExactControlRef: boolean,
): AgentEnvironment {
  const environment: AgentEnvironment = {
    id: String(box.id),
    provider: providerName,
    ...(typeof box.name === 'string' ? { name: box.name } : {}),
    async status(): Promise<AgentEnvironmentStatus> {
      await maybeRefresh(box)
      return statusFromUnknown(readBoxStatus(box))
    },
    async *stream(input: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent> {
      assertSandboxInputSupported(input)
      const stream = box.streamPrompt(
        promptFromTurnInputForSandbox(input),
        promptOptionsFromTurnInput(input),
      )
      const events = input.signal ? abortableAsyncIterable(stream, input.signal) : stream
      for await (const event of events) {
        yield environmentEventFromSandboxEvent(event)
      }
    },
    ...(hasDispatchPrompt(box)
      ? {
          async dispatch(input: AgentTurnInput): Promise<AgentSessionRef> {
            assertSandboxInputSupported(input, { allowDispatchDetach: true })
            const dispatched = await box.dispatchPrompt(
              promptFromTurnInput(input),
              promptOptionsFromTurnInput(input),
            )
            const reference = sessionRefFromSandboxDispatch(
              dispatched,
              providerName,
              String(box.id),
              input,
              requireExactControlRef,
            )
            if (reference.controlRef) {
              knownControlRefs.set(
                sandboxControlRefKey(String(box.id), reference.id),
                reference.controlRef,
              )
            }
            return reference
          },
        }
      : {}),
    ...(hasSession(box)
      ? {
          session(id: string, options?: { controlRef?: AgentRunControlRef }): AgentSession {
            const controlRef = options?.controlRef
            if (requireExactControlRef && !controlRef) {
              throw new ValidationError(
                'sandbox session reconstruction requires the exact provider-owned control reference',
              )
            }
            if (controlRef) {
              const exact = AgentRunControlRefSchema.parse(controlRef)
              if (
                exact.provider !== providerName ||
                exact.environmentId !== String(box.id) ||
                exact.sessionId !== id
              ) {
                throw new ValidationError(
                  'sandbox session control reference does not match the requested session',
                )
              }
              const owned = knownControlRefs.get(sandboxControlRefKey(String(box.id), id))
              if (!owned || canonicalCandidateDigest(owned) !== canonicalCandidateDigest(exact)) {
                throw new ValidationError(
                  'sandbox session control reference was not returned by this provider',
                )
              }
            }
            return sandboxSessionAsAgentSession(box.session(id), controlRef)
          },
        }
      : {}),
    ...(hasRead(box) ? { read: box.read.bind(box) } : {}),
    ...(hasWrite(box) ? { write: box.write.bind(box) } : {}),
    ...(hasExec(box)
      ? {
          async exec(command: string, options?: ExecRequest): Promise<ExecResult> {
            return execResultFromSandboxExecResult(await box.exec(command, options as never))
          },
        }
      : {}),
    async checkpoint(options?: CheckpointRequest): Promise<CheckpointRef> {
      const result = await box.snapshot({ ...(options?.name ? { tags: [options.name] } : {}) })
      return {
        id: result.snapshotId,
        provider: providerName,
        ...(options?.metadata ? { metadata: options.metadata } : {}),
      }
    },
    async fork(checkpoint: CheckpointRef, options?: ForkRequest): Promise<AgentEnvironment> {
      const forked = await client.create({
        fromSnapshot: checkpoint.id,
        fromSandboxId: String(box.id),
        ...(options?.name ? { name: options.name } : {}),
        ...(options?.metadata ? { metadata: options.metadata } : {}),
      })
      return sandboxInstanceAsEnvironment(
        forked,
        providerName,
        client,
        knownControlRefs,
        requireExactControlRef,
      )
    },
    async placement(): Promise<PlacementInfo> {
      return placementInfoFromLoopPlacement(client.describePlacement?.(box), box)
    },
    async refresh(): Promise<void> {
      await maybeRefresh(box)
    },
    async destroy(): Promise<void> {
      await destroyBox(box)
    },
  }
  return environment
}

function sandboxSessionAsAgentSession(
  session: SandboxSessionLike,
  controlRef?: AgentRunControlRef,
): AgentSession {
  return {
    id: session.id,
    ...(controlRef ? { controlRef: Object.freeze({ ...controlRef }) } : {}),
    async status(): Promise<AgentSessionStatus | null> {
      const status = await session.status()
      return status ? sessionStatusFromUnknown((status as { status?: unknown }).status) : null
    },
    async *events(options): AsyncIterable<AgentEnvironmentEvent> {
      assertSandboxReplaySupported(options?.since)
      const stream = session.events(options)
      const events = options?.signal ? abortableAsyncIterable(stream, options.signal) : stream
      for await (const event of events) yield environmentEventFromSandboxEvent(event)
    },
    async result(): Promise<AgentTurnResult> {
      return agentTurnResultFromPromptResult(
        await session.result(
          controlRef?.executionId === undefined
            ? undefined
            : { executionId: controlRef.executionId },
        ),
      )
    },
    async prompt(input: AgentTurnInput): Promise<AgentTurnResult> {
      assertSandboxInputSupported(input)
      const prompt = session.prompt(promptFromTurnInput(input), promptOptionsFromTurnInput(input))
      const result = input.signal ? await awaitAbortable(prompt, input.signal) : await prompt
      return agentTurnResultFromPromptResult(result)
    },
    cancel(): Promise<void> {
      return session
        .interrupt(
          controlRef?.executionId === undefined
            ? undefined
            : { executionId: controlRef.executionId },
        )
        .then(() => undefined)
    },
  }
}
