import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { captureAgentCandidateWorkspaceFiles } from '../../src/candidate-execution'
import { sha256Bytes } from '../../src/candidate-execution/digest'
import { harnessTranscriptArtifact } from '../../src/runtime/harness-transcript'
import { createPrivateCasArtifactPort } from '../../src/runtime/private-cas'
import type {
  ProviderWorkspaceCaptureResult,
  ProviderWorkspaceRetentionContext,
  ProviderWorkspaceRetentionPort,
} from '../../src/runtime/provider-workspace-retention'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import { testContinuation } from '../helpers/continuation'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import {
  proxyCoordination as coordinationProxy,
  proxySecretCapabilities,
} from '../helpers/proxy-coordination'
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
/** The retention port's native session copies, for a run that keeps them. */
interface NativeCopies {
  /** The final copy a turn takes as it ends waits for this. */
  readonly settledCopy?: Promise<void>
  readonly onSettledCopy?: () => void
  /** Every native copy throws this. */
  readonly failure?: Error
}

async function rootRun(
  runId: string,
  options: {
    readable: boolean
    retained?: boolean
    native?: NativeCopies
    captureFailure?: Error
  },
) {
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
      create: { runtimeAttachments: { mcp: true }, proxySecrets: proxySecretCapabilities },
    }),
    create: async (input) => {
      token ||= proxy.authorizationFor(input).slice('Bearer '.length)
      return wrap(await base.create(input))
    },
    get: async (id, options) => {
      if (options?.proxySecrets) {
        token = proxy.authorizationFor(options).slice('Bearer '.length)
      }
      const environment = await base.get!(id, options)
      return environment ? wrap(environment) : null
    },
  }
  const artifacts = createPrivateCasArtifactPort(join(directory, 'cas'), runId)
  // The session as the retention port stores it: a workspace capture, or a native-only copy.
  const sessionCapture = async (
    context: ProviderWorkspaceRetentionContext,
    scope: 'environment' | 'none',
  ): Promise<ProviderWorkspaceCaptureResult> => {
    const bytes = Buffer.from(SESSION.content)
    const { snapshot } = await captureAgentCandidateWorkspaceFiles(
      [{ path: 'provider/retained/native.jsonl', bytes, mode: 0o600 }],
      {
        artifactPersistence: { executionId: context.executionId, outputArtifacts: artifacts },
      },
    )
    return {
      snapshot,
      provenance: {
        status: 'reported',
        ...(scope === 'none' ? { workspaceScope: 'none' as const } : {}),
        executionId: context.executionId,
        environmentId: context.environment.id,
        controlRef: context.controlRef,
        missing: [],
        workspace: {
          scannedFiles: 1,
          reportedFiles: 1,
          scannedDirectories: 0,
          reportedDirectories: 0,
          complete: true,
        },
        sessions: [
          {
            id: context.providerSessionId!,
            executionId: context.executionId,
            backendType: 'opencode',
            transportEvents: 'complete',
            eventCount: 1,
            messageCount: 1,
            nativeStore: {
              scope: 'session',
              complete: true,
              roots: [{ scope: 'session-home', path: '/native-home' }],
              excludedPaths: [],
              inventory: {
                scannedFiles: 1,
                reportedFiles: 1,
                scannedDirectories: 0,
                reportedDirectories: 0,
                scannedSymlinks: 0,
                reportedSymlinks: 0,
                skippedEntries: 0,
              },
              entries: [
                {
                  sourceId: 'native-execution',
                  rootScope: 'session-home',
                  path: SESSION.path,
                  kind: 'file',
                  mode: 0o600,
                  sizeBytes: bytes.length,
                  sha256: sha256Bytes(bytes),
                  linkTarget: null,
                },
              ],
            },
          },
        ],
      },
    }
  }
  const workspaceRetention: ProviderWorkspaceRetentionPort | undefined = options.retained
    ? {
        artifacts,
        timeoutMs: 5_000,
        async capture(context) {
          if (options.captureFailure) throw options.captureFailure
          return sessionCapture(context, 'environment')
        },
        ...(options.native === undefined
          ? {}
          : {
              // No running copy: only the copies taken as the turn ends.
              nativeIntervalMs: 3_600_000,
              async captureNative(context) {
                if (context.phase === 'settled') {
                  options.native?.onSettledCopy?.()
                  await options.native?.settledCopy
                }
                if (options.native?.failure) throw options.native.failure
                return sessionCapture(context, 'none')
              },
            }),
      }
    : undefined
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
      backend: { backend: 'provider', provider, workspaceRetention },
      driverBackend: { backend: 'provider', provider, workspaceRetention },
      budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: 60_000 },
      driverRetry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
      retainedAtSettlement: 'release',
      deliverable: {
        describe: 'the submitted answer',
        check: (value) => (value as { answer?: unknown }).answer === 'done',
      },
      continuation: testContinuation(),
      coordination: {
        proxySecret: proxy.proxySecret,
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
  return { result, blobs: context.blobs, artifacts }
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

  it('settles a retained root descriptor even when HOME is unreadable', async () => {
    const { result, blobs, artifacts } = await rootRun('root-transcript-retained', {
      readable: false,
      retained: true,
    })
    expect(result).toMatchObject({ kind: 'winner' })
    expect(result.rootHarnessTranscript).toMatchObject({
      status: 'available',
      harness: 'opencode',
      fileCount: 1,
    })
    const receipt = result.rootHarnessTranscript!
    const metadata = await harnessTranscriptArtifact(receipt, blobs, { content: false })
    expect(metadata?.source?.node?.nodeId).toBeDefined()
    const artifact = await harnessTranscriptArtifact(receipt, blobs, { artifacts })
    expect(artifact?.files[0]?.content).toBe(SESSION.content)
    expect(artifact?.files[0]?.bytes).toBe(Buffer.byteLength(SESSION.content))
  })

  it('reaches the result when the final session copy lands after the turn commits', async () => {
    // A retained root commits its turn before its final session copy and workspace capture,
    // which run as the owner's end-of-turn work. The receipt was copied when the attempt ended,
    // so result.json kept `capture-did-not-run` for a session stored minutes later: 7 of 8 such
    // nodes on Runtime 0.319.8 and later, test-on-merge-proof-20261015a among them (#1360).
    let openCopy!: () => void
    const settledCopy = new Promise<void>((resolve) => {
      openCopy = resolve
    })
    let copyStarted = false
    const running = rootRun('root-transcript-deferred', {
      readable: false,
      retained: true,
      native: {
        settledCopy,
        onSettledCopy: () => {
          copyStarted = true
        },
      },
    })
    await expect.poll(() => copyStarted, { timeout: 15_000, interval: 50 }).toBe(true)
    openCopy()
    const { result, blobs, artifacts } = await running

    expect(result).toMatchObject({ kind: 'winner' })
    expect(result.rootHarnessTranscript).toMatchObject({
      status: 'available',
      harness: 'opencode',
      fileCount: 1,
    })
    const artifact = await harnessTranscriptArtifact(result.rootHarnessTranscript!, blobs, {
      artifacts,
    })
    expect(artifact?.files[0]?.content).toBe(SESSION.content)
  })

  it('names the failure when every copy of the root session fails', async () => {
    // 64 nodes on 2026-10-15 had every capture fail and settled `capture-did-not-run`, which
    // reads as nobody trying (#1360).
    const failure = new Error('Failed to connect to sandbox: Request timed out after 30000ms')
    const { result } = await rootRun('root-transcript-failed', {
      readable: false,
      retained: true,
      native: { failure },
      captureFailure: failure,
    })

    expect(result).toMatchObject({ kind: 'winner' })
    expect(result.rootHarnessTranscript).toMatchObject({
      status: 'unavailable',
      reason: 'enumeration-failed',
      skipped: [{ reason: expect.stringContaining('Failed to connect to sandbox') }],
    })
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
        tools: runtimeToolDeclarations('spawn_worker'),
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
