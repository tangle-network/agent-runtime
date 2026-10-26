import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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
  replaySpawnTree,
  serveCoordinationMcp,
  workerFromBackend,
} from '../../src/runtime/index'

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
        expect(
          result.result.result.tree.nodes.find((node) => node.label === 'native-worker')?.failure,
        ).toBeUndefined()
      } finally {
        await fixture.close()
      }
    }, 60000)
  },
)
