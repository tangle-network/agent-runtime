import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { runtimeRunRolloutLines } from '@tangle-network/agent-eval/supervisor-run'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { claudeCodeReader, claudeCodeRefForFile } from '@tangle-network/harness-sessions'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderExecutorOptions } from '../../src/runtime/environment-provider/provider-executor-admission'
import { providerAsExecutor } from '../../src/runtime/environment-provider/provider-executor-admission'
import { captureBoundHarnessTranscript } from '../../src/runtime/harness-transcript'
import { readHarnessTranscriptSessions } from '../../src/runtime/harness-transcript-sessions'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  ExecutorFactory,
  SpawnEvent,
  SpawnJournal,
} from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

// Runtime writes the run directory through its real retained provider executor and evidence
// recorder; Eval's published reader reads it back through Runtime's verified transcript loader.
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

type CaptureRequest = Parameters<NonNullable<ProviderExecutorOptions['harnessTranscript']>>[0]

/** One native Claude Code session file, written the way the harness stores it. */
function nativeSessionFile(sessionId: string) {
  const hex = createHash('sha256').update(sessionId).digest('hex')
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  const at = '2026-11-13T00:00:00.000Z'
  const records = [
    {
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      sessionId: id,
      timestamp: at,
      cwd: '/work',
      message: { role: 'user', content: 'perform native work' },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      sessionId: id,
      timestamp: at,
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'native work' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    },
  ]
  return {
    id,
    bytes: Buffer.from(records.map((record) => JSON.stringify(record)).join('\n') + '\n'),
  }
}

async function nativeCapture(request: CaptureRequest) {
  if (!request.controlRef) throw new Error('missing exact provider control reference')
  const file = nativeSessionFile(request.controlRef.sessionId)
  return captureBoundHarnessTranscript({
    harness: 'claude-code',
    binding: {
      kind: 'provider',
      controlRef: request.controlRef,
      node: request.node,
      sessionId: request.controlRef.sessionId,
      nativeSessionId: file.id,
      profileDigest: request.profileDigest,
      runs: [{ runId: request.controlRef.runId, requestDigest: request.controlRef.requestDigest }],
    },
    nativeSessionId: file.id,
    files: [{ path: `${file.id}.jsonl`, nativeSessionId: file.id, byteLength: file.bytes.length }],
    read: async () => file.bytes,
    parse: () => ({
      nativeSessionId: file.id,
      children: [],
      integrity: { truncated: false, unparsedRecords: 0, gaps: [] },
    }),
    signal: request.signal,
  })
}

/** The test provider never ends a session; a native read needs the provider's terminal proof. */
function endedSessions(base: AgentEnvironmentProvider): AgentEnvironmentProvider {
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session: (id, options) => ({
      ...environment.session!(id, options),
      status: async () => 'completed' as const,
    }),
  })
  return {
    ...base,
    create: async (input) => wrap(await base.create(input)),
    get: async (id) => {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
}

async function runDirectory(options: { readonly crash: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'eval-native-reader-'))
  roots.push(root)
  const runDir = join(root, 'run')
  const context = createFileRunContext(runDir)
  const executorOptions: ProviderExecutorOptions = {
    destroyOnSettle: true,
    defaults: { workspace: { cwd: { base: 'host', path: root } } },
    harnessTranscript: nativeCapture,
  }
  const factory = (): ExecutorFactory<unknown> =>
    providerAsExecutor(
      endedSessions(durableRetainedProvider(join(root, 'provider.json'))),
      executorOptions,
    )
  const profile = testAgentProfile('native-leaf', { harness: 'claude-code' })
  const worker = (): Agent<unknown, unknown> =>
    Object.assign(
      { name: 'native-leaf', act: async () => 'unused' },
      { executorSpec: { profile, harness: profile.harness, executorFactory: factory() } },
    )
  const run = (journal: SpawnJournal, recoverExecutor?: ExecutorFactory<unknown>) =>
    createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        act: async (_task, scope) => {
          if (scope.view.inFlight > 0) await scope.next()
          const child = scope.spawn(worker(), 'perform native work', {
            key: 'work',
            label: 'native-leaf',
            budget: { maxIterations: 1, maxTokens: 100 },
          })
          if (!child.ok) throw new Error('native leaf was not admitted')
          if (child.prior?.state === 'completed') return child.prior.settled.out
          const settled = await scope.next()
          if (settled?.kind !== 'done') throw new Error('native leaf did not settle')
          return settled.out
        },
      },
      'root-task',
      {
        ...context,
        runId: 'root',
        journal,
        budget: { maxIterations: 4, maxTokens: 400 },
        rootIdentity: {
          profileDigest: canonicalCandidateDigest({ name: 'root-profile' }),
          taskDigest: canonicalCandidateDigest('root-task'),
        },
        ...(recoverExecutor ? { recoverExecutor } : {}),
      },
    )
  if (options.crash) {
    // The first process stops right after the dispatch was admitted; a second one recovers it.
    const journal = context.journal
    let stopped = false
    await expect(
      run({
        beginTree: journal.beginTree.bind(journal),
        loadTree: journal.loadTree.bind(journal),
        appendEvent: async (tree: string, event: SpawnEvent) => {
          await journal.appendEvent(tree, event)
          if (
            !stopped &&
            event.kind === 'execution-admitted' &&
            event.admission.phase === 'dispatched'
          ) {
            stopped = true
            throw new Error('process stopped')
          }
        },
      }),
    ).rejects.toThrow('durable state unavailable')
    expect(stopped).toBe(true)
    expect((await run(context.journal, factory())).kind).toBe('winner')
  } else expect((await run(context.journal)).kind).toBe('winner')
  const events = (await context.journal.loadTree('root')) ?? []
  const leaf = events.filter((event) => event.id === 'root:s0')
  const evidence = leaf.filter((event) => event.kind === 'execution-evidence')
  const bound = leaf.filter((event) => event.kind === 'execution-bound')
  const read = () =>
    runtimeRunRolloutLines(runDir, {
      readNativeTranscript: (request) =>
        readHarnessTranscriptSessions(request.receipt, context.blobs, {
          node: { rootId: request.rootId, nodeId: request.nodeId, attemptId: request.attemptId },
          readSessions: async (artifact) => {
            const directory = await mkdtemp(join(root, 'native-'))
            return Promise.all(
              artifact.files.map(async (file) => {
                const path = join(directory, basename(file.path))
                await writeFile(path, file.content)
                return claudeCodeReader.read(claudeCodeRefForFile(path))
              }),
            )
          },
        }),
    })
  return { root, runDir, context, events, evidence, bound, read }
}

/** The leaf's row: its provenance names each native capture and any projection gap. */
function leafRow(rollouts: Awaited<ReturnType<typeof runtimeRunRolloutLines>>) {
  const row = rollouts.lines.find((line) => line.rollout_id === 'root:s0')
  if (!row) throw new Error(`no leaf rollout row: ${JSON.stringify(rollouts.gaps)}`)
  return row.provenance as unknown as {
    native_captures: Array<Record<string, unknown>>
    lossy_projection?: boolean
    gap?: string
  }
}

describe("Eval's published reader over a Runtime run directory", () => {
  it('returns the native session of a clean and a recovered attempt, bound to the journal attempt', async () => {
    const clean = await runDirectory({ crash: false })
    const recovered = await runDirectory({ crash: true })
    for (const run of [clean, recovered]) {
      // One bound attempt, and one evidence row naming it.
      const bound = new Set(
        run.bound.map((event) => event.kind === 'execution-bound' && event.binding.attemptId),
      )
      expect(bound.size, JSON.stringify(run.bound)).toBe(1)
      const [attemptId] = bound
      expect(
        run.evidence.map((event) => event.kind === 'execution-evidence' && event.attemptId),
      ).toEqual([attemptId])
      const provenance = leafRow(await run.read())
      expect(provenance.native_captures, JSON.stringify(provenance)).toEqual([
        expect.objectContaining({ verified: true, gap: null, attempt_id: attemptId }),
      ])
      expect(provenance.native_captures[0]!.native_session_ids).toHaveLength(1)
      expect(provenance.lossy_projection).toBeUndefined()
      // The test provider offers no workspace read; that channel is the row's only gap.
      expect(provenance.gap).toBe('workspace capture evidence incomplete')
    }
    // The recovered attempt's record is content only, so it addresses the same bytes a clean
    // attempt with the same identity would; neither run cites one address twice.
    for (const run of [clean, recovered]) {
      const refs = run.evidence.map((event) => event.kind === 'execution-evidence' && event.outRef)
      expect(new Set(refs).size).toBe(refs.length)
    }
  })

  it('refuses a row whose attempt differs from the journal-bound attempt', async () => {
    const run = await runDirectory({ crash: false })
    const events = run.events.map((event) =>
      event.kind === 'execution-evidence'
        ? { ...event, attemptId: 'root:s0:attempt:foreign' }
        : event,
    )
    await rm(join(run.runDir, 'spawn-journal.jsonl'))
    const journal = createFileRunContext(run.runDir).journal
    await journal.beginTree('root', events[0]!.at)
    for (const event of events) await journal.appendEvent('root', event as SpawnEvent)
    const provenance = leafRow(await run.read())
    expect(provenance.native_captures, JSON.stringify(provenance)).toEqual([
      expect.objectContaining({ verified: false, native_session_ids: [] }),
    ])
    expect(provenance.native_captures[0]!.gap).toMatch(/attempt/)
    expect(provenance.lossy_projection).toBe(true)
  })
})
