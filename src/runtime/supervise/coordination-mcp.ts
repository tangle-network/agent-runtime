/**
 *
 * Serve the coordination verbs (spawn_agent / await_event / observe_agent / steer_agent / stop)
 * as a real HTTP MCP server over a LIVE `Scope`. This is the keystone that lets a coding-harness
 * agent (opencode via the cli-bridge, claude-code, codex) BE the supervisor: it mounts this MCP
 * (`mcp.mcpServers.coordination`) and calls `spawn_agent` as a native tool, which lands on
 * `Scope.spawn` — a real box driving real boxes, not emulated function-tools.
 *
 * Coordination vs DELEGATION (`../../mcp/delegates.ts`): coordination SPAWNS workers in a CHOSEN
 * backend (`createExecutor({ backend })` — sandbox OR cli-bridge) and live-drives them — observe /
 * steer / resume, recursive sub-drivers, one conserved budget. To instead delegate a coding task
 * INSIDE the agent's OWN sandbox (a durable fire-and-poll job that survives an MCP restart), use the
 * delegation MCP. Coordination is the live, cross-backend supervisor; delegation is own-sandbox async.
 *
 * Transport: JSON-RPC over HTTP POST (the MCP streamable-HTTP shape — `application/json` for a
 * single response). The server is created INSIDE an agent's `act(task, scope)` so it fronts that
 * agent's live scope; tear it down when the act returns.
 *
 * @experimental
 */

import { createServer, type Server } from 'node:http'
import { createMcpServer } from '../../mcp/server'
import {
  type AnalystRegistry,
  type CoordinationEvent,
  type CoordinationTools,
  createCoordinationTools,
  type MakeWorkerAgent,
  type QuestionPolicy,
  type QuestionRecord,
  type SettledWorker,
  type WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import type { DeliverableSpec } from './completion-gate'
import type { Budget, ResultBlobStore, Scope } from './types'

/** Transport-neutral live coordination session used by the recursive runtime. */
export interface CoordinationSession {
  /** The coordination tools' settled-worker ledger (for the driver's finalize). */
  settled(): ReadonlyArray<SettledWorker>
  /** The first driver-authored result whose injected independent check passed. */
  submittedResult: CoordinationTools['submittedResult']
  /** Post-loop drain of already-settled, unpulled children into the ledger — call before reading
   *  `settled()` for a finalize, so a delivered child the harness never awaited is not lost. */
  drainResolved: CoordinationTools['drainResolved']
  close(): Promise<void>
}

export interface CoordinationMcpHandle extends CoordinationSession {
  /** The URL an in-box harness mounts as `mcp.mcpServers.coordination.url`. */
  readonly url: string
  readonly port: number
  /** The same live coordination surface served over HTTP, for in-process adapters. */
  readonly coordination: CoordinationTools
  isStopped(): boolean
  /** The full ordered bus-event log — observability audit + replay trail. */
  history: CoordinationTools['history']
  /** Bus throughput counters for live dashboards. */
  stats: CoordinationTools['stats']
  /** Raise a `finding` on the bus from an online detector watching a worker's live pipe. */
  raiseFinding: CoordinationTools['raiseFinding']
}

export interface CoordinationSessionOptions {
  scope: Scope<unknown>
  blobs: ResultBlobStore
  makeWorkerAgent: MakeWorkerAgent
  perWorker: Budget
  workerShutdown: number | 'brutalKill' | 'infinity'
  deliverable: DeliverableSpec<unknown>
  maxLiveWorkers: number | null
  awaitTimeoutMs: number
  analysts: AnalystRegistry | null
  analyzeOnSettle: ReadonlyArray<string>
  watchWorkers: WorkerWatchOptions | null
  stallAfterMs: number | null
  onEvent: ((event: CoordinationEvent) => void | Promise<void>) | null
  questionPolicy: QuestionPolicy
  priorQuestions: ReadonlyArray<QuestionRecord>
  priorFindings: ReadonlyArray<import('../../mcp/tools/coordination').AnalystFindingEvent>
}

/** Legacy-compatible local HTTP adapter options. */
export interface CoordinationMcpOptions {
  scope: Scope<unknown>
  blobs: ResultBlobStore
  makeWorkerAgent: MakeWorkerAgent
  perWorker: Budget
  workerShutdown?: number | 'brutalKill' | 'infinity'
  deliverable?: DeliverableSpec<unknown>
  maxLiveWorkers?: number | null
  awaitTimeoutMs?: number
  analysts?: AnalystRegistry | null
  analyzeOnSettle?: ReadonlyArray<string>
  watchWorkers?: WorkerWatchOptions | null
  stallAfterMs?: number | null
  onEvent?: ((event: CoordinationEvent) => void | Promise<void>) | null
  questionPolicy?: QuestionPolicy
  priorQuestions?: ReadonlyArray<QuestionRecord>
  priorFindings?: ReadonlyArray<import('../../mcp/tools/coordination').AnalystFindingEvent>
  port?: number
  host?: string
}

/** Stand up the coordination MCP over a live scope. The HOST address is `127.0.0.1` (the bridge runs
 *  opencode locally, same host); pass `host` to bind elsewhere when the harness is remote. */
export async function serveCoordinationMcp(
  opts: CoordinationMcpOptions,
): Promise<CoordinationMcpHandle> {
  const coord = createCoordinationTools({
    scope: opts.scope,
    blobs: opts.blobs,
    makeWorkerAgent: opts.makeWorkerAgent,
    perWorker: opts.perWorker,
    ...(opts.workerShutdown !== undefined ? { workerShutdown: opts.workerShutdown } : {}),
    ...(opts.deliverable ? { deliverable: opts.deliverable } : {}),
    ...(opts.maxLiveWorkers !== null && opts.maxLiveWorkers !== undefined
      ? { maxLiveWorkers: opts.maxLiveWorkers }
      : {}),
    ...(opts.awaitTimeoutMs !== undefined ? { awaitTimeoutMs: opts.awaitTimeoutMs } : {}),
    ...(opts.analysts ? { analysts: opts.analysts } : {}),
    ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
    ...(opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {}),
    ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.questionPolicy !== undefined ? { questionPolicy: opts.questionPolicy } : {}),
    ...(opts.priorQuestions?.length ? { priorQuestions: opts.priorQuestions } : {}),
    ...(opts.priorFindings?.length ? { priorFindings: opts.priorFindings } : {}),
  })
  const mcp = createMcpServer({ extraTools: coord.tools, serverName: 'coordination' })
  const host = opts.host ?? '127.0.0.1'

  const server: Server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      void (async () => {
        try {
          const message = JSON.parse(body) as Parameters<typeof mcp.handle>[0]
          const response = await mcp.handle(message)
          if (response === null) {
            res.writeHead(202).end() // a notification — no body
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(response))
        } catch (e) {
          // A malformed request is the client's to recover from — a typed JSON-RPC error, not a crash.
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: e instanceof Error ? e.message : 'parse error' },
            }),
          )
        }
      })()
    })
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0))
    })
  })

  return {
    url: `http://${host}:${port}/mcp`,
    port,
    coordination: coord,
    settled: () => coord.settled(),
    submittedResult: () => coord.submittedResult(),
    drainResolved: () => coord.drainResolved(),
    isStopped: () => coord.isStopped(),
    history: () => coord.history(),
    stats: () => coord.stats(),
    raiseFinding: (finding) => coord.raiseFinding(finding),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
