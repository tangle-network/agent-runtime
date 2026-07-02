import { describe, expect, it, vi } from 'vitest'
import type { SandboxClient } from './types'

const createExecutor = vi.fn((config: unknown) => {
  const factory = () => ({}) as never
  ;(factory as unknown as { config: unknown }).config = config
  return factory
})
const inlineSandboxClient = vi.fn((factory: unknown): SandboxClient => {
  return { create: async () => ({}) as never, __factory: factory } as unknown as SandboxClient
})

vi.mock('./supervise/runtime', () => ({ createExecutor }))
vi.mock('./inline-sandbox-client', () => ({ inlineSandboxClient }))

const { resolveSandboxClient } = await import('./resolve-sandbox-client')

const configOf = (client: SandboxClient): unknown =>
  (client as unknown as { __factory: { config: unknown } }).__factory.config

describe('resolveSandboxClient', () => {
  it("backend 'sandbox' returns the caller's client unchanged", () => {
    const sandboxClient = { create: async () => ({}) as never } as unknown as SandboxClient
    expect(resolveSandboxClient({ backend: 'sandbox', sandboxClient })).toBe(sandboxClient)
    expect(inlineSandboxClient).not.toHaveBeenCalled()
    expect(createExecutor).not.toHaveBeenCalled()
  })

  it("backend 'sandbox' fails loud when no sandboxClient is provided", () => {
    expect(() => resolveSandboxClient({ backend: 'sandbox' })).toThrow(
      /requires opts\.sandboxClient/,
    )
  })

  it("backend 'bridge' wires createExecutor with the bridge seam and default url", () => {
    const client = resolveSandboxClient({
      backend: 'bridge',
      bridge: { bearer: 'sk-b', model: 'opencode/kimi', timeoutMs: 90_000 },
    })
    expect(configOf(client)).toEqual({
      backend: 'bridge',
      bridgeUrl: 'http://127.0.0.1:3355',
      bridgeBearer: 'sk-b',
      model: 'opencode/kimi',
      timeoutMs: 90_000,
    })
    expect(inlineSandboxClient).toHaveBeenCalledOnce()
  })

  it("backend 'bridge' honors an explicit bridge.url", () => {
    const client = resolveSandboxClient({
      backend: 'bridge',
      bridge: { url: 'http://bridge.local:9000', bearer: 'sk-b', model: 'claude-code/sonnet' },
    })
    expect((configOf(client) as { bridgeUrl: string }).bridgeUrl).toBe('http://bridge.local:9000')
  })

  it("backend 'bridge' fails loud without bearer or model", () => {
    expect(() =>
      resolveSandboxClient({ backend: 'bridge', bridge: { bearer: '', model: 'x' } }),
    ).toThrow(/bridge\.bearer and bridge\.model/)
    expect(() => resolveSandboxClient({ backend: 'bridge' })).toThrow(
      /bridge\.bearer and bridge\.model/,
    )
  })

  it("backend 'router' wires createExecutor with the router seam", () => {
    const client = resolveSandboxClient({
      backend: 'router',
      router: { baseUrl: 'https://router.tangle.tools', key: 'sk-r', model: 'kimi' },
    })
    expect(configOf(client)).toEqual({
      backend: 'router',
      routerBaseUrl: 'https://router.tangle.tools',
      routerKey: 'sk-r',
      model: 'kimi',
    })
  })

  it("backend 'router' fails loud when a required field is missing", () => {
    expect(() =>
      resolveSandboxClient({ backend: 'router', router: { baseUrl: '', key: 'k', model: 'm' } }),
    ).toThrow(/router\.baseUrl, router\.key and router\.model/)
    expect(() => resolveSandboxClient({ backend: 'router' })).toThrow(
      /router\.baseUrl, router\.key and router\.model/,
    )
  })
})
