import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  type AgentExactRunControlRef,
  type AgentRunCancellationRequest,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { expect, it } from 'vitest'
import { createFileRunContext, createSupervisor } from '../../src/runtime'
import { providerAsExecutor } from '../../src/runtime/environment-provider/provider-executor-admission'
import {
  type HarnessTranscriptEvidence,
  harnessTranscriptArtifact,
} from '../../src/runtime/harness-transcript'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

const execute = promisify(execFile)

// The portable provider runs a real native process and reads its durable files. No model,
// remote allocation, mocked filesystem, or scripted executor stands in for execution.
it.each([
  [0, false],
  [7, false],
  [0, true],
] as const)(
  'retains exact dispatch provenance after native exit %i (repair: %s)',
  async (exitCode, repairCapture) => {
    const directory = await mkdtemp(join(tmpdir(), 'provider-transcript-source-'))
    try {
      const home = join(directory, 'home')
      await mkdir(home)
      const worker = join(directory, 'worker.cjs')
      await writeFile(
        worker,
        `const fs = require('node:fs');
const path = require('node:path');
const ref = JSON.parse(process.argv[2]);
const code = Number(process.argv[3]);
const root = path.join(process.env.HOME, '.opencode/sessions');
fs.mkdirSync(root, {recursive:true});
fs.writeFileSync(path.join(root, 'native.json'), JSON.stringify({id:'native-proof', text:'stored native work'}));
const event = {id:'native-result', type:'result', data:{...ref, sequence:1, occurredAt:new Date().toISOString(), success:code===0, finalText:'native work', ...(code ? {error:'native exit '+code, errorCode:'NATIVE_EXIT'} : {})}};
fs.writeFileSync('events.json', JSON.stringify([event]));
process.exitCode = code;
`,
      )
      let controlRef: AgentExactRunControlRef | undefined
      let nativeExit: number | undefined
      let events: AgentEnvironmentEvent[] = []
      let repairing = false
      let dispatches = 0
      const provider: AgentEnvironmentProvider = {
        name: 'native-process',
        capabilities: durableRetainedProvider(join(directory, 'unused.json')).capabilities,
        async create() {
          return environment
        },
        async get(id) {
          return id === environment.id ? environment : null
        },
      }
      const environment: AgentEnvironment = {
        id: 'native-environment',
        provider: provider.name,
        status: async () => 'running',
        async *stream() {
          yield* []
          throw new Error('retained dispatch must own execution')
        },
        async dispatch(input) {
          dispatches += 1
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
          try {
            await execute(
              process.execPath,
              [worker, JSON.stringify(controlRef), String(exitCode)],
              {
                cwd: directory,
                env: { PATH: process.env.PATH, HOME: home },
              },
            )
            nativeExit = 0
          } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== exitCode)
              throw error
            nativeExit = exitCode
          }
          events = JSON.parse(await readFile(join(directory, 'events.json'), 'utf8'))
          return { id: controlRef.sessionId, provider: provider.name, controlRef }
        },
        session(id) {
          if (!controlRef || id !== controlRef.sessionId) throw new Error('unknown native session')
          const ref = controlRef
          const result = async () => ({
            text: String(events[0]?.data.finalText),
            success: nativeExit === 0,
            sessionId: id,
            metadata: { ...ref },
          })
          return {
            id,
            controlRef: ref,
            status: async () => 'completed',
            async *events() {
              yield* events
            },
            result,
            prompt: result,
            async cancelRun(request: AgentRunCancellationRequest) {
              expect(request.run).toEqual(ref)
              if (nativeExit === undefined) throw new Error('native process has not exited')
              return {
                operationId: request.operationId,
                requestDigest: request.requestDigest,
                run: ref,
                status: 'accepted',
                effect: 'not_live',
              }
            },
            async cancel() {
              throw new Error('completed native execution must not be cancelled')
            },
          }
        },
        async read(path) {
          if (repairCapture && !repairing) throw new Error('temporary transcript read failure')
          return readFile(path, 'utf8')
        },
        async exec(command) {
          const { stdout, stderr } = await execute('/bin/sh', ['-c', command], {
            cwd: directory,
            env: { PATH: process.env.PATH, HOME: home },
          })
          return { stdout, stderr, exitCode: 0 }
        },
        ...(repairCapture
          ? {
              async destroy() {
                const journal = (await context.journal.loadTree(runId))!
                const last = journal.filter((event) => event.kind === 'execution-evidence').at(-1)
                if (last?.kind !== 'execution-evidence') throw new Error('repair evidence missing')
                expect(await context.blobs.get(last.outRef)).toMatchObject({
                  harnessTranscript: { status: 'available' },
                })
                await rm(home, { recursive: true })
              },
            }
          : {}),
      }
      const profile = testAgentProfile('native-proof')
      const context = createFileRunContext(join(directory, 'run'))
      const runId = `native-source-${exitCode}`
      const createExecutor = providerAsExecutor(provider, {
        ...(repairCapture
          ? {
              validator: {
                async validate() {
                  throw new Error('validation transport failed')
                },
              },
            }
          : {}),
      })
      let executor: ReturnType<typeof createExecutor> | undefined
      await createSupervisor().run(
        {
          name: 'root',
          async act(_task, scope) {
            const spawn = scope.spawn(
              {
                name: 'native-proof',
                async act() {
                  throw new Error('the provider owns execution')
                },
                executorSpec: {
                  profile,
                  harness: null,
                  executorFactory: (spec, ctx) => {
                    executor = createExecutor(spec, ctx)
                    return executor
                  },
                },
              },
              'perform native work',
              { budget: { maxIterations: 1, maxTokens: 100 } },
            )
            expect(spawn.ok).toBe(true)
            await scope.next()
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
      const journal = (await context.journal.loadTree(runId))!
      expect(nativeExit, JSON.stringify(journal)).toBe(exitCode)
      const dispatch = journal.find(
        (event) => event.kind === 'execution-admitted' && event.admission.phase === 'dispatched',
      )
      if (dispatch?.kind !== 'execution-admitted' || dispatch.admission.phase !== 'dispatched')
        throw new Error(`native dispatch missing: ${JSON.stringify(journal)}`)
      expect(dispatch.admission.controlRef).toEqual(controlRef)
      const terminal = journal.find(
        (event) =>
          (event.kind === 'settled' || event.kind === 'reconciled') && event.id === `${runId}:s0`,
      )
      if (
        (terminal?.kind !== 'settled' && terminal?.kind !== 'reconciled') ||
        !terminal.harnessTranscript
      )
        throw new Error(`native settlement missing: ${JSON.stringify(journal)}`)
      let receipt = terminal.harnessTranscript
      if (repairCapture) {
        expect(receipt.status).toBe('unavailable')
        repairing = true
        await expect(executor!.releaseRetained!(new AbortController().signal)).resolves.toEqual([
          expect.objectContaining({ destroyed: true }),
        ])
        const repaired = (await context.journal.loadTree(runId))!
        const captures = (await Promise.all(
          repaired
            .filter((event) => event.kind === 'execution-evidence')
            .map((event) => context.blobs.get(event.outRef)),
        )) as Array<{ harnessTranscript: HarnessTranscriptEvidence; outRef?: string }>
        expect(captures.map((capture) => capture.harnessTranscript.status)).toEqual([
          'unavailable',
          'available',
        ])
        expect(captures.every((capture) => !Object.hasOwn(capture, 'outRef'))).toBe(true)
        receipt = captures.at(-1)!.harnessTranscript
      }
      expect(dispatches).toBe(1)
      expect(receipt.status).toBe('available')
      expect(receipt).not.toMatchObject({ coverageComplete: true })
      // Readers have only the durable blob and journal; the original native files are gone.
      await rm(home, { recursive: true, force: true })
      const artifact = await harnessTranscriptArtifact(receipt, context.blobs)
      expect(artifact?.source).toMatchObject({
        controlRef,
        node: { rootId: runId, parentId: runId, nodeId: `${runId}:s0` },
        environmentId: environment.id,
        profileDigest: canonicalAgentProfileDigest(profile),
        providerSessionId: controlRef!.sessionId,
        nativeSessionId: null,
        coverageComplete: false,
      })
      const bound = journal.find(
        (event) => event.kind === 'execution-bound' && event.id === terminal.id,
      )
      const spawned = journal.find((event) => event.kind === 'spawned' && event.id === terminal.id)
      const attemptId =
        bound?.kind === 'execution-bound'
          ? bound.binding.attemptId
          : spawned?.kind === 'spawned'
            ? spawned.attemptId
            : undefined
      expect(attemptId).toBeTypeOf('string')
      expect(artifact?.source?.node?.attemptId).toBe(attemptId)
      expect(
        artifact?.files.some(
          (file) => 'content' in file && file.content.includes('stored native work'),
        ),
      ).toBe(true)
      expect(artifact?.binding).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
