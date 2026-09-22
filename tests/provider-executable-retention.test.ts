import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type AgentCandidateOutputArtifactPort,
  captureAgentCandidateWorkspace,
  createAgentCandidateWorkspacePort,
} from '../src/candidate-execution'
import { sha256Bytes } from '../src/candidate-execution/digest'
import type { ProviderLeafOut } from '../src/runtime/environment-provider'
import { createExecutor } from '../src/runtime/supervise/runtime'
import type { UsageEvent } from '../src/runtime/supervise/types'
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
          throw new Error('portable archive unavailable')
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
    }).rejects.toThrow('portable archive unavailable')
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

  it('refuses a steering path that cannot enforce the capture barrier before creating a worker', async () => {
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
    expect(() =>
      createExecutor({
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
      })(
        { profile: testAgentProfile('unsupported-steering-worker'), harness: null },
        { signal, seams: {} },
      ),
    ).toThrow(/workspaceRetention.*steering|steering.*workspaceRetention/)
    expect(creates).toBe(0)
  })
})
