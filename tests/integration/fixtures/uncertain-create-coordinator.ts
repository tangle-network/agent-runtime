import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentExactRunControlRef } from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { createCommandModelCredentialResolver } from '@tangle-network/agent-provider-tangle/node'
import { Sandbox } from '@tangle-network/sandbox'
import { captureAgentCandidateWorkspaceFiles } from '../../../src/candidate-execution'
import { superviseGraphPursuit, supervisePursuit } from '../../../src/durable'
import { contentAddress } from '../../../src/durable/content-address'
import {
  FileResultBlobStore,
  FileSpawnJournal,
  graphFromStored,
  loadGraphFile,
  type SpawnEvent,
} from '../../../src/runtime'
import { createPrivateCasArtifactPort } from '../../../src/runtime/private-cas'
import type { ProviderWorkspaceCaptureReceipt } from '../../../src/runtime/provider-workspace-retention'
import { writeAtomicDurableFile } from '../../../src/runtime/supervise/durable-file'
import { type Configuration, localUrl, object, record } from './uncertain-create-protocol'

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
const legacyCapture =
  config.scenario === 'json-owner-capture' || config.scenario === 'trace-owner-evidence'
const fileBlobs = new FileResultBlobStore(join(directory, 'run', 'blobs'))
const publications: Promise<void>[] = []
let receiptReady: Promise<ProviderWorkspaceCaptureReceipt> | undefined

/** Reproduce an old journal obligation and its stored artifacts, never a live capture port. */
class HistoricalCaptureJournal extends FileSpawnJournal {
  override async appendEvent(root: string, event: SpawnEvent): Promise<void> {
    const historical =
      legacyCapture && event.id === root && event.kind === 'execution-input'
        ? { ...event, workspaceRetention: true }
        : event
    await super.appendEvent(root, historical)
    if (!legacyCapture || event.id !== root) return
    if (event.kind === 'execution-admitted' && event.admission.phase === 'dispatched') {
      receiptReady = this.receipt(root, event.admission.controlRef).then((receipt) => {
        if (config.scenario === 'json-owner-capture') {
          // Application output is not the historical host receipt, even when its bytes verify.
          writeAtomicDurableFile(
            join(directory, 'reflected-capture.json'),
            JSON.stringify({
              workspaceSnapshot: receipt.snapshot,
              workspaceCapture: { ...receipt, coverageComplete: true },
            }),
          )
        }
        return receipt
      })
      publications.push(receiptReady.then(() => undefined))
    }
    if (event.kind === 'execution-result') {
      // Materialization can bind after dispatch. Only the accepted turn's prefix supplies identity.
      const committed = (await this.loadTree(root)) ?? []
      const end = committed.findIndex(
        (row) => row.kind === 'execution-result' && row.seq === event.seq && row.id === root,
      )
      if (end < 0) throw new Error('historical fixture lost its committed result')
      const bound = committed
        .slice(0, end)
        .find((row) => row.id === root && row.kind === 'execution-bound')
      publications.push(
        (async () => {
          const receipt = await receiptReady
          if (!receipt) throw new Error('historical fixture lost its exact admission')
          record(join(directory, 'capture-attempts.jsonl'), {
            environmentId: receipt.environmentId,
            executionId: receipt.executionId,
          })
          const response = await fetch(
            `${config.url}/fixture/hold-success?phase=workspace-capture`,
            { signal: AbortSignal.timeout(15000) },
          )
          if (!response.ok) throw new Error('historical evidence publication refused')
          if (config.scenario !== 'trace-owner-evidence') return
          const original = object(await fileBlobs.get(event.outRef))
          const output = {
            ...original,
            workspaceSnapshot: receipt.snapshot,
            workspaceCapture: {
              ...receipt,
              ...(bound?.kind === 'execution-bound'
                ? {
                    node: {
                      rootId: root,
                      parentId: root,
                      nodeId: root,
                      depth: 0,
                      attemptId: bound.binding.attemptId,
                    },
                  }
                : {}),
            },
          }
          const outRef = contentAddress(output)
          await fileBlobs.put(outRef, output)
          const rows = (await this.loadTree(root)) ?? []
          await super.appendEvent(root, {
            kind: 'execution-evidence',
            id: root,
            outRef,
            seq: Math.max(0, ...rows.map((row) => row.seq)) + 1,
            at: new Date().toISOString(),
          })
        })(),
      )
    }
  }

  private async receipt(
    root: string,
    controlRef: AgentExactRunControlRef,
  ): Promise<ProviderWorkspaceCaptureReceipt> {
    const rows = (await this.loadTree(root)) ?? []
    const input = [...rows]
      .reverse()
      .find((row) => row.id === root && row.kind === 'execution-input')
    const intent = rows.find(
      (row) => row.kind === 'execution-admitted' && row.admission.phase === 'intent',
    )
    const bound = rows.find((row) => row.id === root && row.kind === 'execution-bound')
    if (!input || intent?.kind !== 'execution-admitted' || intent.admission.phase !== 'intent')
      throw new Error('historical fixture requires actual input/admission')
    const path = join(directory, 'json-worker-processes.jsonl')
    const deadline = Date.now() + 5000
    let bytes: Buffer
    for (;;) {
      try {
        bytes = readFileSync(path)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() >= deadline)
          throw error
        await delay(10)
      }
    }
    const executionId = `${root}:input:${input.seq}`
    const captured = await captureAgentCandidateWorkspaceFiles(
      [{ path: 'actual-processes.jsonl', mode: 0o600, bytes }],
      {
        artifactPersistence: { executionId, outputArtifacts: artifacts },
      },
    )
    return {
      executionId,
      controlRef,
      environmentId: controlRef.environmentId,
      profileDigest: intent.admission.requestedProfileDigest,
      ...(bound?.kind === 'execution-bound'
        ? {
            node: {
              rootId: root,
              parentId: root,
              nodeId: root,
              depth: 0,
              attemptId: bound.binding.attemptId,
            },
          }
        : {}),
      providerSessionId: controlRef.sessionId,
      nativeSessionId: null,
      snapshot: captured.snapshot,
      provenance: {
        status: 'unavailable',
        provider: controlRef.provider,
        environmentId: controlRef.environmentId,
        executionId,
        controlRef,
        workspaceScope: 'environment',
        missing: ['local process fixture has no native harness capture'],
      },
      coverageComplete: false,
    }
  }
}
const journal = new HistoricalCaptureJournal(join(directory, 'run', 'spawn-journal.jsonl'))
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
            ...(legacyCapture ? { journal } : {}),
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
            finalizer: async (context) => {
              // The existing application finalizer joins this historical fixture publication
              // while the run lock is held; Runtime has no client capture writer.
              if (legacyCapture) await Promise.all(publications)
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
                (config.scenario.startsWith('create-') &&
                  (attempt.error === undefined ||
                    (config.holdCreateFailure && attempt.attempt === 2))) ||
                measuredDisposition ||
                (config.scenario.startsWith('dispatch-') && attempt.error !== undefined)
              ) {
                await fetch(
                  `${config.url}/fixture/hold-success?phase=${config.holdCreateFailure && attempt.error !== undefined ? 'create-failure-recorded' : config.scenario.startsWith('dispatch-') ? 'dispatch-failure-recorded' : measuredDisposition ? 'nested-disposition-committed' : 'native-result-committed'}`,
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
