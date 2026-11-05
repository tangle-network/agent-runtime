import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import { RunCancellationReason } from '../../src/runtime/supervise/abortable'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'
import { testContinuation } from './continuation'
import { nativeSeatProvider } from './native-seat-provider'

const [directory, phase] = process.argv.slice(2)
if (!directory || !phase) throw new Error('expected directory and phase')
const runId = 'retained-capture-restart'
const note = (event: object) =>
  appendFileSync(join(directory, 'moments.jsonl'), `${JSON.stringify({ phase, ...event })}\n`)
const context = createFileRunContext(join(directory, 'run'))
const base = nativeSeatProvider(directory, { success: phase !== 'kill-failed', recordOutput: true })
const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
  ...environment,
  async dispatch(turn) {
    note({ what: 'dispatch', environmentId: environment.id, executionId: turn.executionId })
    return environment.dispatch!(turn)
  },
  async destroy() {
    note({ what: 'destroy', environmentId: environment.id })
    await environment.destroy?.()
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
const backend = { backend: 'provider' as const, provider }
const seat = phase.startsWith('seat-')
const operator = new AbortController()
try {
  const result = await supervisePursuit(
    testAgentProfile('root', {
      harness: 'claude-code',
      ...(seat
        ? {
            model: { provider: 'anthropic', default: 'claude-opus-4-1' },
            seats: [
              {
                harness: 'claude-code',
                provider: 'anthropic',
                model: 'claude-opus-4-1',
                selector: { kind: 'all-eligible' as const },
              },
              {
                harness: 'codex',
                provider: 'openai',
                model: 'gpt-6-sol',
                selector: { kind: 'all-eligible' as const },
              },
            ],
          }
        : {}),
      tools: runtimeToolDeclarations('submit_result'),
    }),
    'Return an ordinary turn, then continue.',
    {
      pursuitId: runId,
      runId,
      runDir: join(directory, 'run'),
      signal: operator.signal,
      journal: {
        beginTree: context.journal.beginTree.bind(context.journal),
        loadTree: context.journal.loadTree.bind(context.journal),
        async appendEvent(root, event) {
          await context.journal.appendEvent(root, event)
          if (event.kind === 'execution-result') {
            if (['kill', 'kill-failed', 'seat-kill'].includes(phase))
              process.kill(process.pid, 'SIGKILL')
            operator.abort(new RunCancellationReason('operator', 'cold receipt proof complete'))
          }
          if (
            (phase === 'kill-before-input' && event.kind === 'execution-input') ||
            (phase === 'kill-before-dispatch' &&
              event.kind === 'execution-admitted' &&
              event.admission.phase === 'environment')
          ) {
            const events = (await context.journal.loadTree(root)) ?? []
            if (events.filter((next) => next.kind === 'execution-input').length > 1)
              process.kill(process.pid, 'SIGKILL')
          }
        },
      },
      blobs: context.blobs,
      backend,
      driverBackend: backend,
      ...(seat
        ? {
            selectSeat: async ({ stageIndex }: { stageIndex: number }) =>
              stageIndex === 0
                ? { resumeAt: '2026-01-01T00:00:00.000Z' }
                : { seat: 'test-seat', backend },
          }
        : {}),
      budget: { maxIterations: 8, maxTokens: 1000, deadlineMs: 10_000 },
      driverRetry: {
        maxAttempts: 3,
        maxConsecutiveFailures: 2,
        transientOutageMs: 0,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        pauseRootStops: false,
      },
      retainedAtSettlement: 'release',
      teardownConfirmMs: 0,
      wake: { deadlineWarningMs: 0, debounceMs: 0 },
      deliverable: { check: () => false },
      continuation: testContinuation({ maxBarren: 2 }),
      coordination: {
        authentication: true,
        publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
      },
    },
  )
  process.stdout.write(`${JSON.stringify(result.result)}\n`)
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
  )
  process.exitCode = 1
}
