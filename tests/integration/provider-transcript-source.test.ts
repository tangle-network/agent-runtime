import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  type AgentExactRunControlRef,
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
import { harnessTranscriptArtifact } from '../../src/runtime/harness-transcript'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

const execute = promisify(execFile)

// The portable provider runs a real native process and reads its durable files. No model,
// remote allocation, mocked filesystem, or scripted executor stands in for execution.
it.each([0, 7])('retains exact dispatch provenance after native exit %i', async (exitCode) => {
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
          await execute(process.execPath, [worker, JSON.stringify(controlRef), String(exitCode)], {
            cwd: directory,
            env: { PATH: process.env.PATH, HOME: home },
          })
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
          async cancel() {
            throw new Error('completed native execution must not be cancelled')
          },
        }
      },
      async read(path) {
        return readFile(path, 'utf8')
      },
      async exec(command) {
        const { stdout, stderr } = await execute('/bin/sh', ['-c', command], {
          cwd: directory,
          env: { PATH: process.env.PATH, HOME: home },
        })
        return { stdout, stderr, exitCode: 0 }
      },
    }
    const profile = testAgentProfile('native-proof')
    const servedProfile = { ...profile, prompt: { instructions: ['provider overlay'] } }
    const context = createFileRunContext(join(directory, 'run'))
    const runId = `native-source-${exitCode}`
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
                executorFactory: providerAsExecutor(provider, {
                  profileForCreate: () => servedProfile,
                }),
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
        workerSlots: 1,
        retainedAtSettlement: 'keep',
        budget: { maxIterations: 2, maxTokens: 200 },
      },
    )
    expect(nativeExit).toBe(exitCode)
    const journal = (await context.journal.loadTree(runId))!
    const dispatch = journal.find(
      (event) => event.kind === 'execution-admitted' && event.admission.phase === 'dispatched',
    )
    expect(dispatch).toBeDefined()
    const terminal = journal.find((event) => event.kind === 'settled' && event.id === `${runId}:s0`)
    if (!terminal || terminal.kind !== 'settled' || !terminal.harnessTranscript)
      throw new Error(`native settlement missing: ${JSON.stringify(journal)}`)
    expect(terminal.harnessTranscript.status).toBe('available')
    // Readers have only the durable blob and journal; the original native files are gone.
    await rm(home, { recursive: true })
    const artifact = await harnessTranscriptArtifact(terminal.harnessTranscript, context.blobs)
    expect(artifact?.source).toMatchObject({
      controlRef,
      node: { rootId: runId, parentId: runId, nodeId: `${runId}:s0` },
      environmentId: environment.id,
      profileDigest: canonicalAgentProfileDigest(servedProfile),
      providerSessionId: controlRef!.sessionId,
      nativeSessionId: null,
      coverageComplete: false,
    })
    expect(artifact?.source?.node?.attemptId).toBeTruthy()
    expect(
      artifact?.files.some(
        (file) => 'content' in file && file.content.includes('stored native work'),
      ),
    ).toBe(true)
    expect(artifact?.binding).toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
