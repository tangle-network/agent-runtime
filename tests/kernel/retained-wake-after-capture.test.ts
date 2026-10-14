/**
 * A retained root's next turn starts only after its previous turn's workspace capture, so the wake
 * it receives must describe the run as it is at dispatch, not as it was when the wait ended.
 *
 * Discovery run test-retained-root-wake-20261014c (2026-10-14): the root's wake was composed at
 * 10:43Z from a lead message, then held 43 minutes behind a 1,549 s workspace capture. Its child
 * settled at 11:00:36Z, yet the 11:26Z turn said "Workers running: <child>" and omitted the child's
 * result, so the root kept waiting and the run settled before another wake.
 */
import { mkdtemp, rm } from 'node:fs/promises'
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
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('retained root wake held behind its workspace capture', () => {
  it('delivers a child that settled during the capture and does not report it running', {
    timeout: 40_000,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retained-wake-capture-'))
    directories.push(directory)
    const runId = 'retained-wake-capture'
    const context = createFileRunContext(join(directory, 'run'))
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    const roles = new Map<string, string>()
    const wrappers = new Map<string, (environment: AgentEnvironment) => AgentEnvironment>()
    const rootTurns: string[] = []
    let releaseChild!: () => void
    const childMayFinish = new Promise<void>((resolve) => {
      releaseChild = resolve
    })
    let rootCaptures = 0
    // A settled event names the worker and its status; the worker's answer is read separately.
    const childSettledEvent = `\\"settled\\":\\"${runId}:s0\\",\\"status\\":\\"done\\"`
    const worker = testAgentProfile('delay', {
      harness: 'claude-code',
      tools: runtimeToolDeclarations('submit_result'),
    })
    const childSettled = async () =>
      ((await context.journal.loadTree(runId)) ?? []).some(
        (event) => event.kind === 'settled' && event.id !== runId,
      )
    const provider: AgentEnvironmentProvider = {
      ...base,
      capabilities: async () => ({
        ...(await base.capabilities()),
        create: { runtimeAttachments: { mcp: true } },
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
              Authorization: `Bearer ${input.env?.AGENT_RUNTIME_COORDINATION_TOKEN}`,
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
            if (role === 'root') {
              rootTurns.push(JSON.stringify(turn))
              if (rootTurns.length === 1) {
                await call('spawn_worker', { profile: worker, task: 'Wait, then report.' })
              } else if (rootTurns.at(-1)!.includes(childSettledEvent)) {
                await call('submit_result', { result: { answer: 'ROOT: child received' } })
              }
            } else {
              // The child finishes only once the root's wake has been composed.
              await childMayFinish
              await call('submit_result', { result: { answer: 'CHILD: ready' } })
            }
            return result
          },
        })
        wrappers.set(created.id, wrap)
        return wrap(created)
      },
      async get(id) {
        const environment = await base.get!(id)
        const wrap = wrappers.get(id)
        return environment && wrap ? wrap(environment) : environment
      },
    }
    const artifacts = fileWorkspaceArtifacts(join(directory, 'artifacts'))
    const retention: ProviderWorkspaceRetentionPort = {
      timeoutMs: 20_000,
      requireCompleteProvenance: true,
      artifacts,
      async capture(captureContext) {
        if (roles.get(captureContext.environment.id) === 'root' && ++rootCaptures === 1) {
          // Hold the root's first end-of-turn capture past its 50 ms heartbeat wake, and let the
          // child settle before it ends, as run c's 25.8-minute capture did.
          await new Promise((resolve) => setTimeout(resolve, 500))
          releaseChild()
          await expect.poll(childSettled, { timeout: 15_000 }).toBe(true)
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
      'Spawn one child, wait for its result, then submit.',
      {
        pursuitId: runId,
        runId,
        runDir: join(directory, 'run'),
        journal: context.journal,
        blobs: context.blobs,
        backend,
        driverBackend: backend,
        budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: 30_000 },
        perWorker: { maxIterations: 6, maxTokens: 100 },
        driverRetry: { enabled: false },
        retainedAtSettlement: 'release',
        teardownConfirmMs: 0,
        wake: { heartbeatMs: 50, deadlineWarningMs: 0, debounceMs: 20 },
        deliverable: {
          check: (out) => (out as { answer?: string })?.answer === 'ROOT: child received',
        },
        continuation: testContinuation(),
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
        },
      },
    )
    expect(rootCaptures).toBeGreaterThanOrEqual(1)
    // The turn dispatched after the held capture carries the child's settlement and no stale worker.
    const second = rootTurns[1]
    expect(second).toBeDefined()
    expect(second).toContain(childSettledEvent)
    expect(second).toContain('Workers running: none.')
    expect(second).not.toContain(`Workers running: ${runId}:s0`)
    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'ROOT: child received' } })
    // Exactly once: the child's settlement reaches one root turn.
    expect(rootTurns.filter((turn) => turn.includes(childSettledEvent))).toHaveLength(1)
  })
})
