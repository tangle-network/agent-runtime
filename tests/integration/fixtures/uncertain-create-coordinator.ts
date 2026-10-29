import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { createCommandModelCredentialResolver } from '@tangle-network/agent-provider-tangle/node'
import { Sandbox } from '@tangle-network/sandbox'
import { captureAgentCandidateWorkspaceFiles } from '../../../src/candidate-execution'
import { superviseGraphPursuit, supervisePursuit } from '../../../src/durable'
import {
  FileResultBlobStore,
  FileSpawnJournal,
  graphFromStored,
  loadGraphFile,
} from '../../../src/runtime'
import { createPrivateCasArtifactPort } from '../../../src/runtime/private-cas'
import {
  type ProviderWorkspaceRetentionContext,
  type ProviderWorkspaceRetentionPort,
  workspaceCaptureReceipt,
} from '../../../src/runtime/provider-workspace-retention'
import { writeAtomicDurableFile } from '../../../src/runtime/supervise/durable-file'
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
  ...(config.scenario === 'json-owner-capture' || config.scenario.startsWith('trace-')
    ? { ephemeral: true }
    : {}),
  requireNativeSessionCapture: config.scenario.startsWith('dispatch-'),
  readyTimeoutMs: 250,
  modelCredentials: createCommandModelCredentialResolver({
    command: [process.execPath, config.resolver, directory],
    timeoutMs: 5000,
  }),
})
const artifacts = createPrivateCasArtifactPort(join(directory, 'workspace-cas'), 'provider-json')
async function captureFiles(context: ProviderWorkspaceRetentionContext, native = false) {
  const { snapshot } = await captureAgentCandidateWorkspaceFiles(
    [
      {
        path: 'actual-processes.jsonl',
        mode: 0o600,
        bytes: readFileSync(join(directory, 'json-worker-processes.jsonl')),
      },
    ],
    {
      artifactPersistence: { executionId: context.executionId, outputArtifacts: artifacts },
    },
  )
  return {
    snapshot,
    provenance: {
      status: 'unavailable' as const,
      provider: context.environment.provider,
      environmentId: context.environment.id,
      executionId: context.executionId,
      ...(context.controlRef === undefined ? {} : { controlRef: context.controlRef }),
      workspaceScope: native ? ('none' as const) : ('environment' as const),
      missing: ['local process fixture has no native harness capture'],
    },
  }
}
const workspaceRetention: ProviderWorkspaceRetentionPort | undefined =
  config.scenario === 'json-owner-capture' || config.scenario === 'trace-owner-evidence'
    ? {
        artifacts,
        timeoutMs: 5000,
        nativeIntervalMs: 1,
        async captureNative(context) {
          const captured = await captureFiles(context, true)
          const { snapshot } = captured
          // Deliberately forge authority in APPLICATION data, never in the host port's result.
          writeAtomicDurableFile(
            join(directory, 'reflected-capture.json'),
            JSON.stringify({
              workspaceSnapshot: snapshot,
              workspaceCapture: workspaceCaptureReceipt(context, {
                ...captured,
                coverageComplete: true,
              }),
            }),
          )
          return captured
        },
        async capture(context) {
          record(join(directory, 'capture-attempts.jsonl'), {
            environmentId: context.environment.id,
            executionId: context.executionId,
          })
          await fetch(`${config.url}/fixture/hold-success?phase=workspace-capture`, {
            signal: context.signal,
          })
          if (config.scenario === 'trace-owner-evidence') return captureFiles(context)
          throw new Error('fixture full workspace capture unavailable')
        },
      }
    : undefined
const fileBlobs = new FileResultBlobStore(join(directory, 'run', 'blobs'))
const controller = new AbortController()
process.once('SIGTERM', () => controller.abort('integration cleanup'))
record(join(directory, 'coordinator.jsonl'), {
  kind: 'coordinator-entered',
  at: new Date().toISOString(),
  pid: process.pid,
  scenario: config.scenario,
})
try {
  const result =
    (config.scenario.startsWith('json-') && config.scenario !== 'json-owner-capture') ||
    config.scenario.startsWith('trace-tree-')
      ? await superviseGraphPursuit(
          graphFromStored(
            (
              await loadGraphFile(join(directory, 'graph.json'), {
                source: JSON.stringify({
                  graph: 'provider-json-output',
                  nodes: ['fetch-pr', 'review-pr'].map((id) => ({
                    id,
                    profile: {
                      name: id,
                      harness: 'opencode',
                      model: { provider: 'openai', default: 'fixture-model' },
                    },
                  })),
                  entry: [{ node: 'fetch-pr', task: 'Return merge evidence as JSON.' }],
                  edges: [
                    {
                      kind: 'routes',
                      from: 'fetch-pr',
                      to: 'review-pr',
                      directive: { surface: 'delegates/worker-brief', version: 1 },
                    },
                  ],
                  budget: { maxIterations: 12, maxTokens: 1000, deadlineMs: 15000 },
                  check: {
                    all: [
                      {
                        node: 'fetch-pr',
                        pointer: '/merge_sha',
                        equals: '27a9d985a054cab5287e4f1b9d35687e4295f5ca',
                      },
                      { node: 'review-pr', pointer: '/approved', equals: true },
                    ],
                  },
                }),
              })
            ).graph,
            ...(config.scenario === 'json-malformed-always-true' ? ([() => true] as const) : []),
          ),
          {
            pursuitId: 'uncertain-create-proof',
            runId: 'uncertain-create-proof',
            runDir: join(directory, 'run'),
            backend: {
              backend: 'provider',
              provider,
              requireTerminalEvent: config.scenario !== 'json-no-terminal',
            },
            signal: controller.signal,
          },
        )
      : await supervisePursuit(
          {
            name: 'root',
            harness: config.scenario === 'terminal-ceiling' ? 'codex' : 'opencode',
            model: {
              provider: 'openai',
              default: 'fixture-model',
              ...(config.scenario === 'terminal-ceiling'
                ? { metadata: { credentialSource: 'subscription' } }
                : {}),
            },
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
            ...(config.scenario === 'trace-owner-cancel'
              ? {
                  blobs: {
                    get: (ref: string) => fileBlobs.get(ref),
                    async put(ref: string, value: unknown) {
                      if (
                        value !== null &&
                        typeof value === 'object' &&
                        'schema' in value &&
                        value.schema === 'agent-runtime.trace-root.v1' &&
                        !controller.signal.aborted
                      ) {
                        record(join(directory, 'cancelled-while-hashing.jsonl'), { ref })
                        controller.abort(
                          new Error('fixture cancelled during actual trace artifact persistence'),
                        )
                      }
                      await fileBlobs.put(ref, value)
                    },
                  },
                }
              : {}),
            backend: {
              backend: 'provider',
              provider,
              requireTerminalEvent: config.scenario !== 'json-no-terminal',
            },
            driverBackend: {
              backend: 'provider',
              provider,
              ...(config.scenario === 'json-owner-capture' ? { outputFormat: 'json' } : {}),
              ...(workspaceRetention === undefined ? {} : { workspaceRetention }),
              ...(config.scenario === 'terminal-ceiling'
                ? { defaults: { resources: { cpu: 16 } } }
                : {}),
            },
            budget: { maxIterations: 200, maxTokens: 10000, deadlineMs: 120000 },
            perWorker: { maxIterations: 20, maxTokens: 1000 },
            workerSlots: 4,
            driverRetry: {
              pauseRootStops: config.scenario === 'terminal-ceiling',
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
            wake: {
              heartbeatMs: config.scenario === 'unsupported-descendant' ? 250 : 0,
              debounceMs: 0,
            },
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
                      await new FileSpawnJournal(
                        join(directory, 'run', 'spawn-journal.jsonl'),
                      ).loadTree('uncertain-create-proof')
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
                measuredDisposition ||
                (config.scenario.startsWith('dispatch-') && attempt.error !== undefined)
              ) {
                await fetch(
                  `${config.url}/fixture/hold-success?phase=${config.scenario.startsWith('dispatch-') ? 'dispatch-failure-recorded' : measuredDisposition ? 'nested-disposition-committed' : 'native-result-committed'}`,
                  { signal: controller.signal },
                )
              }
            },
            coordination: {
              authentication: {
                signingKeys: {
                  activeKeyId: 'local-fixture',
                  keys: {
                    'local-fixture': 'local-integration-signing-key-not-a-production-secret-0000',
                  },
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
                record(join(directory, 'coordinator.jsonl'), {
                  kind: 'coordinator-route-ready',
                  at: new Date().toISOString(),
                  pid: process.pid,
                  actorId: address.actorId,
                })
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
