import type { AgentEnvironmentEvent } from '@tangle-network/agent-interface/environment-provider'
import { createSandboxToolPartState, sandboxProgressEvents } from '../sandbox-executor-output'
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
  ) {}

  async *consume(
    events: AsyncIterable<AgentEnvironmentEvent | RetainedAwaitingResult>,
  ): AsyncGenerator<UsageEvent> {
    const toolParts = createSandboxToolPartState()
    for await (const event of events) {
      if ('awaitingResultSince' in event) {
        yield {
          kind: 'progress',
          progress: { kind: 'awaiting-result', since: event.awaitingResultSince },
        }
        continue
      }
      this.args.noteProviderEvent()
      this.archive.append(event)
      this.text += textFromEnvironmentEvent(event)
      const sandboxEvent = sandboxEventFromEnvironmentEvent(event)
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
      if (
        this.retained &&
        event.type === 'result' &&
        event.data.eventStreamComplete === false &&
        event.data.usdKnown === false
      ) {
        this.usage.markCostUnknown()
      }
      if (isTerminalEnvironmentEvent(event)) this.terminal = true
    }
  }

  private recordTraceStep(eventData: unknown): void {
    const part =
      eventData !== null && typeof eventData === 'object'
        ? (eventData as { readonly part?: unknown }).part
        : undefined
    if (part === undefined) return
    const step = decodeBoxPart(part, this.args.profile.harness)
    if (
      step !== undefined &&
      (step.callId === undefined || !this.seenTraceCalls.has(step.callId))
    ) {
      if (step.callId !== undefined) this.seenTraceCalls.add(step.callId)
      this.args.trace.record(step)
    }
  }
}
