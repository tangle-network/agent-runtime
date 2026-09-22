import type { AgentEnvironmentEvent } from '@tangle-network/agent-interface/environment-provider'
import {
  createRuntimeStreamEventCollector,
  type RuntimeStreamEventCollector,
} from '@tangle-network/agent-runtime'
import { inProcessEnvironmentProvider, streamAgentTurn } from '@tangle-network/agent-runtime/loops'

const provider = inProcessEnvironmentProvider({
  name: 'telemetry-demo',
  onTurn: () =>
    [
      {
        type: 'message.part.updated',
        data: { part: { type: 'text' }, delta: 'Looking up the customer. ' },
      },
      {
        type: 'tool.call',
        data: {
          id: 'lookup-1',
          name: 'lookup_customer',
          input: { customerId: 'cust-42', email: 'redact-me@example.com' },
        },
      },
      {
        type: 'tool.result',
        data: {
          id: 'lookup-1',
          name: 'lookup_customer',
          output: { plan: 'enterprise', secretToken: 'sk-redact-me' },
        },
      },
      {
        type: 'done',
        data: { finalText: 'Customer found.', tokenUsage: { inputTokens: 12, outputTokens: 4 } },
      },
    ] satisfies AgentEnvironmentEvent[],
})

async function drain(label: string, collector: RuntimeStreamEventCollector): Promise<void> {
  for await (const event of streamAgentTurn(
    { kind: 'provider', provider, profile: { name: 'telemetry-demo' } },
    'Find customer cust-42',
    { preserveToolParts: true },
  )) {
    collector.onEvent(event)
  }
  console.log(`--- ${label}: summary ---`)
  console.log(collector.summary())
  console.log(`--- ${label}: events ---`)
  for (const event of collector.events) console.log(JSON.stringify(event))
}

await drain('safe defaults', createRuntimeStreamEventCollector())
await drain(
  'privileged diagnostics',
  createRuntimeStreamEventCollector({ includeTaskData: true, includeEventData: true }),
)
