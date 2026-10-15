import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile, ProxySecretBinding } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  loadSpawnForest,
} from '../../src/durable/spawn-journal'
import type { ProviderWorkspaceRetentionPort } from '../../src/runtime/provider-workspace-retention'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import { type SuperviseOptions, supervise } from '../../src/runtime/supervise/supervise'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import { checkpointCaptureFixture } from '../helpers/checkpoint-capture'
import { completeCapture } from '../helpers/complete-workspace-capture'
import { testContinuation } from '../helpers/continuation'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { proxyCoordination, proxySecretCapabilities } from '../helpers/proxy-coordination'
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
  it('refuses missing parent map readback before dispatch and cleans its created environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supervise-proxy-parents-'))
    const proxy = await proxyCoordination()
    const journal = new InMemorySpawnJournal()
    const allocated: string[] = []
    let dispatches = 0
    let destroyed = 0
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    const defaults = { env: { PUBLIC_FIXTURE_SETTING: 'preserved' } }
    const provider: AgentEnvironmentProvider = {
      ...base,
      async capabilities() {
        const capabilities = await base.capabilities()
        return {
          ...capabilities,
          create: {
            ...capabilities.create,
            runtimeAttachments: { mcp: true },
            proxySecrets: proxySecretCapabilities,
          },
        }
      },
      async create(input) {
        const environment = await base.create(input)
        allocated.push(environment.id)
        return {
          ...environment,
          creation: 'created',
          // A generic provider cannot prove support through an SDK-only capability.
          // Its missing current readback must refuse dispatch after allocation.
          proxySecretParents: undefined,
          async dispatch(input) {
            dispatches++
            return environment.dispatch!(input)
          },
          async destroy() {
            destroyed++
            await environment.destroy?.()
          },
        }
      },
    }
    try {
      const outcome = await supervise(
        profile('root', [parentBinding], true),
        'admit root custody',
        {
          runId: 'proxy-parent-root',
          journal,
          backend: { backend: 'provider', provider, defaults },
          driverBackend: { backend: 'provider', provider, defaults },
          budget: { maxIterations: 2, maxTokens: 2_000 },
          driverRetry: { enabled: false },
          coordination: {
            authentication: true,
            publicUrl: proxy.publicUrl,
            proxySecret: proxy.proxySecret,
          },
        },
      ).then(
        (value) => JSON.stringify(value),
        (error) => String(error),
      )
      expect(
        allocated,
        'missing readback is checked on the created fixture environment',
      ).toHaveLength(1)
      expect(dispatches).toBe(0)
      expect(destroyed).toBe(1)
      expect(outcome).toContain('provider proxySecretParents readback differs from admitted pins')
      const events = (await journal.loadTree('proxy-parent-root')) ?? []
      const inputs = events.filter(
        (event) => event.kind === 'execution-input' && event.id === 'proxy-parent-root',
      )
      expect(inputs).toHaveLength(1)
      expect(Reflect.get(inputs[0]!, 'proxySecretParents')).toEqual({
        REPORTS_TOKEN: null,
        AGENT_RUNTIME_COORDINATION_TOKEN: null,
      })
      expect(defaults).toEqual({ env: { PUBLIC_FIXTURE_SETTING: 'preserved' } })
      expect(JSON.stringify(events)).not.toContain('reporting-api')
      expect(JSON.stringify(events)).not.toContain('Authorization')
    } finally {
      await proxy.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('preserves the protected public supervisor source without checkpoint inspection forks', { timeout: 10_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supervise-protected-checkpoint-'))
    const proxy = await proxyCoordination()
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    const runId = 'protected-checkpoint-root'
    const files = new Map<string, string>([['notes.md', 'protected workspace']])
    const checkpoints = new Map<string, ReadonlyMap<string, string>>()
    const capture = checkpointCaptureFixture({ provider: base.name, snapshotFiles: id => checkpoints.get(id) })
    let sourceId: string | undefined
    let destroyed = 0
    let deleted = 0
    const wrap = (environment: AgentEnvironment, coordinate: () => Promise<void>): AgentEnvironment => ({
      ...environment,
      read: async path => {
        const content = files.get(path)
        if (content === undefined) throw new Error('fixture workspace file absent')
        return content
      },
      write: async (path, content) => { files.set(path, content) },
      workspaceBranching: {
        ...capture.branching,
        async checkpoint(request) {
          const checkpointId = `protected-checkpoint-${checkpoints.size + 1}`
          checkpoints.set(checkpointId, new Map(files))
          return { status: 'created', idempotencyKey: request.idempotencyKey, requestDigest: request.requestDigest,
            checkpoint: { checkpointId, provider: environment.provider, source: request.source,
              idempotencyKey: request.idempotencyKey, requestDigest: request.requestDigest, createdAt: new Date().toISOString() } }
        },
        lookupCheckpoint: async request => ({ ...request, status: 'not_found' }),
        deleteCheckpoint: async request => { deleted++; checkpoints.delete(request.targetId); return { ...request, status: 'deleted' } },
      },
      session(id, options) {
        const session = environment.session!(id, options)
        return { ...session,
          async *events(eventOptions) { await coordinate(); yield* session.events(eventOptions) },
          async result() { await coordinate(); return session.result() },
        }
      },
      async destroy() { destroyed++; await environment.destroy?.() },
    })
    let coordinate: () => Promise<void> = async () => { throw new Error('fixture source not created') }
    const provider: AgentEnvironmentProvider = {
      ...base,
      capabilities: async () => ({ ...(await base.capabilities()), create: { runtimeAttachments: { mcp: true }, proxySecrets: proxySecretCapabilities, workspaceCheckpoint: true } }),
      async create(input) {
        const environment = await base.create(input)
        sourceId = environment.id
        const attachment = input.runtimeAttachments?.mcp?.['agent-runtime-coordination']
        if (attachment?.transport !== 'http') throw new Error('fixture coordination attachment absent')
        let completed: Promise<void> | undefined
        const request = async (name: string, args: Record<string, unknown>) => {
          const response = await fetch(attachment.url, { method: 'POST', signal: AbortSignal.timeout(2_000),
            headers: { Authorization: proxy.authorizationFor(input), 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: name, method: 'tools/call', params: { name, arguments: args } }) })
          const reply: unknown = await response.json()
          expect(response.ok).toBe(true)
          if (reply === null || typeof reply !== 'object' || Object.hasOwn(reply, 'error')) throw new Error('fixture coordination refused')
          const result: unknown = Reflect.get(reply, 'result')
          if (result !== null && typeof result === 'object' && Reflect.get(result, 'isError') === true) throw new Error('fixture tool refused')
        }
        coordinate = () => completed ??= (async () => {
          await request('read_journal', {})
          await expect.poll(async () => ((await journal.loadTree(runId)) ?? []).some(event => event.kind === 'workspace-checkpoint'), { timeout: 1_000 }).toBe(true)
          await request('submit_result', { result: { answer: 'retained safely' } })
        })()
        return wrap(environment, coordinate)
      },
      async get(id, options) {
        const environment = await base.get!(id, options)
        return environment ? wrap(environment, coordinate) : capture.forkEnvironment(id)
      },
    }
    const retention: ProviderWorkspaceRetentionPort = { ...capture.port, timeoutMs: 1_000, requireCompleteProvenance: true,
      capture: context => completeCapture(context, capture.cas) }
    const backend = { backend: 'provider' as const, provider, workspaceRetention: retention }
    try {
      await supervise(testAgentProfile('root', { tools: runtimeToolDeclarations('read_journal', 'submit_result') }), 'retain the protected workspace', {
        runId, journal, blobs, signal: AbortSignal.timeout(5_000), backend, driverBackend: backend,
        budget: { maxIterations: 4, maxTokens: 4_000 }, driverRetry: { enabled: false },
        retainedAtSettlement: 'release', teardownConfirmMs: 0,
        continuation: testContinuation({ deadline: Date.now() + 5_000 }),
        deliverable: { check: out => out !== null && typeof out === 'object' && Reflect.get(out, 'answer') === 'retained safely' },
        coordination: { authentication: true, publicUrl: proxy.publicUrl, proxySecret: proxy.proxySecret },
      })
      const events = (await journal.loadTree(runId)) ?? []
      expect(events.some(event => event.kind === 'workspace-checkpoint')).toBe(true)
      expect(capture.forks.size, 'protected public checkpoint cleanup must refuse before inspection allocation').toBe(0)
      expect(events.some(event => event.kind === 'workspace-checkpoint-fork-requested')).toBe(false)
      expect(events).toContainEqual(expect.objectContaining({ kind: 'workspace-checkpoint-cleanup', confirmed: false,
        refused: 'proxy-secret checkpoint capture refused: no checkpoint-specific custody proof' }))
      expect(deleted).toBe(0)
      expect(destroyed).toBe(0)
      expect(sourceId).toBeDefined()
      expect(await base.get!(sourceId!)).not.toBeNull()
      expect(checkpoints.size).toBe(1)
      expect(JSON.stringify(events)).not.toContain('Authorization')
    } finally {
      capture.cleanup()
      await proxy.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(['ordinary manager', 'managed protected steering leaf'] as const)(
    'persists actual root-child-grandchild parent maps before provider creation (%s)',
    async (mode) => {
      const steering = mode === 'managed protected steering leaf'
      const directory = await mkdtemp(join(tmpdir(), 'supervise-proxy-parent-tree-'))
      const proxy = await proxyCoordination()
      const journal = new InMemorySpawnJournal()
      const blobs = new InMemoryResultBlobStore()
      const base = durableRetainedProvider(join(directory, 'provider.json'))
      const allocations: Array<{
        name: string
        environment: AgentEnvironment
        parents: unknown
        readback: unknown
      }> = []
      const mapsBeforeAllocation: unknown[] = []
      const replies: unknown[] = []
      const dispatchedNames: string[] = []
      const streamedNames: string[] = []
      const controller = new AbortController()
      let releaseAncestors: () => void = () => {}
      const descendantsDispatched = new Promise<void>((resolve) => {
        releaseAncestors = resolve
        controller.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      const child = profile('child', [childBinding], true)
      const grandchild = profile('grandchild', [{ ...childBinding, ttlSeconds: 30 }], !steering)
      const defaults = { env: { PUBLIC_FIXTURE_SETTING: 'preserved' } }
      const provider: AgentEnvironmentProvider = {
        ...base,
        async capabilities() {
          const capabilities = await base.capabilities()
          return {
            ...capabilities,
            create: {
              ...capabilities.create,
              runtimeAttachments: { mcp: true },
              proxySecrets: proxySecretCapabilities,
            },
          }
        },
        async create(input) {
          if (typeof input.profile === 'string')
            throw new Error('inline profile required by fixture')
          const name = input.profile.name
          if (!name) throw new Error('named profile required by fixture')
          const parents: unknown = Reflect.get(input, 'proxySecretParents')
          const forest = await loadSpawnForest(journal, 'proxy-parent-tree')
          const events = forest.events.map((entry) => entry.event)
          const inputMaps = events
            .filter((event) => event.kind === 'execution-input')
            .map((event) => Reflect.get(event, 'proxySecretParents'))
          mapsBeforeAllocation.push({ name, parents, inputMaps })
          const environment = await base.create(input)
          allocations.push({ name, environment, parents, readback: environment.proxySecretParents })
          if (steering && name === 'grandchild') {
            expect(input.runtimeAttachments?.mcp?.['agent-runtime-coordination']).toBeUndefined()
            return {
              ...environment,
              async *stream() {
                streamedNames.push(name)
                releaseAncestors()
                yield { type: 'result' as const, data: { finalText: 'scoped reports complete' } }
              },
            }
          }
          const authorization = proxy.authorizationFor(input)
          const attachment = input.runtimeAttachments?.mcp?.['agent-runtime-coordination']
          if (!attachment || attachment.transport !== 'http')
            throw new Error('manager coordination URL required by fixture')
          const request = async (tool: string, args: Record<string, unknown>) => {
            const response = await fetch(attachment.url, {
              method: 'POST',
              signal: controller.signal,
              headers: { Authorization: authorization, 'content-type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: `${name}:${tool}`,
                method: 'tools/call',
                params: { name: tool, arguments: args },
              }),
            })
            expect(response.ok).toBe(true)
            const reply: unknown = await response.json()
            replies.push(reply)
            if (reply !== null && typeof reply === 'object') {
              const result: unknown = Reflect.get(reply, 'result')
              if (
                Object.hasOwn(reply, 'error') ||
                (result !== null &&
                  typeof result === 'object' &&
                  Reflect.get(result, 'isError') === true)
              ) {
                releaseAncestors()
                throw new Error(`fixture ${tool} refused`)
              }
            }
            return reply
          }
          return {
            ...environment,
            async dispatch(turn) {
              const dispatched = await environment.dispatch!(turn)
              dispatchedNames.push(name)
              if (name === 'grandchild') releaseAncestors()
              if (name === 'root' || name === 'child') {
                await request('spawn_worker', {
                  profile: name === 'root' ? child : grandchild,
                  task: 'delegate scoped reports',
                  key: `${name}-reports`,
                })
                // End ancestors after the grandchild's actual fixture dispatch,
                // following both public spawn boundaries and receipt checks.
                await descendantsDispatched
              }
              await request('stop', {})
              return dispatched
            },
          }
        },
      }
      const timeout = setTimeout(
        () => controller.abort(new Error('fixture delegation deadline')),
        3_000,
      )
      try {
        const outcome = await supervise(
          profile('root', [parentBinding], true),
          'delegate scoped reports',
          {
            runId: 'proxy-parent-tree',
            journal,
            blobs,
            signal: controller.signal,
            backend: {
              backend: 'provider',
              provider,
              defaults,
              ...(steering ? { steering: { maxTurns: 1, turnTimeoutMs: 1_000 } } : {}),
            },
            driverBackend: { backend: 'provider', provider, defaults },
            budget: { maxIterations: 40, maxTokens: 40_000 },
            perWorker: { maxIterations: 10, maxTokens: 10_000 },
            driverRetry: { enabled: false },
            inheritSpawnRights: false,
            authorizeSpawn: ({ profile: requested }) => ({ profile: requested }),
            coordination: {
              authentication: true,
              publicUrl: proxy.publicUrl,
              proxySecret: proxy.proxySecret,
            },
          },
        ).catch((error) => error)
        expect(
          allocations.map((entry) => entry.name),
          'root and descendant allocations must preserve admitted parent maps',
        ).toEqual(['root', 'child', 'grandchild'])
        expect(outcome).not.toBeInstanceOf(Error)
        expect(dispatchedNames).toEqual(
          steering ? ['root', 'child'] : ['root', 'child', 'grandchild'],
        )
        expect(
          streamedNames,
          'managed protected steering must reach the public adapter stream',
        ).toEqual(steering ? ['grandchild'] : [])
        const [root, delegated, nested] = allocations
        const rootParents = { REPORTS_TOKEN: null, AGENT_RUNTIME_COORDINATION_TOKEN: null }
        const childParents = {
          REPORTS_TOKEN: root!.environment.id,
          AGENT_RUNTIME_COORDINATION_TOKEN: null,
        }
        const grandchildParents = {
          REPORTS_TOKEN: delegated!.environment.id,
          ...(!steering ? { AGENT_RUNTIME_COORDINATION_TOKEN: null } : {}),
        }
        expect(root!.parents).toEqual(rootParents)
        expect(delegated!.parents).toEqual(childParents)
        expect(nested!.parents).toEqual(grandchildParents)
        expect(new Set(allocations.map((entry) => entry.environment.id)).size).toBe(3)
        for (const [index, parents] of [rootParents, childParents, grandchildParents].entries()) {
          expect(mapsBeforeAllocation[index]).toMatchObject({
            parents,
            inputMaps: expect.arrayContaining([parents]),
          })
          expect(allocations[index]!.readback).toEqual(parents)
        }
        expect(defaults).toEqual({ env: { PUBLIC_FIXTURE_SETTING: 'preserved' } })
        expect(JSON.stringify(replies)).not.toContain('"isError":true')
      } finally {
        clearTimeout(timeout)
        releaseAncestors()
        controller.abort()
        await proxy.close()
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

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
    const admittedChild = events?.find(
      (event) => event.kind === 'spawned' && event.parent === 'proxy-tree',
    )
    if (!admittedChild || admittedChild.kind !== 'spawned' || !admittedChild.profileRef) {
      throw new Error('admitted child must retain its content-addressed profile')
    }
    expect(await blobs.get(admittedChild.profileRef)).toMatchObject({
      proxySecrets: [childBinding],
    })
    const serializedJournal = JSON.stringify(events)
    expect(serializedJournal).not.toContain('reporting-api')
    expect(serializedJournal).not.toContain('Authorization')
  })
})
