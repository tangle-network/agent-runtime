import type { AgentEnvironmentEvent } from '@tangle-network/agent-interface/environment-provider'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { sameModelId, sandboxEventServedBackend } from '../sandbox-events'
import { createSandboxToolPartState, sandboxProgressEvents } from '../sandbox-executor-output'
import {
  recordRuntimeOwnedProviderIdentityConflict,
  recordRuntimeOwnedProviderModel,
} from '../supervise/materialization'
import { concreteProfileModel } from '../supervise/model-policy'
import { decodeBoxPart } from '../supervise/trace-source'
import type { UsageEvent } from '../supervise/types'
import {
  createProviderFailureLedger,
  createTurnEventArchive,
  isTerminalEnvironmentEvent,
  sandboxEventFromEnvironmentEvent,
  textFromEnvironmentEvent,
  usageSandboxEvent,
} from './provider-event-projection'
import type { StreamProviderExecutorArgs } from './provider-invocation'
import type { RetainedAwaitingResult } from './provider-retained-observation'
import type { ProviderUsageAccount } from './provider-usage-account'

/** Reads one turn's provider events into archive, text, failures, trace steps, progress and usage. */
export class ProviderTurnObserver {
  readonly archive = createTurnEventArchive()
  readonly failures = createProviderFailureLedger()
  text = ''
  terminal = false
  private readonly seenTraceCalls = new Set<string>()

  constructor(
    private readonly args: StreamProviderExecutorArgs,
    private readonly usage: ProviderUsageAccount,
    private readonly retained: boolean,
    private readonly turnModel: string | undefined,
  ) {}

  /** The platform's `effectiveBackend` (on `execution.started` and the terminal event) is the attempt's
   *  provider evidence; a model other than the declared one is an identity conflict (the leaf's rule). */
  private recordServedModel(sandboxEvent: SandboxEvent): void {
    const served = sandboxEventServedBackend(sandboxEvent)
    if (served?.model === undefined) return
    const declared = this.turnModel ?? concreteProfileModel(this.args.profile)
    if (declared !== undefined && !sameModelId(served.model, declared, [served.provider])) {
      recordRuntimeOwnedProviderIdentityConflict(this.args.scope.executor())
    } else recordRuntimeOwnedProviderModel(this.args.scope.executor(), served.model)
  }

  async *consume(
    events: AsyncIterable<AgentEnvironmentEvent | RetainedAwaitingResult>,
  ): AsyncGenerator<UsageEvent> {
    const toolParts = createSandboxToolPartState()
    for await (const event of events) {
      if ('awaitingResultSince' in event) {
        const since = event.awaitingResultSince
        yield { kind: 'progress', progress: { kind: 'awaiting-result', since } }
        continue
      }
      this.args.scope.mirrors.noteProviderEvent()
      this.archive.append(event)
      this.text += textFromEnvironmentEvent(event)
      const sandboxEvent = sandboxEventFromEnvironmentEvent(event)
      this.recordServedModel(sandboxEvent)
      this.recordTraceStep(sandboxEvent.data)
      this.failures.observe(event, sandboxEvent)
      // One projection for every sandbox-shaped stream: the provider event is adapted to the
      // sandbox wire the mappers already read, so live output needs no provider-specific parser.
      for (const progress of sandboxProgressEvents(sandboxEvent, toolParts)) {
        yield { kind: 'progress', progress }
      }
      const usageEvent = usageSandboxEvent(event)
      if (usageEvent) yield* this.usage.observe(usageEvent)
      yield* this.usage.observe(sandboxEvent)
      const { eventStreamComplete, usdKnown } = event.data
      if (
        this.retained &&
        event.type === 'result' &&
        eventStreamComplete === false &&
        usdKnown === false
      )
        this.usage.markCostUnknown()
      if (isTerminalEnvironmentEvent(event)) this.terminal = true
    }
  }

  private recordTraceStep(eventData: unknown): void {
    const part = (eventData as { readonly part?: unknown } | null)?.part
    const step = part === undefined ? undefined : decodeBoxPart(part, this.args.profile.harness)
    if (step === undefined || (step.callId !== undefined && this.seenTraceCalls.has(step.callId)))
      return
    if (step.callId !== undefined) this.seenTraceCalls.add(step.callId)
    this.args.trace.record(step)
  }
}
