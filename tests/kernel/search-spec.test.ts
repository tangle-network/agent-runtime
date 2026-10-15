/**
 * SearchSpec: the seven axes refuse unknown and contradictory values, the five presets have
 * canonical digests, and every preset compiles to exactly one existing call that runs with injected
 * execution (a scripted root harness and in-process leaves), holding the routes, the worker bound and
 * the stop rule its axes name. The spec's digest lands on the root's registration and on the settle
 * record, and the same spec, inputs and decisions replay to the same journal.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type Agent,
  type AgentSpec,
  assertSearchSpec,
  type CompiledSearchSpec,
  compileSearchSpec,
  type DriveHarness,
  type Executor,
  type ExecutorResult,
  InMemorySpawnJournal,
  runGraph,
  SEARCH_SPEC_CORRELATION_KEY,
  type SearchSpec,
  type SearchSpecInputs,
  type SpawnEvent,
  searchPresets,
  searchSpecDigest,
  supervise,
  type UsageEvent,
  type WorkerSpawnContext,
} from '@tangle-network/agent-runtime/kernel'
import { describe, expect, it } from 'vitest'
import { testContinuationProfile } from '../helpers/continuation'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const budget = { maxIterations: 200, maxTokens: 200_000 }
const deliverable = {
  describe: 'An object whose answer is 42.',
  check: (out: unknown) => (out as { answer?: unknown } | null)?.answer === 42,
}

async function call(url: string, name: string, args: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = (await response.json()) as { result?: { content?: Array<{ text?: string }> } }
  const text = body.result?.content?.[0]?.text
  return text === undefined ? body : JSON.parse(text)
}

/** A leaf worker: no coordination tools, so it stays a leaf under every spec. */
function worker(name: string): AgentProfile {
  return testAgentProfile(name, { tools: { agent_runtime_coordination_spawn_worker: false } })
}

interface Observed {
  live: number
  peak: number
  readonly spawned: string[]
  readonly mail: Array<string | undefined>
}

/** In-process leaves that settle in 25 ms with `{ answer: 42 }`, recording what reached them. */
function leaves(observed: Observed) {
  return (profile: AgentProfile, context?: WorkerSpawnContext): Agent<unknown, unknown> => {
    const name = String(profile.name)
    observed.spawned.push(name)
    observed.mail.push(context?.peerMailUrl)
    const out = { answer: 42, from: name }
    const executor: Executor<unknown> = {
      runtime: 'router',
      execute() {
        return (async function* () {
          observed.live += 1
          observed.peak = Math.max(observed.peak, observed.live)
          try {
            await new Promise((resolve) => setTimeout(resolve, 25))
            yield { kind: 'iteration' } as UsageEvent
            yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
            yield {
              kind: 'cost',
              usd: 0,
              usdKnown: true,
              provenance: 'provider-receipt',
            } as UsageEvent
          } finally {
            observed.live -= 1
          }
        })()
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: (): ExecutorResult<unknown> => ({
        outRef: `leaf:${name}`,
        out,
        verdict: { valid: true, score: 1 },
        spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
      }),
    }
    const spec: AgentSpec = { profile, harness: null, executor }
    return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
}

interface Driven {
  readonly managers: string[]
  readonly sessions: Array<string | undefined>
  readonly tasks: string[]
}

/** The root's harness, scripted: on its first turn it spawns `spawns` by name; on every later turn
 *  it submits the answer, which Runtime refuses while a worker still runs. */
function scriptedRoot(
  root: string,
  driven: Driven,
  options: { readonly spawns?: ReadonlyArray<string>; readonly submits?: boolean } = {},
): DriveHarness {
  return async ({ profile, coordinationMcpUrl, session, task }) => {
    driven.managers.push(String(profile.name))
    if (profile.name !== root) throw new Error(`a worker became a manager: ${profile.name}`)
    driven.sessions.push(session)
    driven.tasks.push(String(task))
    if (driven.tasks.length === 1 && (options.spawns?.length ?? 0) > 0) {
      for (const [index, name] of (options.spawns ?? []).entries()) {
        await call(coordinationMcpUrl, 'spawn_worker', { profile: name, task: `part ${index + 1}` })
      }
      return
    }
    if (options.submits !== false) {
      await call(coordinationMcpUrl, 'submit_result', { result: { answer: 42 } })
    }
  }
}

function inputs(
  over: Partial<SearchSpecInputs> & Pick<SearchSpecInputs, 'profile'>,
): SearchSpecInputs {
  return {
    task: 'Find the answer.',
    budget,
    deliverable,
    deadline: Date.now() + 3_600_000,
    continuation: { profile: testContinuationProfile },
    ...over,
  }
}

async function run(compiled: CompiledSearchSpec) {
  return compiled.call === 'supervise'
    ? supervise(compiled.profile, compiled.task, compiled.options)
    : (await runGraph(compiled.graph, compiled.options)).result
}

const observe = (): Observed => ({ live: 0, peak: 0, spawned: [], mail: [] })
const drive = (): Driven => ({ managers: [], sessions: [], tasks: [] })

describe('SearchSpec validation', () => {
  const sla = searchPresets.sla(3)
  const refusals: Array<[string, () => unknown, RegExp]> = [
    [
      'an unknown axis',
      () => assertSearchSpec({ ...sla, topology: 'tree' }),
      /unknown axis 'topology'/,
    ],
    [
      'a missing axis',
      () => {
        const { stop: _stop, ...rest } = sla
        return assertSearchSpec(rest)
      },
      /axis 'stop' is missing/,
    ],
    [
      'an unknown value',
      () => assertSearchSpec({ ...sla, context: 'sometimes' }),
      /context is "sometimes"/,
    ],
    [
      'an unknown nested key',
      () => assertSearchSpec({ ...sla, workers: { ...sla.workers, depth: 2 } }),
      /workers has unknown key 'depth'/,
    ],
    [
      'conversation state',
      () => assertSearchSpec({ ...sla, state: 'conversation' }),
      /state 'conversation' is not a value/,
    ],
    [
      'an advisor with native context',
      () => assertSearchSpec({ ...sla, context: 'native' }),
      /select 'advisor' sees each epoch only through the coordinator's projection, so it needs context 'fresh'/,
    ],
    [
      'messages without peers',
      () => assertSearchSpec({ ...searchPresets.tree(1), comms: 'messages' }),
      /comms 'messages' needs at least two peers .* workers.count is 1/,
    ],
    [
      'self selection without messages',
      () => assertSearchSpec({ ...searchPresets.peers(2), comms: 'assignments' }),
      /select 'self' lets the peers divide the work by messages/,
    ],
    [
      'assignments with no workers',
      () => assertSearchSpec({ ...searchPresets.solo(), comms: 'assignments' }),
      /workers.count 0 runs the root alone, so comms must be 'none'/,
    ],
    [
      'a code root with fresh context',
      () => assertSearchSpec({ ...searchPresets.tree(2), select: 'code', context: 'fresh' }),
      /no harness session for context 'fresh' to renew/,
    ],
    [
      'a preset width that contradicts its comms',
      () => searchPresets.peers(1),
      /needs at least two peers/,
    ],
  ]
  for (const [name, attempt, message] of refusals) {
    it(`refuses ${name} with a plain message`, () => {
      expect(attempt).toThrow(message)
    })
  }

  const root = testAgentProfile('root', { tools: runtimeToolDeclarations('spawn_worker') })
  const compileRefusals: Array<[string, () => unknown, RegExp]> = [
    [
      'an option an axis decides',
      () => compileSearchSpec(sla, inputs({ profile: root, options: { workerSlots: 9 } as never })),
      /options.workerSlots is decided by workers.count/,
    ],
    [
      'a caller-written spec digest',
      () =>
        compileSearchSpec(
          sla,
          inputs({
            profile: root,
            options: { execution: { correlation: { [SEARCH_SPEC_CORRELATION_KEY]: 'mine' } } },
          }),
        ),
      /cannot set searchSpecDigest/,
    ],
    [
      'a router-brained root under a continuation axis',
      () =>
        compileSearchSpec(
          searchPresets.tree(2),
          inputs({ profile: { ...root, harness: 'cli-base' } }),
        ),
      /runs on the router\s+brain/,
    ],
    [
      'workers with a root that cannot spawn',
      () =>
        compileSearchSpec(
          searchPresets.tree(2),
          inputs({
            profile: testAgentProfile('root', { tools: runtimeToolDeclarations('submit_result') }),
          }),
        ),
      /workers.count 2 needs a root that spawns/,
    ],
    [
      'isolated workers on a shared placement',
      () =>
        compileSearchSpec(
          searchPresets.tree(2),
          inputs({ profile: root, sharedPlacement: {} as never }),
        ),
      /workers.isolation 'isolated' gives every worker its own environment/,
    ],
    [
      'peer mail on workers that cannot mount it',
      () =>
        compileSearchSpec(
          searchPresets.peers(2),
          inputs({
            profile: root,
            workers: [worker('peer-a'), worker('peer-b')],
            options: { backend: { backend: 'provider', provider: 'tangle' } },
          }),
        ),
      /comms 'messages' needs workers that can call peer mail/,
    ],
    [
      'peers that do not match the width',
      () =>
        compileSearchSpec(
          searchPresets.peers(3),
          inputs({ profile: root, workers: [worker('a')] }),
        ),
      /select 'self' starts exactly workers.count peers; inputs.workers holds 1/,
    ],
  ]
  for (const [name, attempt, message] of compileRefusals) {
    it(`compileSearchSpec refuses ${name}`, () => {
      expect(attempt).toThrow(message)
    })
  }
})

describe('SearchSpec presets', () => {
  it('have canonical digests: pinned, distinct, and independent of list order', () => {
    const digests = {
      solo: searchSpecDigest(searchPresets.solo()),
      tree: searchSpecDigest(searchPresets.tree(3)),
      swarm: searchSpecDigest(searchPresets.swarm(16)),
      peers: searchSpecDigest(searchPresets.peers(3)),
      sla: searchSpecDigest(searchPresets.sla(3)),
    }
    // Computed independently from RFC 8785 JSON of { kind: 'agent-runtime.search-spec.v1', spec }.
    expect(digests).toEqual({
      solo: 'sha256:169a058a19071be169514ec2b7b68e8946b4738fa958ed8e13d138f450667136',
      tree: 'sha256:e90c38f931ec077033463266375b7df9a796c9759c2ff6f1833c3527fdf57dbe',
      swarm: 'sha256:d2e4aa8ee3cfc8250dc455785a5eb345f92d333534b93675db5fb268b82a3dbc',
      peers: 'sha256:4bbd7b3724272e3336bd3eaf76d5283eca5014c81ae28485c1bf4094bb355d6f',
      sla: 'sha256:855159ee1bae99bdb01d062d859cde9eec1afc3325b82c89bbdb08337b42003c',
    })
    expect(new Set(Object.values(digests)).size).toBe(5)
    const tree: SearchSpec = searchPresets.tree(2)
    expect(searchSpecDigest({ ...tree, workers: { ...tree.workers, models: ['b', 'a'] } })).toBe(
      searchSpecDigest({ ...tree, workers: { ...tree.workers, models: ['a', 'b'] } }),
    )
    expect(searchSpecDigest(searchPresets.tree(2))).not.toBe(
      searchSpecDigest(searchPresets.tree(3)),
    )
  })

  it('compile each axis onto the option it names', () => {
    const root = testAgentProfile('root', {
      tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
    })
    const sla = compileSearchSpec(searchPresets.sla(3), inputs({ profile: root }))
    if (sla.call !== 'supervise') throw new Error('sla compiles to supervise')
    expect(sla.options).toMatchObject({
      workerSlots: 3,
      maxDepth: 1,
      inheritSpawnRights: false,
      continuation: {
        session: 'fresh',
        maxBarren: 2,
        failures: 'verbatim',
        bar: 'off',
        panel: 'off',
      },
      execution: { correlation: { [SEARCH_SPEC_CORRELATION_KEY]: sla.digest } },
    })
    expect(sla.options.peerMail).toBeUndefined()
    const peers = compileSearchSpec(
      searchPresets.peers(2),
      inputs({ profile: root, workers: [worker('peer-a'), worker('peer-b')] }),
    )
    if (peers.call !== 'supervise') throw new Error('peers compile to supervise')
    expect(peers.options).toMatchObject({
      peerMail: true,
      workerSlots: 2,
      continuation: { session: 'native' },
    })
    expect(peers.options.registry?.profiles?.names()).toEqual(['peer-a', 'peer-b'])
    const placement = { kind: 'test-placement' } as never
    const swarm = compileSearchSpec(
      searchPresets.swarm(16),
      inputs({
        profile: root,
        sharedPlacement: placement,
        options: { backend: { backend: 'provider', provider: 'tangle' } },
      }),
    )
    if (swarm.call !== 'supervise') throw new Error('swarm compiles to supervise')
    expect(swarm.options.backend).toMatchObject({ backend: 'provider', shared: placement })
    const plateau = compileSearchSpec(
      { ...searchPresets.tree(2), stop: { maxBarren: 3, plateau: { window: 4, minDelta: 0.01 } } },
      inputs({ profile: root }),
    )
    if (plateau.call !== 'supervise') throw new Error('tree compiles to supervise')
    expect(plateau.options).toMatchObject({
      stopRule: { plateau: { window: 4, minDelta: 0.01 } },
      continuation: { maxBarren: 3 },
    })
  })

  it('solo runs the root alone and its stop rule ends a run that never passes', async () => {
    const root = testAgentProfile('solo-root', { tools: runtimeToolDeclarations('submit_result') })
    const observed = observe()
    const passing = drive()
    const winner = await run(
      compileSearchSpec(
        searchPresets.solo(),
        inputs({
          profile: root,
          options: {
            runId: 'solo-pass',
            makeLeafAgent: leaves(observed),
            driveHarness: scriptedRoot('solo-root', passing),
          },
        }),
      ),
    )
    expect(winner).toMatchObject({ kind: 'winner', out: { answer: 42 } })
    expect(observed.spawned).toEqual([])

    const barren = drive()
    const stopped = await run(
      compileSearchSpec(
        searchPresets.solo(),
        inputs({
          profile: root,
          options: {
            runId: 'solo-barren',
            makeLeafAgent: leaves(observe()),
            driverRetry: { initialBackoffMs: 1, maxBackoffMs: 1 },
            driveHarness: scriptedRoot('solo-root', barren, { submits: false }),
          },
        }),
      ),
    )
    // The first turn, then stop.maxBarren (2) re-entered turns in a row without progress.
    expect(barren.tasks).toHaveLength(3)
    expect(stopped.kind).toBe('no-winner')
    expect(stopped.continuation?.repromptRefusedBy).toBe('no-progress')
  })

  it('tree(2) holds two workers at once over three assignments, with no peer mail', async () => {
    const root = testAgentProfile('lead', {
      tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
    })
    const observed = observe()
    const driven = drive()
    const result = await run(
      compileSearchSpec(
        searchPresets.tree(2),
        inputs({
          profile: root,
          workers: [worker('w1'), worker('w2'), worker('w3')],
          options: {
            runId: 'tree',
            wake: { debounceMs: 0 },
            makeLeafAgent: leaves(observed),
            driveHarness: scriptedRoot('lead', driven, { spawns: ['w1', 'w2', 'w3'] }),
          },
        }),
      ),
    )
    expect(result.kind).toBe('winner')
    expect([...observed.spawned].sort()).toEqual(['w1', 'w2', 'w3'])
    expect(observed.peak).toBeLessThanOrEqual(2)
    expect(observed.mail).toEqual([undefined, undefined, undefined])
    expect(new Set(driven.managers)).toEqual(new Set(['lead']))
    expect(driven.sessions.every((session) => session === 'native')).toBe(true)
  })

  it('swarm(2) runs the same lead over a two-worker bound', async () => {
    const root = testAgentProfile('lead', {
      tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
    })
    const observed = observe()
    const result = await run(
      compileSearchSpec(
        searchPresets.swarm(2),
        inputs({
          profile: root,
          workers: [worker('w1'), worker('w2'), worker('w3')],
          options: {
            runId: 'swarm',
            wake: { debounceMs: 0 },
            makeLeafAgent: leaves(observed),
            driveHarness: scriptedRoot('lead', drive(), { spawns: ['w1', 'w2', 'w3'] }),
          },
        }),
      ),
    )
    expect(result.kind).toBe('winner')
    expect(observed.spawned).toHaveLength(3)
    expect(observed.peak).toBeLessThanOrEqual(2)
  })

  it('peers(2) hands every peer a peer-mail channel', async () => {
    const convener = testAgentProfile('convener', {
      tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
    })
    const observed = observe()
    const result = await run(
      compileSearchSpec(
        searchPresets.peers(2),
        inputs({
          profile: convener,
          workers: [worker('peer-a'), worker('peer-b')],
          options: {
            runId: 'peers',
            wake: { debounceMs: 0 },
            makeLeafAgent: leaves(observed),
            driveHarness: scriptedRoot('convener', drive(), { spawns: ['peer-a', 'peer-b'] }),
          },
        }),
      ),
    )
    expect(result.kind).toBe('winner')
    expect([...observed.spawned].sort()).toEqual(['peer-a', 'peer-b'])
    expect(observed.mail).toHaveLength(2)
    for (const url of observed.mail) expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mail\//)
    expect(observed.mail[0]).not.toBe(observed.mail[1])
  })

  it('sla(2) re-enters a fresh advisor over leaf workers and records its digest', async () => {
    const advisor = testAgentProfile('advisor', {
      tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
    })
    const observed = observe()
    const driven = drive()
    const journal = new InMemorySpawnJournal()
    const compiled = compileSearchSpec(
      searchPresets.sla(2),
      inputs({
        profile: advisor,
        // No coordination entry: under any other select this worker could become a manager.
        workers: [testAgentProfile('w1'), testAgentProfile('w2')],
        options: {
          runId: 'sla',
          journal,
          wake: { debounceMs: 0 },
          makeLeafAgent: leaves(observed),
          driveHarness: scriptedRoot('advisor', driven, { spawns: ['w1', 'w2'] }),
        },
      }),
    )
    const result = await run(compiled)
    expect(result.kind).toBe('winner')
    expect([...observed.spawned].sort()).toEqual(['w1', 'w2'])
    // Only the advisor is a manager, every drive is told the session is fresh, and every
    // re-entry carries the coordinator's projection.
    expect(new Set(driven.managers)).toEqual(new Set(['advisor']))
    expect(driven.sessions.every((session) => session === 'fresh')).toBe(true)
    expect(driven.tasks.length).toBeGreaterThan(1)
    for (const task of driven.tasks.slice(1)) {
      expect(task).toContain('## Run state, from the coordinator')
    }
    // The digest is on the root's registration and on the settle record's tree.
    const events = (await journal.loadTree('sla')) ?? []
    const registered = events.find(
      (event): event is Extract<SpawnEvent, { kind: 'spawned' }> =>
        event.kind === 'spawned' && event.id === 'sla',
    )
    expect(registered?.identity?.correlation?.[SEARCH_SPEC_CORRELATION_KEY]).toBe(compiled.digest)
    const rootNode = result.tree.nodes.find((node) => node.id === result.tree.root)
    expect(rootNode?.identity?.correlation?.[SEARCH_SPEC_CORRELATION_KEY]).toBe(compiled.digest)
  })
})

describe('SearchSpec replay', () => {
  /** Strip wall-clock fields; every other journal field is a function of spec, inputs and decisions. */
  const normalized = (events: ReadonlyArray<SpawnEvent>): unknown =>
    JSON.parse(
      JSON.stringify(events, (key, value) =>
        key === 'at' || key === 'ms' || key.endsWith('At') ? undefined : value,
      ),
    )

  async function replay(): Promise<unknown> {
    const journal = new InMemorySpawnJournal()
    const advisor = testAgentProfile('advisor', {
      tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
    })
    // Recorded decisions: one assignment per turn, then the result.
    const decisions: Array<{ tool: string; args: unknown }> = [
      { tool: 'spawn_worker', args: { profile: 'w1', task: 'part 1' } },
      { tool: 'spawn_worker', args: { profile: 'w2', task: 'part 2' } },
      { tool: 'submit_result', args: { result: { answer: 42 } } },
    ]
    let turn = 0
    const result = await run(
      compileSearchSpec(
        searchPresets.sla(1),
        inputs({
          profile: advisor,
          deadline: 4_102_444_800_000,
          workers: [worker('w1'), worker('w2')],
          options: {
            runId: 'sla-replay',
            journal,
            wake: { debounceMs: 0 },
            makeLeafAgent: leaves(observe()),
            driveHarness: async ({ coordinationMcpUrl }) => {
              const decision = decisions[Math.min(turn, decisions.length - 1)]!
              turn += 1
              await call(coordinationMcpUrl, decision.tool, decision.args)
            },
          },
        }),
      ),
    )
    expect(result.kind).toBe('winner')
    return normalized((await journal.loadTree('sla-replay')) ?? [])
  }

  it('gives the same journal for the same spec, inputs and recorded decisions', async () => {
    const first = await replay()
    const second = await replay()
    expect(second).toEqual(first)
  })
})
