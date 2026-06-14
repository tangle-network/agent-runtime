import { describe, expect, it } from 'vitest'
import {
  applyRouterEnv,
  type ProvisionableSpec,
  resolveResearcherProvisioning,
} from '../../src/mcp/researcher-provisioning'

describe('resolveResearcherProvisioning', () => {
  it('defaults to a provisionable harness/model and a /v1 router base', () => {
    const p = resolveResearcherProvisioning({} as NodeJS.ProcessEnv)
    expect(p.harness).toBe('opencode')
    expect(p.model).toBe('moonshotai/kimi-k2.6')
    expect(p.routerBaseUrl).toBe('https://router.tangle.tools/v1')
    expect(p.routerKey).toBeUndefined()
  })

  it('honors explicit env overrides', () => {
    const p = resolveResearcherProvisioning({
      MCP_RESEARCHER_HARNESS: 'codex',
      MCP_RESEARCHER_MODEL: 'deepseek-chat',
      MCP_RESEARCHER_ROUTER_KEY: 'rk_123',
      MCP_RESEARCHER_ROUTER_BASE_URL: 'https://example.com/v2',
    } as unknown as NodeJS.ProcessEnv)
    expect(p).toMatchObject({
      harness: 'codex',
      model: 'deepseek-chat',
      routerKey: 'rk_123',
      routerBaseUrl: 'https://example.com/v2',
    })
  })

  it('falls back through MCP_WORKER_MODEL then WORKER_MODEL', () => {
    expect(
      resolveResearcherProvisioning({ WORKER_MODEL: 'wm' } as unknown as NodeJS.ProcessEnv).model,
    ).toBe('wm')
    expect(
      resolveResearcherProvisioning({
        MCP_WORKER_MODEL: 'mwm',
        WORKER_MODEL: 'wm',
      } as unknown as NodeJS.ProcessEnv).model,
    ).toBe('mwm')
  })

  it('uses TANGLE_API_KEY as the router key, overridable by MCP_RESEARCHER_ROUTER_KEY', () => {
    expect(
      resolveResearcherProvisioning({ TANGLE_API_KEY: 'tk' } as unknown as NodeJS.ProcessEnv)
        .routerKey,
    ).toBe('tk')
    expect(
      resolveResearcherProvisioning({
        TANGLE_API_KEY: 'tk',
        MCP_RESEARCHER_ROUTER_KEY: 'override',
      } as unknown as NodeJS.ProcessEnv).routerKey,
    ).toBe('override')
  })

  it('reuses the repo router base (TANGLE_ROUTER_*) and normalizes to /v1', () => {
    expect(
      resolveResearcherProvisioning({
        TANGLE_ROUTER_BASE_URL: 'https://r.example.com',
      } as unknown as NodeJS.ProcessEnv).routerBaseUrl,
    ).toBe('https://r.example.com/v1')
  })

  it('prefers TANGLE_ROUTER_URL over TANGLE_ROUTER_BASE_URL', () => {
    expect(
      resolveResearcherProvisioning({
        TANGLE_ROUTER_URL: 'https://primary.example.com',
        TANGLE_ROUTER_BASE_URL: 'https://secondary.example.com',
      } as unknown as NodeJS.ProcessEnv).routerBaseUrl,
    ).toBe('https://primary.example.com/v1')
  })

  it('leaves an already-versioned MCP_RESEARCHER_ROUTER_BASE_URL intact (no double /v1)', () => {
    // Exercises the researcher regex directly: this env bypasses resolveRouterBaseUrl.
    expect(
      resolveResearcherProvisioning({
        MCP_RESEARCHER_ROUTER_BASE_URL: 'https://r.example.com/v1/',
      } as unknown as NodeJS.ProcessEnv).routerBaseUrl,
    ).toBe('https://r.example.com/v1')
  })

  it('parses fanout harnesses + per-harness models from csv env', () => {
    const p = resolveResearcherProvisioning({
      MCP_RESEARCHER_FANOUT_HARNESSES: 'opencode, codex',
      MCP_RESEARCHER_FANOUT_MODELS: 'kimi, deepseek',
    } as unknown as NodeJS.ProcessEnv)
    expect(p.fanoutHarnesses).toEqual(['opencode', 'codex'])
    expect(p.fanoutModels).toEqual(['kimi', 'deepseek'])
  })

  it('treats empty/whitespace env values as unset', () => {
    const p = resolveResearcherProvisioning({
      MCP_RESEARCHER_HARNESS: '  ',
      TANGLE_API_KEY: '',
      MCP_RESEARCHER_FANOUT_HARNESSES: ' , ',
    } as unknown as NodeJS.ProcessEnv)
    expect(p.harness).toBe('opencode')
    expect(p.routerKey).toBeUndefined()
    expect(p.fanoutHarnesses).toBeUndefined()
  })
})

describe('applyRouterEnv', () => {
  it('merges router creds into existing box env instead of replacing it', () => {
    const spec: ProvisionableSpec = { sandboxOverrides: { env: { KEEP_ME: '1' }, name: 'box' } }
    applyRouterEnv(spec, 'rk', 'https://router/v1')
    expect(spec.sandboxOverrides).toEqual({
      name: 'box',
      env: { KEEP_ME: '1', OPENAI_API_KEY: 'rk', OPENAI_BASE_URL: 'https://router/v1' },
    })
  })

  it('initializes sandboxOverrides when absent', () => {
    const spec: ProvisionableSpec = {}
    applyRouterEnv(spec, 'rk', 'https://router/v1')
    expect(spec.sandboxOverrides?.env).toEqual({
      OPENAI_API_KEY: 'rk',
      OPENAI_BASE_URL: 'https://router/v1',
    })
  })

  it('is a no-op without a router key (undefined or empty string)', () => {
    for (const key of [undefined, '']) {
      const spec: ProvisionableSpec = { sandboxOverrides: { env: { KEEP_ME: '1' } } }
      applyRouterEnv(spec, key, 'https://router/v1')
      expect(spec.sandboxOverrides?.env).toEqual({ KEEP_ME: '1' })
    }
  })
})

describe('buildPreset composition (resolve → apply)', () => {
  // Mirrors what bin.ts buildPreset does to an agentRunSpec returned by researcherProfile,
  // exercised through the public surface (no optional peer, no exported internals).
  it('overlays resolved router creds onto a profile-shaped spec, preserving preset env', () => {
    const provisioning = resolveResearcherProvisioning({
      TANGLE_API_KEY: 'tk',
      MCP_RESEARCHER_MODEL: 'moonshotai/kimi-k2.6',
    } as unknown as NodeJS.ProcessEnv)
    // A spec shaped like researcherProfile().agentRunSpec — profile carries harness/model;
    // a preset may already ship box env the in-box agent needs.
    const spec: ProvisionableSpec = {
      sandboxOverrides: { env: { NS_TOKEN: 'abc' }, name: 'researcher' },
    }
    applyRouterEnv(spec, provisioning.routerKey, provisioning.routerBaseUrl)
    expect(spec.sandboxOverrides).toEqual({
      name: 'researcher',
      env: {
        NS_TOKEN: 'abc',
        OPENAI_API_KEY: 'tk',
        OPENAI_BASE_URL: 'https://router.tangle.tools/v1',
      },
    })
  })
})
