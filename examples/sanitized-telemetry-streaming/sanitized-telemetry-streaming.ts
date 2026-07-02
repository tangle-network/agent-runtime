/**
 * Sanitized telemetry capture for a streaming task run.
 *
 * Streaming counterpart of `createRuntimeEventCollector` (the non-streaming
 * `runAgentTask` collector — same options, different event shape):
 * - feeds each yielded `RuntimeStreamEvent` through
 *   `createRuntimeStreamEventCollector` so sensitive payloads / metadata /
 *   uris are dropped by default
 * - shows the opt-in path for privileged diagnostics via
 *   `RuntimeTelemetryOptions` flags
 * - prints each run's summary first, then its sanitized event wall
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
  type AgentBackendInput,
  type AgentTaskSpec,
  createIterableBackend,
  createRuntimeStreamEventCollector,
  type RuntimeStreamEvent,
  type RuntimeStreamEventCollector,
  runAgentTaskStream,
} from '@tangle-network/agent-runtime'

// A synthetic backend that yields a small streaming script. In a real
// product this would be your sandbox, OpenAI-compatible router, or
// CLI bridge — the redaction story is identical.
const backend = createIterableBackend<AgentBackendInput>({
  kind: 'demo-stream',
  async *stream(_input, ctx) {
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

// One task spec, one drain — the ONLY thing that changes between the two runs below is which
// collector the events flow through. `intent` is fixed operation metadata (safe to expose);
// `inputs` / `metadata` carry the PII the collector redacts by default.
const task: AgentTaskSpec = {
  id: 'demo-stream',
  // Fixed operation kind — NOT user-provided. Safe to expose in sanitized telemetry.
  // Never put PII or user input here.
  intent: 'Look up a customer record',
  domain: 'demo',
  inputs: { customerId: 'cust-42' },
  metadata: { tenantId: 'tenant-7' },
}

async function drain(label: string, collector: RuntimeStreamEventCollector): Promise<void> {
  for await (const event of runAgentTaskStream({
    task,
    backend,
    input: { message: 'find the customer' } as Partial<AgentBackendInput>,
  })) {
    collector.onEvent(event as RuntimeStreamEvent)
  }
  console.log(`--- ${label}: summary ---`)
  console.log(collector.summary())
  console.log(`--- ${label}: sanitized events ---`)
  for (const e of collector.events) console.log(JSON.stringify(e))
}

async function main() {
  // ── 1. Default redaction: PII inputs/metadata, tool args/results, and artifact
  // uris are all stripped — the safe-by-default state any telemetry sink gets.
  const safe = createRuntimeStreamEventCollector()
  await drain('safe (default redaction)', safe)

  // ── 2. Opt-in verbose: a privileged operator triaging an incident turns on the
  // exact fields they need; everything they did NOT opt into stays redacted.
  const verbose = createRuntimeStreamEventCollector({
    includeInputs: true,
    includeMetadata: true,
    includeControlPayloads: true,
    includeEvidenceIds: true,
  })
  console.log()
  await drain('verbose (opt-in fields)', verbose)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
