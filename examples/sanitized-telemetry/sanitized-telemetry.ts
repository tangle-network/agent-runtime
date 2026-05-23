/**
 * Sanitized telemetry capture for a task run.
 *
 * Run with:
 *   pnpm tsx examples/sanitized-telemetry/sanitized-telemetry.ts
 */

import type { AgentAdapter } from '@tangle-network/agent-runtime'
import { createRuntimeEventCollector, runAgentTask } from '@tangle-network/agent-runtime'

const adapter: AgentAdapter<{ ready: boolean }, void, void> = {
  async observe() {
    return { ready: true }
  },
  async validate() {
    return [{ id: 'ok', score: 1, passed: true }]
  },
  async decide() {
    return { kind: 'finish', reason: 'demo done' }
  },
  async act() {
    return undefined
  },
}

async function main() {
  // Default-redacted collector. Inputs / user answers / control payloads
  // / evidence ids / metadata / eval details are all dropped from the
  // event stream unless you opt in.
  const safe = createRuntimeEventCollector()

  const result = await runAgentTask({
    task: {
      id: 'demo',
      intent: 'A task with sensitive inputs',
      domain: 'demo',
      // Sensitive metadata deliberately on the task. Does NOT appear in
      // the collector's `events` because `includeMetadata` defaults false.
      metadata: { customerId: 'cust-42', email: 'redact-me@example.com' },
    },
    adapter,
    onEvent: safe.onEvent,
  })

  console.log('--- safe events (default redaction) ---')
  for (const e of safe.events) {
    console.log(JSON.stringify(e))
  }

  console.log('\n--- private diagnostics (opt-in) ---')
  // Diagnostics-mode collector — same task, includes the fields a
  // privileged operator might need to triage an incident. Redaction is
  // still on for the fields the collector wasn't told to include.
  const verbose = createRuntimeEventCollector({
    includeInputs: true,
    includeMetadata: true,
    includeEvalDetails: true,
  })
  await runAgentTask({
    task: {
      id: 'demo-2',
      intent: 'Same task, verbose telemetry',
      domain: 'demo',
      metadata: { customerId: 'cust-42' },
    },
    adapter,
    onEvent: verbose.onEvent,
  })
  for (const e of verbose.events) {
    console.log(JSON.stringify(e))
  }

  console.log('\n--- final result ---')
  console.log(`status=${result.status} pass=${result.control.pass}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
