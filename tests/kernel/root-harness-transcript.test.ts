import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { harnessTranscriptArtifact } from '../../src/runtime/harness-transcript'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import { testContinuation } from '../helpers/continuation'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { supervise as superviseWithBrain } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

// A root has no settle record of its own, so before this receipt its harness session reached no
// record at all: 312 of 312 Discovery roots of 2026-09-23/24 settled without one (#1264).

const directories: string[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const SESSION = {
  path: '/home/agent/.local/share/opencode/storage/session/ses_root.json',
  content: '{"id":"ses_root","parts":["delegated the audit, then submitted the answer"]}',
}

/** A retained provider-backed opencode root whose one turn submits the deliverable. */
async function rootRun(runId: string, options: { readable: boolean }) {
  const directory = await mkdtemp(join(tmpdir(), 'root-harness-transcript-'))
  directories.push(directory)
  const proxy = await coordinationProxy()
  proxies.push(proxy)
  const context = createFileRunContext(join(directory, 'run'))
  let port = 0
  let token = ''
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session: (id, sessionOptions) => {
      const session = environment.session!(id, sessionOptions)
      return {
        ...session,
        result: async () => ({
          ...(await session.result()),
          usage: { inputTokens: 3, outputTokens: 2 },
        }),
      }
    },
    dispatch: async (turn) => {
      const dispatched = await environment.dispatch!(turn)
      const response = await fetch(`http://127.0.0.1:${port}/manager`, {
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
    // The session store the capture lists with `find` and reads file by file.
    ...(options.readable
      ? {
          // The subagent export runs first; this root named no subagent.
          exec: async (command: string) =>
            command.includes('opencode export')
              ? { stdout: 'done\n', exitCode: 0 }
              : { stdout: `${SESSION.content.length}\t${SESSION.path}\n`, exitCode: 0 },
          read: async (path: string) => {
            if (path !== SESSION.path) throw new Error(`no such file: ${path}`)
            return SESSION.content
          },
        }
      : {}),
  })
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: { runtimeAttachments: { mcp: true } },
    }),
    create: async (input) => {
      token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
      return wrap(await base.create(input))
    },
    get: async (id) => {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(new Error('test run timed out')), 20_000)
  const result = await supervise(
    testAgentProfile('root', {
      harness: 'opencode',
      tools: runtimeToolDeclarations('submit_result'),
    }),
    'Produce the answer.',
    {
      runDir: join(directory, 'run'),
      runId,
      journal: context.journal,
      blobs: context.blobs,
      signal: abort.signal,
      backend: { backend: 'provider', provider },
      driverBackend: { backend: 'provider', provider },
      budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: 60_000 },
      driverRetry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
      retainedAtSettlement: 'release',
      deliverable: {
        describe: 'the submitted answer',
        check: (value) => (value as { answer?: unknown }).answer === 'done',
      },
      continuation: testContinuation(),
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
  return { result, blobs: context.blobs }
}

describe("the root's harness session", () => {
  it('reaches the result as a persisted receipt, like a child settlement', async () => {
    const { result, blobs } = await rootRun('root-transcript', { readable: true })

    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'done' } })
    expect(result.rootHarnessTranscript).toMatchObject({
      status: 'available',
      harness: 'opencode',
      fileCount: 1,
      skippedCount: 0,
    })
    const receipt = result.rootHarnessTranscript
    if (receipt === undefined) throw new Error('expected a root receipt')
    const artifact = await harnessTranscriptArtifact(receipt, blobs)
    expect(artifact?.files).toEqual([
      { path: SESSION.path, bytes: SESSION.content.length, content: SESSION.content },
    ])
  })

  it('names why when the root box cannot be read', async () => {
    const { result } = await rootRun('root-transcript-unreadable', { readable: false })

    expect(result).toMatchObject({ kind: 'winner' })
    expect(result.rootHarnessTranscript).toEqual({
      status: 'unavailable',
      reason: 'unsupported-environment',
    })
  })

  it('is absent for a router-brained root, which runs no driver', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'root-harness-transcript-router-'))
    directories.push(directory)
    const context = createFileRunContext(join(directory, 'run'))
    const result = await superviseWithBrain(
      testAgentProfile('root', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
      }),
      'Answer.',
      {
        runDir: join(directory, 'run'),
        runId: 'router-root',
        journal: context.journal,
        blobs: context.blobs,
        backend: {
          backend: 'provider',
          provider: durableRetainedProvider(join(directory, 'provider.json')),
        },
        budget: { maxIterations: 4, maxTokens: 100 },
        brain: scriptedBrain([{ content: 'done' }]),
      },
    )

    expect(result).not.toHaveProperty('rootHarnessTranscript')
  })
})
