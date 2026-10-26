import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { RuntimeFailureCause } from '../../src/index'
import { FileObserverJournal, projectPursuit, superviseGraphPursuit } from '../../src/durable/index'
import {
  type Agent,
  type AgentGraph,
  connectRemoteSupervisor,
  createExecutorRegistry,
  createSupervisor,
  FileResultBlobStore,
  FileSpawnJournal,
  materializeTreeView,
  promptHandle,
  replaySpawnTree,
  serveCoordinationMcp,
  workerFromBackend,
} from '../../src/runtime/index'
import { bridgeUpstreamError } from '../../src/runtime/supervise/bridge-protocol'

// The qualifier supplies the PUBLIC entry of an installed, exact qualified cli-bridge artifact.
// Without it these are explicitly skipped paired proofs, never evidence of native qualification.
const bridgeEntry = process.env.RUNTIME_BRIDGE_PACKAGE_ENTRY
interface PublicBridge {
  loadConfig(env: Record<string, string>): Record<string, unknown>
  startServer(options: {
    config: Record<string, unknown>
    handleSignals: false
    quiet: true
  }): Promise<{ url: string; close(): Promise<void> }>
}
const profile = {
  name: 'native-worker',
  harness: 'claude-code' as const,
  model: { provider: 'anthropic', default: 'protocol-fixture-model' },
  prompt: { systemPrompt: 'Run the disposable native protocol fixture.' },
}
const budget = { maxIterations: 20, maxTokens: 10000, deadlineMs: 20000 }
const graph: AgentGraph = {
  nodes: [{ id: 'native-worker', profile }],
  edges: [],
  entry: [{ node: 'native-worker', task: 'Return the protocol fixture result.' }],
  budget,
  deliverable: { check: () => true },
}

async function paired(kind: string) {
  if (!bridgeEntry)
    throw new Error('set RUNTIME_BRIDGE_PACKAGE_ENTRY to the installed public Bridge entry')
  const bridge = (await import(/* @vite-ignore */ bridgeEntry)) as PublicBridge
  const directory = await mkdtemp(join(tmpdir(), 'runtime-failure-bridge-'))
  const executable = join(directory, 'native-protocol.cjs')
  await copyFile(
    fileURLToPath(new URL('./fixtures/native-failure-protocol.cjs', import.meta.url)),
    executable,
  )
  await chmod(executable, 0o700)
  await writeFile(join(directory, 'native-case.json'), JSON.stringify({ kind }))
  const bearer = 'disposable-local-protocol-fixture-token'
  try {
    const server = await bridge.startServer({
      config: {
        ...bridge.loadConfig({
          BRIDGE_DATA_DIR: join(directory, 'bridge'),
          BRIDGE_BACKENDS: 'claude',
          BRIDGE_BEARER: bearer,
          BRIDGE_TRACE: 'off',
          CLAUDE_BIN: executable,
        }),
        port: 0,
      },
      handleSignals: false,
      quiet: true,
    })
    return {
      directory,
      backend: {
        backend: 'bridge' as const,
        bridgeUrl: server.url,
        bridgeBearer: bearer,
        cwd: directory,
        outputFormat: 'json' as const,
      },
      async close() {
        await server.close()
        await rm(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function waitForPid(directory: string): Promise<number> {
  const end = Date.now() + 10000
  while (Date.now() < end) {
    try {
      const pid = Number(await readFile(join(directory, 'native.pid'), 'utf8'))
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('invalid native process PID')
      return pid
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await sleep(10)
  }
  throw new Error('native process did not start before the bounded deadline')
}

type GuardCause = 'not_authenticated' | 'api_key_selected' | 'subscription_unverified'
type GuardWire = NonNullable<RuntimeFailureCause['remediation']> & {
  type: 'subscription_required'
  status: 403
  provider_dispatch: 'not_started'
}

// This separate fixture delegates metadata to a real installed native binary. It never emits
// native status/model frames, and refuses every argument list that could start inference.
async function subscriptionPair(cause: GuardCause) {
  const native = process.env.RUNTIME_BRIDGE_NATIVE_CLAUDE_BIN
  if (!bridgeEntry || !native)
    throw new Error(
      'require qualified RUNTIME_BRIDGE_PACKAGE_ENTRY and RUNTIME_BRIDGE_NATIVE_CLAUDE_BIN',
    )
  await access(native)
  const bridge = (await import(/* @vite-ignore */ bridgeEntry)) as PublicBridge
  const directory = await mkdtemp(join(tmpdir(), 'runtime-subscription-bridge-'))
  const previous = { ...process.env }
  let server: Awaited<ReturnType<PublicBridge['startServer']>> | undefined
  const close = async () => {
    try {
      await server?.close()
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
      Object.assign(process.env, previous)
      await rm(directory, { recursive: true, force: true })
    }
  }
  try {
    const home = join(directory, 'home')
    const workspace = join(directory, 'workspace')
    await Promise.all([
      mkdir(join(home, '.claude'), { recursive: true }),
      mkdir(join(workspace, '.claude'), { recursive: true }),
    ])
    for (const key of [
      'CLAUDE_CONFIG_DIR',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ])
      delete process.env[key]
    process.env.HOME = home
    const attempted = join(directory, 'inference-attempted')
    const metadata = join(directory, 'native-metadata')
    const wrapper = join(directory, 'claude-readonly')
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    await writeFile(
      wrapper,
      `#!/bin/sh
readonly_status() {
  while [ "$#" -gt 3 ]; do
    case "$1" in --setting-sources|--settings) shift; [ "$#" -gt 0 ] || return 1; shift ;; *) return 1 ;; esac
  done
  [ "$#" -eq 3 ] && [ "$1" = auth ] && [ "$2" = status ] && [ "$3" = --json ]
}
if [ "$#" -eq 1 ] && [ "$1" = --version ]; then
  printf 'version\\n' >> ${quote(metadata)}
elif readonly_status "$@"; then
  printf 'status\\n' >> ${quote(metadata)}
else
  printf attempted >> ${quote(attempted)}
  exit 125
fi
exec ${quote(native)} "$@"
`,
      { mode: 0o700 },
    )
    const bearer = 'disposable-native-status-bridge-token'
    server = await bridge.startServer({
      config: {
        ...bridge.loadConfig({
          BRIDGE_DATA_DIR: join(directory, 'bridge'),
          BRIDGE_BACKENDS: 'claude',
          BRIDGE_BEARER: bearer,
          BRIDGE_TRACE: 'off',
          CLAUDE_BIN: wrapper,
          BRIDGE_SUBSCRIPTIONS_ONLY: '1',
        }),
        port: 0,
      },
      handleSignals: false,
      quiet: true,
    })
    const url = server.url
    const headers = { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }
    const catalog = await fetch(`${url}/v1/models`, { headers }).then((response) => response.json())
    expect(
      catalog.data.find((row: { id: string }) => row.id === 'claude-code/opus').authentication
        .status,
    ).toBe('signed_out')
    expect(await readFile(metadata, 'utf8')).toContain('status\n')
    if (cause === 'api_key_selected')
      await writeFile(
        join(workspace, '.claude', 'settings.json'),
        JSON.stringify({ env: { ANTHROPIC_API_KEY: 'public-project-api-canary' } }),
      )
    if (cause === 'subscription_unverified')
      process.env.ANTHROPIC_AUTH_TOKEN = 'public-native-bearer-canary'
    return {
      directory,
      workspace,
      close,
      backend: {
        backend: 'bridge' as const,
        bridgeUrl: url,
        bridgeBearer: bearer,
        cwd: workspace,
        outputFormat: 'json' as const,
      },
      async refusal(): Promise<GuardWire> {
        const request = (stream: boolean) =>
          fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: 'claude-code/opus',
              cwd: workspace,
              stream,
              ...(stream ? { run_id: `wire-${cause}` } : {}),
              messages: [{ role: 'user', content: 'Admission must refuse before inference.' }],
            }),
          })
        const response = await request(false)
        expect(response.status).toBe(403)
        const body = await response.text()
        const { error } = JSON.parse(body) as { error: GuardWire }
        expect(error).toMatchObject({
          type: 'subscription_required',
          status: 403,
          cause,
          provider_dispatch: 'not_started',
          harness: 'claude-code',
          provider: 'anthropic',
        })
        expect(error.fix.length).toBeGreaterThan(0)
        expect(error.fix.length).toBeLessThanOrEqual(256)
        // Runtime's normal driver uses SSE. Exercise its shared non-2xx decoder with the actual
        // public server response too, rather than fabricating an HTTP server or error object.
        const decoded = bridgeUpstreamError(
          body,
          'actual public Bridge HTTP refusal',
          response.status,
        )
        expect(decoded).toMatchObject({
          status: 403,
          upstreamCode: 'subscription_required',
          providerDispatch: 'not_started',
          remediation: wireRemediation(error),
        })
        const streamed = await request(true)
        expect(streamed.status).toBe(200)
        const frames = (await streamed.text())
          .split('\n')
          .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
          .map((line) => JSON.parse(line.slice(6)))
        expect(
          frames.find((frame) => frame.error?.type === 'subscription_required')?.error,
        ).toEqual(error)
        return error
      },
      async assertNoDispatch() {
        await expect(readFile(attempted)).rejects.toMatchObject({ code: 'ENOENT' })
        expect(await readFile(metadata, 'utf8')).toContain('status\n')
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}

const subscriptionProfile = { ...profile, model: { provider: 'anthropic', default: 'opus' } }
const rootedSubscriptionGraph: AgentGraph = {
  nodes: [
    {
      id: 'native-root',
      profile: {
        ...subscriptionProfile,
        name: 'native-root',
        tools: { agent_runtime_coordination_spawn_worker: true },
      },
    },
    { id: 'native-worker', profile: subscriptionProfile },
  ],
  edges: [
    {
      kind: 'delegates',
      from: 'native-root',
      to: 'native-worker',
      directive: promptHandle('delegates/worker-brief/v1'),
    },
  ],
  budget,
  deliverable: { describe: 'Deliver the worker result.', check: () => true },
}

function wireRemediation(wire: GuardWire) {
  return { cause: wire.cause, fix: wire.fix, harness: wire.harness, provider: wire.provider }
}

describe.skipIf(!bridgeEntry)(
  'Runtime failure projection through an installed real Bridge server',
  () => {
    it.each([
      { kind: 'model', code: 'request-rejected', providerCode: 'MODEL_NOT_FOUND', exitCode: 7 },
      { kind: 'auth', code: 'credential-refused', providerCode: 'SEAT_NOT_LOGGED_IN', exitCode: 9 },
    ])(
      'preserves $kind refusal through result, durable journals and cold readers',
      async (scenario) => {
        const fixture = await paired(scenario.kind)
        const runDir = join(fixture.directory, 'runtime')
        const runId = `native-${scenario.kind}`
        try {
          const result = await superviseGraphPursuit(graph, {
            backend: fixture.backend,
            runDir,
            runId,
            pursuitId: runId,
            perWorker: { maxIterations: 1, maxTokens: 1000 },
            driverRetry: { enabled: false },
          })
          expect(result.result.result).toMatchObject({
            kind: 'no-winner',
            reason: 'all-children-down',
          })
          const node = result.result.result.tree.nodes.find(
            (node) => node.label === 'native-worker',
          )
          expect(node, JSON.stringify(result.result)).toBeDefined()
          const failure = node!.failure
          expect(failure).toMatchObject({
            code: scenario.code,
            owner: 'caller',
            providerCode: scenario.providerCode,
          })
          expect(failure?.providerCode).not.toBe('config')
          expect(failure).not.toHaveProperty('fixCommand')
          expect(
            JSON.parse(await readFile(join(fixture.directory, 'native-exit.json'), 'utf8')),
          ).toMatchObject({ exitCode: scenario.exitCode })
          const journal = new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl'))
          const events = await journal.loadTree(runId)
          if (!events) throw new Error('actual Bridge execution produced no Runtime journal')
          expect(
            events.find((event) => event.id === node!.id && event.kind === 'settled'),
          ).toMatchObject({ failure })
          const replay = await replaySpawnTree(
            journal,
            new FileResultBlobStore(join(runDir, 'blobs')),
            runId,
          )
          expect(replay.find((settled) => settled.handle.id === node!.id)).toMatchObject({
            kind: 'down',
            failure,
          })
          expect(
            materializeTreeView(events).nodes.find((recorded) => recorded.id === node!.id)?.failure,
          ).toEqual(failure)
          const observer = new FileObserverJournal(result.observerPath, runId)
          expect(
            projectPursuit(await observer.read()).nodes.find((recorded) => recorded.id === node!.id)
              ?.failure,
          ).toEqual(failure)
          expect(
            result.pursuit.nodes.find((recorded) => recorded.id === node!.id)?.failure,
          ).toEqual(failure)
          const persisted = JSON.parse(await readFile(result.settlePath, 'utf8'))
          expect(
            persisted.tree.nodes.find((recorded: { id: string }) => recorded.id === node!.id)
              .failure,
          ).toEqual(failure)
          // Re-persist actual execution history in the supported pre-field format. A reason alone
          // remains unknown; no native diagnosis is reconstructed by reading its prose.
          const legacy = new FileSpawnJournal(join(fixture.directory, 'legacy.jsonl'))
          await legacy.beginTree(runId, new Date().toISOString())
          for (const event of events) {
            if (event.kind === 'settled' || event.kind === 'cancelled') {
              const { failure: _failure, infra: _infra, ...old } = event
              await legacy.appendEvent(runId, old)
            } else await legacy.appendEvent(runId, event)
          }
          const old = await replaySpawnTree(
            legacy,
            new FileResultBlobStore(join(runDir, 'blobs')),
            runId,
          )
          expect(old.find((settled) => settled.handle.id === node!.id)).toMatchObject({
            failure: { code: 'unknown', owner: 'unknown' },
          })
        } finally {
          await fixture.close()
        }
      },
      60000,
    )

    it('reads the same typed native refusal through protected HTTP tree and observe', async () => {
      const fixture = await paired('auth')
      const runId = 'native-http-reader'
      const journal = new FileSpawnJournal(join(fixture.directory, 'http-spawn.jsonl'))
      const blobs = new FileResultBlobStore(join(fixture.directory, 'http-blobs'))
      let checked = false
      let exercise: Promise<void> | undefined
      const root: Agent<unknown, unknown> = {
        name: 'native-reader-owner',
        async act(_task, scope) {
          const makeWorkerAgent = workerFromBackend(fixture.backend)
          const mcp = await serveCoordinationMcp({
            scope,
            blobs,
            makeWorkerAgent,
            perWorker: { maxIterations: 1, maxTokens: 1000 },
            toolNames: ['spawn_worker'],
            authentication: true,
            identity: { runId, actorId: scope.view.root },
          })
          try {
            exercise = (async () => {
              const spawned = scope.spawn(makeWorkerAgent(profile), 'Return the protocol result.', {
                label: 'native-worker',
                budget: { maxIterations: 1, maxTokens: 1000 },
              })
              if (!spawned.ok) throw new Error(`native spawn refused: ${spawned.reason}`)
              const settled = await scope.next()
              expect(settled).toMatchObject({
                kind: 'down',
                failure: { providerCode: 'SEAT_NOT_LOGGED_IN' },
              })
              if (settled?.kind !== 'down')
                throw new Error('native auth refusal did not settle down')
              const reader = await connectRemoteSupervisor({
                url: mcp.readOnly.url,
                protectedHeaders: mcp.readOnly.headers,
              })
              try {
                expect(
                  (await reader.tree()).nodes.find((node) => node.id === spawned.handle.id)
                    ?.failure,
                ).toEqual(settled.failure)
                expect((await reader.observe(spawned.handle.id)).agent.failure).toEqual(
                  settled.failure,
                )
                const denied = await fetch(mcp.control.url, {
                  method: 'POST',
                  headers: { ...mcp.readOnly.headers, 'content-type': 'application/json' },
                  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
                })
                expect(denied.status).toBe(401)
                checked = true
              } finally {
                await reader.close()
              }
            })()
            await exercise
            return { checked }
          } finally {
            await mcp.close()
          }
        },
      }
      try {
        const result = await createSupervisor().run(
          root,
          {},
          { budget, runId, journal, blobs, executors: createExecutorRegistry() },
        )
        await exercise
        expect(checked, JSON.stringify(result)).toBe(true)
      } finally {
        await fixture.close()
      }
    }, 60000)

    it('keeps caller cancellation typed and confirms the native process is gone', async () => {
      const fixture = await paired('abort')
      const abort = new AbortController()
      let running: ReturnType<typeof superviseGraphPursuit> | undefined
      try {
        running = superviseGraphPursuit(graph, {
          backend: fixture.backend,
          runDir: join(fixture.directory, 'cancelled'),
          runId: 'native-cancelled',
          pursuitId: 'native-cancelled',
          signal: abort.signal,
          perWorker: { maxIterations: 1, maxTokens: 1000 },
          driverRetry: { enabled: false },
        })
        const pid = await waitForPid(fixture.directory)
        process.kill(pid, 0)
        abort.abort(new Error('integration caller cancellation'))
        const result = await running
        expect(
          result.result.result.tree.nodes.find((node) => node.label === 'native-worker')?.failure,
        ).toMatchObject({ code: 'aborted', owner: 'caller' })
        try {
          process.kill(pid, 0)
          throw new Error('cancelled native process is still alive')
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe('ESRCH')
        }
      } finally {
        abort.abort(new Error('integration cleanup'))
        await running?.catch(() => undefined)
        await fixture.close()
      }
    }, 60000)

    it('does not promote a worker-authored failure field into Runtime authority', async () => {
      const fixture = await paired('success')
      try {
        const result = await superviseGraphPursuit(graph, {
          backend: fixture.backend,
          runDir: join(fixture.directory, 'success'),
          runId: 'native-success',
          pursuitId: 'native-success',
          perWorker: { maxIterations: 1, maxTokens: 1000 },
          driverRetry: { enabled: false },
        })
        expect(result.result.result.kind).toBe('winner')
        expect(result.pursuit.runs.every((run) => run.failure === undefined)).toBe(true)
        expect(
          result.result.result.tree.nodes.find((node) => node.label === 'native-worker')?.failure,
        ).toBeUndefined()
      } finally {
        await fixture.close()
      }
    }, 60000)
  },
)

describe.skipIf(!bridgeEntry)(
  'Runtime subscription guard through a genuine native status process',
  () => {
    it.each(['not_authenticated', 'api_key_selected', 'subscription_unverified'] as const)(
      'preserves %s root refusal through HTTP/SSE, settle record and cold observer replay',
      async (cause) => {
        const fixture = await subscriptionPair(cause)
        const runId = `subscription-root-${cause}`
        try {
          const wire = await fixture.refusal()
          const result = await superviseGraphPursuit(rootedSubscriptionGraph, {
            backend: fixture.backend,
            driverBackend: fixture.backend,
            runDir: join(fixture.directory, 'runtime'),
            runId,
            pursuitId: runId,
            perWorker: { maxIterations: 1, maxTokens: 1000 },
            driverRetry: { enabled: false },
          })
          const terminal = result.result.result
          expect(terminal, JSON.stringify(terminal)).toMatchObject({
            kind: 'no-winner',
            reason: 'driver-failed',
          })
          if (terminal.kind !== 'no-winner' || terminal.reason !== 'driver-failed')
            throw new Error(
              `native root admission selected a different lifecycle outcome: ${JSON.stringify(terminal)}`,
            )
          const failure = terminal.error.failure
          expect(failure).toMatchObject({
            code: 'credential-refused',
            owner: 'caller',
            providerCode: 'subscription_required',
            remediation: wireRemediation(wire),
          })
          expect(failure).not.toHaveProperty('fixCommand')
          expect(terminal.tree.nodes.filter((node) => node.id !== terminal.tree.root)).toEqual([])
          expect(terminal.spentTotal).toMatchObject({ tokens: { input: 0, output: 0 }, usd: 0 })
          expect(terminal.spentTotal.tokensKnown).not.toBe(false)
          expect(terminal.spentTotal.usdKnown).not.toBe(false)
          const run = result.pursuit.runs.find((recorded) => recorded.runId === runId)
          expect(run).toMatchObject({ status: 'done', error: terminal.error.message, failure })
          const persisted = JSON.parse(await readFile(result.settlePath, 'utf8'))
          expect(persisted).toEqual(JSON.parse(JSON.stringify(terminal)))
          expect(persisted.error.failure).toEqual(failure)
          const cold = projectPursuit(
            await new FileObserverJournal(result.observerPath, runId).read(),
          )
          expect(cold.runs).toEqual(result.pursuit.runs)
          expect(cold.runs.find((recorded) => recorded.runId === runId)?.failure).toEqual(failure)
          await fixture.assertNoDispatch()
        } finally {
          await fixture.close()
        }
      },
      60000,
    )

    it('keeps the producer remedy on a settled child and protected HTTP tree/observe readers', async () => {
      const fixture = await subscriptionPair('api_key_selected')
      const runId = 'subscription-http-reader'
      const journal = new FileSpawnJournal(join(fixture.directory, 'http-spawn.jsonl'))
      const blobs = new FileResultBlobStore(join(fixture.directory, 'http-blobs'))
      let checked = false
      let exercise: Promise<void> | undefined
      try {
        const wire = await fixture.refusal()
        const root: Agent<unknown, unknown> = {
          name: 'subscription-reader-owner',
          async act(_task, scope) {
            const makeWorkerAgent = workerFromBackend(fixture.backend)
            const mcp = await serveCoordinationMcp({
              scope,
              blobs,
              makeWorkerAgent,
              perWorker: { maxIterations: 1, maxTokens: 1000 },
              toolNames: ['spawn_worker'],
              authentication: true,
              identity: { runId, actorId: scope.view.root },
            })
            try {
              exercise = (async () => {
                const spawned = scope.spawn(
                  makeWorkerAgent(subscriptionProfile),
                  'Admission must refuse before inference.',
                  {
                    label: 'native-worker',
                    budget: { maxIterations: 1, maxTokens: 1000 },
                  },
                )
                if (!spawned.ok) throw new Error(`native spawn refused: ${spawned.reason}`)
                const settled = await scope.next()
                expect(settled).toMatchObject({
                  kind: 'down',
                  failure: {
                    code: 'credential-refused',
                    providerCode: 'subscription_required',
                    remediation: wireRemediation(wire),
                  },
                })
                if (settled?.kind !== 'down')
                  throw new Error('native guard refusal did not settle down')
                const reader = await connectRemoteSupervisor({
                  url: mcp.readOnly.url,
                  protectedHeaders: mcp.readOnly.headers,
                })
                try {
                  expect(
                    (await reader.tree()).nodes.find((node) => node.id === spawned.handle.id)
                      ?.failure,
                  ).toEqual(settled.failure)
                  expect((await reader.observe(spawned.handle.id)).agent.failure).toEqual(
                    settled.failure,
                  )
                  checked = true
                } finally {
                  await reader.close()
                }
              })()
              await exercise
              return { checked }
            } finally {
              await mcp.close()
            }
          },
        }
        const result = await createSupervisor().run(
          root,
          {},
          {
            budget,
            runId,
            journal,
            blobs,
            executors: createExecutorRegistry(),
          },
        )
        await exercise
        expect(checked, JSON.stringify(result)).toBe(true)
        await fixture.assertNoDispatch()
      } finally {
        await fixture.close()
      }
    }, 60000)
  },
)
