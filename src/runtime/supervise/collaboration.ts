/**
 * Scoped collaboration for live Runtime actors.
 *
 * Runtime already has authoritative parent/child coordination: questions and findings travel up;
 * answers, steering, and stop travel down. Collaboration is the non-authoritative SIDEWAYS channel.
 * It lets managers, workers, nested leads, and explicitly federated graphs exchange bounded typed
 * messages without granting one actor another actor's control capabilities.
 *
 * One hub may serve one tree or several explicitly connected trees. Actors may communicate only
 * when they share a group. The default `team` scope joins each manager with its direct children;
 * `graph` additionally joins every actor in one Runtime graph. A caller may add exact custom group
 * ids with `groupsForActor`; sharing a hub plus a custom group is the explicit cross-graph seam.
 *
 * Messages are direct, not broadcast. This keeps context pull-based: `read_mail` shows relevant
 * peers and retained messages, while a best-effort notification may also wake a live inbox. Large
 * artifacts and traces travel by reference in `evidenceRefs`, not by copying whole transcripts.
 *
 * @experimental
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type { McpToolDescriptor } from '../../mcp/protocol'
import type { Scope } from './types'

export type CollaborationKind = 'ask' | 'tell' | 'challenge' | 'answer'
export type CollaborationRole = 'manager' | 'worker' | 'analyst'
export type CollaborationScope = 'team' | 'graph' | 'none'

export interface CollaborationActorContext {
  /** Globally unambiguous within a shared hub. Runtime derives this from graphId + localId. */
  readonly actorId: string
  /** The Runtime graph/run namespace. */
  readonly graphId: string
  /** Scope-local node id (`root`, `root:s0`, ...). */
  readonly localId: string
  readonly label: string
  readonly profileName?: string
  readonly parentActorId?: string
  readonly roles: ReadonlyArray<CollaborationRole>
}

export type ResolveCollaborationGroups = (
  actor: CollaborationActorContext,
) => ReadonlyArray<string>

export interface CollaborationConfig {
  /** Reuse one hub to connect several supervise calls explicitly. */
  readonly hub?: CollaborationHub
  /** `team` by default; `graph` adds a whole-graph group; `none` uses custom groups only. */
  readonly scope?: CollaborationScope
  /** Exact additional group ids. Same id + same hub is the explicit federation mechanism. */
  readonly groupsForActor?: ResolveCollaborationGroups
  /** Valid only when Runtime creates the hub. A shared hub already owns its limits. */
  readonly limits?: Partial<CollaborationLimits>
}

/** Normalized once per supervise invocation and shared by every recursive manager in that tree. */
export interface CollaborationRuntime {
  readonly hub: CollaborationHub
  readonly graphId: string
  readonly scope: CollaborationScope
  readonly groupsForActor?: ResolveCollaborationGroups
}

export interface CollaborationMessage {
  readonly mailId: string
  readonly threadId: string
  readonly depth: number
  readonly from: string
  readonly to: string
  /** The exact group authorizing this edge. */
  readonly groupId: string
  readonly kind: CollaborationKind
  readonly subject: string
  readonly body: string
  readonly evidenceRefs: ReadonlyArray<string>
  readonly replyTo?: string
  readonly at: number
}

export type CollaborationRefusal =
  | 'sender-unbound'
  | 'self-addressed'
  | 'send-quota-exhausted'
  | 'mailbox-full'
  | 'thread-depth-exceeded'
  | 'thread-stopped'
  | 'unknown-reply-target'
  | 'evidence-required'
  | 'subject-too-large'
  | 'body-too-large'
  | 'forged-authority'
  | 'unknown-worker'
  | 'ambiguous-target'
  | 'no-shared-group'
  | 'unknown-group'
  | 'group-required'
  | 'already-settled'
  | 'worker-has-no-inbox'
  | 'scope-stopped'
  | 'runtime-error'

export type CollaborationOutcome = 'delivered' | CollaborationRefusal

export interface CollaborationEvent {
  readonly envelope: CollaborationMessage
  readonly delivered: boolean
  /** Whether Runtime also pushed the message into a live actor inbox. The retained mailbox is truth. */
  readonly notified: boolean
  readonly outcome: CollaborationOutcome
  readonly bodyDigest: string
  readonly error?: string
}

export interface CollaborationLimits {
  readonly maxSentPerActor: number
  readonly maxInboxPerActor: number
  readonly maxInboxBytesPerActor: number
  readonly maxThreadDepth: number
  readonly maxBodyBytes: number
  readonly maxSubjectBytes: number
}

export const DEFAULT_COLLABORATION_LIMITS: CollaborationLimits = Object.freeze({
  maxSentPerActor: 8,
  maxInboxPerActor: 16,
  maxInboxBytesPerActor: 32_768,
  maxThreadDepth: 4,
  maxBodyBytes: 4_096,
  maxSubjectBytes: 200,
})

export const AUTHORITY_MARKERS: ReadonlyArray<string> = Object.freeze([
  '[SUPERVISOR]',
  'from your supervisor',
  'Answer from your supervisor',
])

/** Kept as `mail` on the wire for backward-compatible worker inbox parsing. */
export const COLLABORATION_WIRE_KEY = 'mail'
export const collaborationVerbNames = ['send_mail', 'read_mail'] as const

export interface CollaborationPeer {
  readonly actorId: string
  /** Compatibility/local addressing alias. Use actorId when several graphs are federated. */
  readonly workerId: string
  readonly graphId: string
  readonly label: string
  readonly profileName?: string
  readonly roles: ReadonlyArray<CollaborationRole>
  readonly groups: ReadonlyArray<string>
}

export interface CollaborationReadout {
  readonly you: string
  readonly localId: string
  readonly groups: ReadonlyArray<string>
  readonly inbox: ReadonlyArray<CollaborationMessage>
  readonly peers: ReadonlyArray<CollaborationPeer>
  readonly sent: number
  readonly sendQuotaLeft: number | null
  readonly limits: CollaborationLimits
}

export interface CollaborationSendInput {
  /** Exact actorId, or a local workerId when that name is unambiguous among visible peers. */
  readonly to: unknown
  readonly groupId?: unknown
  readonly kind: unknown
  readonly subject: unknown
  readonly body: unknown
  readonly evidenceRefs?: unknown
  readonly replyTo?: unknown
}

export interface CollaborationActorRegistration extends CollaborationActorContext {
  readonly groups: ReadonlyArray<string>
  readonly isLive: () => boolean
  /** Best-effort turn notification. The retained mailbox remains readable when omitted. */
  readonly notify?: (message: CollaborationMessage) => boolean
  /** Workers normally require a live inbox; managers may operate mailbox-only through read_mail. */
  readonly mailboxOnly?: boolean
  /** Owner-local durable/audit projection. The hub itself retains one global event history. */
  readonly publish?: (event: CollaborationEvent) => void | Promise<void>
}

export interface CollaborationHub {
  readonly limits: CollaborationLimits
  registerActor(actor: CollaborationActorRegistration): string
  /** Mark an actor registration inactive without deleting its retained messages or history. */
  unregisterActor(actorId: string): void
  mintCapability(key: string, baseUrl: string): string
  bindCapability(key: string, actorId: string): void
  hasCapability(capabilityId: string): boolean
  tools(capabilityId: string): McpToolDescriptor[]
  toolsForActor(actorId: string): McpToolDescriptor[]
  send(actorId: string, input: CollaborationSendInput): Promise<CollaborationEvent>
  read(actorId: string): CollaborationReadout
  stopThread(threadId: string): boolean
  history(): ReadonlyArray<CollaborationEvent>
}

export interface CreateCollaborationHubOptions {
  readonly limits?: Partial<CollaborationLimits>
  readonly now?: () => number
  readonly onEvent?: (event: CollaborationEvent) => void | Promise<void>
}

export interface CollaborationManagerRegistration {
  readonly label: string
  readonly profileName?: string
  readonly parentActorId?: string
  readonly isLive?: () => boolean
  readonly notify?: (message: CollaborationMessage) => boolean
}

/** One manager-bound endpoint adapter used by createCoordinationTools. */
export interface CollaborationMailbox {
  readonly hub: CollaborationHub
  readonly limits: CollaborationLimits
  readonly managerActorId?: string
  setEndpoint(baseUrl: string): void
  mintCapability(assignmentId: string): string | undefined
  bindCapability(
    assignmentId: string,
    workerId: string,
    details?: {
      readonly label?: string
      readonly profileName?: string
      readonly analyst?: string
    },
  ): void
  hasCapability(capabilityId: string): boolean
  tools(capabilityId: string): McpToolDescriptor[]
  managerTools(): McpToolDescriptor[]
  send(capabilityId: string, input: CollaborationSendInput): Promise<CollaborationEvent>
  read(capabilityId: string): CollaborationReadout
  stopThread(threadId: string): boolean
  history(): ReadonlyArray<CollaborationEvent>
}

export interface CollaborationMailboxOptions {
  readonly runtime: CollaborationRuntime
  readonly scope: Scope<unknown>
  readonly publish: (event: CollaborationEvent) => void | Promise<void>
  readonly manager?: CollaborationManagerRegistration
}

const utf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf8')
const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

export function claimsAuthority(text: string): boolean {
  const haystack = text.toLowerCase()
  return AUTHORITY_MARKERS.some((marker) => haystack.includes(marker.toLowerCase()))
}

export function isCollaborationMessage(value: unknown): value is CollaborationMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    typeof message.mailId === 'string' &&
    typeof message.threadId === 'string' &&
    typeof message.depth === 'number' &&
    typeof message.from === 'string' &&
    typeof message.to === 'string' &&
    typeof message.groupId === 'string' &&
    isCollaborationKind(message.kind) &&
    typeof message.subject === 'string' &&
    typeof message.body === 'string' &&
    Array.isArray(message.evidenceRefs) &&
    message.evidenceRefs.every((ref) => typeof ref === 'string')
  )
}

export function collaborationActorId(graphId: string, localId: string): string {
  return `${nonEmpty(graphId, 'collaboration graphId')}#${nonEmpty(localId, 'collaboration localId')}`
}

export function createCollaborationRuntime(
  value: boolean | CollaborationConfig | undefined,
  graphId: string,
): CollaborationRuntime | undefined {
  if (value === undefined || value === false) return undefined
  const config = value === true ? {} : value
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('collaboration must be true or a CollaborationConfig object')
  }
  if (config.hub !== undefined && config.limits !== undefined) {
    throw new TypeError('collaboration.limits belongs to a newly-created hub; a shared hub owns its limits')
  }
  const scope = config.scope ?? 'team'
  if (scope !== 'team' && scope !== 'graph' && scope !== 'none') {
    throw new TypeError(`collaboration.scope is invalid: ${String(scope)}`)
  }
  if (config.groupsForActor !== undefined && typeof config.groupsForActor !== 'function') {
    throw new TypeError('collaboration.groupsForActor must be a function when present')
  }
  return Object.freeze({
    hub: config.hub ?? createCollaborationHub({ limits: config.limits }),
    graphId: nonEmpty(graphId, 'collaboration graphId'),
    scope,
    ...(config.groupsForActor === undefined ? {} : { groupsForActor: config.groupsForActor }),
  })
}

export function collaborationGroupsForActor(
  runtime: CollaborationRuntime,
  actor: Omit<CollaborationActorContext, 'actorId'> & { readonly actorId?: string },
): ReadonlyArray<string> {
  const actorId = actor.actorId ?? collaborationActorId(actor.graphId, actor.localId)
  const exact: CollaborationActorContext = Object.freeze({ ...actor, actorId })
  const groups = new Set<string>()
  if (runtime.scope === 'team' || runtime.scope === 'graph') {
    if (actor.parentActorId !== undefined) groups.add(`team:${actor.graphId}:${actor.parentActorId}`)
    if (actor.roles.includes('manager')) groups.add(`team:${actor.graphId}:${actorId}`)
  }
  if (runtime.scope === 'graph') groups.add(`graph:${actor.graphId}`)
  for (const group of runtime.groupsForActor?.(exact) ?? []) groups.add(groupId(group))
  return Object.freeze([...groups].sort(compareText))
}

export function createCollaborationHub(options: CreateCollaborationHubOptions = {}): CollaborationHub {
  const limits = normalizeLimits(options.limits)
  const now = options.now ?? Date.now
  const actors = new Map<
    string,
    {
      context: CollaborationActorContext
      groups: Set<string>
      roles: Set<CollaborationRole>
      liveChecks: Set<() => boolean>
      notifications: Set<(message: CollaborationMessage) => boolean>
      publishers: Set<(event: CollaborationEvent) => void | Promise<void>>
      mailboxOnly: boolean
      active: boolean
    }
  >()
  const actorByCapability = new Map<string, string>()
  const capabilityByKey = new Map<string, string>()
  const sentByActor = new Map<string, number>()
  const inboxLoad = new Map<string, { count: number; bytes: number }>()
  const inboxByActor = new Map<string, CollaborationMessage[]>()
  const messageById = new Map<string, CollaborationMessage>()
  const stoppedThreads = new Set<string>()
  const log: CollaborationEvent[] = []

  const actorIsLive = (actorId: string): boolean => {
    const actor = actors.get(actorId)
    if (!actor?.active) return false
    for (const check of actor.liveChecks) {
      try {
        if (check()) return true
      } catch {
        // A broken liveness probe never upgrades an actor to live.
      }
    }
    return actor.liveChecks.size === 0
  }

  const actorGroups = (actorId: string): ReadonlyArray<string> =>
    Object.freeze([...(actors.get(actorId)?.groups ?? [])].sort(compareText))

  const visiblePeers = (actorId: string): CollaborationPeer[] => {
    const sourceGroups = new Set(actorGroups(actorId))
    const peers: CollaborationPeer[] = []
    for (const [candidateId, actor] of actors) {
      if (candidateId === actorId || !actorIsLive(candidateId)) continue
      const shared = [...actor.groups].filter((group) => sourceGroups.has(group)).sort(compareText)
      if (shared.length === 0) continue
      peers.push({
        actorId: candidateId,
        workerId: actor.context.localId,
        graphId: actor.context.graphId,
        label: actor.context.label,
        ...(actor.context.profileName === undefined
          ? {}
          : { profileName: actor.context.profileName }),
        roles: Object.freeze([...actor.roles].sort(compareText)),
        groups: Object.freeze(shared),
      })
    }
    return peers.sort((left, right) => compareText(left.actorId, right.actorId))
  }

  const resolveTarget = (
    senderId: string,
    rawTarget: string,
  ): { actorId?: string; refusal?: CollaborationRefusal } => {
    if (actors.has(rawTarget)) return { actorId: rawTarget }
    const matches = visiblePeers(senderId).filter((peer) => peer.workerId === rawTarget)
    if (matches.length === 1) return { actorId: matches[0]!.actorId }
    if (matches.length > 1) return { refusal: 'ambiguous-target' }
    return { refusal: 'unknown-worker' }
  }

  const publish = async (actorId: string, event: CollaborationEvent): Promise<void> => {
    log.push(event)
    await options.onEvent?.(event)
    const actor = actors.get(actorId)
    if (!actor) return
    for (const sink of actor.publishers) await sink(event)
  }

  const send = async (
    actorId: string,
    input: CollaborationSendInput,
  ): Promise<CollaborationEvent> => {
    if (!isCollaborationKind(input.kind)) {
      throw new Error('collaboration: "kind" must be ask, tell, challenge, or answer')
    }
    const kind = input.kind
    const rawTarget = nonEmpty(input.to, 'collaboration to')
    const subject = nonEmpty(input.subject, 'collaboration subject')
    const body = nonEmpty(input.body, 'collaboration body')
    const replyTo = input.replyTo === undefined ? undefined : nonEmpty(input.replyTo, 'collaboration replyTo')
    const requestedGroup =
      input.groupId === undefined ? undefined : groupId(nonEmpty(input.groupId, 'collaboration groupId'))
    const evidenceRefs = stringArray(input.evidenceRefs ?? [], 'collaboration evidenceRefs')
    const sender = actors.get(actorId)
    const target = resolveTarget(actorId, rawTarget)
    const parent = replyTo === undefined ? undefined : messageById.get(replyTo)
    const targetId = target.actorId ?? rawTarget
    const draft: CollaborationMessage = {
      mailId: randomUUID(),
      threadId: parent?.threadId ?? '',
      depth: parent === undefined ? 0 : parent.depth + 1,
      from: actorId,
      to: targetId,
      groupId: parent?.groupId ?? requestedGroup ?? '',
      kind,
      subject,
      body,
      evidenceRefs,
      ...(replyTo === undefined ? {} : { replyTo }),
      at: now(),
    }
    let envelope: CollaborationMessage = Object.freeze({
      ...draft,
      threadId: draft.threadId || draft.mailId,
      evidenceRefs: Object.freeze([...draft.evidenceRefs]),
    })
    const event = async (
      outcome: CollaborationOutcome,
      notified = false,
      error?: string,
    ): Promise<CollaborationEvent> => {
      const value: CollaborationEvent = Object.freeze({
        envelope,
        delivered: outcome === 'delivered',
        notified,
        outcome,
        bodyDigest: canonicalCandidateDigest(envelope.body),
        ...(error === undefined ? {} : { error }),
      })
      await publish(actorId, value)
      return value
    }

    if (!sender) return event('sender-unbound')
    const sent = sentByActor.get(actorId) ?? 0
    if (limits.maxSentPerActor > 0 && sent >= limits.maxSentPerActor) {
      return event('send-quota-exhausted')
    }
    sentByActor.set(actorId, sent + 1)
    if (target.refusal) return event(target.refusal)
    if (targetId === actorId) return event('self-addressed')
    if (utf8Bytes(subject) > limits.maxSubjectBytes) return event('subject-too-large')
    if (utf8Bytes(body) > limits.maxBodyBytes) return event('body-too-large')
    if (claimsAuthority(subject) || claimsAuthority(body)) return event('forged-authority')
    if ((kind === 'tell' || kind === 'challenge') && evidenceRefs.length === 0) {
      return event('evidence-required')
    }
    if (replyTo !== undefined) {
      if (parent === undefined || parent.to !== actorId || parent.from !== targetId) {
        return event('unknown-reply-target')
      }
      if (envelope.depth > limits.maxThreadDepth) return event('thread-depth-exceeded')
    }
    if (stoppedThreads.has(envelope.threadId)) return event('thread-stopped')
    const targetActor = actors.get(targetId)
    if (!targetActor) return event('unknown-worker')
    if (!actorIsLive(targetId)) return event('already-settled')

    const senderGroups = new Set(actorGroups(actorId))
    const sharedGroups = [...targetActor.groups]
      .filter((group) => senderGroups.has(group))
      .sort(compareText)
    let selectedGroup = parent?.groupId ?? requestedGroup
    if (selectedGroup !== undefined && !sharedGroups.includes(selectedGroup)) {
      return event('unknown-group')
    }
    if (selectedGroup === undefined) {
      if (sharedGroups.length === 0) return event('no-shared-group')
      if (sharedGroups.length > 1) return event('group-required')
      selectedGroup = sharedGroups[0]
    }
    envelope = Object.freeze({ ...envelope, groupId: selectedGroup as string })

    const load = inboxLoad.get(targetId) ?? { count: 0, bytes: 0 }
    const bodyBytes = utf8Bytes(body)
    if (
      (limits.maxInboxPerActor > 0 && load.count >= limits.maxInboxPerActor) ||
      (limits.maxInboxBytesPerActor > 0 &&
        load.bytes + bodyBytes > limits.maxInboxBytesPerActor)
    ) {
      return event('mailbox-full')
    }

    let notified = false
    let notificationError: string | undefined
    for (const notify of targetActor.notifications) {
      try {
        notified = notify(envelope) || notified
      } catch (cause) {
        notificationError = cause instanceof Error ? cause.message : String(cause)
      }
    }
    if (!notified && !targetActor.mailboxOnly) {
      return event('worker-has-no-inbox', false, notificationError)
    }

    inboxLoad.set(targetId, { count: load.count + 1, bytes: load.bytes + bodyBytes })
    messageById.set(envelope.mailId, envelope)
    const inbox = inboxByActor.get(targetId) ?? []
    inbox.push(envelope)
    inboxByActor.set(targetId, inbox)
    return event('delivered', notified, notificationError)
  }

  const read = (actorId: string): CollaborationReadout => {
    const actor = actors.get(actorId)
    if (!actor) throw new Error(`collaboration: unknown actor ${JSON.stringify(actorId)}`)
    const sent = sentByActor.get(actorId) ?? 0
    return Object.freeze({
      you: actorId,
      localId: actor.context.localId,
      groups: actorGroups(actorId),
      inbox: Object.freeze([...(inboxByActor.get(actorId) ?? [])]),
      peers: Object.freeze(visiblePeers(actorId)),
      sent,
      sendQuotaLeft:
        limits.maxSentPerActor > 0 ? Math.max(0, limits.maxSentPerActor - sent) : null,
      limits,
    })
  }

  const hub: CollaborationHub = {
    limits,
    registerActor(raw) {
      const actorId = collaborationActorId(raw.graphId, raw.localId)
      if (raw.actorId !== actorId) {
        throw new Error(
          `collaboration actorId mismatch: expected ${JSON.stringify(actorId)}, received ${JSON.stringify(raw.actorId)}`,
        )
      }
      const groups = raw.groups.map(groupId)
      const roles = raw.roles.map(role)
      const existing = actors.get(actorId)
      if (existing) {
        existing.active = true
        for (const group of groups) existing.groups.add(group)
        for (const item of roles) existing.roles.add(item)
        existing.liveChecks.add(raw.isLive)
        if (raw.notify) existing.notifications.add(raw.notify)
        if (raw.publish) existing.publishers.add(raw.publish)
        existing.mailboxOnly ||= raw.mailboxOnly === true
        return actorId
      }
      actors.set(actorId, {
        context: Object.freeze({
          actorId,
          graphId: nonEmpty(raw.graphId, 'collaboration actor.graphId'),
          localId: nonEmpty(raw.localId, 'collaboration actor.localId'),
          label: nonEmpty(raw.label, 'collaboration actor.label'),
          ...(raw.profileName === undefined
            ? {}
            : { profileName: nonEmpty(raw.profileName, 'collaboration actor.profileName') }),
          ...(raw.parentActorId === undefined
            ? {}
            : { parentActorId: nonEmpty(raw.parentActorId, 'collaboration actor.parentActorId') }),
          roles: Object.freeze(roles),
        }),
        groups: new Set(groups),
        roles: new Set(roles),
        liveChecks: new Set([raw.isLive]),
        notifications: new Set(raw.notify ? [raw.notify] : []),
        publishers: new Set(raw.publish ? [raw.publish] : []),
        mailboxOnly: raw.mailboxOnly === true,
        active: true,
      })
      return actorId
    },
    unregisterActor(actorId) {
      const actor = actors.get(actorId)
      if (actor) actor.active = false
    },
    mintCapability(key, baseUrl) {
      const exactKey = nonEmpty(key, 'collaboration capability key')
      const endpoint = nonEmpty(baseUrl, 'collaboration capability baseUrl').replace(/\/+$/, '')
      const existing = capabilityByKey.get(exactKey)
      if (existing) return `${endpoint}/${existing}`
      const capabilityId = randomBytes(16).toString('hex')
      capabilityByKey.set(exactKey, capabilityId)
      return `${endpoint}/${capabilityId}`
    },
    bindCapability(key, actorId) {
      const capabilityId = capabilityByKey.get(nonEmpty(key, 'collaboration capability key'))
      if (!capabilityId) return
      if (!actors.has(actorId)) throw new Error(`collaboration: cannot bind unknown actor ${actorId}`)
      actorByCapability.set(capabilityId, actorId)
    },
    hasCapability: (capabilityId) => actorByCapability.has(capabilityId),
    tools: (capabilityId) => collaborationTools(hub, () => actorByCapability.get(capabilityId)),
    toolsForActor: (actorId) => collaborationTools(hub, () => actorId),
    send,
    read,
    stopThread(threadId) {
      const exact = nonEmpty(threadId, 'collaboration threadId')
      if (stoppedThreads.has(exact)) return false
      stoppedThreads.add(exact)
      return true
    },
    history: () => Object.freeze([...log]),
  }
  return hub
}

export function createCollaborationMailbox(
  options: CollaborationMailboxOptions,
): CollaborationMailbox {
  const { runtime, scope } = options
  let endpoint: string | undefined
  const localEvents: CollaborationEvent[] = []
  const publish = async (event: CollaborationEvent): Promise<void> => {
    localEvents.push(event)
    await options.publish(event)
  }
  const managerActorId = options.manager
    ? registerLocalActor(runtime, scope, publish, {
        localId: scope.view.root,
        label: options.manager.label,
        ...(options.manager.profileName === undefined
          ? {}
          : { profileName: options.manager.profileName }),
        ...(options.manager.parentActorId === undefined
          ? {}
          : { parentActorId: options.manager.parentActorId }),
        roles: ['manager'],
        isLive: options.manager.isLive ?? (() => !scope.signal.aborted),
        ...(options.manager.notify === undefined
          ? { mailboxOnly: true }
          : { notify: options.manager.notify, mailboxOnly: true }),
      })
    : undefined

  const keyFor = (assignmentId: string): string =>
    `${runtime.graphId}:${scope.view.root}:${nonEmpty(assignmentId, 'collaboration assignmentId')}`

  return {
    hub: runtime.hub,
    limits: runtime.hub.limits,
    ...(managerActorId === undefined ? {} : { managerActorId }),
    setEndpoint(baseUrl) {
      endpoint = nonEmpty(baseUrl, 'collaboration endpoint').replace(/\/+$/, '')
    },
    mintCapability(assignmentId) {
      if (!endpoint) return undefined
      return runtime.hub.mintCapability(keyFor(assignmentId), endpoint)
    },
    bindCapability(assignmentId, workerId, details = {}) {
      const node = scope.view.nodes.find((candidate) => candidate.id === workerId)
      const actorId = registerLocalActor(runtime, scope, publish, {
        localId: workerId,
        label: details.label ?? node?.label ?? workerId,
        ...(details.profileName === undefined ? {} : { profileName: details.profileName }),
        parentActorId: collaborationActorId(runtime.graphId, scope.view.root),
        roles: details.analyst === undefined ? ['worker'] : ['worker', 'analyst'],
        isLive: () => {
          const live = scope.view.nodes.find((candidate) => candidate.id === workerId)
          return live !== undefined && !isTerminalStatus(live.status) && !scope.signal.aborted
        },
        notify: (message) => scope.send(workerId, { [COLLABORATION_WIRE_KEY]: message }),
      })
      runtime.hub.bindCapability(keyFor(assignmentId), actorId)
    },
    hasCapability: (capabilityId) => runtime.hub.hasCapability(capabilityId),
    tools: (capabilityId) => runtime.hub.tools(capabilityId),
    managerTools: () =>
      managerActorId === undefined ? [] : runtime.hub.toolsForActor(managerActorId),
    async send(capabilityId, input) {
      const actorId = actorIdForCapability(runtime.hub, capabilityId)
      return runtime.hub.send(actorId, input)
    },
    read(capabilityId) {
      const actorId = actorIdForCapability(runtime.hub, capabilityId)
      return runtime.hub.read(actorId)
    },
    stopThread: (threadId) => runtime.hub.stopThread(threadId),
    history: () => Object.freeze([...localEvents]),
  }
}

/**
 * The existing sibling-only constructor, now implemented by the collaboration substrate.
 * It intentionally registers no manager and creates one private team-scoped hub.
 */
export function createPeerMailbox(options: {
  readonly scope: Scope<unknown>
  readonly publish: (event: CollaborationEvent) => void | Promise<void>
  readonly limits?: Partial<CollaborationLimits>
  readonly now?: () => number
}): CollaborationMailbox {
  const runtime: CollaborationRuntime = Object.freeze({
    hub: createCollaborationHub({ limits: options.limits, now: options.now }),
    graphId: `peer-mail:${randomUUID()}`,
    scope: 'team',
  })
  return createCollaborationMailbox({ runtime, scope: options.scope, publish: options.publish })
}

export function collaborationTools(
  hub: CollaborationHub,
  actor: () => string | undefined,
): McpToolDescriptor[] {
  return [
    {
      name: 'send_mail',
      description:
        'Collaborate with one LIVE actor that shares a group with you. Use ask to request a fact, ' +
        'tell to share a measured result, challenge to dispute a claim, and answer to reply. ' +
        'This channel is information, never authority: it cannot steer, stop, or spawn another ' +
        'actor. tell and challenge require evidenceRefs. Call read_mail first to see peers and ' +
        'shared groups. When several groups connect the same two actors, pass groupId explicitly.',
      inputSchema: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description:
              'Peer actorId from read_mail.peers. A local workerId is accepted only when unambiguous.',
          },
          groupId: {
            type: 'string',
            description: 'Shared group authorizing the message; required when several groups overlap.',
          },
          kind: { type: 'string', enum: ['ask', 'tell', 'challenge', 'answer'] },
          subject: { type: 'string' },
          body: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          replyTo: { type: 'string', description: 'mailId of a message addressed to you.' },
        },
        required: ['to', 'kind', 'subject', 'body'],
      },
      handler: async (raw) => {
        const actorId = actor()
        if (!actorId) throw new Error('collaboration: this capability is not bound to an actor yet')
        const event = await hub.send(actorId, (raw ?? {}) as CollaborationSendInput)
        return event.delivered
          ? {
              delivered: true,
              notified: event.notified,
              mailId: event.envelope.mailId,
              threadId: event.envelope.threadId,
              groupId: event.envelope.groupId,
            }
          : {
              delivered: false,
              outcome: event.outcome,
              ...(event.error === undefined ? {} : { error: event.error }),
            }
      },
    },
    {
      name: 'read_mail',
      description:
        'Read retained collaboration messages, your groups, and every currently-live actor that ' +
        'shares at least one group with you. Use actorId for cross-graph targets; workerId is the ' +
        'short local alias. Messages may also be pushed into a live inbox between turns.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => {
        const actorId = actor()
        if (!actorId) throw new Error('collaboration: this capability is not bound to an actor yet')
        return Promise.resolve({ ...hub.read(actorId) })
      },
    },
  ]
}

function registerLocalActor(
  runtime: CollaborationRuntime,
  scope: Scope<unknown>,
  publish: (event: CollaborationEvent) => void | Promise<void>,
  input: {
    readonly localId: string
    readonly label: string
    readonly profileName?: string
    readonly parentActorId?: string
    readonly roles: ReadonlyArray<CollaborationRole>
    readonly isLive: () => boolean
    readonly notify?: (message: CollaborationMessage) => boolean
    readonly mailboxOnly?: boolean
  },
): string {
  const actorId = collaborationActorId(runtime.graphId, input.localId)
  const context: CollaborationActorContext = Object.freeze({
    actorId,
    graphId: runtime.graphId,
    localId: input.localId,
    label: input.label,
    ...(input.profileName === undefined ? {} : { profileName: input.profileName }),
    ...(input.parentActorId === undefined ? {} : { parentActorId: input.parentActorId }),
    roles: Object.freeze([...input.roles]),
  })
  return runtime.hub.registerActor({
    ...context,
    groups: collaborationGroupsForActor(runtime, context),
    isLive: input.isLive,
    ...(input.notify === undefined ? {} : { notify: input.notify }),
    ...(input.mailboxOnly === undefined ? {} : { mailboxOnly: input.mailboxOnly }),
    publish,
  })
}

function actorIdForCapability(hub: CollaborationHub, capabilityId: string): string {
  const tools = hub.tools(capabilityId)
  // Avoid exposing a separate capability-inspection primitive. The first tool closure verifies the
  // binding, while callers of send/read still need the actor id. Use read_mail's handler once and
  // return its `you` field; this path is local and contains no model/tool transport.
  const readTool = tools.find((tool) => tool.name === 'read_mail')
  if (!readTool) throw new Error('collaboration: capability exposes no read_mail tool')
  const holder = (hub as CollaborationHub & {
    readonly __actorByCapability?: ReadonlyMap<string, string>
  }).__actorByCapability
  const actorId = holder?.get(capabilityId)
  if (!actorId) throw new Error('collaboration: this capability is not bound to an actor yet')
  return actorId
}

function normalizeLimits(value: Partial<CollaborationLimits> | undefined): CollaborationLimits {
  const limits = { ...DEFAULT_COLLABORATION_LIMITS, ...(value ?? {}) }
  for (const [key, raw] of Object.entries(limits)) {
    if (!Number.isSafeInteger(raw) || raw < 0) {
      throw new TypeError(`collaboration limit ${key} must be a non-negative safe integer`)
    }
  }
  return Object.freeze(limits)
}

function isCollaborationKind(value: unknown): value is CollaborationKind {
  return value === 'ask' || value === 'tell' || value === 'challenge' || value === 'answer'
}

function role(value: unknown): CollaborationRole {
  if (value === 'manager' || value === 'worker' || value === 'analyst') return value
  throw new TypeError(`collaboration role is invalid: ${String(value)}`)
}

function groupId(value: unknown): string {
  const group = nonEmpty(value, 'collaboration group')
  if (group.length > 256) throw new TypeError('collaboration group must be at most 256 characters')
  return group
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be a trimmed non-empty string`)
  }
  return value
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of strings`)
  return value.map((entry, index) => nonEmpty(entry, `${label}[${index}]`))
}

function isTerminalStatus(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

// Compatibility names. The implementation and state remain singular.
export type PeerMailKind = CollaborationKind
export type PeerMailEnvelope = CollaborationMessage
export type PeerMailRefusal = CollaborationRefusal
export type PeerMailOutcome = CollaborationOutcome
export type PeerMailEvent = CollaborationEvent
export interface PeerMailLimits {
  readonly maxSentPerWorker: number
  readonly maxInboxPerWorker: number
  readonly maxInboxBytesPerWorker: number
  readonly maxThreadDepth: number
  readonly maxBodyBytes: number
  readonly maxSubjectBytes: number
}
export type PeerMailReadout = CollaborationReadout
export type PeerMailSendInput = CollaborationSendInput
export type PeerMailbox = CollaborationMailbox
export type PeerMailboxOptions = Parameters<typeof createPeerMailbox>[0]
export const DEFAULT_PEER_MAIL_LIMITS: PeerMailLimits = Object.freeze({
  maxSentPerWorker: DEFAULT_COLLABORATION_LIMITS.maxSentPerActor,
  maxInboxPerWorker: DEFAULT_COLLABORATION_LIMITS.maxInboxPerActor,
  maxInboxBytesPerWorker: DEFAULT_COLLABORATION_LIMITS.maxInboxBytesPerActor,
  maxThreadDepth: DEFAULT_COLLABORATION_LIMITS.maxThreadDepth,
  maxBodyBytes: DEFAULT_COLLABORATION_LIMITS.maxBodyBytes,
  maxSubjectBytes: DEFAULT_COLLABORATION_LIMITS.maxSubjectBytes,
})
export const PEER_MAIL_WIRE_KEY = COLLABORATION_WIRE_KEY
export const peerMailVerbNames = collaborationVerbNames
export const isPeerMailEnvelope = isCollaborationMessage
export const peerMailTools = collaborationTools
