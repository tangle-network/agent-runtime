/**
 * PHASE-6 proof — the `connection` artifact (adopt an EXTERNAL MCP) + key
 * provisioning:
 *
 *   1. a grant validates fail-closed and becomes a profile `mcp` entry whose
 *      secrets ride BY NAME only (`metadata.secretEnv`) — a credential value
 *      never appears anywhere on the artifact or the profile,
 *   2. `applyArtifact('connection')` promotes the server entry AND the
 *      optional hub grant (`profile.connections`, artifact wins on conflict),
 *   3. `envKeyProvider`/`resolveSecretEnv` resolve declared names and throw —
 *      naming the KEY, never a value — on a missing provider or key,
 *   4. the LIVE smoke: adopt a stdio "external" server (the in-repo memory
 *      bin) whose entire dataset arrives ONLY via a provisioned secret env —
 *      `materializeLocalMcp({ keys })` boots it and a search returns the
 *      seeded row, proving the key reached the child process env,
 *   5. an http grant materializes NOWHERE same-host: fail loud, never a
 *      silent skip that would fake the with/without ablation.
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../errors'
import { envKeyProvider, resolveSecretEnv } from '../runtime/key-provider'
import { materializeLocalMcp } from '../runtime/stdio-mcp-client'
import { applyArtifact } from './apply'
import {
  connectionArtifact,
  connectionMcpServer,
  type ExternalMcpGrant,
  validateExternalMcpGrant,
} from './connection'
import type { ProfileArtifact } from './types'

const FAKE_KEY_VALUE = 'sk-test-9f8e7d6c5b4a'

const asArtifact = (input: ReturnType<typeof connectionArtifact>): ProfileArtifact => ({
  ...input,
  id: input.key ?? 'connection',
  status: 'candidate',
})

const httpGrant = (over: Partial<ExternalMcpGrant> = {}): ExternalMcpGrant => ({
  transport: 'http',
  url: 'https://mcp.exa.ai/mcp',
  headers: { 'x-client': 'agent-runtime' },
  secretEnv: { EXA_API_KEY: 'EXA_API_KEY' },
  ...over,
})

describe('validateExternalMcpGrant / connectionMcpServer', () => {
  it('builds an http server entry with secrets by NAME in metadata', () => {
    const server = connectionMcpServer(httpGrant())
    expect(server.transport).toBe('http')
    expect(server.url).toBe('https://mcp.exa.ai/mcp')
    expect(server.headers).toEqual({ 'x-client': 'agent-runtime' })
    expect(server.enabled).toBe(true)
    expect(server.metadata?.secretEnv).toEqual({ EXA_API_KEY: 'EXA_API_KEY' })
    expect(server.command).toBeUndefined()
  })

  it('builds a stdio server entry for an installed external launch', () => {
    const server = connectionMcpServer({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@vendor/mcp-server'],
      env: { LOG_LEVEL: 'warn' },
      secretEnv: { VENDOR_API_KEY: 'VENDOR_API_KEY' },
    })
    expect(server.transport).toBe('stdio')
    expect(server.command).toBe('npx')
    expect(server.args).toEqual(['-y', '@vendor/mcp-server'])
    expect(server.env).toEqual({ LOG_LEVEL: 'warn' })
    expect(server.metadata?.secretEnv).toEqual({ VENDOR_API_KEY: 'VENDOR_API_KEY' })
  })

  it('fails closed on malformed grants', () => {
    expect(() => validateExternalMcpGrant(httpGrant({ url: 'ftp://x' }))).toThrow(ValidationError)
    expect(() => validateExternalMcpGrant(httpGrant({ url: undefined }))).toThrow(/requires/)
    expect(() => validateExternalMcpGrant(httpGrant({ command: 'also-a-command' }))).toThrow(
      /ambiguous/,
    )
    expect(() => validateExternalMcpGrant({ transport: 'stdio' })).toThrow(/requires a `command`/)
    expect(() =>
      validateExternalMcpGrant({ transport: 'stdio', command: 'x', headers: { a: 'b' } }),
    ).toThrow(/http-only/)
    expect(() => validateExternalMcpGrant(httpGrant({ secretEnv: { '': 'KEY' } }))).toThrow(
      /secretEnv/,
    )
    expect(() =>
      validateExternalMcpGrant(httpGrant({ hub: { connectionId: 'c1', capabilities: [] } })),
    ).toThrow(/capability/)
  })
})

describe('applyArtifact(connection)', () => {
  it('promotes the grant onto profile.mcp and never carries a secret VALUE', () => {
    const base: AgentProfile = { name: 'agent' }
    const out = applyArtifact(base, asArtifact(connectionArtifact(httpGrant(), { key: 'exa' })))
    expect(out.mcp?.exa?.transport).toBe('http')
    expect(out.mcp?.exa?.url).toBe('https://mcp.exa.ai/mcp')
    expect(out.mcp?.exa?.metadata?.secretEnv).toEqual({ EXA_API_KEY: 'EXA_API_KEY' })
    // The invariant that makes a promoted grant safe to store/log: only the
    // key NAME rides the profile — a value like FAKE_KEY_VALUE never can,
    // because the grant has no field that holds one.
    expect(JSON.stringify(out)).not.toContain(FAKE_KEY_VALUE)
    expect(base.mcp).toBeUndefined()
  })

  it('promotes a hub grant onto profile.connections, replacing the same connectionId', () => {
    const hub = { connectionId: 'conn-1', capabilities: ['search.web'], alias: 'exa' }
    const base: AgentProfile = {
      connections: [
        { connectionId: 'conn-1', capabilities: ['old.cap'] },
        { connectionId: 'conn-2', capabilities: ['keep.cap'] },
      ],
    }
    const out = applyArtifact(base, asArtifact(connectionArtifact(httpGrant({ hub }))))
    expect(out.connections).toEqual([{ connectionId: 'conn-2', capabilities: ['keep.cap'] }, hub])
    // Default key derived from the endpoint host.
    expect(Object.keys(out.mcp ?? {})).toEqual(['mcp_exa_ai'])
  })

  it('records transport + secret key NAMES in artifact metadata for the audit trail', () => {
    const artifact = connectionArtifact(httpGrant())
    expect(artifact.metadata?.transport).toBe('http')
    expect(artifact.metadata?.secretKeys).toEqual(['EXA_API_KEY'])
    expect(JSON.stringify(artifact)).not.toContain(FAKE_KEY_VALUE)
  })
})

describe('envKeyProvider / resolveSecretEnv', () => {
  it('resolves named keys from the (dotenvx-loaded) env', async () => {
    const keys = envKeyProvider({ EXA_API_KEY: FAKE_KEY_VALUE, EMPTY: '  ' })
    expect(await keys.get('EXA_API_KEY')).toBe(FAKE_KEY_VALUE)
    expect(await keys.get('EMPTY')).toBeUndefined()
    expect(await keys.get('ABSENT')).toBeUndefined()
    const resolved = await resolveSecretEnv({ EXA_API_KEY: 'EXA_API_KEY' }, keys, 'test')
    expect(resolved).toEqual({ EXA_API_KEY: FAKE_KEY_VALUE })
  })

  it('throws on a missing provider or key, naming the key and NEVER a value', async () => {
    await expect(
      resolveSecretEnv({ X_KEY: 'X_KEY' }, undefined, "profile.mcp['x']"),
    ).rejects.toThrow(/no KeyProvider/)
    const keys = envKeyProvider({ OTHER: FAKE_KEY_VALUE })
    const failure = await resolveSecretEnv({ X_KEY: 'MISSING_KEY' }, keys, "profile.mcp['x']")
      .then(() => undefined)
      .catch((e: Error) => e)
    expect(failure).toBeInstanceOf(ValidationError)
    expect(failure?.message).toContain('MISSING_KEY')
    expect(failure?.message).not.toContain(FAKE_KEY_VALUE)
  })
})

describe('same-host materialization of a promoted grant', () => {
  // The in-repo memory bin stands in for an "external" stdio MCP server whose
  // API needs a provisioned credential: its ENTIRE dataset arrives via the
  // secret env (AGENT_MEMORY_ITEMS ← key ADOPTED_MEMORY_ITEMS_JSON), and an
  // empty memory refuses to boot — so a successful boot + search hit is proof
  // the KeyProvider value reached the child process env.
  const here = dirname(fileURLToPath(import.meta.url))
  const memoryBin = join(here, '..', 'mcp', 'memory-bin.ts')
  const tsxCli = createRequire(import.meta.url).resolve('tsx/cli')
  const seededRows = JSON.stringify([
    { id: 'm1', text: 'adopted external memory row: rotate keys quarterly' },
  ])

  it('boots an adopted stdio grant with the provisioned key in its env (the Phase-6 smoke)', {
    timeout: 60_000,
  }, async () => {
    const grant: ExternalMcpGrant = {
      transport: 'stdio',
      command: process.execPath,
      args: [tsxCli, memoryBin],
      secretEnv: { AGENT_MEMORY_ITEMS: 'ADOPTED_MEMORY_ITEMS_JSON' },
    }
    const profile = applyArtifact({}, asArtifact(connectionArtifact(grant, { key: 'adopted' })))
    expect(JSON.stringify(profile)).not.toContain('rotate keys quarterly')

    const keys = envKeyProvider({ ADOPTED_MEMORY_ITEMS_JSON: seededRows })
    const mat = await materializeLocalMcp(profile, { keys })
    try {
      expect(mat.tools.map((t) => t.function.name)).toEqual([
        'adopted__memory_search',
        'adopted__memory_get',
      ])
      const hit = await mat.call('adopted__memory_search', { query: 'rotate keys' })
      expect(hit).toContain('rotate keys quarterly')
    } finally {
      await mat.close()
    }
  })

  it('fails closed when the grant declares a secret and no provider / key exists', async () => {
    const grant: ExternalMcpGrant = {
      transport: 'stdio',
      command: process.execPath,
      args: [tsxCli, memoryBin],
      secretEnv: { AGENT_MEMORY_ITEMS: 'ADOPTED_MEMORY_ITEMS_JSON' },
    }
    const profile = applyArtifact({}, asArtifact(connectionArtifact(grant, { key: 'adopted' })))
    await expect(materializeLocalMcp(profile)).rejects.toThrow(/no KeyProvider/)
    await expect(materializeLocalMcp(profile, { keys: envKeyProvider({}) })).rejects.toThrow(
      /ADOPTED_MEMORY_ITEMS_JSON/,
    )
  })

  it('fails loud on a promoted http grant — never a silent skip', async () => {
    const profile = applyArtifact({}, asArtifact(connectionArtifact(httpGrant(), { key: 'exa' })))
    await expect(
      materializeLocalMcp(profile, { keys: envKeyProvider({ EXA_API_KEY: FAKE_KEY_VALUE }) }),
    ).rejects.toThrow(/transport 'http'/)
  })
})
