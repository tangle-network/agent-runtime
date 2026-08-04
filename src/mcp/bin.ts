#!/usr/bin/env node

/**
 *
 * `agent-runtime-mcp` — stdio MCP server entry point.
 *
 * Serves the ONE generic `delegate` verb (opt-in via `MCP_ENABLE_DELEGATE=1`): one intent → a
 * supervisor that authors + drives its own worker over `supervise()`, returning the delivered output
 * with its cost. The supervisor brain runs on the router; authored workers run as sub-sandboxes
 * through the same `SandboxClient` the bin loads from `TANGLE_API_KEY`. The queue-bound tools
 * (`delegate_feedback`, `delegation_status`, `delegation_history`) are always served.
 *
 * Environment variables:
 *   TANGLE_API_KEY                   required — passed to `new Sandbox({ apiKey })`
 *   SANDBOX_BASE_URL                 optional — sandbox-SDK base URL override
 *   MCP_ENABLE_DELEGATE              set to `1` to serve the generic `delegate` verb. Its authoring
 *                                    supervisor runs the brain on the router and spawns authored
 *                                    workers as sub-sandboxes via the same client; needs TANGLE_API_KEY.
 *   MCP_SUPERVISOR_MODEL             supervisor brain model id (falls back to MCP_WORKER_MODEL, then
 *                                    WORKER_MODEL, then TANGLE_ROUTER_MODEL). Must be a tool-calling
 *                                    model the router serves; with none named the bin exits 2.
 *   MCP_SUPERVISOR_ROUTER_KEY        router key for the supervisor brain (falls back to the box's
 *                                    inference credential TANGLE_INFERENCE_KEY, then its vendor
 *                                    spelling OPENAI_API_KEY, then TANGLE_API_KEY — which
 *                                    authenticates the sandbox API, not the router)
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

import type { SandboxClient } from '../runtime'
import { delegateEnabled, resolveDelegateSupervisor } from './delegate-supervisor-provisioning'
import { FileDelegationStore } from './delegation-store'
import { createMcpServer } from './server'
import { DelegationTaskQueue } from './task-queue'
import type { DelegateHandlerOptions } from './tools/delegate'
import { readTraceContextFromEnv, type TraceContext } from './trace-propagation'

const DEFAULT_SANDBOX_BASE_URL = 'https://sandbox.tangle.tools'

async function main(): Promise<void> {
  const wantDelegate = delegateEnabled(process.env)

  // The generic `delegate` verb needs the sandbox client: its authored workers run as sub-sandboxes
  // (the `sandbox` backend). When `delegate` is not opted in, the server runs the queue-only subset
  // (feedback + status + history) with no sandbox.
  let sandboxClient: SandboxClient | undefined
  if (wantDelegate) {
    const apiKey = process.env.TANGLE_API_KEY
    if (!apiKey && !process.env.AGENT_RUNTIME_MCP_ALLOW_NO_KEY) {
      process.stderr.write(
        'agent-runtime-mcp: TANGLE_API_KEY is required to serve `delegate`. Set AGENT_RUNTIME_MCP_ALLOW_NO_KEY=1 to run without it for diagnostics, or unset MCP_ENABLE_DELEGATE to run the queue-only subset.\n',
      )
      process.exit(2)
    }
    sandboxClient = await loadSandboxClient(apiKey)
  }

  // The supervisor's loop topology spans export to the OTLP / Tangle Intelligence sink when
  // OTEL_EXPORTER_OTLP_ENDPOINT is set (+ TRACE_ID / PARENT_SPAN_ID for correlation). The same
  // context is stamped onto every delegation record so journal consumers join records into the
  // caller's trace.
  const traceContext = readTraceContextFromEnv()
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    process.stderr.write(
      `agent-runtime-mcp: exporting loop topology → ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}\n`,
    )
  }

  // The ONE generic `delegate` verb — opt-in via MCP_ENABLE_DELEGATE=1. Its authoring supervisor
  // runs the brain on the router and spawns authored workers as sub-sandboxes through the SAME
  // client, so it needs the loaded `sandboxClient`. Gated on the client resolving (no key → no
  // delegate, fail-closed).
  let delegateSupervisor: DelegateHandlerOptions | undefined
  if (wantDelegate && sandboxClient) {
    try {
      delegateSupervisor = resolveDelegateSupervisor(sandboxClient)
    } catch (error) {
      // Refuse to serve a verb that cannot work. Advertising `delegate` on an
      // unresolvable substrate spends an agent's turn on a tool whose first
      // inference is guaranteed to reject.
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(2)
    }
  }
  if (delegateSupervisor) {
    process.stderr.write(
      `agent-runtime-mcp: delegate enabled — generic authoring supervisor on ${delegateSupervisor.supervisorProfile.model?.default}\n`,
    )
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

async function loadSandboxClient(apiKey: string | undefined): Promise<SandboxClient> {
  // Diagnostic mode: AGENT_RUNTIME_MCP_ALLOW_NO_KEY=1 enables tools/list + the
  // queue-bound tools (status / history / feedback) without sandbox creds.
  // `delegate` requires a real client; the stub fails loud at create() so the
  // agent observes the cause instead of silent success.
  if (!apiKey) {
    return {
      async create() {
        throw new Error(
          'agent-runtime-mcp: TANGLE_API_KEY is unset; `delegate` is disabled in diagnostic mode. Set TANGLE_API_KEY or unset MCP_ENABLE_DELEGATE to remove the unsupported tool from the tool list.',
        )
      },
    } satisfies SandboxClient
  }
  // Dynamic import keeps the bin importable in environments that haven't
  // installed `@tangle-network/sandbox` yet (the runtime package lists it
  // as a peer dep, not a hard dep).
  const mod = await import('@tangle-network/sandbox').catch((err) => {
    process.stderr.write(
      `agent-runtime-mcp: failed to load @tangle-network/sandbox (${err.message}); install the peer dependency\n`,
    )
    process.exit(2)
  })
  const SandboxCtor = (mod as { Sandbox?: new (config: unknown) => SandboxClient }).Sandbox
  if (!SandboxCtor) {
    process.stderr.write(
      'agent-runtime-mcp: @tangle-network/sandbox does not export Sandbox; cannot construct client\n',
    )
    process.exit(2)
  }
  // @tangle-network/sandbox ≥0.6 makes baseUrl required; default it so the MCP server
  // starts without forcing every caller to set SANDBOX_BASE_URL. Treat empty/whitespace as
  // unset (|| not ??) so `SANDBOX_BASE_URL=` still resolves to the default.
  const baseUrl = process.env.SANDBOX_BASE_URL?.trim() || DEFAULT_SANDBOX_BASE_URL
  return new SandboxCtor({ apiKey, baseUrl })
}

main().catch((err) => {
  process.stderr.write(`agent-runtime-mcp: ${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
