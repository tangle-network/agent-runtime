import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironmentCreateInput,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-retry'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import { coordinationMcpAlias } from '../../src/runtime/supervise/supervisor-agent'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

// A manager inside a provider sandbox reaches coordination only through its mounted MCP
// attachment, whose URL it cannot read. To POST to that same endpoint from its SHELL — which is
// how it stages a file's bytes with put_blob instead of retyping them into a tool call — it needs
// the URL as a plain environment value beside the bearer it already receives.

const directories: string[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function runWithProviderDefaults(options: {
  readonly runId: string
  readonly defaults?: { readonly env?: Readonly<Record<string, string>> }
}) {
  const directory = await mkdtemp(join(tmpdir(), 'coordination-url-env-'))
  directories.push(directory)
  const proxy = await coordinationProxy()
  proxies.push(proxy)
  const context = createFileRunContext(join(directory, 'run'))
  const creates: AgentEnvironmentCreateInput[] = []
  const attempts: DriverAttemptRecord[] = []
  let port = 0
  let token = ''

  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: { runtimeAttachments: { mcp: true } },
    }),
    create: async (input) => {
      creates.push(input)
      token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
      const environment = await base.create(input)
      return {
        ...environment,
        dispatch: async (turn) => {
          const dispatched = await environment.dispatch!(turn)
          // The manager answers from its own shell: one authenticated POST to the URL it was
          // handed in the environment, which is the whole point of the wiring under test.
          const response = await fetch(input.env?.AGENT_RUNTIME_COORDINATION_URL ?? '', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'submit',
              method: 'tools/call',
              params: { name: 'submit_result', arguments: { result: { answer: 'done' } } },
            }),
          })
          if (!response.ok) throw new Error(`submit_result returned ${response.status}`)
          return dispatched
        },
      }
    },
  }

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(new Error('test run timed out')), 20_000)
  const backend = {
    backend: 'provider' as const,
    provider,
    ...(options.defaults ? { defaults: options.defaults } : {}),
  }
  const result = await supervise(
    testAgentProfile('root', {
      harness: 'opencode',
      tools: runtimeToolDeclarations('submit_result'),
    }),
    'Produce the answer.',
    {
      runDir: join(directory, 'run'),
      runId: options.runId,
      journal: context.journal,
      blobs: context.blobs,
      signal: abort.signal,
      backend,
      driverBackend: backend,
      budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: 60_000 },
      driverRetry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
      onDriverAttempt: (record) => void attempts.push(record),
      deliverable: {
        describe: 'the answer',
        check: (value) => (value as { answer?: unknown }).answer === 'done',
      },
      coordination: {
        authentication: {
          signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
        },
        publicUrl: (address) => {
          port = address.port
          proxy.forwardTo(port)
          return `${proxy.url}/manager`
        },
      },
    },
  ).finally(() => clearTimeout(timer))
  return { result, creates, attempts, proxyUrl: `${proxy.url}/manager` }
}

describe('a provider-backed manager receives the coordination URL beside its bearer', () => {
  it('injects both names, and the URL is the attachment URL', async () => {
    const { result, creates, proxyUrl } = await runWithProviderDefaults({ runId: 'url-env' })
    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'done' } })
    expect(creates.length).toBeGreaterThan(0)
    const env = creates[0]?.env ?? {}
    expect(env.AGENT_RUNTIME_COORDINATION_TOKEN).toMatch(/^.+$/)
    expect(env.AGENT_RUNTIME_COORDINATION_URL).toBe(proxyUrl)
    // One URL, not two: the shell value must be the same endpoint the MCP attachment mounts, or a
    // manager would stage to one server and spawn against another.
    const attachment = creates[0]?.runtimeAttachments?.mcp?.[coordinationMcpAlias] as
      | { url?: string }
      | undefined
    expect(attachment?.url).toBe(env.AGENT_RUNTIME_COORDINATION_URL)
    // The bearer stays out of the attachment: it travels as a secret reference to the env name.
    expect(JSON.stringify(creates[0]?.runtimeAttachments)).not.toContain(
      env.AGENT_RUNTIME_COORDINATION_TOKEN,
    )
  })

  it.each(['AGENT_RUNTIME_COORDINATION_TOKEN', 'AGENT_RUNTIME_COORDINATION_URL'])(
    'refuses a backend default that already holds %s, naming it',
    async (reserved) => {
      const { result, attempts } = await runWithProviderDefaults({
        runId: `url-env-${reserved}`,
        defaults: { env: { [reserved]: 'caller-supplied' } },
      })
      expect(result.kind).not.toBe('winner')
      const errors = attempts.map((attempt) => attempt.error ?? '').join(' | ')
      expect(errors).toContain('reserved coordination env name')
      expect(errors).toContain(reserved)
    },
  )
})
