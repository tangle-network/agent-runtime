import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'

import { buildBackendOptions } from '../sandbox-backend'
import {
  assertHostExecutionAllowed,
  parseEgressPolicy,
  readProfileEgressPolicy,
  resolveEgressPolicy,
  resolveModelHosts,
  toSandboxEgressPolicy,
} from './policy'

const profile = (network?: unknown): AgentProfile =>
  ({
    name: 'worker',
    ...(network === undefined ? {} : { metadata: { network } }),
  }) as AgentProfile

describe('declaration defaults', () => {
  it('treats an absent declaration as gateway, not open', () => {
    expect(readProfileEgressPolicy(profile())).toEqual({ mode: 'gateway' })
  })

  it('refuses an open declaration with no recorded reason', () => {
    expect(() => parseEgressPolicy({ mode: 'open' }, 'test')).toThrow(/requires a non-empty reason/)
    expect(parseEgressPolicy({ mode: 'open', reason: 'trusted rig' }, 'test')).toEqual({
      mode: 'open',
      reason: 'trusted rig',
    })
  })

  it('refuses strict without an explicit list, so it cannot be read two ways', () => {
    expect(() => parseEgressPolicy({ mode: 'strict' }, 'test')).toThrow(/requires allowDomains/)
    expect(parseEgressPolicy({ mode: 'strict', allowDomains: [] }, 'test')).toEqual({
      mode: 'strict',
      allowDomains: [],
    })
  })

  it('rejects an unknown mode rather than falling back to something permissive', () => {
    expect(() => parseEgressPolicy({ mode: 'allow-all' }, 'test')).toThrow(/must be one of/)
  })
})

describe('an override may narrow, never widen', () => {
  it('accepts a stricter run-level override', () => {
    expect(
      resolveEgressPolicy(profile({ mode: 'strict', allowDomains: ['a.dev'] }), {
        mode: 'blocked',
      }),
    ).toEqual({ mode: 'blocked' })
  })

  it('rejects an override that grants more than the profile declared', () => {
    expect(() =>
      resolveEgressPolicy(profile({ mode: 'gateway' }), { mode: 'open', reason: 'why not' }),
    ).toThrow(/more permissive than the profile/)
  })

  it('rejects a same-mode override that adds domains', () => {
    expect(() =>
      resolveEgressPolicy(profile({ mode: 'strict', allowDomains: ['a.dev'] }), {
        mode: 'strict',
        allowDomains: ['evil.dev'],
      }),
    ).toThrow(/adds domains the profile does not grant/)
  })
})

describe('translation to the sandbox boundary', () => {
  it('never re-enables the implicit domain list, which carries github.com', () => {
    const policy = toSandboxEgressPolicy({ mode: 'strict', allowDomains: ['proxy.golang.org'] }, [
      'router.tangle.tools',
    ])
    expect(policy).toEqual({
      mode: 'strict',
      allowDomains: ['router.tangle.tools', 'proxy.golang.org'],
      includeImplicitDomains: false,
    })
  })

  it('keeps the model host reachable without the caller naming it', () => {
    expect(toSandboxEgressPolicy({ mode: 'gateway' }, ['router.tangle.tools'])).toEqual({
      mode: 'strict',
      allowDomains: ['router.tangle.tools'],
      includeImplicitDomains: false,
    })
  })

  it('denies the model host under blocked', () => {
    expect(toSandboxEgressPolicy({ mode: 'blocked' }, ['router.tangle.tools'])).toEqual({
      mode: 'blocked',
    })
  })

  it('has no boundary form for open', () => {
    expect(toSandboxEgressPolicy({ mode: 'open', reason: 'trusted' }, ['h'])).toBeUndefined()
  })

  it('refuses to build a policy that would strand the agent with no model host', () => {
    expect(() => toSandboxEgressPolicy({ mode: 'gateway' }, [])).toThrow(/at least one model host/)
  })
})

describe('model host resolution', () => {
  it('prefers the run-supplied base URL', () => {
    expect(resolveModelHosts({ baseUrl: 'https://gw.example.com/v1', env: {} })).toEqual([
      'gw.example.com',
    ])
  })

  it('falls back through the environment, then the default gateway', () => {
    expect(resolveModelHosts({ env: { OPENAI_BASE_URL: 'https://alt.example.com/v1' } })).toEqual([
      'alt.example.com',
    ])
    expect(resolveModelHosts({ env: {} })).toEqual(['router.tangle.tools'])
  })

  it('throws on a malformed base URL instead of silently allowlisting the default', () => {
    expect(() => resolveModelHosts({ baseUrl: 'not a url', env: {} })).toThrow(/not a valid URL/)
  })
})

describe('host-process executors refuse what they cannot enforce', () => {
  it('allows only an explicit open', () => {
    expect(() =>
      assertHostExecutionAllowed({ mode: 'open', reason: 'trusted' }, 'piExecutor', 'use sandbox'),
    ).not.toThrow()
    for (const mode of ['blocked', 'gateway'] as const) {
      expect(() => assertHostExecutionAllowed({ mode }, 'piExecutor', 'use sandbox')).toThrow(
        /piExecutor runs on the host and cannot enforce network policy/,
      )
    }
  })
})

describe('sandbox creation is deny-by-default', () => {
  it('sends a gateway policy when the profile declares nothing', () => {
    const options = buildBackendOptions(profile(), undefined, {
      modelBaseUrl: 'https://router.tangle.tools/v1',
    })
    expect(options.egressPolicy).toEqual({
      mode: 'strict',
      allowDomains: ['router.tangle.tools'],
      includeImplicitDomains: false,
    })
  })

  it('overrides a caller-supplied egressPolicy that would re-open the box', () => {
    const options = buildBackendOptions(
      profile(),
      { egressPolicy: { mode: 'open' } },
      { modelBaseUrl: 'https://router.tangle.tools/v1' },
    )
    expect(options.egressPolicy?.mode).toBe('strict')
  })

  it('leaves the SDK default in place only for a deliberate open', () => {
    const options = buildBackendOptions(
      profile({ mode: 'open', reason: 'trusted local rig' }),
      undefined,
      { modelBaseUrl: 'https://router.tangle.tools/v1' },
    )
    expect(options.egressPolicy).toBeUndefined()
  })
})
