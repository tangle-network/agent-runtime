import { ProxySecretsSchema } from '@tangle-network/agent-interface'
import {
  mergeProxySecretBindings,
  type ProxySecretBinding,
} from '@tangle-network/agent-interface/environment-provider'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import {
  captureProxySecretBindingAdmission,
  type ProxySecretBindingAdmission,
} from '../proxy-secret-admission'
import { captureProxySecretParents } from '../proxy-secret-parents'
import type { CoordinationProxySecretSourceIdentity } from './coordination-credential'
import { detachedSnapshot } from './snapshot'
import type { ResultBlobStore, SpawnEvent, SpawnJournal } from './types'

interface AuthorityOwner {
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly rootId: string
  readonly nodeId: string
  readonly nextSequence: () => number
  readonly now: () => number
}

/** Private host evidence shares the existing CAS and journal, never the model evidence writer. */
export function runtimeAuthorityEvidence<T>(
  args: AuthorityOwner & {
    readonly authority: 'coordination-credential-generation' | 'proxy-secret-binding-admission'
    readonly capture: (value: unknown) => T
  },
): {
  readonly write: (value: unknown) => Promise<void>
  readonly read: (events?: readonly SpawnEvent[]) => Promise<readonly T[]>
} {
  return {
    write: async (value) => {
      const artifact = detachedSnapshot(args.capture(value), 'host authority evidence')
      const outRef = contentAddress(artifact)
      await args.blobs.put(outRef, artifact)
      await args.journal.appendEvent(args.rootId, {
        kind: 'execution-evidence',
        id: args.nodeId,
        outRef,
        authority: args.authority,
        seq: args.nextSequence(),
        at: new Date(args.now()).toISOString(),
      })
    },
    read: async (prior) => {
      const events = prior ?? (await args.journal.loadTree(args.rootId)) ?? []
      const records: T[] = []
      for (const event of events) {
        if (
          event.kind !== 'execution-evidence' ||
          event.id !== args.nodeId ||
          event.authority !== args.authority
        )
          continue
        const artifact = await args.blobs.get(event.outRef)
        if (artifact === undefined || contentAddress(artifact) !== event.outRef) {
          throw new ValidationError('host authority evidence does not match its content reference')
        }
        records.push(detachedSnapshot(args.capture(artifact), 'host authority evidence'))
      }
      return records
    },
  }
}

/** The fixed wrapper distinguishes host admission artifacts from arbitrary executor payloads. */
export function proxySecretBindingEvidence(
  args: AuthorityOwner & {
    readonly currentRegistration?: () =>
      | {
          readonly binding: ProxySecretBinding
          readonly sourceIdentity: CoordinationProxySecretSourceIdentity
        }
      | undefined
  },
): {
  readonly write: (admission: ProxySecretBindingAdmission) => Promise<void>
  readonly read: () => Promise<readonly ProxySecretBindingAdmission[]>
} {
  const channel = runtimeAuthorityEvidence({
    ...args,
    authority: 'proxy-secret-binding-admission',
    capture: (value: unknown) => {
      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('kind' in value) ||
        value.kind !== 'proxy-secret-binding-admission'
      ) {
        throw new ValidationError('proxy-secret binding evidence is invalid')
      }
      const { kind: _kind, ...admission } = value
      return {
        ...captureProxySecretBindingAdmission(admission),
        kind: 'proxy-secret-binding-admission' as const,
      }
    },
  })
  let writes = Promise.resolve()
  return {
    write: (value) => {
      const admission = captureProxySecretBindingAdmission(value)
      const registration = args.currentRegistration?.()
      const pending = writes.then(async () => {
        const events = ((await args.journal.loadTree(args.rootId)) ?? []).filter(
          (event) => event.id === args.nodeId,
        )
        const history = (await channel.read(events)).map(({ kind: _kind, ...record }) => record)
        assertBindingOwner(events, history, admission, registration)
        await channel.write({ ...admission, kind: 'proxy-secret-binding-admission' })
      })
      writes = pending.catch(() => undefined)
      return pending
    },
    read: async () => (await channel.read()).map(({ kind: _kind, ...admission }) => admission),
  }
}

function selectionMatches(
  selected: ProxySecretBindingAdmission,
  next: ProxySecretBindingAdmission,
): boolean {
  return (
    selected.provider === next.provider &&
    (selected.environmentId === undefined || selected.environmentId === next.environmentId) &&
    selected.idempotencyKey === next.idempotencyKey &&
    contentAddress(selected.proxySecrets) === contentAddress(next.proxySecrets) &&
    contentAddress(selected.proxySecretParents) === contentAddress(next.proxySecretParents) &&
    contentAddress(selected.sourceIdentity ?? null) === contentAddress(next.sourceIdentity ?? null)
  )
}

function lastEventIndex(
  events: readonly SpawnEvent[],
  kind: SpawnEvent['kind'],
  before = events.length,
): number {
  for (let index = before - 1; index >= 0; index--) {
    if (events[index]?.kind === kind) return index
  }
  return -1
}

/** Authority is a pre-existing owner link, never the environment id the new request supplies. */
function assertBindingOwner(
  events: readonly SpawnEvent[],
  history: readonly ProxySecretBindingAdmission[],
  admission: ProxySecretBindingAdmission,
  registration:
    | {
        readonly binding: ProxySecretBinding
        readonly sourceIdentity: CoordinationProxySecretSourceIdentity
      }
    | undefined,
): void {
  const ownership = () =>
    new ValidationError('proxy-secret admission lacks matching durable environment ownership')
  const priorCustody = () =>
    new ValidationError('proxy-secret prior custody differs from durable owner admission')
  const inputIndex = lastEventIndex(events, 'execution-input')
  const input = events[inputIndex]
  if (
    input?.kind !== 'execution-input' ||
    input.proxySecretParents === undefined ||
    contentAddress(captureProxySecretParents(input.proxySecretParents)) !==
      contentAddress(admission.proxySecretParents)
  ) {
    throw new ValidationError('proxy-secret parent pins do not match the durable execution input')
  }
  const authored = ProxySecretsSchema.safeParse(input.proxySecrets)
  if (!authored.success) {
    throw new ValidationError(
      'proxy-secret admission lacks a canonical authored declaration snapshot',
    )
  }
  const selected = mergeProxySecretBindings(
    authored.data,
    registration === undefined ? undefined : [registration.binding],
  )
  if (contentAddress(selected) !== contentAddress(admission.proxySecrets)) {
    throw new ValidationError(
      'proxy-secret selection differs from the authorized authored declaration',
    )
  }
  if (registration !== undefined) {
    if (
      !admission.proxySecrets.some(
        (binding) => contentAddress(binding) === contentAddress(registration.binding),
      ) ||
      contentAddress(admission.sourceIdentity ?? null) !==
        contentAddress(registration.sourceIdentity)
    ) {
      throw new ValidationError('proxy-secret selection differs from the registered host source')
    }
  } else if (admission.sourceIdentity !== undefined) {
    throw new ValidationError('proxy-secret selection has no registered host source')
  }
  const attempt = events.slice(inputIndex)
  const records = attempt.flatMap((event) =>
    event.kind === 'execution-admitted' ? [event.admission] : [],
  )
  const intent = records.find((record) => record.phase === 'intent')
  const environment = records.find((record) => record.phase === 'environment')
  const dispatched = records.find((record) => record.phase === 'dispatched')
  const previousRecords = events.slice(0, inputIndex)
  const resultIndex = lastEventIndex(previousRecords, 'execution-result')
  const previousInput = lastEventIndex(previousRecords, 'execution-input', resultIndex + 1)
  const committed = previousRecords
    .slice(previousInput, resultIndex + 1)
    .flatMap((event) => (event.kind === 'execution-admitted' ? [event.admission] : []))
  const priorEnvironment = committed.find((record) => record.phase === 'environment')
  const previousEvidenceCount = previousRecords.filter(
    (event) =>
      event.kind === 'execution-evidence' && event.authority === 'proxy-secret-binding-admission',
  ).length
  const currentHistory = history.slice(previousEvidenceCount)
  const installed = [...history]
    .reverse()
    .find(
      (record) =>
        record.stage === 'installed' &&
        record.provider === admission.provider &&
        record.environmentId === admission.environmentId,
    )
  const candidate = [...currentHistory]
    .reverse()
    .find((record) => record.stage !== 'installed' && selectionMatches(record, admission))

  const assertKnownEnvironment = () => {
    const owned =
      environment ??
      (dispatched === undefined &&
      intent?.phase === 'intent' &&
      priorEnvironment?.phase === 'environment' &&
      priorEnvironment.idempotencyKey === intent.idempotencyKey
        ? priorEnvironment
        : undefined)
    if (owned?.phase === 'environment' && intent?.phase === 'intent') {
      if (
        owned.provider !== admission.provider ||
        owned.environmentId !== admission.environmentId ||
        owned.idempotencyKey !== intent.idempotencyKey ||
        owned.provider !== intent.provider ||
        (environment !== undefined &&
          (owned.sessionId !== intent.sessionId || owned.executionId !== intent.executionId)) ||
        (dispatched?.phase === 'dispatched' &&
          (dispatched.controlRef.provider !== owned.provider ||
            dispatched.controlRef.environmentId !== owned.environmentId ||
            dispatched.controlRef.sessionId !== owned.sessionId ||
            dispatched.controlRef.executionId !== owned.executionId))
      )
        throw ownership()
      return
    }
    // A legacy adapter has no native run admission, but its earlier create receipt is scoped
    // to this same input and its already-admitted create key.
    const created = [...currentHistory]
      .reverse()
      .find(
        (record) =>
          record.stage === 'installed' &&
          record.priorReceipt === undefined &&
          record.provider === admission.provider &&
          record.environmentId === admission.environmentId,
      )
    if (
      records.length !== 0 ||
      created === undefined ||
      !currentHistory.some(
        (record) =>
          record.stage === 'selected' &&
          record.environmentId === undefined &&
          selectionMatches(record, created),
      )
    )
      throw ownership()
  }

  if (admission.stage === 'selected' && admission.environmentId === undefined) {
    if (
      admission.idempotencyKey === undefined ||
      (intent?.phase === 'intent' &&
        (intent.provider !== admission.provider ||
          intent.idempotencyKey !== admission.idempotencyKey))
    )
      throw ownership()
    const created = [...history]
      .reverse()
      .find(
        (record) =>
          record.stage === 'installed' &&
          record.idempotencyKey === admission.idempotencyKey &&
          record.provider === admission.provider,
      )
    if (created !== undefined) {
      if (created.stage !== 'installed') throw ownership()
      const latest = [...history]
        .reverse()
        .find(
          (record) =>
            record.stage === 'installed' &&
            record.provider === created.provider &&
            record.environmentId === created.environmentId,
        )
      if (
        !selectionMatches(admission, created) ||
        latest?.stage !== 'installed' ||
        contentAddress(latest.receipt) !== contentAddress(created.receipt)
      )
        throw ownership()
    }
    if (
      created === undefined &&
      (environment !== undefined ||
        dispatched !== undefined ||
        currentHistory.some((record) => record.stage === 'installed'))
    )
      throw ownership()
    return
  }
  if (admission.stage === 'installed' && admission.priorReceipt === undefined) {
    if (
      candidate?.stage !== 'selected' ||
      candidate.environmentId !== undefined ||
      admission.idempotencyKey === undefined
    )
      throw ownership()
    if (intent !== undefined && environment === undefined) throw ownership()
    if (environment !== undefined || dispatched !== undefined) assertKnownEnvironment()
    const created = [...history]
      .reverse()
      .find(
        (record) =>
          record.stage === 'installed' &&
          record.provider === admission.provider &&
          record.idempotencyKey === admission.idempotencyKey,
      )
    const known = [...history]
      .reverse()
      .find(
        (record) =>
          record.stage === 'installed' &&
          record.provider === admission.provider &&
          record.environmentId === admission.environmentId,
      )
    if (
      (created !== undefined && created.environmentId !== admission.environmentId) ||
      (known !== undefined &&
        (known.stage !== 'installed' ||
          known.idempotencyKey !== admission.idempotencyKey ||
          !selectionMatches(known, admission) ||
          contentAddress(known.receipt) !== contentAddress(admission.receipt)))
    )
      throw ownership()
    return
  }
  assertKnownEnvironment()
  if (installed?.stage !== 'installed') throw priorCustody()
  if (admission.stage === 'selected') return
  if (candidate === undefined) throw ownership()
  if (admission.stage === 'replacement') {
    if (
      contentAddress(admission.priorReceipt) !== contentAddress(installed.receipt) ||
      contentAddress(admission.proxySecretParents) !==
        contentAddress(installed.proxySecretParents) ||
      admission.expectedProxySecretGeneration !== installed.receipt.generation
    )
      throw priorCustody()
    return
  }
  if (
    candidate.stage !== 'replacement' ||
    contentAddress(admission.priorReceipt ?? null) !== contentAddress(candidate.priorReceipt) ||
    admission.expectedProxySecretGeneration !== candidate.expectedProxySecretGeneration
  )
    throw priorCustody()
}
