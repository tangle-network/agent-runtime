import { createHash, randomUUID } from 'node:crypto'
import type {
  CreateAgentEnvironmentInput,
  ProxySecretBinding,
  ProxySecretCapabilities,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  CoordinationProxySecretOptions,
  CoordinationPublicAddress,
} from '../../src/runtime/supervise/coordination-mcp'

/** Canonical capability declaration for the bounded test transport, never a production driver. */
export const proxySecretCapabilities = {
  protocolVersion: 1,
  supportedDrivers: ['durable-test'],
  presentations: ['bearer', 'basic', 'header', 'query'],
  placeholderFormats: ['opaque', 'jwt'],
  enforcement: 'exact',
  transports: ['https:443'],
  lifecycle: true,
  placementReceiptRequired: true,
} satisfies ProxySecretCapabilities

interface Credential {
  authorization: string
  url: string
  expiresAt: number
  placeholder: string
  binding: ProxySecretBinding
}
interface Route {
  local: string
  credentials: Map<string, Credential>
}
const routes = new Map<string, Route>()
let originalFetch: typeof fetch | undefined
let fixtureCount = 0

/** Route only this fixture's exact HTTPS host/path to a real local listener.
 * This proves HTTP integration, never production TLS, secret storage or installation custody. */
function installRouter() {
  if (originalFetch) return
  const native = globalThis.fetch
  originalFetch = native
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const route = routes.get(`${url.origin}${url.pathname}`)
    if (!route || url.search || url.hash) return native(input, init)
    const headers = new Headers(request.headers)
    const marker = headers.get('authorization')
    if (marker?.startsWith('Bearer proxy-placeholder:')) {
      const credential = [...route.credentials.values()].find(
        (entry) => entry.placeholder === marker.slice('Bearer proxy-placeholder:'.length),
      )
      if (
        !credential ||
        credential.expiresAt <= Date.now() ||
        credential.url !== request.url ||
        request.method !== 'POST'
      ) {
        return new Response(null, { status: 403 })
      }
      headers.set('authorization', credential.authorization)
    }
    return native(route.local, {
      method: request.method,
      headers,
      signal: request.signal,
      ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.arrayBuffer() } : {}),
    })
  }
}

export async function proxyCoordination(options: { immutableCredentials?: boolean } = {}) {
  installRouter()
  fixtureCount += 1
  let closed = false
  const fixture = randomUUID()
  const url = `https://coord-${fixture}.example.test`
  const owned = new Set<string>()
  const credentials = new Map<string, Credential>()
  function route(publicUrl: string, port: number, host = '127.0.0.1') {
    const address = new URL(publicUrl)
    const key = `${address.origin}${address.pathname}`
    owned.add(key)
    routes.set(key, { local: `http://${host}:${port}${address.pathname}`, credentials })
    return publicUrl
  }
  const proxySecret: CoordinationProxySecretOptions = {
    async prepare(input) {
      if (input.signal.aborted) throw new Error('fixture registration cancelled')
      const actor = `${input.runId}:${input.actorId}`
      const identity = options.immutableCredentials
        ? `${actor}:${createHash('sha256').update(input.authorization).digest('hex')}`
        : actor
      const key = createHash('sha256').update(identity).digest('hex')
      const prior = options.immutableCredentials ? credentials.get(key) : undefined
      if (prior && (prior.authorization !== input.authorization || prior.url !== input.url)) {
        throw Object.assign(new Error('fixture immutable credential conflict'), { status: 409 })
      }
      const expiresAt = prior?.expiresAt ?? Math.min(Date.now() + 300_000, input.credentialExpiresAt ?? Infinity)
      if (expiresAt - Date.now() < 1_000) throw new Error('fixture credential already expired')
      const credential: Credential = prior ?? {
        authorization: input.authorization,
        url: input.url,
        expiresAt,
        placeholder: randomUUID(),
        binding: {
          envName: 'AGENT_RUNTIME_COORDINATION_TOKEN',
          secretRef: { kind: 'secret-ref', key },
          hosts: [new URL(input.url).hostname],
          presentation: { type: 'bearer' },
          methods: ['POST'],
          paths: [new URL(input.url).pathname],
          ttlSeconds: 60,
        },
      }
      if (prior === undefined) credentials.set(key, credential)
      return {
        binding: structuredClone(credential.binding),
        expiresAt: new Date(expiresAt).toISOString(),
        async revoke() {
          if (credentials.get(key) === credential) credentials.delete(key)
          return { confirmed: true }
        },
      }
    },
  }
  return {
    url,
    proxySecret,
    forwardTo(port: number, host = '127.0.0.1') {
      route(`${url}/manager`, port, host)
    },
    publicUrl(address: Pick<CoordinationPublicAddress, 'port' | 'actorId' | 'runId'>) {
      const actor = createHash('sha256')
        .update(`${address.runId}:${address.actorId}`)
        .digest('hex')
        .slice(0, 16)
      return route(`https://${actor}.coord-${fixture}.example.test/manager`, address.port)
    },
    /** Trusted fake-provider boundary only: resolve the actual admitted reference, never guest env. */
    authorizationFor(input: Pick<CreateAgentEnvironmentInput, 'proxySecrets' | 'env'>) {
      if (Object.hasOwn(input.env ?? {}, 'AGENT_RUNTIME_COORDINATION_TOKEN')) {
        throw new Error('guest input contains a readable coordination credential')
      }
      const binding = input.proxySecrets?.find(
        (entry) => entry.envName === 'AGENT_RUNTIME_COORDINATION_TOKEN',
      )
      const credential = binding && credentials.get(binding.secretRef.key)
      if (
        !binding ||
        !credential ||
        credential.expiresAt <= Date.now() ||
        binding.hosts[0] !== new URL(credential.url).hostname ||
        binding.paths?.[0] !== new URL(credential.url).pathname ||
        binding.methods?.[0] !== 'POST'
      ) {
        throw new Error('missing registered coordination proxy reference')
      }
      return credential.authorization
    },
    guestHeadersFor(binding: ProxySecretBinding) {
      const credential = credentials.get(binding.secretRef.key)
      if (!credential) throw new Error('missing registered coordination proxy reference')
      return { Authorization: `Bearer proxy-placeholder:${credential.placeholder}` }
    },
    async close() {
      if (closed) return
      closed = true
      fixtureCount -= 1
      for (const key of owned) routes.delete(key)
      credentials.clear()
      if (fixtureCount === 0 && originalFetch) {
        globalThis.fetch = originalFetch
        originalFetch = undefined
      }
    },
  }
}
