/**
 * @experimental
 *
 * Serve the coordination verbs (spawn_worker / await_next / observe_worker / steer_worker / stop)
 * as a real HTTP MCP server over a LIVE `Scope`. This is the keystone that lets a coding-harness
 * agent (opencode via the cli-bridge, claude-code, codex) BE the supervisor: it mounts this MCP
 * (`mcp.mcpServers.coordination`) and calls `spawn_worker` as a native tool, which lands on
 * `Scope.spawn` — a real box driving real boxes, not emulated function-tools.
 *
 * Transport: JSON-RPC over HTTP POST (the MCP streamable-HTTP shape — `application/json` for a
 * single response). The server is created INSIDE an agent's `act(task, scope)` so it fronts that
 * agent's live scope; tear it down when the act returns.
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
} from '../../mcp/tools/coordination'
import type { Budget, ResultBlobStore, Scope } from './types'

export interface CoordinationMcpHandle {
  /** The URL an in-box harness mounts as `mcp.mcpServers.coordination.url`. */
  readonly url: string
  readonly port: number
  /** The coordination tools' settled-worker ledger (for the driver's finalize). */
  settled(): ReadonlyArray<{ status: string; score?: number; valid?: boolean; outRef?: string }>
  isStopped(): boolean
  /** The full ordered bus-event log — observability audit + replay trail. */
  history: CoordinationTools['history']
  /** Bus throughput counters for live dashboards. */
  stats: CoordinationTools['stats']
  close(): Promise<void>
}

/** Stand up the coordination MCP over a live scope. The HOST address is `127.0.0.1` (the bridge runs
 *  opencode locally, same host); pass `host` to bind elsewhere when the harness is remote. */
export async function serveCoordinationMcp(opts: {
  scope: Scope<unknown>
  blobs: ResultBlobStore
  makeWorkerAgent: MakeWorkerAgent
  perWorker: Budget
  port?: number
  host?: string
  /** Trace-analyst lenses the driver can run (`run_analyst`) or auto-fire on settle. */
  analysts?: AnalystRegistry
  /** Analyst kinds to auto-run when a worker settles `done` — findings flow up the bus. */
  analyzeOnSettle?: ReadonlyArray<string>
  /** Pass-through subscriber for every bus event (settled / question / finding). */
  onEvent?: (event: CoordinationEvent) => void | Promise<void>
  questionPolicy?: QuestionPolicy
}): Promise<CoordinationMcpHandle> {
  const coord = createCoordinationTools({
    scope: opts.scope,
    blobs: opts.blobs,
    makeWorkerAgent: opts.makeWorkerAgent,
    perWorker: opts.perWorker,
    ...(opts.analysts ? { analysts: opts.analysts } : {}),
    ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.questionPolicy ? { questionPolicy: opts.questionPolicy } : {}),
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
    settled: () => coord.settled(),
    isStopped: () => coord.isStopped(),
    history: () => coord.history(),
    stats: () => coord.stats(),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
