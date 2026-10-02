import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AgentCandidateOutputArtifactPort,
  captureAgentCandidateWorkspace,
  createAgentCandidateWorkspacePort,
} from '../src/candidate-execution'
import { sha256Bytes } from '../src/candidate-execution/digest'
import { contentAddress, replaySpawnTree } from '../src/durable/spawn-journal'
import { RuntimeRunStateError } from '../src/errors'
import type { ProviderLeafOut } from '../src/runtime/environment-provider'
import {
  executorEvidenceWriter,
  retainedExecutorSeamKey,
} from '../src/runtime/supervise/retained-executor'
import {
  prepareScopeRetainedOwnerTask,
  scopeRetainedOwnerContext,
} from '../src/runtime/supervise/retained-scope-owner'
import { createFileRunContext } from '../src/runtime/supervise/run-context'
import { createExecutor } from '../src/runtime/supervise/runtime'
import { createSupervisor } from '../src/runtime/supervise/supervisor'
import type { SpawnEvent, UsageEvent } from '../src/runtime/supervise/types'
import { durableRetainedProvider } from './helpers/durable-retained-provider'
import { testAgentProfile } from './kernel/test-agent-profile'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'provider-executable-retention-'))
  roots.push(root)
  return root
}

function helper(increment: number): string {
  return [
    "import { readFileSync } from 'node:fs'",
    "const input = JSON.parse(readFileSync(new URL('./input.json', import.meta.url), 'utf8'))",
    `process.stdout.write(String(input.value + ${increment}))`,
    '',
  ].join('\n')
}

/** Local storage stands in for the artifact service; workspace and helper execution are real. */
function artifactStore(directory: string): AgentCandidateOutputArtifactPort {
  return {
    async put({ bytes, signal }) {
      signal?.throwIfAborted()
      const sha256 = sha256Bytes(bytes)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, sha256.slice(7)), bytes)
      signal?.throwIfAborted()
      return {
        locator: { kind: 's3', bucket: 'retention-test-artifacts', key: sha256.slice(7) },
        sha256,
        byteLength: bytes.byteLength,
      }
    },
    async read(ref) {
      return readFile(join(directory, ref.sha256.slice(7)))
    },
  }
}

describe('provider executable workspace retention', () => {
  it.each(
    (
      [
        { location: 'worker', steering: false, ending: 'failed', storageFailure: undefined },
        { location: 'worker', steering: true, ending: 'failed', storageFailure: undefined },
        { location: 'worker', steering: false, ending: 'cancelled', storageFailure: undefined },
        { location: 'root', steering: false, ending: 'failed', storageFailure: undefined },
        ...(['root', 'worker'] as const).flatMap((location) =>
          [false, true].map((steering) => ({
            location,
            steering,
            ending: 'completed' as const,
            storageFailure: undefined,
          })),
        ),
        ...(['blob', 'journal'] as const).flatMap((storageFailure) =>
          [false, true].map((steering) => ({
            location: 'root' as const,
            steering,
            ending: 'failed' as const,
            storageFailure,
          })),
        ),
        ...(['blob', 'journal'] as const).flatMap((storageFailure) =>
          [false, true].flatMap((steering) =>
            (['completed', 'failed'] as const).map((ending) => ({
              location: 'worker' as const,
              steering,
              ending,
              storageFailure,
            })),
          ),
        ),
        ...[false, true].map((steering) => ({
          location: 'worker' as const,
          steering,
          ending: 'completed' as const,
          storageFailure: undefined,
          strictPartial: true,
        })),
      ] as const
    ).map((config) => ({ strictPartial: false, ...config })),
  )(
    'retains $location evidence after $ending with steering=$steering, storageFailure=$storageFailure and strictPartial=$strictPartial',
    async ({ location, steering, ending, storageFailure, strictPartial }) => {
      const root = await temporaryRoot()
      const runDir = join(root, 'run')
      const workspace = join(root, 'workspace')
      const artifacts = artifactStore(join(root, 'artifacts'))
      const run = createFileRunContext(runDir)
      if (storageFailure === 'blob') {
        const put = run.blobs.put.bind(run.blobs)
        vi.spyOn(run.blobs, 'put').mockImplementation(async (outRef, out) => {
          if (
            out !== null &&
            typeof out === 'object' &&
            ('workspaceCapture' in out || 'workspaceCaptures' in out)
          ) {
            throw new Error('capture blob publication rejected')
          }
          await put(outRef, out)
        })
      } else if (storageFailure === 'journal') {
        const append = run.journal.appendEvent.bind(run.journal)
        vi.spyOn(run.journal, 'appendEvent').mockImplementation(async (rootId, event) => {
          if (event.kind === 'execution-evidence') {
            throw new Error('capture journal publication rejected')
          }
          await append(rootId, event)
        })
      }
      let destroyed = 0
      const profile = testAgentProfile('failed-capture-record')
      const task = 'retain failed execution'
      const runId = 'failed-capture-record'
      let started!: () => void
      const admitted = new Promise<void>((resolve) => {
        started = resolve
      })
      let captured!: () => void
      const captureDone = new Promise<void>((resolve) => {
        captured = resolve
      })
      const provider: AgentEnvironmentProvider = {
        name: 'failed-capture-record',
        async capabilities() {
          return { streaming: { live: true }, sessions: { continue: true } }
        },
        async create(options) {
          await mkdir(workspace)
          const raw = { type: 'text', data: { text: 'partial work', metadata: [null, 0, false] } }
          await writeFile(join(workspace, 'native-trace.json'), JSON.stringify(raw))
          return {
            id: 'failed-environment',
            provider: provider.name,
            status: async () => 'running',
            async *stream() {
              yield raw
              started()
              if (ending === 'cancelled') {
                await new Promise<void>((_, reject) => {
                  if (options.signal?.aborted) reject(options.signal.reason)
                  options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
                    once: true,
                  })
                })
              }
              if (ending === 'completed') yield { type: 'done', data: { finalText: 'finished' } }
              else throw new Error('execution failed after partial work')
            },
            session(id) {
              return {
                id,
                status: async () => 'completed',
                async *events() {},
                result: async () => ({ text: '', success: false, sessionId: id }),
                prompt: async () => ({ text: '', success: false, sessionId: id }),
              }
            },
            async destroy() {
              const events = (await run.journal.loadTree(runId)) ?? []
              const citation = events.find((event) => event.kind === 'execution-evidence')
              if (citation?.kind !== 'execution-evidence') {
                throw new Error('source deletion preceded durable capture citation')
              }
              const output = await run.blobs.get(citation.outRef)
              expect(citation.outRef).toBe(contentAddress(output))
              const receipt =
                (output as ProviderLeafOut).workspaceCapture ??
                (output as { workspaceCaptures?: unknown[] }).workspaceCaptures?.[0]
              expect(receipt).toMatchObject({ environmentId: 'failed-environment' })
              destroyed++
              await rm(workspace, { recursive: true })
            },
          }
        },
      }
      const executorFactory = createExecutor({
        backend: 'provider',
        provider,
        ...(steering ? { steering: { maxTurns: 1 } } : {}),
        workspaceRetention: {
          timeoutMs: 5_000,
          requireCompleteProvenance: strictPartial,
          artifacts,
          async capture({ executionId, signal }) {
            const { snapshot } = await captureAgentCandidateWorkspace(workspace, {
              artifactPersistence: { executionId, outputArtifacts: artifacts, signal },
            })
            captured()
            return {
              snapshot,
              provenance: {
                status: 'reported',
                executionId,
                environmentId: 'failed-environment',
                missing: ['offline fixture does not supply native coverage'],
                fixtureMetadata: [null, 0, false],
              },
            }
          },
        },
      })
      const supervisor = createSupervisor()
      let rootExecutor: ReturnType<typeof executorFactory> | undefined
      let rootExecutionDone: Promise<void> | undefined
      let rootExecutionFailure: unknown
      let workerMessage: unknown
      const supervision = supervisor.run(
        {
          name: 'failed-capture-root',
          async act(ownerTask, scope) {
            if (location === 'root') {
              await prepareScopeRetainedOwnerTask(scope, ownerTask)
              const context = scopeRetainedOwnerContext(scope)
              if (!context) throw new Error('missing root writer')
              const executor = executorFactory(
                { profile, harness: null },
                {
                  signal: scope.signal,
                  seams: { [retainedExecutorSeamKey]: context },
                },
              )
              rootExecutor = executor
              const consume = async () => {
                for await (const _event of executor.execute(task, scope.signal)) {
                }
              }
              rootExecutionDone = consume().catch((error: unknown) => {
                rootExecutionFailure = error
              })
              await rootExecutionDone
            } else {
              const worker = {
                name: 'failed-capture-worker',
                act: async () => 'unused',
                executorSpec: { profile, harness: null, executorFactory },
              }
              const spawned = await scope.spawn(worker, task, {
                label: 'failed capture',
                budget: { maxIterations: 2, maxTokens: 100 },
              })
              if (!spawned.ok) throw new Error('worker admission failed')
              if (ending === 'cancelled') {
                await admitted
                await scope.cancel(spawned.handle.id, { operationId: 'cancel-with-evidence' })
              }
              workerMessage = await scope.next()
            }
            return 'fixture complete'
          },
        },
        task,
        {
          ...run,
          runId,
          teardownConfirmMs: 20,
          rootIdentity: {
            profileDigest: contentAddress(profile),
            taskDigest: contentAddress(task),
          },
          budget: { maxIterations: 20, maxTokens: 1_000 },
        },
      )
      const persistenceMessage = `supervisor: durable state unavailable; restore storage and resume the same run (capture ${storageFailure} publication rejected)`
      if (storageFailure === undefined) await supervision
      else {
        await expect(supervision).rejects.toBeInstanceOf(RuntimeRunStateError)
        await expect(supervision).rejects.toMatchObject({
          message: persistenceMessage,
          cause: { message: `capture ${storageFailure} publication rejected` },
        })
      }
      await rootExecutionDone
      await captureDone
      // Assert outside act(): its rejection is a run outcome, so an assertion inside it can
      // be hidden by the supervisor's stronger persistence interruption.
      if (location === 'worker' && storageFailure === undefined) {
        expect(workerMessage).toMatchObject({
          kind: ending === 'completed' && !strictPartial ? 'done' : 'down',
          ...(strictPartial
            ? {
                reason: steering
                  ? 'Sandbox evidence capture failed before teardown'
                  : expect.stringContaining('coverage incomplete'),
              }
            : {}),
        })
      }
      if (location === 'root') {
        if (ending === 'completed') expect(rootExecutionFailure).toBeUndefined()
        else {
          expect(rootExecutionFailure).toBeInstanceOf(Error)
          if (!(rootExecutionFailure instanceof Error)) throw new Error('missing execution failure')
          if (storageFailure === undefined || steering) {
            expect(rootExecutionFailure.message).toBe('execution failed after partial work')
          } else {
            expect(rootExecutionFailure).toBeInstanceOf(AggregateError)
            expect(rootExecutionFailure.message).toBe(persistenceMessage)
          }
          if (storageFailure !== undefined) {
            if (steering) {
              expect(rootExecutionFailure.cause).toBeInstanceOf(AggregateError)
              expect((rootExecutionFailure.cause as AggregateError).errors).toContainEqual(
                expect.objectContaining({
                  message: persistenceMessage,
                  cause: expect.objectContaining({
                    message: `capture ${storageFailure} publication rejected`,
                  }),
                }),
              )
              await expect(rootExecutor!.teardown('brutalKill')).rejects.toThrow(
                'Sandbox evidence capture failed before teardown',
              )
            } else {
              expect(rootExecutionFailure.cause).toBeInstanceOf(RuntimeRunStateError)
              expect(rootExecutionFailure.cause).toMatchObject({
                message: persistenceMessage,
                cause: { message: `capture ${storageFailure} publication rejected` },
              })
              expect((rootExecutionFailure as AggregateError).errors).toEqual([
                rootExecutionFailure.cause,
                expect.objectContaining({ message: 'execution failed after partial work' }),
              ])
              expect(await rootExecutor!.teardown('brutalKill')).toMatchObject({
                destroyed: false,
              })
            }
          }
        }
      }
      if (storageFailure !== undefined) {
        const events = (await run.journal.loadTree(runId)) ?? []
        expect(events.filter((event) => event.kind === 'execution-evidence')).toEqual([])
        expect(events.filter((event) => event.kind === 'execution-result')).toEqual([])
        expect(
          events.filter((event) => event.kind === 'settled' || event.kind === 'cancelled'),
        ).toEqual([])
        if (location === 'worker') {
          expect(events).toContainEqual(expect.objectContaining({ kind: 'spawned', parent: runId }))
        }
        expect(existsSync(workspace)).toBe(true)
        expect(JSON.parse(await readFile(join(workspace, 'native-trace.json'), 'utf8'))).toEqual({
          type: 'text',
          data: { text: 'partial work', metadata: [null, 0, false] },
        })
        expect(destroyed).toBe(0)
        return
      }
      const evidenceEvent = await vi.waitFor(() => {
        // Cancellation can settle before the bounded capture finishes.
        return readFile(join(runDir, 'spawn-journal.jsonl'), 'utf8').then((text) => {
          const events = text
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line).event)
          const event = events.find(
            (event: SpawnEvent | undefined) => event?.kind === 'execution-evidence',
          )
          expect(event).toBeDefined()
          return event
        })
      })
      expect(evidenceEvent.kind).toBe('execution-evidence')
      const output = JSON.parse(
        await readFile(
          join(runDir, 'blobs', `sha256-${evidenceEvent.outRef.slice(7)}.json`),
          'utf8',
        ),
      )
      const receipt = output.workspaceCapture ?? output.workspaceCaptures?.[0]
      expect(receipt).toMatchObject({
        environmentId: 'failed-environment',
        coverageComplete: false,
        provenance: { fixtureMetadata: [null, 0, false] },
      })
      expect(receipt.snapshot.archive).toHaveProperty('locator')
      expect(evidenceEvent.outRef).toBe(contentAddress(output))
      const events = (await run.journal.loadTree(runId)) ?? []
      expect(events.filter((event) => event.kind === 'execution-result')).toEqual([])
      if (strictPartial) {
        expect(events.filter((event) => event.kind === 'execution-evidence')).toHaveLength(1)
        expect(destroyed).toBe(0)
        expect(existsSync(workspace)).toBe(true)
        if (steering) expect(output.workspaceCaptures).toHaveLength(1)
      }
      await expect(
        run.journal.appendEvent(runId, {
          kind: 'execution-evidence',
          id: 'never-spawned',
          outRef: evidenceEvent.outRef,
          seq: 0,
          at: new Date().toISOString(),
        }),
      ).rejects.toThrow(/no spawned node or valid content reference/)
      await expect(
        run.journal.appendEvent(runId, {
          kind: 'execution-evidence',
          id: evidenceEvent.id,
          outRef: 'unverifiable-reference',
          seq: 0,
          at: new Date().toISOString(),
        }),
      ).rejects.toThrow(/no spawned node or valid content reference/)
      expect(await run.journal.loadTree(runId)).toEqual(events)
      if (location === 'worker') {
        const worker = events.find((event) => event.kind === 'spawned' && event.parent === runId)
        const terminal = events.find(
          (event) =>
            (event.kind === 'cancelled' || event.kind === 'settled') && event.id === worker?.id,
        )
        expect(terminal).toBeDefined()
        if (ending !== 'completed' || strictPartial)
          expect(terminal).not.toHaveProperty('status', 'done')
        else {
          expect(terminal).toHaveProperty('status', 'done')
          expect(terminal).toHaveProperty('outRef', evidenceEvent.outRef)
          expect(destroyed).toBe(strictPartial ? 0 : 1)
          expect(existsSync(workspace)).toBe(strictPartial)
        }
        const lateWriter = executorEvidenceWriter({
          rootId: runId,
          nodeId: evidenceEvent.id,
          journal: run.journal,
          blobs: run.blobs,
          nextSequence: () => 0,
          now: Date.now,
        })
        await lateWriter(output)
        expect((await run.journal.loadTree(runId))?.at(-1)).toMatchObject({
          kind: 'execution-evidence',
          id: evidenceEvent.id,
          outRef: contentAddress(output),
        })
        expect(await replaySpawnTree(run.journal, run.blobs, runId)).toMatchObject([
          { kind: ending === 'completed' && !strictPartial ? 'done' : 'down' },
        ])
      }
    },
  )
  it('executes retained helper bytes after deleting the source and restores the original revision', async () => {
    const root = await temporaryRoot()
    const artifacts = artifactStore(join(root, 'artifacts'))
    const workspacePort = createAgentCandidateWorkspacePort()
    const profile = testAgentProfile('portable-worker')
    const workspaces = new Map<string, string>()
    const executions: string[] = []
    let nextEnvironment = 0

    async function run(
      task: string,
      restoredSnapshot?: AgentCandidateWorkspaceSnapshotEvidence,
    ): Promise<{ output: string; snapshot: AgentCandidateWorkspaceSnapshotEvidence }> {
      const provider: AgentEnvironmentProvider = {
        name: 'portable-workspace-fixture',
        capabilities: durableRetainedProvider(join(root, 'unused-provider-state.json'))
          .capabilities,
        async create() {
          const id = `worker-${++nextEnvironment}`
          const workspace = join(root, id)
          workspaces.set(id, workspace)
          if (restoredSnapshot) {
            if (!('locator' in restoredSnapshot.archive)) {
              throw new Error('the retained archive must use durable artifact storage')
            }
            await workspacePort.materialize({
              role: 'candidate',
              snapshot: restoredSnapshot,
              archive: await artifacts.read(restoredSnapshot.archive),
              destination: workspace,
            })
          } else {
            await mkdir(workspace)
            await writeFile(join(workspace, 'helper.mjs'), helper(1))
            await writeFile(join(workspace, 'input.json'), JSON.stringify({ value: 1 }))
            await writeFile(join(workspace, 'raw-data.bin'), Buffer.alloc(100_000, 7))
          }
          return {
            id,
            provider: provider.name,
            status: async () => 'running',
            async *stream() {
              if (task === 'revise') await writeFile(join(workspace, 'helper.mjs'), helper(2))
              const output = execFileSync(process.execPath, [join(workspace, 'helper.mjs')], {
                encoding: 'utf8',
              })
              executions.push(output)
              yield { type: 'done', data: { finalText: output } }
            },
            async destroy() {
              await rm(workspace, { recursive: true })
            },
          }
        },
      }
      const signal = new AbortController().signal
      const executor = createExecutor({
        backend: 'provider',
        provider,
        workspaceRetention: {
          timeoutMs: 5_000,
          artifacts,
          async capture({ environment, executionId, signal: captureSignal }) {
            const workspace = workspaces.get(environment.id)
            if (!workspace) throw new Error('capture received an unknown environment')
            expect(existsSync(workspace)).toBe(true)
            const captured = await captureAgentCandidateWorkspace(workspace, {
              limits: { maxEmbeddedArtifactBytes: 64 },
              artifactPersistence: {
                executionId,
                outputArtifacts: artifacts,
                signal: captureSignal,
              },
            })
            return captured.snapshot
          },
        },
      })({ profile, harness: null }, { signal, seams: {} })

      for await (const _event of executor.execute(task, signal) as AsyncIterable<UsageEvent>) {
        // Drain the actual Runtime lifecycle, including capture and cleanup.
      }
      const result = executor.resultArtifact().out as ProviderLeafOut
      expect(result.workspaceSnapshot).toBeDefined()
      if (!result.workspaceSnapshot) throw new Error('the final artifact omitted its workspace')
      expect([...workspaces.values()].every((workspace) => !existsSync(workspace))).toBe(true)

      // A later caller has only the serialized receipt and the artifact service.
      const receiptPath = join(root, `receipt-${nextEnvironment}.json`)
      await writeFile(receiptPath, JSON.stringify(result.workspaceSnapshot))
      const snapshot: AgentCandidateWorkspaceSnapshotEvidence = JSON.parse(
        await readFile(receiptPath, 'utf8'),
      )
      expect('locator' in snapshot.manifest).toBe(true)
      expect('locator' in snapshot.archive).toBe(true)
      return { output: result.content, snapshot }
    }

    const baseline = await run('execute')
    const revised = await run('revise')
    expect(revised.snapshot.digest).not.toBe(baseline.snapshot.digest)
    const adopted = await run('execute', revised.snapshot)
    const restored = await run('execute', baseline.snapshot)

    expect([baseline.output, revised.output, adopted.output, restored.output]).toEqual([
      '2',
      '3',
      '3',
      '2',
    ])
    expect(adopted.snapshot.digest).toBe(revised.snapshot.digest)
    expect(restored.snapshot.digest).toBe(baseline.snapshot.digest)
    expect(executions).toEqual(['2', '3', '3', '2'])

    await writeFile(join(root, 'artifacts', revised.snapshot.archive.sha256.slice(7)), 'corrupt')
    await expect(run('execute', revised.snapshot)).rejects.toThrow(/byte length|digest/)
    expect(executions).toEqual(['2', '3', '3', '2'])
  })

  it('keeps the source alive when portable capture fails, including during teardown', async () => {
    const root = await temporaryRoot()
    const workspace = join(root, 'live-source')
    let destroyed = 0
    const captureFailure = new Error('portable archive unavailable')
    const provider: AgentEnvironmentProvider = {
      name: 'capture-failure-fixture',
      capabilities: durableRetainedProvider(join(root, 'unused-provider-state.json')).capabilities,
      async create() {
        await mkdir(workspace)
        await writeFile(join(workspace, 'helper.mjs'), helper(1))
        return {
          id: 'source-1',
          provider: provider.name,
          status: async () => 'running',
          async *stream() {
            yield { type: 'done', data: { finalText: 'finished' } }
          },
          async destroy() {
            destroyed++
            await rm(workspace, { recursive: true })
          },
        }
      },
    }
    const signal = new AbortController().signal
    const executor = createExecutor({
      backend: 'provider',
      provider,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts: artifactStore(join(root, 'artifacts')),
        async capture({ environment }) {
          expect(environment.id).toBe('source-1')
          expect(existsSync(workspace)).toBe(true)
          throw captureFailure
        },
      },
    })(
      { profile: testAgentProfile('capture-failure-worker'), harness: null },
      { signal, seams: {} },
    )

    await expect(async () => {
      for await (const _event of executor.execute('execute', signal)) {
        // Drain until the capture barrier settles or fails.
      }
    }).rejects.toBe(captureFailure)
    expect(captureFailure.cause).not.toBe(captureFailure)
    expect(captureFailure.cause).toMatchObject({
      message: expect.stringContaining('source preserved because execution failed'),
    })
    expect(existsSync(workspace)).toBe(true)
    expect(destroyed).toBe(0)
    expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
    expect(existsSync(workspace)).toBe(true)
    expect(destroyed).toBe(0)
  })

  it('keeps a failed worker alive when no result can carry its captured workspace receipt', async () => {
    const root = await temporaryRoot()
    const workspace = join(root, 'failed-source')
    const artifacts = artifactStore(join(root, 'artifacts'))
    let destroyed = 0
    let creates = 0
    const provider: AgentEnvironmentProvider = {
      name: 'failed-worker-fixture',
      capabilities: durableRetainedProvider(join(root, 'unused-provider-state.json')).capabilities,
      async create() {
        creates++
        await mkdir(workspace)
        await writeFile(join(workspace, 'helper.mjs'), helper(2))
        return {
          id: 'failed-worker-1',
          provider: provider.name,
          status: async () => 'running',
          async *stream() {
            yield* []
            throw new Error('worker execution failed')
          },
          async destroy() {
            destroyed++
            await rm(workspace, { recursive: true })
          },
        }
      },
    }
    const signal = new AbortController().signal
    const executor = createExecutor({
      backend: 'provider',
      provider,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture({ executionId, signal: captureSignal }) {
          const captured = await captureAgentCandidateWorkspace(workspace, {
            limits: { maxEmbeddedArtifactBytes: 64 },
            artifactPersistence: {
              executionId,
              outputArtifacts: artifacts,
              signal: captureSignal,
            },
          })
          return captured.snapshot
        },
      },
    })({ profile: testAgentProfile('failed-worker'), harness: null }, { signal, seams: {} })

    await expect(async () => {
      for await (const _event of executor.execute('execute', signal)) {
        // The stream fails before it produces a settled artifact.
      }
    }).rejects.toThrow('worker execution failed')
    expect(existsSync(workspace)).toBe(true)
    expect(destroyed).toBe(0)
    expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
    expect(existsSync(workspace)).toBe(true)
    await expect(async () => {
      for await (const _event of executor.execute('retry', signal)) {
        // A new attempt must not clear preservation for the unreceipted source.
      }
    }).rejects.toThrow('prior failed execution has no retrievable workspace receipt')
    expect(creates).toBe(1)
    expect(existsSync(workspace)).toBe(true)
  })

  it('configures the steering capture barrier before creating a worker', async () => {
    const root = await temporaryRoot()
    let creates = 0
    const provider: AgentEnvironmentProvider = {
      name: 'unsupported-steering-fixture',
      capabilities: durableRetainedProvider(join(root, 'unused-provider-state.json')).capabilities,
      async create() {
        creates++
        throw new Error('an unsupported path must never create a worker')
      },
    }
    const signal = new AbortController().signal
    const executorFactory = createExecutor({
      backend: 'provider',
      provider,
      steering: { maxTurns: 2 },
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts: artifactStore(join(root, 'artifacts')),
        async capture() {
          throw new Error('capture should not run')
        },
      },
    })
    const executor = executorFactory(
      { profile: testAgentProfile('supported-steering-worker'), harness: null },
      { signal, seams: {} },
    )
    expect(executor).toBeDefined()
    expect(creates).toBe(0)
  })
})
