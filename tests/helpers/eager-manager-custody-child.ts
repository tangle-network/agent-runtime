import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { RunCancellationReason } from '../../src/runtime/supervise/abortable'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { scriptedDriverBrain } from '../kernel/scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'
import { coordinationProxy } from './coordination-proxy'
import { durableRetainedProvider } from './durable-retained-provider'
import { superviseForTest } from './runtime-with-test-brain'

const [directory, phase] = process.argv.slice(2)
if (!directory || !['kill', 'cancel', 'complete', 'refuse'].includes(phase))
  throw new Error('expected fixture directory and phase')
const runId = 'manager-custody'
const budget = { maxIterations: 8, maxTokens: 100 }
const context = createFileRunContext(join(directory, 'run'), { withDriver: true })
if (phase === 'cancel') {
  const root = (await context.journal.loadTree(runId))!.find(
    (event) => event.kind === 'spawned' && event.parent === undefined,
  )!
  const controller = new AbortController()
  controller.abort(
    new RunCancellationReason('operator', 'cold cancellation without execution authority'),
  )
  const result = await createSupervisor().run(
    {
      name: 'root',
      act: async () => {
        throw new Error('cancelled root executed')
      },
    },
    'Delegate.',
    {
      ...context,
      runId,
      budget,
      rootIdentity: root.kind === 'spawned' ? root.identity : undefined,
      signal: controller.signal,
      resume: true,
      retainedAtSettlement: 'keep',
      teardownConfirmMs: 0,
    },
  )
  process.stdout.write(`${JSON.stringify(result)}\n`)
} else {
  const note = (what: string, environmentId?: string) =>
    appendFileSync(join(directory, 'moments.jsonl'), `${JSON.stringify({ what, environmentId })}\n`)
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    async dispatch(turn) {
      note('dispatch', environment.id)
      return environment.dispatch!(turn)
    },
    async destroy() {
      note('destroy-requested', environment.id)
      if (phase === 'refuse') throw new Error('fixture owner destruction refused')
      await environment.destroy!()
      note('destroy-acked', environment.id)
    },
    session(id, options) {
      const session = environment.session!(id, options)
      return {
        ...session,
        result: async () => ({
          ...(await session.result()),
          usage: { inputTokens: 3, outputTokens: 2 },
        }),
      }
    },
  })
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: { runtimeAttachments: { mcp: true } },
    }),
    create: async (input) => wrap(await base.create(input)),
    get: async (id) => {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  const proxy = await coordinationProxy(() => {
    note('coordination-http')
    return undefined
  })
  const manager = testAgentProfile('manager', {
    harness: 'codex',
    tools: runtimeToolDeclarations('stop'),
  })
  try {
    const result = await superviseForTest(
      testAgentProfile('root', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('spawn_worker'),
      }),
      'Delegate.',
      {
        runId,
        runDir: join(directory, 'run'),
        budget,
        blobs: context.blobs,
        journal: {
          beginTree: context.journal.beginTree.bind(context.journal),
          loadTree: context.journal.loadTree.bind(context.journal),
          async appendEvent(root, event) {
            await context.journal.appendEvent(root, event)
            if (
              phase === 'kill' &&
              root === runId &&
              event.kind === 'settled' &&
              event.id !== runId
            )
              process.kill(process.pid, 'SIGKILL')
          },
        },
        backend: { backend: 'provider', provider },
        perWorker: { maxIterations: 3, maxTokens: 20 },
        driverRetry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
        teardownConfirmMs: 0,
        retainedAtSettlement: 'keep',
        finalizer: () => ({ finalizedBy: 'manager' }),
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'fixture-signing-key-'.repeat(3) } },
          },
          publicUrl: ({ port }) => {
            proxy.forwardTo(port)
            return `${proxy.url}/nested`
          },
        },
        brain: scriptedDriverBrain([
          {
            toolCalls: [
              {
                name: 'spawn_worker',
                arguments: { profile: manager, task: 'Manage.', key: 'manager' },
              },
            ],
          },
          { content: 'waiting for manager' },
          { content: 'done' },
        ]),
      },
    )
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    await proxy.close()
  }
}
