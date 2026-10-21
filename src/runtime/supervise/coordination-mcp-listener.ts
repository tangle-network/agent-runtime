/**
 * The HTTP side of one coordination server: which hosts and paths it answers, who may call each
 * (manager, read-only observer, one peer-mail capability), and the public address it advertises.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { McpToolDescriptor } from '../../mcp/server'
import { createStdioToolServer } from '../../mcp/tool-server'
import type { CoordinationTools } from '../../mcp/tools/coordination-contracts'
import { bearerToken, type CoordinationCredentials } from './coordination-credentials'
import { type CoordinationRejection, coordinationHttpHandler } from './coordination-http'
import type { serveCoordinationMcp } from './coordination-mcp'
import { noteScopeRetainedOwnerCoordination } from './retained-scope-owner'

/** What the listener has bound so far: `closed` refuses everything, the rest is learned once the
 *  public address is known. */
export interface CoordinationListenerState {
  closed: boolean
  readonly audiences: Set<string>
  readonly paths: Set<string>
  readonly readPaths: Set<string>
  readonly mailPaths: Set<string>
}

export interface CoordinationListenerContext {
  readonly opts: Parameters<typeof serveCoordinationMcp>[0]
  readonly host: string
  readonly identity: { readonly runId: string; readonly actorId: string }
  readonly requestTimeoutMs: number
  readonly credentials: CoordinationCredentials
  readonly state: CoordinationListenerState
}

export function openCoordinationListenerState(): CoordinationListenerState {
  return {
    closed: false,
    audiences: new Set<string>(),
    paths: new Set(['/mcp']),
    readPaths: new Set<string>(),
    mailPaths: new Set<string>(),
  }
}

function authority(
  ctx: CoordinationListenerContext,
  req: IncomingMessage,
): CoordinationRejection | undefined {
  const { state, host } = ctx
  // A proxy may use the destination IP as Host. A wildcard bind must
  // recognize its actual socket address without trusting forwarded names.
  const address = req.socket.localAddress?.replace(/^::ffff:/, '')
  const localAuthority = address?.includes(':')
    ? `[${address}]:${req.socket.localPort}`
    : `${address}:${req.socket.localPort}`
  const boundAuthority =
    state.audiences.size > 0 &&
    (host === '0.0.0.0' || host === '::') &&
    address !== undefined &&
    req.socket.localPort !== undefined &&
    req.headers.host === localAuthority
  if (!state.audiences.has(req.headers.host ?? '') && !boundAuthority)
    return { status: 403, reason: 'wrong-host' }
  if (state.closed) return { status: 401, reason: 'listener-closed' }
  return undefined
}

type HttpHandler = ReturnType<typeof coordinationHttpHandler>

function readOnlyHandler(ctx: CoordinationListenerContext, coord: CoordinationTools): HttpHandler {
  const readMcp = createStdioToolServer({
    serverName: 'supervisor-reader',
    serverVersion: '1',
    tools: coord.tools.filter(
      (tool) => tool.name === 'observe_agent' || tool.name === 'read_journal',
    ),
  })
  return coordinationHttpHandler({
    options: ctx.opts,
    identity: ctx.identity,
    toolNames: new Set(['observe_agent', 'read_journal']),
    backgroundActions: () => 0,
    authorize: (req) => {
      const refused = authority(ctx, req)
      if (refused) return refused
      return ctx.credentials.readerRefused(bearerToken(req.headers.authorization))
        ? { status: 401, reason: 'credential-refused' }
        : undefined
    },
    handle: (message) => readMcp.handle(message),
  })
}

function managerHandler(
  ctx: CoordinationListenerContext,
  mcp: ReturnType<typeof createStdioToolServer>,
  servedTools: ReadonlyArray<McpToolDescriptor>,
  background: () => number,
): HttpHandler {
  return coordinationHttpHandler({
    options: ctx.opts,
    identity: ctx.identity,
    toolNames: new Set(servedTools.map((tool) => tool.name)),
    handle: async (message) => {
      const response = await mcp.handle(message)
      // A coordination call is where a manager commits work, so it is when its workspace is
      // worth a checkpoint (`retained-scope-owner`, rate-limited, off the request path).
      if (message.method === 'tools/call') noteScopeRetainedOwnerCoordination(ctx.opts.scope)
      return response
    },
    backgroundActions: background,
    authorize: (req) => {
      if (!ctx.state.paths.has(req.url ?? '')) return { status: 404, reason: 'unknown-path' }
      const refusedAuthority = authority(ctx, req)
      if (refusedAuthority) return refusedAuthority
      if (!ctx.opts.authentication) return undefined
      const refused = ctx.credentials.refused(bearerToken(req.headers.authorization))
      return refused === undefined ? undefined : { status: 401, reason: refused }
    },
  })
}

/** The handler for one worker's peer-mail capability: it serves `send_mail` and `read_mail` only. */
function peerMailHandler(
  ctx: CoordinationListenerContext,
  coord: CoordinationTools,
  capabilityId: string,
): HttpHandler {
  const mailbox = coord.peerMail!
  const peerMcp = createStdioToolServer({
    serverName: 'peer-mail',
    serverVersion: '1',
    tools: mailbox.tools(capabilityId),
  })
  return coordinationHttpHandler({
    options: ctx.opts,
    identity: { runId: ctx.identity.runId, actorId: 'peer' },
    toolNames: new Set(['send_mail', 'read_mail']),
    backgroundActions: () => 0,
    authorize: (request) =>
      authority(ctx, request) ??
      (!mailbox.hasCapability(capabilityId)
        ? { status: 401, reason: 'credential-refused' }
        : undefined),
    handle: (message) => peerMcp.handle(message),
  })
}

/** The server that routes each request to the read-only, peer-mail or manager handler. */
export function createCoordinationListener(
  ctx: CoordinationListenerContext,
  bound: {
    readonly coord: CoordinationTools
    readonly mcp: ReturnType<typeof createStdioToolServer>
    readonly servedTools: ReadonlyArray<McpToolDescriptor>
    readonly background: () => number
  },
): Server {
  const { coord } = bound
  const readHandler = readOnlyHandler(ctx, coord)
  const peerHandlers = new Map<string, HttpHandler>()
  const mainHandler = managerHandler(ctx, bound.mcp, bound.servedTools, bound.background)
  return createServer((req, res) => {
    if (ctx.state.readPaths.has(req.url ?? '')) return readHandler(req, res)
    for (const base of ctx.state.mailPaths) {
      if (!(req.url ?? '').startsWith(base + '/')) continue
      const capabilityId = (req.url ?? '').slice(base.length + 1)
      const mailbox = coord.peerMail
      if (!/^[0-9a-f]{32}$/.test(capabilityId) || !mailbox?.hasCapability(capabilityId)) {
        res.writeHead(404).end()
        return
      }
      let handler = peerHandlers.get(capabilityId)
      if (!handler) {
        handler = peerMailHandler(ctx, coord, capabilityId)
        peerHandlers.set(capabilityId, handler)
      }
      return handler(req, res)
    }
    return mainHandler(req, res)
  })
}
