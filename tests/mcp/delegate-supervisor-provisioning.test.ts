import { describe, expect, it } from 'vitest'
import {
  delegateEnabled,
  resolveDelegateSupervisor,
} from '../../src/mcp/delegate-supervisor-provisioning'
import type { SandboxClient } from '../../src/runtime'

// The resolver only stores the client reference into the backend config; it never invokes it, so a
// bare cast is a faithful stub for these assertions.
const stubClient = {} as SandboxClient

describe('delegateEnabled', () => {
  it('is off by default and on only at MCP_ENABLE_DELEGATE=1', () => {
    expect(delegateEnabled({} as NodeJS.ProcessEnv)).toBe(false)
    expect(delegateEnabled({ MCP_ENABLE_DELEGATE: '0' } as unknown as NodeJS.ProcessEnv)).toBe(
      false,
    )
    expect(delegateEnabled({ MCP_ENABLE_DELEGATE: '1' } as unknown as NodeJS.ProcessEnv)).toBe(true)
  })
})

describe('resolveDelegateSupervisor', () => {
  it('returns undefined when delegate is not opted in (fail-closed)', () => {
    expect(resolveDelegateSupervisor(stubClient, {} as NodeJS.ProcessEnv)).toBeUndefined()
  })

  it('wires a router-brained supervisor over a sandbox backend when enabled', () => {
    const opts = resolveDelegateSupervisor(stubClient, {
      MCP_ENABLE_DELEGATE: '1',
      TANGLE_API_KEY: 'tk',
    } as unknown as NodeJS.ProcessEnv)
    expect(opts).toBeDefined()
    expect(opts!.router).toEqual({
      routerBaseUrl: 'https://router.tangle.tools/v1',
      routerKey: 'tk',
      model: 'moonshotai/kimi-k2.6',
    })
    expect(opts!.model).toBe('moonshotai/kimi-k2.6')
    expect(opts!.backend).toMatchObject({ backend: 'sandbox', harness: 'opencode' })
    expect((opts!.backend as { sandboxClient: unknown }).sandboxClient).toBe(stubClient)
  })

  it('honors the supervisor model + worker harness + router overrides', () => {
    const opts = resolveDelegateSupervisor(stubClient, {
      MCP_ENABLE_DELEGATE: '1',
      TANGLE_API_KEY: 'tk',
      MCP_SUPERVISOR_MODEL: 'deepseek-chat',
      MCP_SUPERVISOR_ROUTER_KEY: 'override',
      MCP_SUPERVISOR_ROUTER_BASE_URL: 'https://example.com/v2',
      MCP_DELEGATE_WORKER_HARNESS: 'claude-code',
    } as unknown as NodeJS.ProcessEnv)
    expect(opts!.router).toEqual({
      routerBaseUrl: 'https://example.com/v2',
      routerKey: 'override',
      model: 'deepseek-chat',
    })
    expect(opts!.backend).toMatchObject({ backend: 'sandbox', harness: 'claude-code' })
  })

  it('falls back through MCP_WORKER_MODEL then WORKER_MODEL for the brain', () => {
    const a = resolveDelegateSupervisor(stubClient, {
      MCP_ENABLE_DELEGATE: '1',
      WORKER_MODEL: 'wm',
    } as unknown as NodeJS.ProcessEnv)
    expect(a!.router.model).toBe('wm')
    const b = resolveDelegateSupervisor(stubClient, {
      MCP_ENABLE_DELEGATE: '1',
      MCP_WORKER_MODEL: 'mwm',
      WORKER_MODEL: 'wm',
    } as unknown as NodeJS.ProcessEnv)
    expect(b!.router.model).toBe('mwm')
  })

  it('normalizes a router base without a version suffix to /v1', () => {
    const opts = resolveDelegateSupervisor(stubClient, {
      MCP_ENABLE_DELEGATE: '1',
      TANGLE_ROUTER_BASE_URL: 'https://r.example.com',
    } as unknown as NodeJS.ProcessEnv)
    expect(opts!.router.routerBaseUrl).toBe('https://r.example.com/v1')
  })
})
