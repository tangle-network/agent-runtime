/** Serve Runtime coordination as bounded HTTP MCP over one live scope. @experimental */
import { isIP } from 'node:net'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import { createStdioToolServer } from '../../mcp/tool-server'
import type {
  AnalystRegistry,
  AnalyzeOnSettleRoute,
  DefinedAnalystRecord,
} from '../../mcp/tools/coordination-analysts'
import type {
  CoordinationTools,
  GraphSubtasks,
  MakeWorkerAgent,
  PeerAuditAccess,
  SettledWorker,
  SpawnPreflight,
  SuperviseProfileEntry,
} from '../../mcp/tools/coordination-contracts'
import type { CoordinationEvent, WorkerWatchOptions } from '../../mcp/tools/coordination-events'
import { createCoordinationToolsForManager } from '../../mcp/tools/coordination-manager'
import type { MapOnSettleRoute } from '../../mcp/tools/coordination-map-contracts'
import type { AuthorizeDownMessage, ContinuityMode } from '../../mcp/tools/coordination-messages'
import type {
  ChildQuestionInbox,
  EscalateQuestion,
  QuestionEscalationRecord,
  QuestionPolicy,
  QuestionRecord,
} from '../../mcp/tools/coordination-questions'
import type { SpawnResourceReader } from '../../mcp/tools/spawn-resource-paths'
import { runAbortable } from './abortable'
import { createCoordinationCredentials } from './coordination-credentials'
import { type CoordinationHttpOptions, coordinationHttpLimits } from './coordination-http'
import {
  type CoordinationListenerContext,
  createCoordinationListener,
  openCoordinationListenerState,
} from './coordination-mcp-listener'
import { bindServedTools, coordinationToolOptions } from './coordination-mcp-tools'
import { preflightPublicCoordination } from './coordination-preflight'
import { armDeadlineTimer } from './deadline'
import { scopeRetainedOwnerResourceReader } from './retained-scope-owner'

export type {
  CoordinationHttpAudit,
  CoordinationHttpOptions,
  CoordinationRejectReason,
} from './coordination-http'

import type { DeliverableSpec } from './completion-gate'
import type { BusRecord } from './event-bus'
import type { PeerMailEvent, PeerMailLimits } from './peer-mail'
import type { Budget, ResultBlobStore, Scope } from './types'

export interface CoordinationMcpHandle {
  readonly url: string
  readonly port: number
  /** A separately authenticated read-only endpoint. Never persist its protected headers. */
  readonly readOnly: { readonly url: string; readonly headers: Readonly<Record<string, string>> }
  /** Independent operator capability; never persist its protected headers in profiles or journals. */
  readonly control: CoordinationControlAccess
  /** Runtime-only credentials. Never put these headers in canonical profiles or journals. */
  readonly headers: Readonly<Record<string, string>>
  /** Finite lease expiry, capped by the root run's absolute deadline. */
  readonly credentialExpiresAt: number | undefined
  readonly credentialSigned?: boolean
  rotateCredential(): void
  /** Bind a trusted holder; renewal stops and drains before its release. */
  bindCredential?(
    install: (headers: Readonly<Record<string, string>>) => Promise<void>,
  ): Promise<() => Promise<void>>
  settled(): ReadonlyArray<SettledWorker>
  submittedResult: CoordinationTools['submittedResult']
  drainResolved: CoordinationTools['drainResolved']
  finishAnalysis: CoordinationTools['finishAnalysis']
  isStopped(): boolean
  history: CoordinationTools['history']
  stats: CoordinationTools['stats']
  raiseFinding: CoordinationTools['raiseFinding']
  mailHistory(): ReadonlyArray<PeerMailEvent>
  stopMailThread(threadId: string): boolean
  close(): Promise<void>
}

/** Recognizable loopback spellings; other hostnames require authenticated remote transport. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '::ffff:127.0.0.1') {
    return true
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
}

export interface CoordinationAuthentication {
  /** Credential lease duration; omission uses the public Sandbox execution-lifetime owner. */
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
  /** Listener lifetime: aborts on close, failed setup, manager cancellation, or deadline. */
  readonly signal: AbortSignal
}

/** Runtime-only read capability delivered to an operator client, never to the canonical profile. */
export interface CoordinationReadAccess {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

/** Runtime-only owned-worker control capability, separate from read and manager authority. */
export interface CoordinationControlAccess extends CoordinationReadAccess {
  readonly runId: string
  readonly actorId: string
}

export interface CoordinationTransportOptions extends CoordinationHttpOptions {
  /** Publish the read capability before dispatch, so a remote client can observe the first worker. */
  readonly onReadReady?: (
    access: CoordinationReadAccess & { readonly runId: string; readonly actorId: string },
  ) => void | Promise<void>
  readonly onControlReady?: (access: CoordinationControlAccess) => void | Promise<void>
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
  if (
    ttl !== undefined &&
    (!Number.isSafeInteger(ttl) || ttl <= 0 || !Number.isSafeInteger(Date.now() + ttl))
  ) {
    throw new ConfigError(
      'coordination credential ttlMs must be a positive safe integer with a safe expiry',
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
  if (options.onReadReady && !options.authentication) {
    throw new ConfigError('coordination read capability publication requires authentication')
  }
  if (options.onControlReady && !options.authentication) {
    throw new ConfigError('coordination control capability publication requires authentication')
  }
  coordinationHttpLimits(options)
}

/** The longest any coordination call holds its response, whatever the request timeout: under the
 *  60 s MCP tool-call timeout Claude Code and Codex apply by default. */
const RESPONSE_FENCE_CAP_MS = 45_000

/** The longest a fenced call (`submit_result`, node tools) holds its response before answering with
 *  a receipt: half of `requestTimeoutMs` (beating the transport's 504), at most {@link RESPONSE_FENCE_CAP_MS}. */
function coordinationResponseFenceMs(requestTimeoutMs: number): number {
  return Math.max(1, Math.min(RESPONSE_FENCE_CAP_MS, Math.floor(requestTimeoutMs / 2)))
}

/** Stand up the existing coordination tools with bounded HTTP access over one live scope. */
export async function serveCoordinationMcp(
  opts: CoordinationTransportOptions & {
    /** Trusted audit identity; defaults to the live scope node. */
    identity?: { runId: string; actorId: string }
    scope: Scope<unknown>
    blobs: ResultBlobStore
    makeWorkerAgent: MakeWorkerAgent
    graphs?: GraphSubtasks
    authorizeDownMessage?: AuthorizeDownMessage
    perWorker: Budget
    /** Independent submit_result check; fenced and single-flight. */
    deliverable?: DeliverableSpec<unknown>
    readContinuation?: (continuation: number | undefined) => unknown
    onStop?: (reason: string | undefined) => void
    analysts?: AnalystRegistry
    analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
    mapOnSettle?: ReadonlyArray<MapOnSettleRoute>
    sourceEvidenceRefs?: ReadonlyArray<string>
    peerAudit?: PeerAuditAccess
    watchWorkers?: WorkerWatchOptions
    stallAfterMs?: number
    /** Default continuity per profile; per-call selection overrides it. */
    continuityByProfile?: Readonly<Record<string, ContinuityMode>>
    /** Await every bus event, including delivery outcomes. */
    onEvent?: (
      event: CoordinationEvent,
      record: BusRecord<CoordinationEvent>,
    ) => void | Promise<void>
    replaySettlements?: boolean
    questionPolicy?: QuestionPolicy
    escalateQuestion?: EscalateQuestion
    onChildQuestionInbox?: (inbox: ChildQuestionInbox) => void
    priorEscalations?: ReadonlyArray<QuestionEscalationRecord>
    priorQuestions?: ReadonlyArray<QuestionRecord>
    /** Prior-process records precede this process in read_journal. */
    priorJournal?: ReadonlyArray<BusRecord<CoordinationEvent>>
    priorAnalystDefinitions?: ReadonlyArray<DefinedAnalystRecord>
    /** Node tools share the MCP duplicate-name guard, single-flight and response fence. */
    nodeTools?: ReadonlyArray<McpToolDescriptor>
    /** Exact bare tool names to expose from the coordination and node-tool set. Runtime never
     *  grants an implicit complete tool set. An unknown name fails before the listener opens. */
    toolNames: ReadonlyArray<string>
    /** Peer mail grants separate per-agent send/read authority, never manager authority. */
    peerMail?: boolean | { limits?: Partial<PeerMailLimits> }
    /** Async pre-journal gate before assignment or budget reservation. */
    preflightSpawn?: SpawnPreflight
    resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile
    composeSpawnProfile?: (profile: AgentProfile) => AgentProfile
    profiles?: ReadonlyMap<string, SuperviseProfileEntry>
    spawnResourceRoot?: string
    spawnResourceReader?: SpawnResourceReader
    /** Bind exact tool descriptors before the listener admits its first request. */
    onCoordinationTools?: (
      tools: ReadonlyArray<McpToolDescriptor>,
      coordination: Pick<CoordinationTools, 'awaitSettlement'>,
    ) => void
  },
): Promise<CoordinationMcpHandle> {
  return (await serveCoordinationMcpForManager(opts)).handle
}

/** Bind the advertised address, credential audience and paths, then prove public reachability. */
async function bindCoordinationAddress(
  ctx: CoordinationListenerContext,
  port: number,
  addressSignal: AbortSignal,
): Promise<string> {
  const { opts, host, identity, state } = ctx
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const localUrl = `http://${urlHost}:${port}/mcp`
  const resolver = opts.publicUrl
  const configured =
    typeof resolver === 'function'
      ? await runAbortable(
          async () => resolver({ host, port, ...identity, signal: addressSignal }),
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
  const url = publicAddress.href
  ctx.credentials.setAudience(url)
  if (opts.authentication) ctx.credentials.rotate()
  state.audiences.add(new URL(localUrl).host)
  state.audiences.add(publicAddress.host)
  if (host === '0.0.0.0' || host === '::') state.audiences.add(`127.0.0.1:${port}`)
  state.paths.add(publicAddress.pathname)
  for (const path of state.paths) {
    state.readPaths.add(`${path.replace(/\/$/, '')}/read`)
    state.controlPaths.add(`${path.replace(/\/$/, '')}/control`)
    state.mailPaths.add(`${path.replace(/\/$/, '')}/mail`)
  }
  if (configured !== undefined) {
    await preflightPublicCoordination({
      url,
      headers: ctx.credentials.headers,
      signal: opts.scope.signal,
      requestTimeoutMs: ctx.requestTimeoutMs,
      toolNames: opts.toolNames,
    })
  }
  return url
}

/** Runtime-only binding: operator controls stay off the public MCP handle and tool grants. */
export async function serveCoordinationMcpForManager(
  opts: Parameters<typeof serveCoordinationMcp>[0],
  lifetime?: AbortSignal,
): Promise<{ handle: CoordinationMcpHandle; controls: CoordinationTools }> {
  const host = opts.host ?? '127.0.0.1'
  assertCoordinationTransport(opts)
  const requestTimeoutMs = coordinationHttpLimits(opts).requestTimeoutMs
  const responseFenceMs = coordinationResponseFenceMs(requestTimeoutMs)
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
  const state = openCoordinationListenerState()
  const credentials = createCoordinationCredentials({
    authentication: opts.authentication,
    identity,
    toolNames: opts.toolNames,
    scopeSignal: opts.scope.signal,
    lifetimeSignal: lifetime,
    lifetimeExpiresAt: opts.scope.rootDeadlineAtMs,
    isClosed: () => state.closed,
  })
  const ctx: CoordinationListenerContext = {
    opts,
    host,
    identity,
    requestTimeoutMs,
    credentials,
    state,
  }
  const ownerReader =
    opts.spawnResourceReader ??
    (opts.spawnResourceRoot === undefined
      ? scopeRetainedOwnerResourceReader(opts.scope)
      : undefined)
  let probeableByName: ReadonlyMap<string, McpToolDescriptor> | undefined
  const coord = createCoordinationToolsForManager(
    coordinationToolOptions(opts, ownerReader, (name) => probeableByName?.get(name)),
    lifetime,
  )
  await coord.ready()
  const { servedTools, background } = bindServedTools(opts, coord, responseFenceMs)
  probeableByName = new Map(servedTools.map((tool) => [tool.name, tool]))
  const mcp = createStdioToolServer({
    serverName: 'coordination',
    serverVersion: '1',
    tools: servedTools,
  })
  opts.onCoordinationTools?.([...mcp.tools.values()], coord)

  const server = createCoordinationListener(ctx, { coord, mcp, servedTools, background })
  server.requestTimeout = requestTimeoutMs
  server.headersTimeout = requestTimeoutMs

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0))
    })
  })

  const addressLifetime = new AbortController()
  const abortAddress = () => addressLifetime.abort(opts.scope.signal.reason)
  opts.scope.signal.addEventListener('abort', abortAddress, { once: true })
  if (opts.scope.signal.aborted) abortAddress()
  const releaseAddress = () => {
    opts.scope.signal.removeEventListener('abort', abortAddress)
    if (!addressLifetime.signal.aborted)
      addressLifetime.abort(new Error('coordination listener closed'))
  }

  let url: string
  try {
    url = await bindCoordinationAddress(ctx, port, addressLifetime.signal)
  } catch (error) {
    releaseAddress()
    state.closed = true
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
    throw error
  }

  let stopCredentialBinding: (() => Promise<void>) | undefined
  let refreshBoundCredential: (() => void) | undefined
  const bindCredential: NonNullable<CoordinationMcpHandle['bindCredential']> = async (install) => {
    if (stopCredentialBinding) throw new ConfigError('coordination already has a credential holder')
    let active = true,
      cancelTimer: (() => void) | undefined
    let pending: Promise<void> = Promise.resolve()
    const stop = async () => {
      active = false
      cancelTimer?.()
      await pending
    }
    stopCredentialBinding = stop
    const schedule = () => {
      const expiry = credentials.expiresAt!
      if (
        !active ||
        state.closed ||
        opts.scope.signal.aborted ||
        lifetime?.aborted ||
        (opts.scope.rootDeadlineAtMs !== undefined && expiry >= opts.scope.rootDeadlineAtMs)
      )
        return
      cancelTimer = armDeadlineTimer(Math.max(1, Math.floor((expiry - Date.now()) / 2)), renew)
    }
    const renew = () => {
      if (!active || state.closed || opts.scope.signal.aborted || lifetime?.aborted) return
      pending = credentials.replace(install)
      void pending.then(schedule, () => {
        state.closed = true
        try {
          opts.onStop?.('coordination credential renewal failed')
        } catch {}
      })
    }
    refreshBoundCredential = () => {
      cancelTimer?.()
      renew()
    }
    try {
      pending = credentials.replace(install)
      await pending
      schedule()
    } catch (error) {
      active = false
      cancelTimer?.()
      stopCredentialBinding = undefined
      refreshBoundCredential = undefined
      throw error
    }
    return stop
  }
  const mailbox = coord.peerMail
  mailbox?.setEndpoint(`${url.replace(/\/$/, '')}/mail`)

  const handle: CoordinationMcpHandle = {
    url,
    port,
    get readOnly() {
      if (!opts.authentication)
        throw new ConfigError('coordination read access requires authentication')
      return {
        url: `${url.replace(/\/$/, '')}/read`,
        headers: Object.freeze({ Authorization: `Bearer ${credentials.readerToken.toString()}` }),
      }
    },
    get headers() {
      return credentials.headers
    },
    get control() {
      if (!opts.authentication)
        throw new ConfigError('coordination control access requires authentication')
      return {
        ...identity,
        url: `${url.replace(/\/$/, '')}/control`,
        headers: credentials.controllerHeaders,
      }
    },
    get credentialExpiresAt() {
      return credentials.expiresAt
    },
    credentialSigned: typeof opts.authentication === 'object' && !!opts.authentication.signingKeys,
    rotateCredential: () => {
      credentials.rotate()
      refreshBoundCredential?.()
    },
    bindCredential,
    settled: () => coord.settled(),
    submittedResult: () => coord.submittedResult(),
    drainResolved: () => coord.drainResolved(),
    finishAnalysis: (input) => coord.finishAnalysis(input),
    isStopped: () => state.closed || coord.isStopped(),
    history: () => coord.history(),
    stats: () => coord.stats(),
    raiseFinding: (finding) => coord.raiseFinding(finding),
    mailHistory: () => mailbox?.history() ?? [],
    stopMailThread: (threadId) => mailbox?.stopThread(threadId) ?? false,
    close: async () => {
      releaseAddress()
      state.closed = true
      const stopped = await Promise.allSettled([
        stopCredentialBinding?.(),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ])
      const failure = stopped.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    },
  }
  try {
    await runAbortable(
      async () => opts.onReadReady?.({ ...handle.readOnly, ...identity }),
      opts.scope.signal,
      'read capability publication aborted',
    )
    await runAbortable(
      async () => opts.onControlReady?.(handle.control),
      opts.scope.signal,
      'control capability publication aborted',
    )
  } catch (error) {
    await handle.close()
    throw error
  }
  return { handle, controls: coord }
}

export function coordinationBindingHost(address: string) {
  const { hostname } = new URL(address)
  return isLoopbackHost(hostname) || isIP(hostname.replace(/^\[|\]$/g, ''))
    ? undefined
    : hostname
}
