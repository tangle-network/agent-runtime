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
      MCP_SUPERVISOR_MODEL: 'brain-model',
    } as unknown as NodeJS.ProcessEnv)
    expect(opts).toBeDefined()
    expect(opts!.router).toEqual({
      routerBaseUrl: 'https://router.tangle.tools/v1',
      routerKey: 'tk',
      model: 'brain-model',
    })
    expect(opts!.model).toBe('brain-model')
    expect(opts!.backend).toMatchObject({ backend: 'sandbox', harness: 'opencode' })
    expect((opts!.backend as { sandboxClient: unknown }).sandboxClient).toBe(stubClient)
  })

  // Which ids a router serves is deployment state this package cannot know. A guess is invisible
  // until the supervisor's first completion rejects — after the verb has been advertised to an
  // agent — so an unnamed brain is a startup error, not a silently broken tool.
  it('refuses to resolve a supervisor whose brain model nobody named', () => {
    expect(() =>
      resolveDelegateSupervisor(stubClient, {
        MCP_ENABLE_DELEGATE: '1',
        TANGLE_API_KEY: 'tk',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/MCP_SUPERVISOR_MODEL/)
  })

  // Inside a sandbox the platform key is for the sandbox, not for inference: the router answers it
  // 403, and the whole delegation dies on the supervisor's first completion with no worker spawned.
  it('brains on the box INFERENCE credential, not the sandbox control key beside it', () => {
    const opts = resolveDelegateSupervisor(stubClient, {
      MCP_ENABLE_DELEGATE: '1',
      MCP_SUPERVISOR_MODEL: 'brain-model',
      OPENAI_API_KEY: 'inference-key',
      TANGLE_API_KEY: 'sandbox-control-key',
    } as unknown as NodeJS.ProcessEnv)
    expect(opts!.router.routerKey).toBe('inference-key')
  })

  it('keeps the platform key for a host that runs one key for both', () => {
    const opts = resolveDelegateSupervisor(stubClient, {
      MCP_ENABLE_DELEGATE: '1',
      MCP_SUPERVISOR_MODEL: 'brain-model',
      TANGLE_API_KEY: 'one-key',
    } as unknown as NodeJS.ProcessEnv)
    expect(opts!.router.routerKey).toBe('one-key')
  })

  it('reads the model its sandbox host declared when no override names one', () => {
    const opts = resolveDelegateSupervisor(stubClient, {
      MCP_ENABLE_DELEGATE: '1',
      TANGLE_API_KEY: 'tk',
      TANGLE_ROUTER_MODEL: 'host-declared',
    } as unknown as NodeJS.ProcessEnv)
    expect(opts!.router.model).toBe('host-declared')
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
      MCP_SUPERVISOR_MODEL: 'brain-model',
      TANGLE_ROUTER_BASE_URL: 'https://r.example.com',
    } as unknown as NodeJS.ProcessEnv)
    expect(opts!.router.routerBaseUrl).toBe('https://r.example.com/v1')
  })
})
