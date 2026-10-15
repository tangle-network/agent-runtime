import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import {
  captureProxySecretBindingAdmission,
  type ProxySecretBindingAdmission,
} from '../proxy-secret-admission'
import { detachedSnapshot } from './snapshot'
import type { ResultBlobStore, SpawnJournal } from './types'

interface AuthorityOwner {
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly rootId: string
  readonly nodeId: string
  readonly nextSequence: () => number
  readonly now: () => number
}

/** Private host evidence shares the existing CAS and journal, never the model evidence writer. */
export function runtimeAuthorityEvidence<T>(args: AuthorityOwner & {
  readonly authority: 'coordination-credential-generation' | 'proxy-secret-binding-admission'
  readonly capture: (value: unknown) => T
}): {
  readonly write: (value: unknown) => Promise<void>
  readonly read: () => Promise<readonly T[]>
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
    read: async () => {
      const events = (await args.journal.loadTree(args.rootId)) ?? []
      const records: T[] = []
      for (const event of events) {
        if (event.kind !== 'execution-evidence' || event.id !== args.nodeId ||
            event.authority !== args.authority) continue
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
export function proxySecretBindingEvidence(args: AuthorityOwner): {
  readonly write: (admission: ProxySecretBindingAdmission) => Promise<void>
  readonly read: () => Promise<readonly ProxySecretBindingAdmission[]>
} {
  const channel = runtimeAuthorityEvidence({
    ...args,
    authority: 'proxy-secret-binding-admission',
    capture: (value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value) ||
          !('kind' in value) || value.kind !== 'proxy-secret-binding-admission') {
        throw new ValidationError('proxy-secret binding evidence is invalid')
      }
      const { kind: _kind, ...admission } = value
      return {
        ...captureProxySecretBindingAdmission(admission),
        kind: 'proxy-secret-binding-admission' as const,
      }
    },
  })
  return {
    write: (admission) => channel.write({
      ...captureProxySecretBindingAdmission(admission),
      kind: 'proxy-secret-binding-admission',
    }),
    read: async () => (await channel.read()).map(({ kind: _kind, ...admission }) => admission),
  }
}
