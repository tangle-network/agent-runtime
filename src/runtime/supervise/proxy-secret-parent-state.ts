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
