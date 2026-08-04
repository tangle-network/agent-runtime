import { describe, expect, it } from 'vitest'
import {
  delegateEnabled,
  resolveDelegateSupervisor,
} from '../../src/mcp/delegate-supervisor-provisioning'
import type { SandboxClient } from '../../src/runtime'

const stubClient = {} as SandboxClient

const exactEnv = {
  MCP_ENABLE_DELEGATE: '1',
  MCP_SUPERVISOR_MODEL: 'brain-model',
  MCP_SUPERVISOR_ROUTER_BASE_URL: 'https://router.example.com',
  MCP_SUPERVISOR_ROUTER_KEY: 'router-key',
} as unknown as NodeJS.ProcessEnv

describe('delegateEnabled', () => {
  it('is off by default and on only at MCP_ENABLE_DELEGATE=1', () => {
    expect(delegateEnabled({} as NodeJS.ProcessEnv)).toBe(false)
    expect(delegateEnabled({ MCP_ENABLE_DELEGATE: '0' } as NodeJS.ProcessEnv)).toBe(false)
    expect(delegateEnabled({ MCP_ENABLE_DELEGATE: '1' } as NodeJS.ProcessEnv)).toBe(true)
  })
})

describe('resolveDelegateSupervisor', () => {
  it('returns undefined when delegate is not opted in', () => {
    expect(resolveDelegateSupervisor(stubClient, {} as NodeJS.ProcessEnv)).toBeUndefined()
  })

  it('requires the dedicated supervisor model and router connection', () => {
    for (const missing of [
      'MCP_SUPERVISOR_MODEL',
      'MCP_SUPERVISOR_ROUTER_BASE_URL',
      'MCP_SUPERVISOR_ROUTER_KEY',
    ] as const) {
      const env = { ...exactEnv }
      delete env[missing]
      expect(() => resolveDelegateSupervisor(stubClient, env)).toThrow(missing)
    }
  })

  it('builds one exact supervisor profile and a transport-only sandbox backend', () => {
    const options = resolveDelegateSupervisor(stubClient, exactEnv)

    expect(options?.router).toEqual({
      routerBaseUrl: 'https://router.example.com/v1',
      routerKey: 'router-key',
    })
    expect(options?.supervisorProfile).toMatchObject({
      name: 'delegate-supervisor',
      harness: 'cli-base',
      model: { provider: 'tangle-router', default: 'brain-model' },
    })
    expect(options?.backend).toEqual({ backend: 'sandbox', sandboxClient: stubClient })
  })

  it('does not revive model, key, URL, or harness choices from legacy environment aliases', () => {
    expect(() =>
      resolveDelegateSupervisor(stubClient, {
        MCP_ENABLE_DELEGATE: '1',
        MCP_SUPERVISOR_ROUTER_BASE_URL: 'https://router.example.com',
        MCP_SUPERVISOR_ROUTER_KEY: 'router-key',
        TANGLE_ROUTER_MODEL: 'legacy-model',
        WORKER_MODEL: 'legacy-worker-model',
      } as NodeJS.ProcessEnv),
    ).toThrow('MCP_SUPERVISOR_MODEL')

    expect(() =>
      resolveDelegateSupervisor(stubClient, {
        MCP_ENABLE_DELEGATE: '1',
        MCP_SUPERVISOR_MODEL: 'brain-model',
        MCP_SUPERVISOR_ROUTER_BASE_URL: 'https://router.example.com',
        OPENAI_API_KEY: 'legacy-key',
        TANGLE_API_KEY: 'control-key',
      } as NodeJS.ProcessEnv),
    ).toThrow('MCP_SUPERVISOR_ROUTER_KEY')

    const options = resolveDelegateSupervisor(stubClient, {
      ...exactEnv,
      MCP_DELEGATE_WORKER_HARNESS: 'codex',
    } as NodeJS.ProcessEnv)
    expect(options?.backend).not.toHaveProperty('harness')
  })

  it('preserves an explicit versioned router base', () => {
    const options = resolveDelegateSupervisor(stubClient, {
      ...exactEnv,
      MCP_SUPERVISOR_ROUTER_BASE_URL: 'https://router.example.com/v2/',
    } as NodeJS.ProcessEnv)
    expect(options?.router.routerBaseUrl).toBe('https://router.example.com/v2')
  })
})
