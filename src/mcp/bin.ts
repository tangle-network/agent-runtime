#!/usr/bin/env node

/**
 *
 * `agent-runtime-mcp` — stdio MCP server entry point.
 *
 * Serves the ONE generic `delegate` verb (opt-in via `MCP_ENABLE_DELEGATE=1`): one intent → a
 * supervisor that authors and drives its own worker over `supervise()`, returning the delivered output
 * with its cost. The supervisor brain runs on the router; authored workers run through the
 * Tangle environment provider configured by `TANGLE_API_KEY`. The queue-bound tools
 * (`delegate_feedback`, `delegation_status`, `delegation_history`) are always served.
 *
 * Environment variables:
 *   TANGLE_API_KEY                   required when delegation is enabled
 *   SANDBOX_BASE_URL                 optional — sandbox-SDK base URL override
 *   MCP_ENABLE_DELEGATE              set to `1` to serve the generic `delegate` verb. Its authoring
 *                                    supervisor runs the brain on the router and spawns authored
 *                                    workers through the Tangle provider; needs TANGLE_API_KEY.
 *   MCP_SUPERVISOR_MODEL             supervisor brain model id (falls back to MCP_WORKER_MODEL, then
 *                                    WORKER_MODEL, then a default). Must be a tool-calling model.
 *   MCP_SUPERVISOR_ROUTER_KEY        router key for the supervisor brain (defaults to TANGLE_API_KEY)
 *   MCP_SUPERVISOR_ROUTER_BASE_URL   router base for the supervisor brain (defaults to the repo's
 *                                    resolveRouterBaseUrl, normalized to `/v1`)
 *   MCP_DELEGATE_WORKER_HARNESS      harness the authored workers run on (default `opencode`)
 *   AGENT_RUNTIME_DELEGATION_STATE_FILE
 *                                    optional — absolute path of a JSON state
 *                                    file. When set, delegation records persist
 *                                    across MCP restarts (FileDelegationStore):
 *                                    status/history survive and idempotency keys
 *                                    dedupe across processes.
 *   AGENT_RUNTIME_DELEGATION_STATE_RECOVER
 *                                    set to `1` to archive a corrupt state file
 *                                    (`<file>.corrupt-<ts>`) and start empty
 *                                    instead of refusing to boot.
 *   AGENT_RUNTIME_DELEGATION_RETAIN_TERMINAL
 *                                    optional — positive integer cap on retained
 *                                    terminal records. Unset = keep forever.
 *
 * @experimental
 */

import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { delegateEnabled, resolveDelegateSupervisor } from './delegate-supervisor-provisioning'
import { FileDelegationStore } from './delegation-store'
import { createMcpServer } from './server'
import { DelegationTaskQueue } from './task-queue'
import { readTraceContextFromEnv, type TraceContext } from './trace-propagation'

const DEFAULT_SANDBOX_BASE_URL = 'https://sandbox.tangle.tools'

async function main(): Promise<void> {
  const wantDelegate = delegateEnabled(process.env)

  // Delegation needs a provider for authored workers. Without delegation,
  // the server exposes only feedback, status, and history.
  let environmentProvider: AgentEnvironmentProvider | undefined
  if (wantDelegate) {
    const apiKey = process.env.TANGLE_API_KEY
    if (!apiKey) {
      process.stderr.write(
        'agent-runtime-mcp: TANGLE_API_KEY is required to serve `delegate`; unset MCP_ENABLE_DELEGATE to run the queue-only tools.\n',
      )
      process.exit(2)
    }
    environmentProvider = createTangleProvider({
      client: await loadTangleClient(apiKey),
    })
  }

  // The supervisor's loop trace exports to the OTLP or Tangle Intelligence sink when
  // OTEL_EXPORTER_OTLP_ENDPOINT is set (+ TRACE_ID / PARENT_SPAN_ID for correlation). The same
  // context is stamped onto every delegation record so journal consumers join records into the
  // caller's trace.
  const traceContext = readTraceContextFromEnv()
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    process.stderr.write(
      `agent-runtime-mcp: exporting loop topology → ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}\n`,
    )
  }

  // The generic `delegate` verb is opt-in. Its supervisor runs on the router
  // and starts workers through the same provider.
  const delegateSupervisor =
    wantDelegate && environmentProvider ? resolveDelegateSupervisor(environmentProvider) : undefined
  if (wantDelegate && delegateSupervisor) {
    process.stderr.write('agent-runtime-mcp: delegate enabled — generic authoring supervisor\n')
  }

  const durableQueue = await buildDurableQueueFromEnv(traceContext)
  const server = createMcpServer({
    ...(delegateSupervisor ? { delegateSupervisor } : {}),
    traceContext,
    ...(durableQueue ? { queue: durableQueue } : {}),
  })

  const shutdown = () => {
    server.stop()
    // Drain journal writes so the state file reflects the final record
    // states before the process exits. A persist failure already routed
    // through onPersistError; swallow the duplicate rejection here.
    if (durableQueue) {
      void durableQueue
        .flush()
        .catch(() => {})
        .finally(() => process.exit(0))
      return
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await server.serve()
}

async function buildDurableQueueFromEnv(
  traceContext: TraceContext,
): Promise<DelegationTaskQueue | undefined> {
  const stateFile = process.env.AGENT_RUNTIME_DELEGATION_STATE_FILE?.trim()
  if (!stateFile) return undefined
  const store = new FileDelegationStore({
    filePath: stateFile,
    recoverCorrupt: process.env.AGENT_RUNTIME_DELEGATION_STATE_RECOVER === '1',
  })
  const maxTerminalRecords = parseRetention(process.env.AGENT_RUNTIME_DELEGATION_RETAIN_TERMINAL)
  const queue = await DelegationTaskQueue.restore({
    store,
    traceContext,
    ...(maxTerminalRecords !== undefined ? { maxTerminalRecords } : {}),
    onPersistError: (error) => {
      // Durable mode that can no longer write is a broken contract: crash
      // loud instead of degrading to memory-only behind the caller's back.
      process.stderr.write(`agent-runtime-mcp: ${error.message}\n`)
      process.exit(1)
    },
  })
  process.stderr.write(`agent-runtime-mcp: durable delegation state → ${stateFile}\n`)
  return queue
}

function parseRetention(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    process.stderr.write(
      `agent-runtime-mcp: AGENT_RUNTIME_DELEGATION_RETAIN_TERMINAL must be a positive integer, got "${raw}"\n`,
    )
    process.exit(2)
  }
  return n
}

async function loadTangleClient(apiKey: string) {
  // Dynamic import keeps the bin importable in environments that haven't
  // installed `@tangle-network/sandbox` yet (the runtime package lists it
  // as a peer dep, not a hard dep).
  const mod = await import('@tangle-network/sandbox').catch((err) => {
    process.stderr.write(
      `agent-runtime-mcp: failed to load @tangle-network/sandbox (${err.message}); install the peer dependency\n`,
    )
    process.exit(2)
  })
  // @tangle-network/sandbox ≥0.6 makes baseUrl required; default it so the MCP server
  // starts without forcing every caller to set SANDBOX_BASE_URL. Treat empty/whitespace as
  // unset (|| not ??) so `SANDBOX_BASE_URL=` still resolves to the default.
  const baseUrl = process.env.SANDBOX_BASE_URL?.trim() || DEFAULT_SANDBOX_BASE_URL
  return new mod.Sandbox({ apiKey, baseUrl })
}

main().catch((err) => {
  process.stderr.write(`agent-runtime-mcp: ${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
