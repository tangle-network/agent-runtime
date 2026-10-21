import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { captureAgentCandidateWorkspaceFiles } from '../../src/candidate-execution'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import type { ProviderWorkspaceRetentionPort } from '../../src/runtime/provider-workspace-retention'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'
import { completeCapture, fileWorkspaceArtifacts } from './complete-workspace-capture'
import { testContinuation } from './continuation'
import { durableRetainedProvider } from './durable-retained-provider'

const [directory, phase] = process.argv.slice(2)
if (!directory || !phase)
  throw new Error('usage: retained-capture-resume-child.ts <directory> <phase>')
const seat = phase.startsWith('seat-')
const runId = 'retained-capture-restart'
const note = (event: object) =>
  appendFileSync(join(directory, 'moments.jsonl'), `${JSON.stringify({ phase, ...event })}\n`)
const context = createFileRunContext(join(directory, 'run'))
const base = durableRetainedProvider(join(directory, 'provider.json'))
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
let lookups = 0
const provider: AgentEnvironmentProvider = {
  ...base,
  capabilities: async () => ({
    ...(await base.capabilities()),
    create: { runtimeAttachments: { mcp: true } },
  }),
  create: async (input) => wrap(await base.create(input)),
  get: async (id) => {
    lookups += 1
    if (phase === 'lookup-hang' && lookups === 2) await new Promise<never>(() => {})
    const environment = await base.get!(id)
    return environment ? wrap(environment) : null
  },
}
const artifacts = fileWorkspaceArtifacts(join(directory, 'artifacts'))
const retention: ProviderWorkspaceRetentionPort = {
  timeoutMs: phase === 'lookup-hang' ? 100 : 10_000,
  requireCompleteProvenance: true,
  artifacts,
  async capture(captureContext) {
    note({
      what: 'capture-started',
      environmentId: captureContext.environment.id,
      executionId: captureContext.executionId,
      node: captureContext.node,
      profileDigest: canonicalAgentProfileDigest(captureContext.profile),
      profile: captureContext.profile,
    })
    if (phase === 'kill' || phase === 'seat-kill') process.kill(process.pid, 'SIGKILL')
    if (phase === 'reject' || phase === 'live-reject')
      throw new Error('capture storage unavailable')
    if (phase === 'gate') {
      while (!existsSync(join(directory, 'capture-open'))) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        captureContext.signal.throwIfAborted()
      }
    }
    const captured = await completeCapture(captureContext, artifacts)
    note({
      what: 'capture-finished',
      environmentId: captureContext.environment.id,
      executionId: captureContext.executionId,
      node: captureContext.node,
      profileDigest: canonicalAgentProfileDigest(captureContext.profile),
    })
    if (phase === 'partial')
      return {
        ...captured,
        provenance: {
          ...captured.provenance,
          workspace: { ...captured.provenance.workspace!, complete: false },
        },
      }
    if (phase === 'foreign')
      return {
        ...captured,
        provenance: { ...captured.provenance, executionId: 'foreign-execution' },
      }
    return captured
  },
  async captureNative(captureContext) {
    if (phase === 'kill-native' && captureContext.phase === 'settled') {
      note({
        what: 'native-started',
        environmentId: captureContext.environment.id,
        executionId: captureContext.executionId,
        node: captureContext.node,
        profileDigest: canonicalAgentProfileDigest(captureContext.profile),
      })
      process.kill(process.pid, 'SIGKILL')
    }
    const { snapshot } = await captureAgentCandidateWorkspaceFiles(
      [{ path: 'native.jsonl', mode: 0o600, bytes: new TextEncoder().encode('{}\n') }],
      {
        artifactPersistence: {
          executionId: captureContext.executionId,
          outputArtifacts: artifacts,
        },
      },
    )
    return {
      snapshot,
      provenance: {
        status: 'reported',
        environmentId: captureContext.environment.id,
        executionId: captureContext.executionId,
        workspaceScope: 'none',
        missing: [],
      },
    }
  },
}
const backend = {
  backend: 'provider' as const,
  provider,
  ...(phase === 'no-retention' ? {} : { workspaceRetention: retention }),
}
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
      // The director never delivers, and a barren streak only pauses the run: the operator stops
      // it at the first `barren-pause` row.
      signal: operator.signal,
      journal: {
        beginTree: context.journal.beginTree.bind(context.journal),
        loadTree: context.journal.loadTree.bind(context.journal),
        async appendEvent(root, event) {
          await context.journal.appendEvent(root, event)
          if (event.kind === 'barren-pause') operator.abort(new Error('operator stopped the run'))
          if (phase === 'kill-after-evidence' && event.kind === 'execution-evidence')
            process.kill(process.pid, 'SIGKILL')
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
      budget: { maxIterations: 8, maxTokens: 1_000, deadlineMs: 60_000 },
      driverRetry: { enabled: false },
      retainedAtSettlement: 'release',
      wake: { deadlineWarningMs: 0, debounceMs: 20 },
      deliverable: { check: () => false },
      continuation: testContinuation({ maxBarren: 2 }),
      coordination: {
        authentication: {
          signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
        },
        publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
      },
    },
  )
  process.stdout.write(`${JSON.stringify({ kind: result.result.kind })}\n`)
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
  )
  process.exitCode = 1
}
