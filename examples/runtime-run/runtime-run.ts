/**
 * Production-run lifecycle: drive a streaming task through `runAgentTaskStream`
 * AND record a canonical `RuntimeRunRow` for cost/audit dashboards.
 *
 * This is the pattern that replaces legal-agent's bespoke
 * `completeProductionAgentRun` + `persistRuntimeRun` pair. Wire it into your
 * own DB by implementing the `RuntimeRunPersistenceAdapter` interface (one
 * `upsert(row)` method).
 *
 * Run with:
 *   pnpm tsx examples/runtime-run/runtime-run.ts
 */

import {
  type AgentBackendInput,
  type AgentTaskSpec,
  createIterableBackend,
  type RuntimeRunPersistenceAdapter,
  type RuntimeRunRow,
  runAgentTaskStream,
  startRuntimeRun,
} from '@tangle-network/agent-runtime'

const readyTask: AgentTaskSpec = {
  id: 'legal-chat:thread-42',
  intent: 'Run a legal advisory chat turn with workspace context.',
  domain: 'legal',
  metadata: { workspaceId: 'ws-1', threadId: 'thread-42' },
}

// Toy backend that yields a couple of llm_call events so the cost ledger has
// real input. Real consumers plug in `createOpenAICompatibleBackend`,
// `createSandboxPromptBackend`, or any `AgentExecutionBackend`.
const backend = createIterableBackend<AgentBackendInput>({
  kind: 'demo',
  async *stream(_input, ctx) {
    yield {
      type: 'llm_call',
      task: ctx.task,
      session: ctx.session,
      model: 'claude-sonnet-4-6',
      tokensIn: 1_200,
      tokensOut: 280,
      costUsd: 0.0042,
      latencyMs: 510,
      timestamp: new Date().toISOString(),
    }
    yield {
      type: 'text_delta',
      task: ctx.task,
      session: ctx.session,
      text: 'Reviewed the matter. No blocking issues found.',
      timestamp: new Date().toISOString(),
    }
    yield {
      type: 'llm_call',
      task: ctx.task,
      session: ctx.session,
      model: 'claude-sonnet-4-6',
      tokensIn: 600,
      tokensOut: 110,
      costUsd: 0.0019,
      latencyMs: 220,
      timestamp: new Date().toISOString(),
    }
  },
})

// In-memory adapter for demonstration. Real adapters write to D1 / postgres /
// the agent's `agentRuns` table — same `upsert(row)` shape.
const persisted: RuntimeRunRow[] = []
const adapter: RuntimeRunPersistenceAdapter = {
  upsert(row) {
    persisted.push(row)
  },
}

async function main(): Promise<void> {
  const run = startRuntimeRun({
    workspaceId: 'ws-1',
    sessionId: 'thread-42',
    agentId: 'legal-chat-runtime',
    taskSpec: readyTask,
    scenarioId: 'legal-chat:thread-42',
    adapter,
  })

  try {
    for await (const event of runAgentTaskStream({
      task: readyTask,
      backend,
      input: { message: 'Please review the latest filing.' },
    })) {
      run.observe(event)
      if (event.type === 'final') {
        const status = event.status === 'completed' ? 'completed' : 'failed'
        run.complete({
          status,
          resultSummary: status === 'completed' ? 'Reviewed' : 'Stream did not complete cleanly',
          error: status === 'failed' ? event.reason : undefined,
        })
      }
    }
  } catch (err) {
    run.complete({
      status: 'failed',
      resultSummary: 'Stream threw before final event',
      error: err instanceof Error ? err.message : String(err),
    })
  }

  await run.persist({ note: 'demo persistence metadata' })

  console.log('Cost ledger:', run.cost())
  console.log('Persisted row:', persisted[0])
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
