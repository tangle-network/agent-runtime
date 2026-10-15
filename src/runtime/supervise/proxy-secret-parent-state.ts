import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import type { SpawnJournal } from './types'
import { captureProxySecretParents, type ProxySecretParents } from '../proxy-secret-parents'

// Only Runtime's admitted agent objects carry these pins. Profile/model metadata cannot supply them.
const parentsByAgent = new WeakMap<object, ProxySecretParents>()

export function bindProxySecretParentState<T extends object>(
  agent: T,
  parents: ProxySecretParents,
): T {
  parentsByAgent.set(agent, captureProxySecretParents(parents))
  return agent
}

export function proxySecretParentState(agent: object): ProxySecretParents | undefined {
  return parentsByAgent.get(agent)
}

/** Verify the final create selection against the value already admitted by this exact owner. */
export async function assertProxySecretParentInput(
  journal: SpawnJournal,
  root: string,
  nodeId: string,
  parents: ProxySecretParents,
): Promise<void> {
  const events = (await journal.loadTree(root)) ?? []
  const input = [...events].reverse().find(event => event.kind === 'execution-input' && event.id === nodeId)
  if (
    input?.kind !== 'execution-input' || input.proxySecretParents === undefined ||
    contentAddress(captureProxySecretParents(input.proxySecretParents)) !==
      contentAddress(captureProxySecretParents(parents))
  ) {
    throw new ValidationError('proxy-secret parent pins do not match the durable execution input')
  }
}
