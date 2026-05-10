/**
 * Sanitized telemetry capture for a streaming task run.
 *
 * Mirror of `examples/sanitized-telemetry/` but for `runAgentTaskStream`:
 * - feeds each yielded `RuntimeStreamEvent` through
 *   `createRuntimeStreamEventCollector` so sensitive payloads / metadata /
 *   uris are dropped by default
 * - shows the opt-in path for privileged diagnostics via
 *   `RuntimeTelemetryOptions` flags
 * - prints the streaming summary at the end
 *
 * Note on `task.intent`: this is fixed metadata that flows through
 * sanitized telemetry by default. NEVER set it to user input — use a
 * fixed string describing the operation kind. User input belongs in
 * `inputs` (redacted by default).
 *
 * Run with:
 *   pnpm tsx examples/sanitized-telemetry-streaming/sanitized-telemetry-streaming.ts
 */

import {
  createIterableBackend,
  createRuntimeStreamEventCollector,
  runAgentTaskStream,
  type AgentBackendInput,
  type RuntimeStreamEvent,
} from '@tangle-network/agent-runtime'

// A synthetic backend that yields a small streaming script. In a real
// product this would be your sandbox, OpenAI-compatible router, or
// CLI bridge — the redaction story is identical.
const backend = createIterableBackend<AgentBackendInput>({
  kind: 'demo-stream',
  async * stream(_input, ctx) {
    yield {
      type: 'text_delta',
      task: ctx.task,
      session: ctx.session,
      text: 'thinking about your account...\n',
      timestamp: new Date().toISOString(),
    }
    yield {
      type: 'tool_call',
      task: ctx.task,
      session: ctx.session,
      toolName: 'lookup_customer',
      // Sensitive! Defaults strip this.
      args: { customerId: 'cust-42', email: 'redact-me@example.com' },
      timestamp: new Date().toISOString(),
    }
    yield {
      type: 'tool_result',
      task: ctx.task,
      session: ctx.session,
      toolName: 'lookup_customer',
      // Sensitive! Defaults strip this.
      result: { plan: 'enterprise', secretToken: 'sk-leak-me' },
      timestamp: new Date().toISOString(),
    }
    yield {
      type: 'artifact',
      task: ctx.task,
      session: ctx.session,
      artifactId: 'art-1',
      name: 'report.json',
      mimeType: 'application/json',
      // Sensitive uri / metadata. Defaults strip these.
      uri: 's3://internal-bucket/cust-42/report.json',
      metadata: { customerId: 'cust-42' },
      timestamp: new Date().toISOString(),
    }
    yield {
      type: 'text_delta',
      task: ctx.task,
      session: ctx.session,
      text: 'done.\n',
      timestamp: new Date().toISOString(),
    }
  },
})

async function main() {
  // ── 1. Safe collector. Default redaction.
  const safe = createRuntimeStreamEventCollector()
  for await (const event of runAgentTaskStream({
    task: {
      id: 'demo-stream',
      // Fixed operation kind — NOT user-provided. Safe to expose in
      // sanitized telemetry. Never put PII or user input here.
      intent: 'Look up a customer record',
      domain: 'demo',
      inputs: { customerId: 'cust-42' },
      metadata: { tenantId: 'tenant-7' },
    },
    backend,
    input: { message: 'find the customer' } as Partial<AgentBackendInput>,
  })) {
    safe.onEvent(event as RuntimeStreamEvent)
  }

  console.log('--- safe stream events (default redaction) ---')
  for (const e of safe.events) console.log(JSON.stringify(e))
  console.log('\n--- safe summary ---')
  console.log(safe.summary())

  // ── 2. Verbose collector. Same task, opt-in fields for a privileged
  // operator triaging an incident. Stream events that the collector
  // wasn't told to include are still redacted.
  const verbose = createRuntimeStreamEventCollector({
    includeInputs: true,
    includeMetadata: true,
    includeControlPayloads: true,
    includeEvidenceIds: true,
  })
  for await (const event of runAgentTaskStream({
    task: {
      id: 'demo-stream-2',
      intent: 'Look up a customer record',
      domain: 'demo',
      inputs: { customerId: 'cust-42' },
      metadata: { tenantId: 'tenant-7' },
    },
    backend,
    input: { message: 'find the customer' } as Partial<AgentBackendInput>,
  })) {
    verbose.onEvent(event as RuntimeStreamEvent)
  }
  console.log('\n--- verbose stream events (opt-in fields) ---')
  for (const e of verbose.events) console.log(JSON.stringify(e))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
