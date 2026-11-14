import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  type AgentExactRunControlRef,
  type AgentRetainedFileOutputRequest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { expect, it } from 'vitest'
import { createFileRunContext, createSupervisor } from '../../src/runtime'
import { providerAsExecutor } from '../../src/runtime/environment-provider/provider-executor-admission'
import { RetainedExecutionPendingError } from '../../src/runtime/supervise/retained-executor'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

const execute = promisify(execFile)

// A real native process writes the declared file; the original submission is accepted, then the
// native stream is lost before the result commits, and the first transcript write fails.
it('keeps an accepted file turn pending when its transcript write fails once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'provider-file-output-transcript-'))
  try {
    const workspace = join(directory, 'workspace')
    await mkdir(workspace)
    const worker = join(directory, 'worker.cjs')
    await writeFile(
      worker,
      `require('node:fs').writeFileSync(process.argv[2], 'retained report\\n')`,
    )
    const policy = { name: 'report', path: 'report.txt' }
    const base = durableRetainedProvider(join(directory, 'unused.json'))
    let controlRef: AgentExactRunControlRef | undefined
    let destroyed = 0
    let executor: ReturnType<ReturnType<typeof providerAsExecutor>> | undefined
    const provider: AgentEnvironmentProvider = {
      name: 'native-file',
      async capabilities() {
        const capabilities = await base.capabilities()
        return {
          ...capabilities,
          workspace: { ...capabilities.workspace, retainFileOutput: true },
        }
      },
      async create() {
        return environment
      },
      async get(id) {
        return id === environment.id ? environment : null
      },
    }
    const environment: AgentEnvironment = {
      id: 'native-file-environment',
      provider: provider.name,
      status: async () => 'running',
      async *stream() {
        yield* []
        throw new Error('retained dispatch must own execution')
      },
      async dispatch(input) {
        if (!input.sessionId || !input.executionId || !input.turnId)
          throw new Error('Runtime omitted retained coordinates')
        controlRef = {
          provider: provider.name,
          environmentId: environment.id,
          sessionId: input.sessionId,
          executionId: input.executionId,
          runId: input.turnId,
          requestDigest: canonicalCandidateDigest({ prompt: input.prompt, turnId: input.turnId }),
        }
        await execute(process.execPath, [worker, join(workspace, policy.path)])
        return { id: controlRef.sessionId, provider: provider.name, controlRef }
      },
      session(id) {
        if (!controlRef || id !== controlRef.sessionId) throw new Error('unknown native session')
        const ref = controlRef
        const result = async () => ({ text: '', success: false, sessionId: id, metadata: { ...ref } })
        return {
          id,
          controlRef: ref,
          status: async () => 'running',
          async *events() {
            // The original submission is accepted while its native stream is still open.
            await executor!.withFileOutput!({ summary: 'report written' }, async (prepared, onAccepted) => {
              onAccepted()
              return prepared
            })
            yield* []
            throw new Error('native stream lost before the result committed')
          },
          result,
          prompt: result,
          async cancelRun() {
            throw new Error('a stopped publication needs no cancellation')
          },
          async cancel() {
            throw new Error('a stopped publication needs no cancellation')
          },
        }
      },
      async retainFileOutput(request: AgentRetainedFileOutputRequest) {
        const bytes = await readFile(join(workspace, request.policy.path))
        return {
          status: 'published',
          publication: {
            controlRef: request.controlRef,
            policy: request.policy,
            source: {
              environmentId: environment.id,
              createdAt: new Date(0).toISOString(),
              filesystemIncarnationId: 'workspace-1',
              workspaceSnapshot: 'snapshot-1',
            },
            file: {
              path: request.policy.path,
              kind: 'regular',
              sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
              byteLength: bytes.byteLength,
            },
            providerReference: { snapshot: 'snapshot-1' },
            preserved: true,
          },
        }
      },
      async read(path) {
        return readFile(path, 'utf8')
      },
      async exec() {
        return { stdout: '', stderr: '', exitCode: 0 }
      },
      async destroy() {
        destroyed += 1
      },
    }
    const context = createFileRunContext(join(directory, 'run'))
    const put = context.blobs.put.bind(context.blobs)
    let transcriptWrites = 0
    context.blobs.put = async (ref, value) => {
      if ((value as { kind?: unknown })?.kind === 'harness-transcript' && ++transcriptWrites === 1)
        throw new Error('transcript store unavailable once')
      return put(ref, value)
    }
    const createExecutor = providerAsExecutor(provider, {})
    let turn: Promise<unknown> | undefined
    const runId = 'native-file-output'
    await createSupervisor().run(
      {
        name: 'root',
        async act(_task, scope) {
          const spawn = scope.spawn(
            {
              name: 'native-file',
              async act() {
                throw new Error('the provider owns execution')
              },
              executorSpec: {
                profile: testAgentProfile('native-file', { outputFile: policy }),
                harness: null,
                executorFactory: (spec, ctx) => {
                  const created = createExecutor(spec, ctx)
                  executor = created
                  return {
                    ...created,
                    execute: (task, signal) => {
                      turn = created.execute(task, signal)
                      return turn as ReturnType<typeof created.execute>
                    },
                  }
                },
              },
            },
            'write the report',
            { budget: { maxIterations: 1, maxTokens: 100 } },
          )
          expect(spawn.ok).toBe(true)
          await expect.poll(() => turn, { timeout: 30_000 }).toBeDefined()
          await turn!.catch(() => undefined)
          return 'observed'
        },
      },
      null,
      {
        ...context,
        runId,
        rootIdentity: {
          profileDigest: canonicalCandidateDigest({ name: 'root' }),
          taskDigest: canonicalCandidateDigest(null),
        },
        workerSlots: 1,
        retainedAtSettlement: 'keep',
        budget: { maxIterations: 2, maxTokens: 200 },
      },
    )
    // The committed turn reports pending, as a persistence throw from settle() does.
    const failure = await turn!.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(RetainedExecutionPendingError)
    // The source is kept, and the retried write recorded the transcript evidence.
    expect(destroyed).toBe(0)
    expect(transcriptWrites).toBe(2)
    const journal = (await context.journal.loadTree(runId))!
    const evidence = await Promise.all(
      journal
        .filter((event) => event.kind === 'execution-evidence')
        .map((event) => context.blobs.get(event.outRef)),
    )
    expect(evidence).toContainEqual(expect.objectContaining({ kind: 'harness-transcript' }))
    expect(evidence).toContainEqual(expect.objectContaining({ kind: 'retained-file-output' }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
