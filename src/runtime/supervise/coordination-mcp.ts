/**
 *
 * Serve the coordination verbs (spawn_worker / await_event / observe_agent / steer_agent / stop)
 * as a real HTTP MCP server over a LIVE `Scope`. This is the keystone that lets a coding-harness
 * agent (opencode via the cli-bridge, claude-code, codex) BE the supervisor: it mounts this MCP
 * (`mcp.mcpServers.coordination`) and calls `spawn_worker` as a native tool, which lands on
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

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import type { JsonRpcMessage } from '../../mcp/protocol'
import type { McpToolDescriptor } from '../../mcp/server'
import { createStdioToolServer, type StdioToolServer } from '../../mcp/tool-server'
import {
  type AnalystRegistry,
  type AnalyzeOnSettleRoute,
  type AuthorizeDownMessage,
  type ContinuityMode,
  type CoordinationEvent,
  type CoordinationTools,
  createCoordinationTools,
  DEFAULT_AWAIT_EVENT_TIMEOUT_MS,
  type DefinedAnalystRecord,
  type EscalateQuestion,
  type MakeWorkerAgent,
  type QuestionEscalationRecord,
  type QuestionPolicy,
  type QuestionRecord,
  type SettledWorker,
  type SpawnPreflight,
  type WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import { runAbortable } from './abortable'
import {
  type CoordinationHttpOptions,
  coordinationHttpHandler,
  coordinationHttpLimits,
} from './coordination-http'

export type { CoordinationHttpAudit, CoordinationHttpOptions } from './coordination-http'

import type { DeliverableSpec } from './completion-gate'
import type { BusRecord } from './event-bus'
import type { PeerMailEvent, PeerMailLimits } from './peer-mail'
import type { Budget, ResultBlobStore, Scope } from './types'

export interface CoordinationMcpHandle {
  /** The URL an in-box harness mounts as `mcp.mcpServers.coordination.url`. */
  readonly url: string
  readonly port: number
  /** Runtime-only credentials. Never put these headers in canonical profiles or journals. */
  readonly headers: Readonly<Record<string, string>>
  readonly credentialExpiresAt: number | undefined
  /** Revoke this listener’s current token and mint another. Remove a signing key to revoke across restarts. */
  rotateCredential(): void
  /** The coordination tools' settled-worker ledger (for the driver's finalize). */
  settled(): ReadonlyArray<SettledWorker>
  /** The first driver-authored result whose injected independent check passed. */
  submittedResult: CoordinationTools['submittedResult']
  /** Post-loop drain of already-settled, unpulled children into the ledger — call before reading
   *  `settled()` for a finalize, so a delivered child the harness never awaited is not lost. */
  drainResolved: CoordinationTools['drainResolved']
  isStopped(): boolean
  /** The full ordered bus-event log for current-process observability and audit evidence. */
  history: CoordinationTools['history']
  /** Bus throughput counters for live dashboards. */
  stats: CoordinationTools['stats']
  /** Raise a `finding` on the bus from an online detector watching a worker's live pipe. */
  raiseFinding: CoordinationTools['raiseFinding']
  /** Every peer-mail attempt in order, delivered and refused alike. Empty when peer mail is off. */
  mailHistory(): ReadonlyArray<PeerMailEvent>
  /** End one peer exchange: every further mail on the thread is refused `thread-stopped`. Returns
   *  false when peer mail is off or the thread was already stopped. */
  stopMailThread(threadId: string): boolean
  close(): Promise<void>
}

/** Hosts that reach only this machine, including the IPv4-mapped and bracketed IPv6 spellings a
 *  caller may pass through from config. A name that is not recognizably loopback counts as REMOTE:
 *  whether it resolves to a loopback interface is not knowable here, and the safe direction of that
 *  doubt is "exposed". */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '::ffff:127.0.0.1') {
    return true
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
}

export interface CoordinationAuthentication {
  /** Credential lifetime; defaults to 15 minutes and cannot exceed 24 hours. */
  readonly ttlMs?: number
  /** Caller-owned secret keys. Keep prior keys to verify unexpired credentials after restart. */
  readonly signingKeys?: {
    readonly activeKeyId: string
    readonly keys: Readonly<Record<string, string>>
  }
}

export interface CoordinationPublicAddress {
  readonly host: string
  readonly port: number
  readonly runId: string
  readonly actorId: string
  /** Manager cancellation and deadline; pass this to asynchronous endpoint provisioning. */
  readonly signal: AbortSignal
}

export interface CoordinationTransportOptions extends CoordinationHttpOptions {
  readonly host?: string
  readonly port?: number
  /** Required for remote binds. Each server mints a distinct run/actor credential. */
  readonly authentication?: true | CoordinationAuthentication
  /** Caller-owned reachable endpoint or mapping, awaited before dispatch. Runtime creates no tunnel. */
  readonly publicUrl?: string | ((address: CoordinationPublicAddress) => string | Promise<string>)
}

export function assertCoordinationTransport(options: CoordinationTransportOptions): void {
  const host = options.host ?? '127.0.0.1'
  if (!isLoopbackHost(host) && !options.authentication) {
    throw new ConfigError(
      'coordination non-loopback address requires authentication; allowUnauthenticatedRemote is no longer supported',
    )
  }
  if (
    options.authentication !== undefined &&
    options.authentication !== true &&
    (typeof options.authentication !== 'object' ||
      options.authentication === null ||
      Array.isArray(options.authentication))
  ) {
    throw new ConfigError(
      'coordination authentication must be true or a credential lifetime configuration',
    )
  }
  const ttl = typeof options.authentication === 'object' ? options.authentication.ttlMs : undefined
  if (ttl !== undefined && (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 86_400_000)) {
    throw new ConfigError(
      'coordination credential ttlMs must be a positive integer no greater than 24 hours',
    )
  }
  if (options.publicUrl !== undefined && !options.authentication) {
    throw new ConfigError('coordination publicUrl requires authentication')
  }
  const signingKeys =
    typeof options.authentication === 'object' ? options.authentication.signingKeys : undefined
  if (signingKeys !== undefined) {
    if (!options.publicUrl)
      throw new ConfigError('coordination signingKeys requires a stable publicUrl')
    if (!signingKeys.activeKeyId || !Object.hasOwn(signingKeys.keys, signingKeys.activeKeyId)) {
      throw new ConfigError('coordination signingKeys must contain the active key')
    }
    for (const [id, key] of Object.entries(signingKeys.keys)) {
      if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
        typeof key !== 'string' ||
        Buffer.byteLength(key) < 32
      ) {
        throw new ConfigError(
          'coordination signing keys require bounded key IDs and at least 32 secret bytes',
        )
      }
    }
  }
  coordinationHttpLimits(options)
}

/** Stand up the existing coordination tools with bounded HTTP access over one live scope. */
export async function serveCoordinationMcp(
  opts: CoordinationTransportOptions & {
    /** Trusted audit identity; defaults to the live scope node. */
    identity?: { runId: string; actorId: string }
    scope: Scope<unknown>
    blobs: ResultBlobStore
    makeWorkerAgent: MakeWorkerAgent
    authorizeDownMessage?: AuthorizeDownMessage
    perWorker: Budget
    /** Independent completion check exposed to the driver as `submit_result`. */
    deliverable?: DeliverableSpec<unknown>
    /** Called once when the external manager accepts a result or declares completion. */
    onStop?: (reason: string | undefined) => void
    /** Hard cap on simultaneously-LIVE workers — `spawn_worker` fails closed once this many are in
     *  flight (a concurrency fence on top of the conserved-pool fence). Omit/`<= 0` = no cap. */
    maxLiveWorkers?: number
    /** Max wall-clock ms a single `await_event` may block before returning a re-pollable
     *  `{ pending, live }` snapshot instead of erroring on the client's request timeout. Omit =
     *  {@link DEFAULT_AWAIT_EVENT_TIMEOUT_MS}; `<= 0` = prior unbounded block (in-process only). */
    awaitTimeoutMs?: number
    /** Trace-analyst lenses the driver can run (`run_analyst`) or auto-fire on settle. */
    analysts?: AnalystRegistry
    /** Analyst kinds to auto-run when a worker settles `done` — findings flow up the bus. */
    analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
    /** Run the ONLINE detector panel over each worker's live tool trace (raises `finding` events). */
    watchWorkers?: WorkerWatchOptions
    /** Idle time after which `observe_agent` reports a worker as stalled. */
    stallAfterMs?: number
    /** Default continuity per worker profile name — `'resume'` re-attaches spawns of that name to
     *  the node's latest settled worker; the tool's per-call `continuity` overrides. */
    continuityByProfile?: Readonly<Record<string, ContinuityMode>>
    /** Pass-through subscriber for every bus event, including pre-delivery instruction receipts and
     * steer/answer delivery outcomes. */
    onEvent?: (
      event: CoordinationEvent,
      record: BusRecord<CoordinationEvent>,
    ) => void | Promise<void>
    /** Re-publish resume-time settlements through the awaited observer before this server listens. */
    replaySettlements?: boolean
    questionPolicy?: QuestionPolicy
    /** Where an `ask_parent` question goes when it leaves this manager. Omit = `no-parent`. */
    escalateQuestion?: EscalateQuestion
    /** Escalations replayed from a prior process — seeds what `stop` knows went unheard. */
    priorEscalations?: ReadonlyArray<QuestionEscalationRecord>
    /** Questions replayed from a prior process of this run — seeds the question ledger. */
    priorQuestions?: ReadonlyArray<QuestionRecord>
    /** Every coordination record from prior processes of this run — what `read_journal` reads before
     *  this process's own rows, so a resumed manager sees what it already did. */
    priorJournal?: ReadonlyArray<BusRecord<CoordinationEvent>>
    /** Lenses this manager defined in a prior process — seeds the menu and the definition cap. */
    priorAnalystDefinitions?: ReadonlyArray<DefinedAnalystRecord>
    /** Product-selected tools already bound to this exact supervisor node. They share this server
     *  with the coordination verbs, so the existing MCP duplicate-name guard applies before listen. */
    nodeTools?: ReadonlyArray<McpToolDescriptor>
    /** Exact bare tool names to expose from the coordination and node-tool set. Runtime never
     *  grants an implicit complete tool set. An unknown name fails before the listener opens. */
    toolNames: ReadonlyArray<string>
    /**
     * OPT-IN peer mail: let this manager's workers message each other directly, bounded and audited
     * (`runtime/supervise/peer-mail`). Each spawn receives a capability URL on
     * `WorkerSpawnContext.peerMailUrl`.
     *
     * It is a SEPARATE listener on its own port, not another tool on this server, and that is the
     * whole point: this server grants spawn_worker / steer_agent / stop to its manager, so a
     * worker handed its URL could send a REAL `[SUPERVISOR]` instruction to a sibling and the peer
     * channel's authority marking would mean nothing. The mail listener serves `send_mail` and
     * `read_mail` and no other verb, on a per-worker secret path bound to that worker's identity.
     *
     * The residual, stated plainly: the boundary is between AGENTS, not between processes. A worker
     * that can read another worker's environment or process memory still holds that worker's
     * capability. Loopback plus an unguessable path is what this layer can honestly enforce.
     */
    peerMail?: boolean | { limits?: Partial<PeerMailLimits> }
    /** OPT-IN async gate run before every spawn mints an assignment or reserves budget — the one
     *  pre-journal point that may ask the backend a question. See
     *  `CoordinationToolsOptions.preflightSpawn`. */
    preflightSpawn?: SpawnPreflight
    /** Pre-journal profile resolution for `preflightSpawn`; see
     *  `CoordinationToolsOptions.resolveSpawnProfile`. */
    resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile
    /** Called with this server's exact MCP tool descriptors once they exist and BEFORE the listener
     *  opens — the seam a caller uses to give an already-bound node tool a way to call the same
     *  verbs in code (`SupervisorToolInvocationContext.verbs`). */
    onCoordinationTools?: (tools: ReadonlyArray<McpToolDescriptor>) => void
  },
): Promise<CoordinationMcpHandle> {
  const host = opts.host ?? '127.0.0.1'
  assertCoordinationTransport(opts)
  if (opts.peerMail && (!isLoopbackHost(host) || opts.publicUrl)) {
    throw new ConfigError(
      'remote peer mail requires a separate reachable capability transport; coordination authentication does not authorize the peer listener',
    )
  }
  const identity = Object.freeze({
    ...(opts.identity ?? {
      runId: opts.scope.view?.root ?? '',
      actorId: opts.scope.view?.root ?? '',
    }),
  })
  if (
    (opts.authentication || opts.onAudit) &&
    (!identity.runId.trim() || !identity.actorId.trim())
  ) {
    throw new ConfigError('authenticated coordination requires a trusted run and actor identity')
  }
  const auth = typeof opts.authentication === 'object' ? opts.authentication : undefined
  const signingKeys = auth?.signingKeys
    ? { activeKeyId: auth.signingKeys.activeKeyId, keys: { ...auth.signingKeys.keys } }
    : undefined
  let token: Buffer | undefined
  let credentialExpiresAt: number | undefined
  let headers: Readonly<Record<string, string>> = Object.freeze({})
  let credentialAudience = ''
  let closed = false
  const revoked = new Map<string, number>()
  const grantDigest = createHash('sha256')
    .update(JSON.stringify([...opts.toolNames].sort()))
    .digest('hex')
  const rotateCredential = () => {
    if (!opts.authentication) throw new ConfigError('coordination authentication is not configured')
    if (closed) throw new ConfigError('coordination server is closed')
    for (const [credential, expiry] of revoked) {
      if (expiry <= Date.now()) revoked.delete(credential)
    }
    if (token) revoked.set(token.toString(), credentialExpiresAt!)
    credentialExpiresAt = Date.now() + (auth?.ttlMs ?? 900_000)
    const nonce = randomBytes(32).toString('base64url')
    let text = nonce
    if (signingKeys) {
      const payload = Buffer.from(
        JSON.stringify({
          key: signingKeys.activeKeyId,
          run: identity.runId,
          actor: identity.actorId,
          audience: credentialAudience,
          grants: grantDigest,
          expires: credentialExpiresAt,
          nonce,
        }),
      ).toString('base64url')
      const signature = createHmac('sha256', signingKeys.keys[signingKeys.activeKeyId]!)
        .update(payload)
        .digest('base64url')
      text = `${payload}.${signature}`
    }
    token = Buffer.from(text)
    headers = Object.freeze({ Authorization: `Bearer ${text}` })
  }
  const validCredential = (supplied: Buffer): boolean => {
    if (closed || revoked.has(supplied.toString())) return false
    if (!signingKeys)
      return (
        token !== undefined &&
        Date.now() < credentialExpiresAt! &&
        supplied.length === token.length &&
        timingSafeEqual(supplied, token)
      )
    if (supplied.length > 8192) return false
    try {
      const parts = supplied.toString().split('.')
      if (parts.length !== 2) return false
      const payload = parts[0]!
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      if (!claims || typeof claims.key !== 'string' || !Object.hasOwn(signingKeys.keys, claims.key))
        return false
      const expected = createHmac('sha256', signingKeys.keys[claims.key]!).update(payload).digest()
      const signature = Buffer.from(parts[1]!, 'base64url')
      return (
        signature.length === expected.length &&
        timingSafeEqual(signature, expected) &&
        claims.run === identity.runId &&
        claims.actor === identity.actorId &&
        claims.audience === credentialAudience &&
        claims.grants === grantDigest &&
        Number.isSafeInteger(claims.expires) &&
        claims.expires > Date.now()
      )
    } catch {
      return false
    }
  }
  const audiences = new Set<string>()
  const paths = new Set(['/mcp'])
  const coord = createCoordinationTools({
    scope: opts.scope,
    blobs: opts.blobs,
    makeWorkerAgent: opts.makeWorkerAgent,
    ...(opts.authorizeDownMessage ? { authorizeDownMessage: opts.authorizeDownMessage } : {}),
    perWorker: opts.perWorker,
    ...(opts.deliverable ? { deliverable: opts.deliverable } : {}),
    ...(opts.onStop ? { onStop: opts.onStop } : {}),
    ...(opts.maxLiveWorkers !== undefined ? { maxLiveWorkers: opts.maxLiveWorkers } : {}),
    awaitTimeoutMs: opts.awaitTimeoutMs ?? DEFAULT_AWAIT_EVENT_TIMEOUT_MS,
    ...(opts.analysts ? { analysts: opts.analysts } : {}),
    ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
    ...(opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {}),
    ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
    ...(opts.continuityByProfile ? { continuityByProfile: opts.continuityByProfile } : {}),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.replaySettlements ? { replaySettlements: true } : {}),
    ...(opts.questionPolicy ? { questionPolicy: opts.questionPolicy } : {}),
    ...(opts.escalateQuestion ? { escalateQuestion: opts.escalateQuestion } : {}),
    ...(opts.priorEscalations?.length ? { priorEscalations: opts.priorEscalations } : {}),
    ...(opts.priorQuestions?.length ? { priorQuestions: opts.priorQuestions } : {}),
    ...(opts.priorJournal?.length ? { priorJournal: opts.priorJournal } : {}),
    ...(opts.priorAnalystDefinitions?.length
      ? { priorAnalystDefinitions: opts.priorAnalystDefinitions }
      : {}),
    ...(opts.preflightSpawn ? { preflightSpawn: opts.preflightSpawn } : {}),
    ...(opts.resolveSpawnProfile ? { resolveSpawnProfile: opts.resolveSpawnProfile } : {}),
    ...(opts.peerMail
      ? {
          peerMail:
            typeof opts.peerMail === 'object' && opts.peerMail.limits
              ? { limits: opts.peerMail.limits }
              : {},
        }
      : {}),
  })
  await coord.ready()
  const reservedNames = new Set<string>(coord.tools.map((tool) => tool.name))
  for (const tool of opts.nodeTools ?? []) {
    if (reservedNames.has(tool.name)) {
      throw new ValidationError(
        `serveCoordinationMcp: node tool ${JSON.stringify(tool.name)} shadows a coordination verb or another node tool`,
      )
    }
    reservedNames.add(tool.name)
  }
  const availableTools = [...coord.tools, ...(opts.nodeTools ?? [])]
  const availableByName = new Map(availableTools.map((tool) => [tool.name, tool]))
  if (!Array.isArray(opts.toolNames)) {
    throw new ValidationError(
      'serveCoordinationMcp: toolNames must name every granted tool explicitly',
    )
  }
  const selectedNames = opts.toolNames
  if (new Set(selectedNames).size !== selectedNames.length) {
    throw new ValidationError('serveCoordinationMcp: toolNames contains a duplicate name')
  }
  const servedTools = selectedNames.map((name) => {
    const tool = availableByName.get(name)
    if (tool === undefined) {
      throw new ValidationError(
        `serveCoordinationMcp: requested tool ${JSON.stringify(name)} is unavailable`,
      )
    }
    return tool
  })
  const mcp = createStdioToolServer({
    serverName: 'coordination',
    serverVersion: '1',
    tools: servedTools,
  })
  // Before the listener opens: a node tool invoked on the first request must already be able to
  // call these verbs. Read back the server's ordered set so every consumer records the exact MCP
  // surface.
  opts.onCoordinationTools?.([...mcp.tools.values()])

  const server: Server = createServer(
    coordinationHttpHandler({
      options: opts,
      identity,
      toolNames: new Set(servedTools.map((tool) => tool.name)),
      handle: (message) => mcp.handle(message),
      authorize: (req) => {
        if (!paths.has(req.url ?? '')) return 404
        if (!audiences.has(req.headers.host ?? '')) return 403
        if (closed) return 401
        if (!opts.authentication) return undefined
        const authorization = req.headers.authorization
        const supplied =
          typeof authorization === 'string' && authorization.startsWith('Bearer ')
            ? Buffer.from(authorization.slice(7))
            : Buffer.alloc(0)
        if (!validCredential(supplied)) return 401
        return undefined
      },
    }),
  )

  const requestTimeoutMs = coordinationHttpLimits(opts).requestTimeoutMs
  server.requestTimeout = requestTimeoutMs
  server.headersTimeout = requestTimeoutMs

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0))
    })
  })

  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const localUrl = `http://${urlHost}:${port}/mcp`
  let url: string
  try {
    const resolver = opts.publicUrl
    const configured =
      typeof resolver === 'function'
        ? await runAbortable(
            async () => resolver({ host, port, ...identity, signal: opts.scope.signal }),
            opts.scope.signal,
            'coordination public address resolution aborted',
          )
        : resolver
    const publicAddress = new URL(configured ?? localUrl)
    if (
      !['http:', 'https:'].includes(publicAddress.protocol) ||
      publicAddress.username ||
      publicAddress.password ||
      publicAddress.search ||
      publicAddress.hash
    ) {
      throw new ConfigError(
        'coordination publicUrl must be an HTTP endpoint without credentials, query, or fragment',
      )
    }
    if (
      configured !== undefined &&
      publicAddress.protocol !== 'https:' &&
      !isLoopbackHost(publicAddress.hostname)
    ) {
      throw new ConfigError('remote coordination publicUrl must use HTTPS')
    }
    url = publicAddress.href
    credentialAudience = url
    if (opts.authentication) rotateCredential()
    audiences.add(new URL(localUrl).host)
    audiences.add(publicAddress.host)
    if (host === '0.0.0.0' || host === '::') audiences.add(`127.0.0.1:${port}`)
    paths.add(publicAddress.pathname)
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw error
  }

  const mailbox = coord.peerMail
  const mailListener = mailbox === undefined ? undefined : await servePeerMail(mailbox, host)

  return {
    url,
    port,
    get headers() {
      return headers
    },
    get credentialExpiresAt() {
      return credentialExpiresAt
    },
    rotateCredential,
    settled: () => coord.settled(),
    submittedResult: () => coord.submittedResult(),
    drainResolved: () => coord.drainResolved(),
    isStopped: () => coord.isStopped(),
    history: () => coord.history(),
    stats: () => coord.stats(),
    raiseFinding: (finding) => coord.raiseFinding(finding),
    mailHistory: () => mailbox?.history() ?? [],
    stopMailThread: (threadId) => mailbox?.stopThread(threadId) ?? false,
    close: async () => {
      closed = true
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      await mailListener?.close()
    },
  }
}

/**
 * Stand up the peer-mail capability listener: one HTTP server, one secret path per worker, and on
 * each path a tool server carrying ONLY `send_mail` / `read_mail` with that worker's identity
 * closed over. An unknown path is a flat 404 — the path is the credential, so a request that does
 * not present a minted one is not a client to reason with.
 *
 * The host is the coordination host, which the caller has already had to justify: the loopback gate
 * above governs both listeners, and there is deliberately no way to bind mail somewhere else.
 */
async function servePeerMail(
  mailbox: NonNullable<CoordinationTools['peerMail']>,
  host: string,
): Promise<{ close(): Promise<void> }> {
  const servers = new Map<string, StdioToolServer>()
  const forCapability = (capabilityId: string): StdioToolServer => {
    const existing = servers.get(capabilityId)
    if (existing) return existing
    const created = createStdioToolServer({
      serverName: 'peer-mail',
      serverVersion: '1',
      tools: mailbox.tools(capabilityId),
    })
    servers.set(capabilityId, created)
    return created
  }

  const listener: Server = createServer((req, res) => {
    const capabilityId = /^\/mail\/([0-9a-f]{32})$/.exec(req.url ?? '')?.[1]
    if (
      req.method !== 'POST' ||
      capabilityId === undefined ||
      !mailbox.hasCapability(capabilityId)
    ) {
      res.writeHead(404).end()
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      void (async () => {
        try {
          const message = JSON.parse(body) as JsonRpcMessage
          const response = await forCapability(capabilityId).handle(message)
          if (response === null) {
            res.writeHead(202).end() // a notification — no body
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(response))
        } catch (e) {
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
    listener.once('error', reject)
    listener.listen(0, host, () => {
      const addr = listener.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
  // Only now is a capability URL a reachable address, so only now may one be minted.
  mailbox.setEndpoint(`http://${host}:${port}/mail`)
  return {
    close: () =>
      new Promise<void>((resolve) => {
        listener.close(() => resolve())
      }),
  }
}
