import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

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
  readonly what: 'dispatched' | 'destroy-started' | 'destroyed'
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

interface TreeOptions {
  /** Delay the exact native environment's cleanup acknowledgement. */
  readonly gateDirectorDestroy?: boolean
  /** Hold the end of the director's turn (its event stream) this long after its dispatch. */
  readonly directorTurnEndsAfterMs?: number
  /** Hold the end of the root's accepting turn until this instant. */
  readonly rootAcceptingTurnEndsAt?: () => number
  /** The root's first turn spawns nothing and holds until this instant. */
  readonly rootFirstTurnEndsAt?: () => number
  readonly deadlineMs?: number
  readonly perWorkerDeadlineMs?: number
  /** The director submits nothing and keeps calling its model in one turn: each call is one
   *  per-call usage receipt, served until the turn is cancelled. */
  readonly directorCalls?: {
    readonly count: number
    readonly input: number
    readonly output: number
    /** The first call's receipt says its counts are unknown, as a broken stream's does. */
    readonly unknownFirst?: boolean
  }
  /** After its first turn's spawn, the root keeps calling its model in that turn. */
  readonly rootCalls?: { readonly count: number; readonly input: number; readonly output: number }
  /** No `perWorker`, one slot: a child spawned without a budget reserves the whole pool. */
  readonly childTakesPool?: boolean
}

/** Gap between a burning director's model calls, long enough for a stop to land between two. */
const CALL_GAP_MS = 300

/**
 * A provider-placed root that spawns one provider-placed director and, woken by its settlement,
 * submits the run's answer. The director submits its own answer in its first turn. Both are
 * retained owners using native provider custody, without a client capture writer.
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
  let callsServed = 0
  let rootCallsServed = 0
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
      // A spawning root turn's calls, ended once they are served or cancelled.
      const rootCallsEnded = new Map<string, { end: () => void; ended: Promise<void> }>()
      // A burning director's exact result exists only once its calls end, served or cancelled.
      let endCalls!: () => void
      const callsEnded = new Promise<void>((resolve) => {
        endCalls = resolve
      })
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
              let end!: () => void
              const ended = new Promise<void>((resolve) => {
                end = resolve
              })
              if (options.rootCalls) rootCallsEnded.set(executionId, { end, ended })
            } else if (woken.some((event) => event.type === 'settled')) {
              expect(await call('submit_result', { result: ACCEPTED })).toMatchObject({
                accepted: true,
              })
              const until = options.rootAcceptingTurnEndsAt?.()
              if (until !== undefined) turnEndsAt.set(executionId, until)
            }
          } else if (options.directorCalls === undefined) {
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
          const executionId = sessionOptions?.controlRef?.executionId ?? ''
          const endsAt = turnEndsAt.get(executionId)
          const rootCallsEnd = rootCallsEnded.get(executionId)
          const rootCalls = rootCallsEnd && options.rootCalls
          return {
            ...session,
            async *events(eventOptions): AsyncIterable<AgentEnvironmentEvent> {
              yield* session.events!(eventOptions)
              for (let index = 0; index < (rootCalls?.count ?? 0); index += 1) {
                await new Promise((resolve) => setTimeout(resolve, CALL_GAP_MS))
                if ((await session.status()) === 'cancelled') break
                rootCallsServed += 1
                yield {
                  id: `root-call-${index}`,
                  type: 'llm_call',
                  data: {
                    usageMode: 'delta',
                    model: 'test',
                    tokensIn: rootCalls!.input,
                    tokensOut: rootCalls!.output,
                    costKnown: false,
                  },
                }
              }
              rootCallsEnd?.end()
              const calls = role === 'director' ? options.directorCalls : undefined
              if (calls !== undefined) {
                for (let index = 0; index < calls.count; index += 1) {
                  await new Promise((resolve) => setTimeout(resolve, CALL_GAP_MS))
                  if ((await session.status()) === 'cancelled') break
                  callsServed += 1
                  // One model call's receipt, shaped as Runtime reads opencode's step-finish.
                  yield {
                    id: `call-${index}`,
                    type: 'llm_call',
                    data: {
                      usageMode: 'delta',
                      model: 'test',
                      tokensIn: calls.input,
                      tokensOut: calls.output,
                      ...(calls.unknownFirst && index === 0 ? { tokensKnown: false } : {}),
                      costKnown: false,
                    },
                  }
                }
                endCalls()
              }
              // The harness is still finishing the turn that submitted the accepted result.
              if (endsAt !== undefined) {
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.max(0, endsAt - Date.now())),
                )
              }
            },
            result: async () => {
              // The exact result is terminal authority, so it cannot precede the turn's end.
              if (endsAt !== undefined) {
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.max(0, endsAt - Date.now())),
                )
              }
              const calls = role === 'director' ? options.directorCalls : undefined
              if (calls !== undefined) await callsEnded
              await rootCallsEnd?.ended
              return {
                ...(await session.result()),
                usage:
                  rootCalls !== undefined
                    ? {
                        inputTokens: rootCallsServed * rootCalls.input,
                        outputTokens: rootCallsServed * rootCalls.output,
                      }
                    : calls === undefined
                      ? { inputTokens: 3, outputTokens: 2 }
                      : {
                          inputTokens: callsServed * calls.input,
                          outputTokens: callsServed * calls.output,
                        },
              }
            },
          }
        },
        destroy: async () => {
          note('destroy-started', environment.id)
          if (role === 'director' && options.gateDirectorDestroy) await gate
          await environment.destroy?.()
          note('destroyed', environment.id)
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
  const backend = { backend: 'provider' as const, provider }
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
      ...(options.childTakesPool
        ? { workerSlots: 1 }
        : {
            perWorker: {
              maxIterations: 4,
              maxTokens: 100,
              ...(options.perWorkerDeadlineMs === undefined
                ? {}
                : { deadlineMs: options.perWorkerDeadlineMs }),
            },
          }),
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
    callsServed: () => callsServed,
    rootCallsServed: () => rootCallsServed,
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
  it('settles an accepted director before its delayed native cleanup acknowledgement', async () => {
    const tree = await acceptedTree('accepted-before-destroy', { gateDirectorDestroy: true })
    try {
      await expect
        .poll(
          async () =>
            ofKind(await tree.rootEvents(), 'settled').find(
              (event) => event.id !== 'accepted-before-destroy' && event.status === 'done',
            ),
          { timeout: 20_000 },
        )
        .toBeDefined()
      const settled = ofKind(await tree.rootEvents(), 'settled').find(
        (event) => event.id !== 'accepted-before-destroy',
      )!
      expect(await tree.blobs.get(settled.outRef!)).toEqual(ACCEPTED)
      await expect
        .poll(() =>
          tree.moments.some(
            (moment) => moment.role === 'director' && moment.what === 'destroy-started',
          ),
        )
        .toBe(true)
      expect(
        tree.moments.some((moment) => moment.role === 'director' && moment.what === 'destroyed'),
      ).toBe(false)
    } finally {
      tree.openGate()
    }
    expect(await tree.settling).toMatchObject({ kind: 'winner', out: ACCEPTED })
    const { events } = await tree.directorTree()
    expect(ofKind(events, 'environment-teardown')).toEqual([
      expect.objectContaining({ destroyed: true }),
    ])
    const metered = ofKind(events, 'metered')
    expect(metered.reduce((sum, event) => sum + event.spend.tokens.input, 0)).toBe(3)
    expect(metered.some((event) => event.spend.tokensKnown === false)).toBe(false)
    expect(ofKind(events, 'workspace-capture')).toEqual([])
  }, 40_000)

  it('settles a director done with its output when its deadline falls while the accepted turn ends', async () => {
    // The director's accepted submission must land before its deadline even on a loaded runner,
    // and its turn must end well after the deadline.
    const tree = await acceptedTree('accepted-deadline', {
      perWorkerDeadlineMs: 5_000,
      directorTurnEndsAfterMs: 10_000,
    })
    const result = await tree.settling
    const settled = ofKind(await tree.rootEvents(), 'settled').find(
      (event) => event.id !== 'accepted-deadline',
    )
    expect(settled).toMatchObject({ status: 'done' })
    expect(await tree.blobs.get(settled!.outRef!)).toEqual(ACCEPTED)
    // The deadline fell before the accepted turn ended, and the node waited for it.
    const dispatched = momentOf(tree.moments, 'dispatched', 'director')
    expect(Date.parse(settled!.at)).toBeGreaterThan(dispatched + 9_500)
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
    const events = await tree.rootEvents()
    expect(
      ofKind(events, 'environment-teardown').filter((event) => event.id === 'root-released'),
    ).toEqual([expect.objectContaining({ destroyed: true })])
    expect(result.teardownUnconfirmed ?? []).toEqual([])
    expect(
      ofKind(events, 'workspace-capture').filter((event) => event.id === 'root-released'),
    ).toHaveLength(0)
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

describe('a worker token grant', () => {
  it('cancels a worker turn at the usage receipt that reaches its grant', async () => {
    // agent-learning-methods-20261109a:s4:s8 held a 6,200-token grant and ran 138 model calls in
    // one turn to 328,290 charged tokens: usage was checked only when the turn ended.
    const calls = { count: 30, input: 30, output: 10 }
    // The director never submits; its deadline settles it whichever way its turn ends.
    const tree = await acceptedTree('grant-mid-turn', {
      directorCalls: calls,
      perWorkerDeadlineMs: 15_000,
    })
    await tree.settling
    // perWorker.maxTokens is 100 charged tokens (input − cacheRead + output); a call charges 40.
    // The third call reaches the grant and no fourth runs.
    expect(tree.callsServed()).toBe(3)
    const { events } = await tree.directorTree()
    const charged = ofKind(events, 'metered').reduce(
      (sum, event) =>
        sum +
        event.spend.tokens.input -
        (event.spend.tokens.cacheRead ?? 0) +
        event.spend.tokens.output,
      0,
    )
    expect(charged).toBe(120)
    // A node at its grant gets no further turn.
    expect(
      tree.moments.filter((moment) => moment.role === 'director' && moment.what === 'dispatched'),
    ).toHaveLength(1)
  }, 40_000)
})

describe("a parent whose child holds its pool's remainder", () => {
  it('keeps calling its model on its own grant, and the child settles', async () => {
    // A setup smoke's root (24,000,000 tokens) spawned a worker without a budget, which reserved
    // the whole remainder; at the root's next usage receipt (30,734 charged) the grant stop counted
    // that reservation as spend, cancelled the root's retained run, and the cascade aborted the child.
    const calls = { count: 5, input: 8, output: 2 }
    const tree = await acceptedTree('grant-child-holds-pool', {
      childTakesPool: true,
      rootCalls: calls,
      // The child holds its reservation while the root's calls run.
      directorTurnEndsAfterMs: 5 * CALL_GAP_MS + 1_500,
    })
    const result = await tree.settling
    const events = await tree.rootEvents()
    const child = ofKind(events, 'spawned').find((event) => event.id !== 'grant-child-holds-pool')
    // The child reserved the whole 1,000-token pool, as a no-budget spawn with one slot does.
    expect(child?.budget?.maxTokens).toBe(1_000)
    // All five root calls ran: 50 charged tokens against its 1,000.
    expect(tree.rootCallsServed()).toBe(calls.count)
    expect(ofKind(events, 'settled').find((event) => event.id === child?.id)).toMatchObject({
      status: 'done',
    })
    // No root attempt failed: the held reservation ended no turn as a failure.
    const rootAttempts = ofKind(events, 'driver-attempt').filter(
      (event) => event.id === child?.parent,
    )
    expect(rootAttempts.length).toBeGreaterThan(0)
    expect(rootAttempts.filter((event) => event.record.error !== undefined)).toEqual([])
    expect(result).toMatchObject({ kind: 'winner', out: ACCEPTED })
  }, 40_000)
})

describe('a settled worker reservation', () => {
  it('releases a settled grant whose early usage sample was unknown', async () => {
    // agent-learning-methods-20261109a:s0 held 1,291,771 of its 1,600,000 grant after it settled:
    // one sample at 22:41:17 said tokensKnown:false, and the held reservation stayed cap - reported.
    const calls = { count: 2, input: 5, output: 5, unknownFirst: true }
    const tree = await acceptedTree('grant-unknown-sample', {
      directorCalls: calls,
      perWorkerDeadlineMs: 15_000,
    })
    await tree.settling
    const { id } = await tree.directorTree()
    const events = await tree.rootEvents()
    expect(ofKind(events, 'settled').some((event) => event.id === id)).toBe(true)
    // Unknown token counts are a lower bound; settled work holds none of the grant.
    const reconciled = ofKind(events, 'reconciled').filter((event) => event.id === id)
    expect(reconciled.at(-1)?.reservation?.maxTokens ?? 0).toBe(0)
  }, 40_000)
})

describe("a root's environment at run settlement", () => {
  it('acknowledges native cleanup after a deadline ends its turn', async () => {
    const deadlineMs = 3_000
    let deadlineAt = 0
    const tree = await acceptedTree('root-deadline-mid-turn', {
      deadlineMs,
      rootFirstTurnEndsAt: () => deadlineAt + 60_000,
    })
    deadlineAt = tree.deadlineAt
    const result = await tree.settling
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'deadline' })
    // A deadline supplies no invented terminal result or client capture receipt.
    const events = (await tree.rootEvents()).filter(
      (event) => event.id === 'root-deadline-mid-turn',
    )
    expect(ofKind(events, 'execution-result')).toHaveLength(0)
    // The ended attempt's only evidence is its explicit capture failure: no output, no receipt.
    const evidence = ofKind(events, 'execution-evidence')
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).not.toHaveProperty('traceRoot')
    const transcript = (await tree.blobs.get(evidence[0]!.outRef)) as Record<string, unknown>
    expect(transcript).toMatchObject({
      kind: 'harness-transcript',
      schemaVersion: 1,
      node: { nodeId: 'root-deadline-mid-turn' },
      harnessTranscript: { status: 'unavailable', reason: 'unsupported-environment' },
    })
    expect(transcript).not.toHaveProperty('outRef')
    expect(ofKind(events, 'environment-teardown')).toEqual([
      expect.objectContaining({ destroyed: true }),
    ])
    expect(momentOf(tree.moments, 'destroyed', 'root')).toBeGreaterThanOrEqual(tree.deadlineAt)
    expect(result.teardownUnconfirmed ?? []).toEqual([])
  }, 40_000)
})
