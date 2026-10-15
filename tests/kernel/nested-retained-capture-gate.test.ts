import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { captureAgentCandidateWorkspaceFiles } from '../../src/candidate-execution'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import type { ProviderWorkspaceRetentionPort } from '../../src/runtime/provider-workspace-retention'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { completeCapture, fileWorkspaceArtifacts } from '../helpers/complete-workspace-capture'
import { testContinuation } from '../helpers/continuation'
import {
  proxyCoordination as coordinationProxy,
  proxySecretCapabilities,
} from '../helpers/proxy-coordination'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('nested retained owner capture gate', () => {
  it.each([true, false])(
    'gates nested reuse with persistent capture failure=%s and permits an independent parent result',
    {
      timeout: 40_000,
    },
    async (persistentFailure) => {
      const directory = await mkdtemp(join(tmpdir(), 'nested-capture-gate-'))
      directories.push(directory)
      const proxy = await coordinationProxy()
      proxies.push(proxy)
      const runId = 'nested-capture-gate'
      const context = createFileRunContext(join(directory, 'run'))
      const base = durableRetainedProvider(join(directory, 'provider.json'))
      const roles = new Map<string, string>()
      const wrappers = new Map<string, (environment: AgentEnvironment) => AgentEnvironment>()
      const dispatched: Array<{ role: string; environmentId: string; executionId?: string }> = []
      const destroyed: string[] = []
      let captureFailures = 0
      let firstNestedCaptureNode: unknown
      let firstNestedCaptureExecution: string | undefined
      const director = testAgentProfile('director', {
        harness: 'claude-code',
        tools: runtimeToolDeclarations('submit_result'),
      })
      const provider: AgentEnvironmentProvider = {
        ...base,
        capabilities: async () => ({
          ...(await base.capabilities()),
          create: { runtimeAttachments: { mcp: true }, proxySecrets: proxySecretCapabilities },
        }),
        async create(input) {
          const created = await base.create(input)
          const role = typeof input.profile === 'string' ? input.profile : input.profile.name
          roles.set(created.id, role)
          const attachment = input.runtimeAttachments?.mcp?.['agent-runtime-coordination']
          if (attachment?.transport !== 'http') throw new Error('missing coordination attachment')
          const call = async (name: string, args: unknown) => {
            const response = await fetch(attachment.url, {
              method: 'POST',
              headers: {
                Authorization: proxy.authorizationFor(input),
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: name,
                method: 'tools/call',
                params: { name, arguments: args },
              }),
            })
            const body = await response.json()
            if (!response.ok || body.error || body.result?.isError)
              throw new Error(JSON.stringify(body))
            return JSON.parse(body.result.content[0].text)
          }
          const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
            ...environment,
            async dispatch(turn) {
              const result = await environment.dispatch!(turn)
              dispatched.push({
                role,
                environmentId: environment.id,
                executionId: turn.executionId,
              })
              const count = dispatched.filter((event) => event.role === role).length
              if (role === 'root') {
                if (count === 1) {
                  await call('spawn_worker', { profile: director, task: 'Find a nested answer.' })
                } else {
                  // The parent independently resolves its task. This is deliberately NOT proof
                  // that the nested manager completed or that a sealed pursuit can resume it.
                  await expect
                    .poll(
                      async () => {
                        const events = (await context.journal.loadTree(runId)) ?? []
                        return (
                          events.some((event) => event.kind === 'reconciled') ||
                          dispatched.filter((event) => event.role === 'director').length > 1
                        )
                      },
                      { timeout: 10_000 },
                    )
                    .toBe(true)
                  expect(
                    await call('submit_result', { result: { answer: 'independent parent' } }),
                  ).toMatchObject({ accepted: true })
                }
              } else if (count > 1) {
                // Baseline reaches this unsafe second dispatch; the receipt gate must not.
                await call('submit_result', { result: { answer: 'nested' } })
              }
              return result
            },
            async destroy() {
              destroyed.push(environment.id)
              await environment.destroy?.()
            },
          })
          wrappers.set(created.id, wrap)
          return wrap(created)
        },
        async get(id, options) {
          const environment = await base.get!(id, options)
          const wrap = wrappers.get(id)
          return environment && wrap ? wrap(environment) : environment
        },
      }
      const artifacts = fileWorkspaceArtifacts(join(directory, 'artifacts'))
      const retention: ProviderWorkspaceRetentionPort = {
        timeoutMs: 5_000,
        requireCompleteProvenance: true,
        artifacts,
        async capture(captureContext) {
          if (
            roles.get(captureContext.environment.id) === 'director' &&
            (persistentFailure || captureFailures === 0)
          ) {
            firstNestedCaptureNode ??= captureContext.node
            firstNestedCaptureExecution ??= captureContext.executionId
            captureFailures += 1
            throw new Error('nested capture storage unavailable')
          }
          return completeCapture(captureContext, artifacts)
        },
        async captureNative(captureContext) {
          const { snapshot } = await captureAgentCandidateWorkspaceFiles(
            [{ path: 'native.jsonl', mode: 0o600, bytes: new TextEncoder().encode('{}\n') }],
            {
              artifactPersistence: {
                executionId: captureContext.executionId,
                outputArtifacts: artifacts,
              },
            },
          )
          return {
            snapshot,
            provenance: {
              status: 'reported',
              environmentId: captureContext.environment.id,
              executionId: captureContext.executionId,
              workspaceScope: 'none',
              missing: [],
            },
          }
        },
      }
      const backend = { backend: 'provider' as const, provider, workspaceRetention: retention }
      const { result } = await supervisePursuit(
        testAgentProfile('root', {
          harness: 'claude-code',
          tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
        }),
        'Resolve this task independently of any blocked nested manager.',
        {
          pursuitId: runId,
          runId,
          runDir: join(directory, 'run'),
          journal: context.journal,
          blobs: context.blobs,
          backend,
          driverBackend: backend,
          budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: 25_000 },
          perWorker: { maxIterations: 6, maxTokens: 100 },
          maxDepth: 3,
          driverRetry: { enabled: false },
          retainedAtSettlement: 'release',
          teardownConfirmMs: 0,
          wake: { deadlineWarningMs: 0, debounceMs: 20 },
          deliverable: {
            check: (out) => (out as { answer?: string })?.answer === 'independent parent',
          },
          resolveDeliverable: () => ({
            check: (out) => (out as { answer?: string })?.answer === 'nested',
          }),
          continuation: testContinuation(),
          coordination: {
            proxySecret: proxy.proxySecret,
            authentication: {
              signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
            },
            publicUrl: (address) => proxy.publicUrl(address),
          },
        },
      )
      expect(result).toMatchObject({ kind: 'winner', out: { answer: 'independent parent' } })
      expect(await readFile(join(directory, 'run', 'result.json'), 'utf8')).toContain(
        'independent parent',
      )
      const nestedDispatches = dispatched.filter((event) => event.role === 'director')
      expect(nestedDispatches).toHaveLength(persistentFailure ? 1 : 2)
      expect([...roles.values()].filter((role) => role === 'director')).toHaveLength(1)
      expect(captureFailures).toBeGreaterThanOrEqual(persistentFailure ? 2 : 1)
      const nestedId = nestedDispatches[0]!.environmentId
      if (persistentFailure) {
        expect(destroyed).not.toContain(nestedId)
        expect(await base.get!(nestedId)).not.toBeNull()
      }
      const parentEvents = (await context.journal.loadTree(runId)) ?? []
      const spawn = parentEvents.find(
        (event) => event.kind === 'spawned' && event.ownedTreeRoot !== undefined,
      )
      if (spawn?.kind !== 'spawned' || spawn.ownedTreeRoot === undefined)
        throw new Error('missing nested owner tree')
      const events = (await context.journal.loadTree(spawn.ownedTreeRoot)) ?? []
      const accepted = events.filter((event) => event.kind === 'execution-result')
      expect(accepted).toHaveLength(persistentFailure ? 1 : 2)
      expect(await context.blobs.get(accepted[0]!.outRef)).toBeDefined()
      expect(events.filter((event) => event.kind === 'execution-input')).toHaveLength(
        persistentFailure ? 1 : 2,
      )
      expect(events.filter((event) => event.kind === 'execution-abandoned')).toHaveLength(0)
      if (!persistentFailure) {
        const outputs = await Promise.all(
          events.flatMap((event) =>
            event.kind === 'execution-evidence' ? [context.blobs.get(event.outRef)] : [],
          ),
        )
        const recovered = outputs.find(
          (out) =>
            (out as { workspaceCapture?: { executionId: string } }).workspaceCapture
              ?.executionId === firstNestedCaptureExecution,
        )
        expect(recovered).toBeDefined()
        expect(
          (recovered as { workspaceCapture: { node: unknown } }).workspaceCapture.node,
        ).toEqual(firstNestedCaptureNode)
        return
      }
      expect(events.filter((event) => event.kind === 'execution-evidence')).toHaveLength(0)
      expect(parentEvents.some((event) => event.kind === 'reconciled')).toBe(true)
      expect(result.tree.nodes.find((node) => node.id === spawn.id)?.status).toBe('failed')
      expect(
        parentEvents.some(
          (event) => event.kind === 'settled' && event.id === spawn.id && event.status === 'done',
        ),
      ).toBe(false)
    },
  )
})
