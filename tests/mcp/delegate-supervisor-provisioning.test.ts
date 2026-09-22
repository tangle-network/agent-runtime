import { describe, expect, it } from 'vitest'
import {
  delegateEnabled,
  resolveDelegateSupervisor,
} from '../../src/mcp/delegate-supervisor-provisioning'
import type { AgentEnvironmentProvider } from '../../src/runtime'

const stubProvider: AgentEnvironmentProvider = {
  name: 'test-provider',
  capabilities() {
    throw new Error('not used')
  },
  async create() {
    throw new Error('not used')
  },
}

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
    expect(resolveDelegateSupervisor(stubProvider, {} as NodeJS.ProcessEnv)).toBeUndefined()
  })

  it('wires a router-brained supervisor to the environment provider when enabled', () => {
    const opts = resolveDelegateSupervisor(stubProvider, {
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
    expect(opts!.worker).toMatchObject({
      environment: { backend: 'opencode' },
    })
    expect(opts!.worker.provider).toBe(stubProvider)
  })

  it('honors the supervisor model + worker harness + router overrides', () => {
    const opts = resolveDelegateSupervisor(stubProvider, {
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
    expect(opts!.worker).toMatchObject({
      environment: { backend: 'claude-code' },
    })
  })

  it('falls back through MCP_WORKER_MODEL then WORKER_MODEL for the brain', () => {
    const a = resolveDelegateSupervisor(stubProvider, {
      MCP_ENABLE_DELEGATE: '1',
      WORKER_MODEL: 'wm',
    } as unknown as NodeJS.ProcessEnv)
    expect(a!.router.model).toBe('wm')
    const b = resolveDelegateSupervisor(stubProvider, {
      MCP_ENABLE_DELEGATE: '1',
      MCP_WORKER_MODEL: 'mwm',
      WORKER_MODEL: 'wm',
    } as unknown as NodeJS.ProcessEnv)
    expect(b!.router.model).toBe('mwm')
  })

  it('normalizes a router base without a version suffix to /v1', () => {
    const opts = resolveDelegateSupervisor(stubProvider, {
      MCP_ENABLE_DELEGATE: '1',
      TANGLE_ROUTER_BASE_URL: 'https://r.example.com',
    } as unknown as NodeJS.ProcessEnv)
    expect(opts!.router.routerBaseUrl).toBe('https://r.example.com/v1')
  })
})
