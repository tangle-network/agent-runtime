import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { createCommandModelCredentialResolver } from '@tangle-network/agent-provider-tangle/node'
import { Sandbox } from '@tangle-network/sandbox'
import { supervisePursuit } from '../../../src/durable'
import { FileSpawnJournal } from '../../../src/runtime'
import { type Configuration, localUrl, record } from './uncertain-create-protocol'

const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Configuration
const directory = config.directory
localUrl(config.url)
const provider = createTangleProvider({
  client: new Sandbox({
    apiKey: 'local-fixture-not-a-secret',
    baseUrl: config.url,
    platformUrl: config.url,
    trustLocalCliAuth: false,
    directExec: false,
  }),
  name: 'local-http-tangle',
  requireNativeSessionCapture: false,
  readyTimeoutMs: 250,
  modelCredentials: createCommandModelCredentialResolver({
    command: [process.execPath, config.resolver, directory],
    timeoutMs: 5000,
  }),
})
const controller = new AbortController()
process.once('SIGTERM', () => controller.abort('integration cleanup'))
record(join(directory, 'coordinator.jsonl'), {
  kind: 'coordinator-entered',
  at: new Date().toISOString(),
  pid: process.pid,
  scenario: config.scenario,
})
try {
  const result = await supervisePursuit(
    {
      name: 'root',
      harness: 'opencode',
      model: { provider: 'openai', default: 'fixture-model' },
      tools: {
        agent_runtime_coordination_spawn_worker: true,
        agent_runtime_coordination_submit_result: true,
        agent_runtime_coordination_observe_agent: true,
        agent_runtime_coordination_steer_agent: true,
      },
    },
    'Complete the locally controlled integration assignment.',
    {
      pursuitId: 'uncertain-create-proof',
      runId: 'uncertain-create-proof',
      runDir: join(directory, 'run'),
      signal: controller.signal,
      backend: { backend: 'provider', provider },
      driverBackend: { backend: 'provider', provider },
      budget: { maxIterations: 200, maxTokens: 10000, deadlineMs: 120000 },
      perWorker: { maxIterations: 20, maxTokens: 1000 },
      workerSlots: 4,
      driverRetry: {
        transientOutageMs: 0,
        initialBackoffMs: 10,
        maxBackoffMs: 10,
        unavailablePauseMs: 10,
        maxUnavailablePauseMs: 10,
        maxConsecutiveFailures: 100,
      },
      continuation: {
        deadline: Date.now() + 120000,
        maxBarren: 100,
        failures: 'verbatim',
        panel: 'off',
        bar: 'off',
        profile: {
          id: 'local-http-integration',
          opening: 'The independent check has not passed.',
          plan: 'Complete the local assignment and submit_result.',
          rules: 'Use only the provided local tools.',
          headings: {
            failures: 'Failures',
            protected: 'Passing',
            changed: 'Changes',
            findings: 'Findings',
            bar: 'Bar',
            plan: 'Plan',
            rules: 'Rules',
          },
        },
      },
      wake: { heartbeatMs: config.scenario === 'unsupported-descendant' ? 250 : 0, debounceMs: 0 },
      teardownConfirmMs: 0,
      retainedAtSettlement: 'release',
      deliverable: {
        describe: 'the delivered local fixture answer',
        check: (value) => JSON.stringify(value).includes('delivered'),
      },
      finalizer: (context) => {
        record(join(directory, 'finalizer.jsonl'), {
          kind: 'finalizer',
          at: new Date().toISOString(),
          delivered: context.delivered.map((row) => ({ id: row.id, outRef: row.outRef })),
          settled: context.allSettled,
          budget: context.budget,
        })
        return context.delivered[0]?.out
      },
      onDriverAttempt: async (attempt) => {
        record(join(directory, 'attempts.jsonl'), {
          kind: 'attempt',
          at: new Date().toISOString(),
          ...attempt,
        })
        const measuredDisposition =
          attempt.error === undefined && config.scenario.startsWith('unsupported-')
            ? (
                await new FileSpawnJournal(join(directory, 'run', 'spawn-journal.jsonl')).loadTree(
                  'uncertain-create-proof',
                )
              )?.some(
                (event) =>
                  event.id === 'uncertain-create-proof:s0' &&
                  ((event.kind === 'settled' && event.status === 'down') ||
                    (event.kind === 'reconciled' &&
                      event.retainedPendingCause === 'nested-recovery')),
              ) === true
            : false
        // Let the normal wake drain child completion first; then preserve its measured
        // disposition before global settlement can legitimately release retained cursors.
        if (
          (config.scenario.startsWith('create-') && attempt.error === undefined) ||
          measuredDisposition
        ) {
          await fetch(
            `${config.url}/fixture/hold-success?phase=${measuredDisposition ? 'nested-disposition-committed' : 'native-result-committed'}`,
            { signal: controller.signal },
          )
        }
      },
      coordination: {
        authentication: {
          signingKeys: {
            activeKeyId: 'local-fixture',
            keys: { 'local-fixture': 'local-integration-signing-key-not-a-production-secret-0000' },
          },
        },
        publicUrl: async (address) => {
          const routeKey = encodeURIComponent(address.actorId)
          const response = await fetch(`${config.url}/fixture/control`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              routeKey,
              target: `http://127.0.0.1:${address.port}/coordination/${routeKey}`,
            }),
            signal: AbortSignal.timeout(5000),
          })
          if (!response.ok) throw new Error('local coordination route registration failed')
          return `${config.url}/coordination/${routeKey}`
        },
      },
    },
  )
  record(join(directory, 'outcome.jsonl'), {
    kind: 'settled',
    at: new Date().toISOString(),
    result,
  })
} catch (cause) {
  const error = cause instanceof Error ? cause : new Error(String(cause))
  record(join(directory, 'outcome.jsonl'), {
    kind: 'rejected',
    at: new Date().toISOString(),
    name: error.name,
    message: error.message,
    stack: error.stack,
  })
  process.exitCode = 1
}
