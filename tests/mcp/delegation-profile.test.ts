import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  buildDelegationMcpServer,
  composeProductionAgentProfile,
  DELEGATION_MCP_SERVER_KEY,
} from '../../src/mcp/delegation-profile'

const BASE: AgentProfile = {
  name: 'demo-agent',
  prompt: { systemPrompt: 'base prompt', metadata: { v: 1 } },
  mcp: {
    'domain-tools': { transport: 'stdio', command: 'domain-mcp', enabled: true },
  },
  resources: {
    files: [{ path: '/skills/a.md', resource: { kind: 'inline', name: 'a', content: 'x' } }],
  },
  metadata: { domain: 'demo' },
}

describe('buildDelegationMcpServer — fail-closed on missing key', () => {
  it('returns undefined when no sandbox API key resolves', () => {
    expect(buildDelegationMcpServer({ env: {} })).toBeUndefined()
  })

  it('emits the delegation entry with the runtime MCP bin command when a key is present', () => {
    const result = buildDelegationMcpServer({ env: { TANGLE_API_KEY: 'sk-test' } })
    expect(result).toBeDefined()
    const entry = result?.[DELEGATION_MCP_SERVER_KEY]
    expect(entry).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@tangle-network/agent-runtime', 'mcp'],
      env: {
        TANGLE_API_KEY: 'sk-test',
        SANDBOX_BASE_URL: 'https://sandbox.tangle.tools',
      },
      enabled: true,
      metadata: {
        surface: 'delegation:dispatch',
        tools: [
          'delegate_code',
          'delegate_research',
          'delegate_feedback',
          'delegation_status',
          'delegation_history',
        ],
      },
    })
  })

  it('prefers explicit sandboxApiKey over the env key', () => {
    const result = buildDelegationMcpServer({
      sandboxApiKey: 'explicit',
      env: { TANGLE_API_KEY: 'from-env' },
    })
    expect(result?.[DELEGATION_MCP_SERVER_KEY]?.env?.TANGLE_API_KEY).toBe('explicit')
  })

  it('resolves base URL precedence sandboxBaseUrl > SANDBOX_BASE_URL > SANDBOX_API_URL > default', () => {
    expect(
      buildDelegationMcpServer({ sandboxApiKey: 'k', sandboxBaseUrl: 'https://explicit' })?.[
        DELEGATION_MCP_SERVER_KEY
      ]?.env?.SANDBOX_BASE_URL,
    ).toBe('https://explicit')
    expect(
      buildDelegationMcpServer({
        env: { TANGLE_API_KEY: 'k', SANDBOX_BASE_URL: 'https://b1', SANDBOX_API_URL: 'https://b2' },
      })?.[DELEGATION_MCP_SERVER_KEY]?.env?.SANDBOX_BASE_URL,
    ).toBe('https://b1')
    expect(
      buildDelegationMcpServer({ env: { TANGLE_API_KEY: 'k', SANDBOX_API_URL: 'https://b2' } })?.[
        DELEGATION_MCP_SERVER_KEY
      ]?.env?.SANDBOX_BASE_URL,
    ).toBe('https://b2')
  })

  it('forwards OTEL + trace-correlation vars only when present', () => {
    const withOtel = buildDelegationMcpServer({
      env: {
        TANGLE_API_KEY: 'k',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp',
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer t',
        TRACE_ID: 'trace-1',
        PARENT_SPAN_ID: 'span-1',
      },
    })?.[DELEGATION_MCP_SERVER_KEY]?.env
    expect(withOtel).toMatchObject({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer t',
      TRACE_ID: 'trace-1',
      PARENT_SPAN_ID: 'span-1',
    })
    const withoutOtel = buildDelegationMcpServer({ env: { TANGLE_API_KEY: 'k' } })?.[
      DELEGATION_MCP_SERVER_KEY
    ]?.env
    expect(withoutOtel).not.toHaveProperty('OTEL_EXPORTER_OTLP_ENDPOINT')
    expect(withoutOtel).not.toHaveProperty('TRACE_ID')
  })
})

describe('composeProductionAgentProfile — base + delegation merge', () => {
  it('merges the delegation MCP alongside the base MCP map when a key is present', () => {
    const profile = composeProductionAgentProfile(BASE, { env: { TANGLE_API_KEY: 'k' } })
    expect(Object.keys(profile.mcp ?? {})).toEqual(['domain-tools', DELEGATION_MCP_SERVER_KEY])
    expect(profile.mcp?.['domain-tools']).toEqual(BASE.mcp?.['domain-tools'])
  })

  it('omits the delegation entry entirely when no key resolves — never a static broken entry', () => {
    const profile = composeProductionAgentProfile(BASE, { env: {} })
    expect(profile.mcp).toEqual({ 'domain-tools': BASE.mcp?.['domain-tools'] })
    expect(profile.mcp).not.toHaveProperty(DELEGATION_MCP_SERVER_KEY)
  })

  it('does not mutate the base profile', () => {
    const baseMcpKeys = Object.keys(BASE.mcp ?? {})
    composeProductionAgentProfile(BASE, { env: { TANGLE_API_KEY: 'k' } })
    expect(Object.keys(BASE.mcp ?? {})).toEqual(baseMcpKeys)
  })

  it('replaces systemPrompt while preserving other prompt fields', () => {
    const profile = composeProductionAgentProfile(BASE, {
      systemPrompt: 'workspace-augmented',
      env: {},
    })
    expect(profile.prompt?.systemPrompt).toBe('workspace-augmented')
    expect(profile.prompt?.metadata).toEqual({ v: 1 })
  })

  it('concatenates extraFiles after the base files', () => {
    const extra = { path: '/skills/b.md', resource: { kind: 'inline' as const, name: 'b', content: 'y' } }
    const profile = composeProductionAgentProfile(BASE, { extraFiles: [extra], env: {} })
    expect(profile.resources?.files).toEqual([...(BASE.resources?.files ?? []), extra])
  })

  it('overrides the profile name when supplied and falls through otherwise', () => {
    expect(composeProductionAgentProfile(BASE, { name: 'ws-42', env: {} }).name).toBe('ws-42')
    expect(composeProductionAgentProfile(BASE, { env: {} }).name).toBe('demo-agent')
  })
})
