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
import type { ProviderLeafOut } from '../src/runtime/environment-provider/provider-executor-admission'
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

describe('native executable workspace archives', () => {
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
      let exported: AgentCandidateWorkspaceSnapshotEvidence | undefined
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
              const captured = await captureAgentCandidateWorkspace(workspace, {
                limits: { maxEmbeddedArtifactBytes: 64 },
                artifactPersistence: {
                  executionId: `native-export:${id}`,
                  outputArtifacts: artifacts,
                },
              })
              exported = captured.snapshot
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
      })({ profile, harness: null }, { signal, seams: {} })

      for await (const _event of executor.execute(task, signal) as AsyncIterable<UsageEvent>) {
        // Drain the native provider lifecycle through its archive export and cleanup.
      }
      const result = executor.resultArtifact().out as ProviderLeafOut
      expect(result).not.toHaveProperty('workspaceCapture')
      expect(result).not.toHaveProperty('workspaceSnapshot')
      expect(exported).toBeDefined()
      if (!exported) throw new Error('the native provider omitted its archive export')
      expect([...workspaces.values()].every((workspace) => !existsSync(workspace))).toBe(true)

      // A later caller has only the serialized receipt and the artifact service.
      const receiptPath = join(root, `receipt-${nextEnvironment}.json`)
      await writeFile(receiptPath, JSON.stringify(exported))
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
})
