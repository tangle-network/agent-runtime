import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type AgentCandidateOutputArtifactPort,
  captureAgentCandidateWorkspaceFiles,
} from '../../src/candidate-execution'
import { sha256Bytes } from '../../src/candidate-execution/digest'
import type {
  ProviderWorkspaceCaptureResult,
  ProviderWorkspaceRetentionContext,
  ProviderWorkspaceRetentionPort,
} from '../../src/runtime/provider-workspace-retention'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

// Discovery Lab run terraform-economics-20261005f: five nodes whose submit_result was accepted
// settled `down` because their deadlines fell while their turns waited on the end-of-turn
// workspace capture, and each root's sandbox was billed after its run settled.

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const ACCEPTED = { answer: 42 }
const check = (value: unknown) => (value as { answer?: unknown } | undefined)?.answer === 42

type Role = 'root' | 'director'

interface Moment {
  readonly at: number
  readonly what: 'dispatched' | 'capture-started' | 'capture-finished' | 'destroyed'
  readonly role: Role
  readonly environmentId: string
}

/** The events a woken manager's input lists. A first turn lists none. */
function wakeEventsIn(prompt: unknown): Array<Record<string, unknown>> {
  return String(prompt ?? '')
    .split('\n')
    .filter((line) => line.startsWith('- {'))
    .map((line) => JSON.parse(line.slice(2)) as Record<string, unknown>)
}

function ofKind<K extends SpawnEvent['kind']>(
  events: readonly SpawnEvent[],
  kind: K,
): Array<Extract<SpawnEvent, { kind: K }>> {
  return events.filter((event): event is Extract<SpawnEvent, { kind: K }> => event.kind === kind)
}

function inMemoryArtifacts(): AgentCandidateOutputArtifactPort {
  const bytes = new Map<string, Uint8Array>()
  return {
    async put({ bytes: input }) {
      const digest = sha256Bytes(input)
      bytes.set(digest, Uint8Array.from(input))
      return {
        locator: { kind: 's3', bucket: 'accepted-result-test', key: digest.slice(7) },
        sha256: digest,
        byteLength: input.byteLength,
      }
    },
    async read(reference) {
      const stored = bytes.get(reference.sha256)
      if (stored === undefined) throw new Error('artifact is unavailable')
      return Uint8Array.from(stored)
    },
  }
}

/** A capture whose coverage is complete, so a release may destroy the source it came from. */
async function completeCapture(
  context: ProviderWorkspaceRetentionContext,
  artifacts: AgentCandidateOutputArtifactPort,
): Promise<ProviderWorkspaceCaptureResult> {
  const { snapshot } = await captureAgentCandidateWorkspaceFiles(
    [{ path: 'turn.txt', mode: 0o644, bytes: Uint8Array.from(Buffer.from(context.executionId)) }],
    { artifactPersistence: { executionId: context.executionId, outputArtifacts: artifacts } },
  )
  const controlRef = context.controlRef!
  const nativeId = `native-${controlRef.sessionId}`
  return {
    snapshot,
    provenance: {
      status: 'reported',
      environmentId: context.environment.id,
      executionId: context.executionId,
      controlRef,
      workspace: {
        scannedFiles: 1,
        scannedDirectories: 0,
        reportedFiles: 1,
        reportedDirectories: 0,
        complete: true,
      },
      sessions: [
        {
          id: controlRef.sessionId,
          executionId: context.executionId,
          transportEvents: 'complete',
          eventCount: 1,
          messageCount: 1,
          backendType: context.profile.harness,
          executionIds: [controlRef.executionId],
          eventCountsByExecutionId: { [controlRef.executionId]: 1 },
          nativeSessionId: nativeId,
          sidecarImageDigest: `sha256:${'1'.repeat(64)}`,
          sidecarBundleRevision: '2'.repeat(40),
          nativeStore: {
            scope: 'session',
            roots: [],
            complete: true,
            entries: [],
            excludedPaths: [],
            inventory: {
              scannedFiles: 0,
              reportedFiles: 0,
              scannedDirectories: 0,
              reportedDirectories: 0,
              scannedSymlinks: 0,
              reportedSymlinks: 0,
              skippedEntries: 0,
            },
          },
          processStreams: {
            complete: true,
            streamCount: 0,
            stdinBytes: 0,
            stdoutBytes: 0,
            stderrBytes: 0,
            protocolBytes: 0,
          },
          nativeEvents: { complete: true, count: 1 },
        },
      ],
      attempts: [
        {
          executionId: controlRef.executionId,
          ordinal: 1,
          providerSessionId: controlRef.sessionId,
          nativeSessionIds: [nativeId],
          processIds: [],
          outcome: 'succeeded',
          missingReasons: [],
        },
      ],
      missing: [],
    },
  }
}

interface TreeOptions {
  /** Hold the director's workspace capture until the test opens the gate. */
  readonly gateDirectorCapture?: boolean
  /** Hold the end of the director's turn (its event stream) this long after its dispatch. */
  readonly directorTurnEndsAfterMs?: number
  /** Hold the end of the root's accepting turn until this instant. */
  readonly rootAcceptingTurnEndsAt?: () => number
  /** The root's first turn spawns nothing and holds until this instant. */
  readonly rootFirstTurnEndsAt?: () => number
  readonly deadlineMs?: number
  readonly perWorkerDeadlineMs?: number
}

/**
 * A provider-placed root that spawns one provider-placed director and, woken by its settlement,
 * submits the run's answer. The director submits its own answer in its first turn. Both are
 * retained owners whose capture port copies the native session on its own queue, as Discovery
 * Lab's does.
 */
async function acceptedTree(runId: string, options: TreeOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'accepted-result-settles-'))
  directories.push(directory)
  const runDir = join(directory, 'run')
  const context = createFileRunContext(runDir)
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const director = testAgentProfile('director', {
    harness: 'claude-code',
    tools: runtimeToolDeclarations('submit_result'),
  })
  const moments: Moment[] = []
  const roles = new Map<string, Role>()
  const note = (what: Moment['what'], environmentId: string): void => {
    moments.push({ at: Date.now(), what, role: roles.get(environmentId)!, environmentId })
  }
  let openGate!: () => void
  const gate = new Promise<void>((resolve) => {
    openGate = resolve
  })
  const wrappers = new Map<string, (environment: AgentEnvironment) => AgentEnvironment>()
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: { runtimeAttachments: { mcp: true } },
    }),
    create: async (input) => {
      const created = await base.create(input)
      const role: Role =
        typeof input.profile !== 'string' && input.profile.name === 'root' ? 'root' : 'director'
      roles.set(created.id, role)
      const attachment = input.runtimeAttachments?.mcp?.['agent-runtime-coordination']
      if (attachment?.transport !== 'http') throw new Error('missing coordination attachment')
      const call = async (name: string, args: unknown) => {
        const response = await fetch(attachment.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.env?.AGENT_RUNTIME_COORDINATION_TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: name,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        })
        const body = await response.json()
        if (!response.ok || body.error || body.result?.isError)
          throw new Error(JSON.stringify(body))
        return JSON.parse(body.result.content[0].text)
      }
      const turnEndsAt = new Map<string, number>()
      const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
        ...environment,
        dispatch: async (turn) => {
          const dispatched = await environment.dispatch!(turn)
          note('dispatched', environment.id)
          const woken = wakeEventsIn(turn.prompt)
          const executionId = dispatched.controlRef?.executionId ?? ''
          if (role === 'root') {
            if (woken.length === 0 && options.rootFirstTurnEndsAt !== undefined) {
              turnEndsAt.set(executionId, options.rootFirstTurnEndsAt())
            } else if (woken.length === 0) {
              await call('spawn_worker', { profile: director, task: 'Find the answer.' })
            } else if (woken.some((event) => event.type === 'settled')) {
              expect(await call('submit_result', { result: ACCEPTED })).toMatchObject({
                accepted: true,
              })
              const until = options.rootAcceptingTurnEndsAt?.()
              if (until !== undefined) turnEndsAt.set(executionId, until)
            }
          } else {
            expect(await call('submit_result', { result: ACCEPTED })).toMatchObject({
              accepted: true,
            })
            if (options.directorTurnEndsAfterMs !== undefined) {
              turnEndsAt.set(executionId, Date.now() + options.directorTurnEndsAfterMs)
            }
          }
          return dispatched
        },
        session: (id, sessionOptions) => {
          const session = environment.session!(id, sessionOptions)
          const endsAt = turnEndsAt.get(sessionOptions?.controlRef?.executionId ?? '')
          return {
            ...session,
            async *events(eventOptions): AsyncIterable<AgentEnvironmentEvent> {
              yield* session.events!(eventOptions)
              // The harness is still finishing the turn that submitted the accepted result.
              if (endsAt !== undefined) {
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.max(0, endsAt - Date.now())),
                )
              }
            },
            result: async () => ({
              ...(await session.result()),
              usage: { inputTokens: 3, outputTokens: 2 },
            }),
          }
        },
        destroy: async () => {
          note('destroyed', environment.id)
          await environment.destroy?.()
        },
      })
      wrappers.set(created.id, wrap)
      return wrap(created)
    },
    get: async (id) => {
      const environment = await base.get!(id)
      const wrap = wrappers.get(id)
      return environment && wrap ? wrap(environment) : environment
    },
  }
  const artifacts = inMemoryArtifacts()
  const workspaceRetention: ProviderWorkspaceRetentionPort = {
    timeoutMs: 30_000,
    maxConcurrentCaptures: 2,
    requireCompleteProvenance: true,
    artifacts,
    async capture(captureContext) {
      const environmentId = captureContext.environment.id
      note('capture-started', environmentId)
      if (options.gateDirectorCapture && roles.get(environmentId) === 'director') await gate
      const captured = await completeCapture(captureContext, artifacts)
      note('capture-finished', environmentId)
      return captured
    },
    async captureNative(captureContext) {
      const { snapshot } = await captureAgentCandidateWorkspaceFiles(
        [{ path: 'native.jsonl', mode: 0o600, bytes: Uint8Array.from(Buffer.from('{}\n')) }],
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
  const backend = { backend: 'provider' as const, provider, workspaceRetention }
  const startedAt = Date.now()
  const deadlineMs = options.deadlineMs ?? 60_000
  const settling = supervise(
    testAgentProfile('root', {
      harness: 'claude-code',
      tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
    }),
    'Delegate, then submit the answer.',
    {
      runId,
      runDir,
      journal: context.journal,
      blobs: context.blobs,
      backend,
      driverBackend: backend,
      budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs },
      perWorker: {
        maxIterations: 4,
        maxTokens: 100,
        ...(options.perWorkerDeadlineMs === undefined
          ? {}
          : { deadlineMs: options.perWorkerDeadlineMs }),
      },
      maxDepth: 3,
      driverRetry: { enabled: false },
      retainedAtSettlement: 'release',
      wake: { deadlineWarningMs: 0, debounceMs: 20 },
      deliverable: { check },
      resolveDeliverable: () => ({ check }),
      continuation: testContinuation(),
      coordination: {
        authentication: {
          signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
        },
        publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
      },
    },
  )
  const rootEvents = async () => (await context.journal.loadTree(runId)) ?? []
  const directorTree = async () => {
    const spawn = (await rootEvents()).find(
      (event): event is Extract<SpawnEvent, { kind: 'spawned' }> =>
        event.kind === 'spawned' && event.label !== 'root' && event.id !== runId,
    )
    if (spawn?.ownedTreeRoot === undefined) throw new Error('the director was not spawned')
    return {
      id: spawn.id,
      events: (await context.journal.loadTree(spawn.ownedTreeRoot)) ?? [],
    }
  }
  return {
    settling,
    openGate,
    moments,
    rootEvents,
    directorTree,
    blobs: context.blobs,
    startedAt,
    deadlineAt: startedAt + deadlineMs,
  }
}

/** The instant of the first moment that matches. */
function momentOf(moments: readonly Moment[], what: Moment['what'], role: Role): number {
  const found = moments.find((moment) => moment.what === what && moment.role === role)
  if (found === undefined) throw new Error(`no ${what} for the ${role}`)
  return found.at
}

function lastMomentOf(moments: readonly Moment[], what: Moment['what'], role: Role): number {
  const found = moments.filter((moment) => moment.what === what && moment.role === role).at(-1)
  if (found === undefined) throw new Error(`no ${what} for the ${role}`)
  return found.at
}

describe('an accepted submit_result settles its node', () => {
  it('settles an accepted director before its slow end-of-turn capture, which still precedes the destroy', async () => {
    const tree = await acceptedTree('accepted-before-capture', { gateDirectorCapture: true })

    // The director's node settles while its workspace capture is still held.
    let settled: Extract<SpawnEvent, { kind: 'settled' }> | undefined
    await expect
      .poll(
        async () => {
          settled = ofKind(await tree.rootEvents(), 'settled').find(
            (event) => event.id !== 'accepted-before-capture',
          )
          return settled
        },
        { timeout: 20_000, interval: 50 },
      )
      .toBeDefined()
    expect(settled).toMatchObject({ status: 'done' })
    expect(await tree.blobs.get(settled!.outRef!)).toEqual(ACCEPTED)
    expect(tree.moments.some((m) => m.role === 'director' && m.what === 'destroyed')).toBe(false)
    const directorCaptures = tree.moments.filter(
      (m) => m.role === 'director' && m.what === 'capture-finished',
    )
    expect(directorCaptures).toHaveLength(0)

    tree.openGate()
    const result = await tree.settling
    expect(result).toMatchObject({ kind: 'winner', out: ACCEPTED })

    // The capture the director handed over finished before its environment was destroyed.
    const captured = momentOf(tree.moments, 'capture-finished', 'director')
    const destroyed = momentOf(tree.moments, 'destroyed', 'director')
    expect(captured).toBeLessThanOrEqual(destroyed)

    const { events: nested } = await tree.directorTree()
    // Its result was committed first, and the capture's receipt reached the journal after it.
    const result0 = nested.findIndex((event) => event.kind === 'execution-result')
    const evidence = nested.findIndex((event) => event.kind === 'execution-evidence')
    expect(result0).toBeGreaterThanOrEqual(0)
    expect(evidence).toBeGreaterThan(result0)
    expect(ofKind(nested, 'environment-teardown')).toEqual([
      expect.objectContaining({ destroyed: true }),
    ])
    // The capture's queue wait and its own duration, on the node's own record.
    const timings = ofKind(nested, 'workspace-capture')
    expect(timings).toEqual([
      expect.objectContaining({
        outcome: 'captured',
        ahead: expect.any(Number),
        queuedMs: expect.any(Number),
        captureMs: expect.any(Number),
        archiveBytes: expect.any(Number),
      }),
    ])
    expect(timings[0]!.archiveBytes).toBeGreaterThan(0)
    // The turn's usage was metered exactly, not marked unknown because the turn returned early.
    const metered = ofKind(nested, 'metered')
    expect(metered.reduce((sum, event) => sum + event.spend.tokens.input, 0)).toBe(3)
    expect(metered.some((event) => event.spend.tokensKnown === false)).toBe(false)
  }, 40_000)

  it('settles a director done with its output when its deadline falls while the accepted turn ends', async () => {
    const tree = await acceptedTree('accepted-deadline', {
      perWorkerDeadlineMs: 1_500,
      directorTurnEndsAfterMs: 3_000,
    })
    const result = await tree.settling
    const settled = ofKind(await tree.rootEvents(), 'settled').find(
      (event) => event.id !== 'accepted-deadline',
    )
    expect(settled).toMatchObject({ status: 'done' })
    expect(await tree.blobs.get(settled!.outRef!)).toEqual(ACCEPTED)
    // The deadline fell before the accepted turn ended, and the node waited for it.
    const dispatched = momentOf(tree.moments, 'dispatched', 'director')
    expect(Date.parse(settled!.at)).toBeGreaterThan(dispatched + 2_500)
    expect(result).toMatchObject({ kind: 'winner', out: ACCEPTED })
    const { events: nested } = await tree.directorTree()
    const metered = ofKind(nested, 'metered')
    expect(metered.reduce((sum, event) => sum + event.spend.tokens.input, 0)).toBe(3)
    expect(metered.some((event) => event.spend.tokensKnown === false)).toBe(false)
  }, 40_000)

  it("destroys the root's environment when the run settles, never between its turns", async () => {
    const tree = await acceptedTree('root-released')
    const result = await tree.settling
    expect(result).toMatchObject({ kind: 'winner', out: ACCEPTED })

    const rootTurns = tree.moments.filter((m) => m.role === 'root' && m.what === 'dispatched')
    // Woken in the environment it waited in: one environment, two turns.
    expect(new Set(rootTurns.map((m) => m.environmentId)).size).toBe(1)
    expect(rootTurns).toHaveLength(2)
    const destroyed = momentOf(tree.moments, 'destroyed', 'root')
    expect(destroyed).toBeGreaterThan(rootTurns[1]!.at)
    expect(destroyed).toBeGreaterThanOrEqual(lastMomentOf(tree.moments, 'capture-finished', 'root'))
    const events = await tree.rootEvents()
    expect(
      ofKind(events, 'environment-teardown').filter((event) => event.id === 'root-released'),
    ).toEqual([expect.objectContaining({ destroyed: true })])
    expect(result.teardownUnconfirmed ?? []).toEqual([])
    // Both root turns' captures are on its record.
    expect(
      ofKind(events, 'workspace-capture').filter((event) => event.id === 'root-released'),
    ).toHaveLength(2)
  }, 40_000)

  it('settles a winner when the root deadline falls while its accepted turn ends', async () => {
    const deadlineMs = 8_000
    let deadlineAt = 0
    const tree = await acceptedTree('accepted-root-deadline', {
      deadlineMs,
      rootAcceptingTurnEndsAt: () => deadlineAt + 1_000,
    })
    deadlineAt = tree.deadlineAt
    const result = await tree.settling
    expect(result).toMatchObject({ kind: 'winner', out: ACCEPTED })
    expect(lastMomentOf(tree.moments, 'dispatched', 'root')).toBeLessThan(tree.deadlineAt)
    expect(Date.now()).toBeGreaterThan(tree.deadlineAt)
  }, 40_000)
})

describe("a root's environment at run settlement", () => {
  it('is destroyed after the capture of the turn its deadline ended, not kept until it is suspended', async () => {
    const deadlineMs = 3_000
    let deadlineAt = 0
    const tree = await acceptedTree('root-deadline-mid-turn', {
      deadlineMs,
      rootFirstTurnEndsAt: () => deadlineAt + 60_000,
    })
    deadlineAt = tree.deadlineAt
    const result = await tree.settling
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'budget-exhausted' })
    // The turn the deadline ended has no result; the capture it handed over is its receipt.
    const events = (await tree.rootEvents()).filter(
      (event) => event.id === 'root-deadline-mid-turn',
    )
    expect(ofKind(events, 'execution-result')).toHaveLength(0)
    expect(ofKind(events, 'execution-evidence')).toHaveLength(1)
    expect(ofKind(events, 'environment-teardown')).toEqual([
      expect.objectContaining({ destroyed: true }),
    ])
    expect(momentOf(tree.moments, 'destroyed', 'root')).toBeGreaterThanOrEqual(
      momentOf(tree.moments, 'capture-finished', 'root'),
    )
    expect(result.teardownUnconfirmed ?? []).toEqual([])
  }, 40_000)
})
