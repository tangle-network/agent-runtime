import type { AgentProfile, ProxySecretBinding } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import { type SuperviseOptions, supervise } from '../../src/runtime/supervise/supervise'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import { proxyCoordination } from '../helpers/proxy-coordination'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const parentBinding: ProxySecretBinding = {
  envName: 'REPORTS_TOKEN',
  secretRef: { kind: 'secret-ref', key: 'reporting-api' },
  hosts: ['reports.example.com', 'archive.example.com'],
  presentation: { type: 'bearer' },
  methods: ['GET', 'POST'],
  paths: ['/v1/events', '/v1/archive'],
  ttlSeconds: 300,
}
const childBinding: ProxySecretBinding = {
  ...parentBinding,
  hosts: ['reports.example.com'],
  methods: ['POST'],
  paths: ['/v1/events'],
  ttlSeconds: 120,
}

function profile(name: string, bindings?: ProxySecretBinding[], manager = false): AgentProfile {
  return testAgentProfile(name, {
    ...(bindings === undefined ? {} : { proxySecrets: bindings }),
    ...(manager ? { tools: runtimeToolDeclarations('spawn_worker', 'stop') } : {}),
  })
}

async function call(url: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  return response.json()
}

/** Records admitted profiles at a caller-owned execution port; no model or sandbox is called. */
function leaf(authored: AgentProfile, seen: AgentProfile[]): Agent<unknown, unknown> {
  seen.push(authored)
  const result: ExecutorResult<unknown> = {
    outRef: `proxy-secret-test:${authored.name}`,
    out: { ok: true },
    verdict: { valid: true, score: 1 },
    spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
  }
  const executor: Executor<unknown> = {
    runtime: 'proxy-secret-test',
    execute: async () => result,
    teardown: async () => ({ destroyed: true }),
    resultArtifact: () => result,
  }
  const executorSpec: AgentSpec = { profile: authored, harness: null, executor }
  return { name: authored.name, act: async () => result.out, executorSpec } as Agent<
    unknown,
    unknown
  >
}

async function spawnOne(
  requested: AgentProfile,
  authorizeSpawn: SuperviseOptions['authorizeSpawn'] | null = ({ profile: child }) => ({
    profile: child,
  }),
  parentBindings: ProxySecretBinding[] = [parentBinding],
) {
  const seen: AgentProfile[] = []
  const journal = new InMemorySpawnJournal()
  const replies: unknown[] = []
  let turns = 0
  await supervise(profile('root', parentBindings, true), 'delegate', {
    budget: { maxIterations: 20, maxTokens: 20_000 },
    perWorker: { maxIterations: 2, maxTokens: 1_000 },
    inheritSpawnRights: false,
    makeLeafAgent: (child) => leaf(child, seen),
    ...(authorizeSpawn ? { authorizeSpawn } : {}),
    journal,
    runId: 'proxy-descendant',
    driveHarness: async ({ coordinationMcpUrl }) => {
      if (turns++ === 0)
        replies.push(
          await call(coordinationMcpUrl, 'spawn_worker', {
            profile: requested,
            task: 'post events',
          }),
        )
      else await call(coordinationMcpUrl, 'stop', {})
    },
  })
  return { seen, replies, events: await journal.loadTree('proxy-descendant') }
}

// These checks establish Runtime admission, not authenticated Sandbox grants or expiry/revocation.
describe('public supervise proxy-secret descendant admission', () => {
  it.each([
    ['backend', 'defaults'],
    ['backend', 'placement'],
    ['driverBackend', 'defaults'],
    ['driverBackend', 'placement'],
  ] as const)('refuses implicit proxy bindings in %s %s before execution', (key, source) => {
    const backend: ExecutorConfig = {
      backend: 'provider',
      provider: 'must-not-be-resolved',
      ...(source === 'defaults'
        ? { defaults: { proxySecrets: [parentBinding] } }
        : {
            placements: [
              {
                id: 'seat',
                match: { harness: 'opencode' },
                create: { backend: 'opencode', proxySecrets: [parentBinding] },
              },
            ],
          }),
    }
    expect(() =>
      supervise(profile('root', undefined, true), 'delegate', {
        budget: { maxIterations: 20, maxTokens: 20_000 },
        [key]: backend,
        makeLeafAgent: () => {
          throw new Error('must not execute')
        },
        driveHarness: async () => {
          throw new Error('must not execute')
        },
      }),
    ).toThrow(/profile\.proxySecrets/)
  })

  it('refuses proxy defaults smuggled through selectSeat before creating an environment', async () => {
    const proxy = await proxyCoordination()
    const journal = new InMemorySpawnJournal()
    let selections = 0
    let creates = 0
    const provider = {
      name: 'selected-seat-test',
      capabilities: () => ({
        create: {
          runtimeAttachments: { mcp: true },
          proxySecrets: {
            protocolVersion: 1,
            supportedDrivers: ['docker'],
            presentations: ['bearer'],
            placeholderFormats: ['opaque'],
            enforcement: 'exact',
            transports: ['https:443'],
            lifecycle: true,
            placementReceiptRequired: true,
          },
        },
      }),
      create: async () => {
        creates += 1
        throw new Error('must not create')
      },
    } as unknown as AgentEnvironmentProvider
    try {
      await supervise(
        testAgentProfile('root', {
          harness: 'codex',
          model: { provider: 'openai', default: 'gpt-6-sol' },
          tools: runtimeToolDeclarations('stop'),
          seats: [
            {
              harness: 'codex',
              provider: 'openai',
              model: 'gpt-6-sol',
              selector: { kind: 'all-eligible' },
            },
          ],
        }),
        'select without implicit authority',
        {
          budget: { maxIterations: 10, maxTokens: 10_000 },
          backend: { backend: 'provider', provider },
          coordination: {
            authentication: true,
            publicUrl: proxy.publicUrl,
            proxySecret: proxy.proxySecret,
          },
          selectSeat: async () => {
            selections += 1
            return {
              seat: 'selected',
              backend: {
                backend: 'provider',
                provider,
                defaults: { proxySecrets: [parentBinding] },
              },
            }
          },
          journal,
          runId: 'proxy-selected-seat',
        },
      )
      expect(selections).toBeGreaterThan(0)
      expect(creates).toBe(0)
      expect(JSON.stringify(await journal.loadTree('proxy-selected-seat'))).toContain(
        'profile.proxySecrets',
      )
    } finally {
      await proxy.close()
    }
  })

  it('requires product authorization before admitting a child reference', async () => {
    const { seen, replies } = await spawnOne(profile('child', [childBinding]), null)
    expect(seen).toEqual([])
    expect(JSON.stringify(replies)).toContain('proxySecrets')
    expect(JSON.stringify(replies)).toContain('authorizeSpawn')
  })

  it.each([
    ['host', { hosts: ['attacker.example.com'] }],
    ['method', { methods: ['DELETE'] }],
    ['omitted method', { methods: undefined }],
    ['path', { paths: ['/v1/admin'] }],
    ['omitted path', { paths: undefined }],
    ['TTL', { ttlSeconds: 301 }],
    ['omitted TTL', { ttlSeconds: undefined }],
    ['secret identity', { secretRef: { kind: 'secret-ref', key: 'another-secret' } }],
    ['presentation', { presentation: { type: 'header', name: 'X-Api-Key' } }],
  ] as const)(
    'refuses widened %s before journal admission or execution',
    async (_field, change) => {
      const widened = { ...childBinding, ...change } as ProxySecretBinding
      const { seen, replies, events } = await spawnOne(profile('child', [widened]))
      expect(seen).toEqual([])
      expect(JSON.stringify(replies)).toContain('proxySecrets')
      expect(events?.filter((event) => event.kind === 'spawned')).toHaveLength(1)
    },
  )

  it('refuses a declared child secret absent from its parent', async () => {
    const { seen, replies } = await spawnOne(profile('child', [childBinding]), undefined, [])
    expect(seen).toEqual([])
    expect(JSON.stringify(replies)).toContain('proxySecrets')
  })

  it.each([
    ['/v1/events/nested', true],
    ['/v10/events', false],
  ] as const)('checks subtree boundary for %s', async (path, allowed) => {
    const requested = profile('child', [{ ...childBinding, paths: [path] }])
    const { seen, replies } = await spawnOne(requested, undefined, [
      { ...parentBinding, paths: ['/v1/*'] },
    ])
    expect(seen).toEqual(allowed ? [requested] : [])
    if (!allowed) expect(JSON.stringify(replies)).toContain('proxySecrets')
  })

  it('checks the final profile returned by authorizeSpawn', async () => {
    const { seen, replies } = await spawnOne(
      profile('child', [childBinding]),
      ({ profile: child }) => ({
        profile: { ...child, proxySecrets: [{ ...childBinding, hosts: ['attacker.example.com'] }] },
      }),
    )
    expect(seen).toEqual([])
    expect(JSON.stringify(replies)).toContain('proxySecrets')
  })

  it.each([undefined, []])(
    'does not inherit parent bindings when child bindings are %j',
    async (bindings) => {
      const { seen } = await spawnOne(profile('child', bindings))
      expect(seen).toHaveLength(1)
      expect(seen[0]?.proxySecrets).toEqual(bindings)
    },
  )

  it('executes explicit root-child-grandchild narrowing and refuses a grandchild widening', async () => {
    const seen: AgentProfile[] = []
    const journal = new InMemorySpawnJournal()
    const replies: unknown[] = []
    const blobs = new InMemoryResultBlobStore()
    const turns = new Map<string, number>()
    const grandchild = profile('grandchild', [{ ...childBinding, ttlSeconds: 30 }])
    const authorizations: string[] = []
    await supervise(profile('root', [parentBinding], true), 'delegate recursively', {
      budget: { maxIterations: 40, maxTokens: 40_000 },
      perWorker: { maxIterations: 10, maxTokens: 10_000 },
      inheritSpawnRights: false,
      makeLeafAgent: (child) => leaf(child, seen),
      authorizeSpawn: (input) => {
        authorizations.push(`${input.parent.name}:${input.profile.name}`)
        return { profile: input.profile }
      },
      journal,
      runId: 'proxy-tree',
      blobs,
      driveHarness: async ({ profile: manager, coordinationMcpUrl }) => {
        const turn = turns.get(manager.name) ?? 0
        turns.set(manager.name, turn + 1)
        if (turn > 0) {
          await call(coordinationMcpUrl, 'stop', {})
          return
        }
        if (manager.name === 'root') {
          await call(coordinationMcpUrl, 'spawn_worker', {
            profile: profile('child', [childBinding], true),
            task: 'delegate',
          })
        } else {
          replies.push(
            await call(coordinationMcpUrl, 'spawn_worker', {
              profile: profile('widened', [parentBinding]),
              task: 'must refuse',
            }),
          )
          replies.push(
            await call(coordinationMcpUrl, 'spawn_worker', {
              profile: grandchild,
              task: 'post events',
            }),
          )
        }
      },
    })
    expect(seen).toEqual([grandchild])
    expect(authorizations).toContain('root:child')
    expect(authorizations).toContain('child:grandchild')
    expect(JSON.stringify(replies[0])).toContain('proxySecrets')
    const events = await journal.loadTree('proxy-tree')
    const admittedChild = events?.find((event) => event.kind === 'spawned' && event.parent === 'proxy-tree')
    if (!admittedChild || admittedChild.kind !== 'spawned' || !admittedChild.profileRef) {
      throw new Error('admitted child must retain its content-addressed profile')
    }
    expect(await blobs.get(admittedChild.profileRef)).toMatchObject({ proxySecrets: [childBinding] })
    const serializedJournal = JSON.stringify(events)
    expect(serializedJournal).not.toContain('reporting-api')
    expect(serializedJournal).not.toContain('Authorization')
  })
})
