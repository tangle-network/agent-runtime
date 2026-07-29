import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { AgentEnvironmentProvider } from '../../src/runtime/environment-provider'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import {
  type SuperviseOptions,
  supervise,
  workerFromBackend,
} from '../../src/runtime/supervise/supervise'
import { createRootHandle } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { scriptedBrain } from './scripted-brain'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }

function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${name}`,
      out,
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: ex }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function failingLeaf(name: string, reason: string): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute: async () => {
      throw new Error(reason)
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    accounting: () => ({
      reported: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
      reservation: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
    }),
    resultArtifact: () => {
      throw new Error('a failed leaf has no terminal artifact')
    },
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: ex }
  return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

describe('supervise — the one-call convenience (defaults blobs/perWorker/journal/executors)', () => {
  it('runs a supervisor to delivery from just profile + task + worker seam + brain + budget', async () => {
    const brain = scriptedBrain([
      {
        toolCalls: [
          { name: 'spawn_agent', arguments: { profile: { name: 'worker' }, task: 'go' } },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    const result = await supervise(
      {
        name: 'root',
        harness: 'cli-base',
        prompt: { systemPrompt: 'drive the worker' },
      },
      'solve it',
      { budget, makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }), brain },
    )
    expect(result.kind).toBe('winner')
  })

  it('cascades the caller abort signal through the root and every live child', async () => {
    const controller = new AbortController()
    let started!: () => void
    const childStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let teardownCalled = false
    const blockedLeaf = (): Agent<unknown, unknown> => {
      const executor: Executor<unknown> = {
        runtime: 'blocked-test-worker',
        execute(_task, signal): Promise<ExecutorResult<unknown>> {
          started()
          return new Promise((_, reject) => {
            const abort = (): void => reject(new DOMException('aborted', 'AbortError'))
            if (signal.aborted) abort()
            else signal.addEventListener('abort', abort, { once: true })
          })
        },
        teardown: () => {
          teardownCalled = true
          return Promise.resolve({ destroyed: true })
        },
        resultArtifact: () => {
          throw new Error('an aborted worker has no terminal artifact')
        },
      }
      const spec: AgentSpec = {
        profile: { name: 'blocked-worker' } as AgentProfile,
        harness: null,
        executor,
      }
      return {
        name: 'blocked-worker',
        act: async () => undefined,
        executorSpec: spec,
      } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    }
    const running = supervise({ name: 'root', harness: 'cli-base' }, 'solve it', {
      budget,
      signal: controller.signal,
      makeWorkerAgent: blockedLeaf,
      brain: scriptedBrain([
        {
          toolCalls: [
            { name: 'spawn_agent', arguments: { profile: { name: 'worker' }, task: 'go' } },
          ],
        },
        { toolCalls: [{ name: 'await_event', arguments: {} }] },
      ]),
    })

    await childStarted
    controller.abort()
    const result = await running

    expect(result).toMatchObject({ kind: 'no-winner', reason: 'aborted' })
    expect(teardownCalled).toBe(true)
  })

  it('attaches a caller RootHandle and folds a live steer before the router manager next thinks', async () => {
    const handle = createRootHandle<unknown>()
    let entered!: () => void
    const firstTurnEntered = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const releaseFirstTurn = new Promise<void>((resolve) => {
      release = resolve
    })
    const seen: Array<ReadonlyArray<Record<string, unknown>>> = []
    let turn = 0
    const running = supervise({ name: 'root', harness: 'cli-base' }, 'solve it', {
      budget,
      rootHandle: handle,
      makeWorkerAgent: () => deliveringLeaf('unused', {}),
      brain: async (messages) => {
        seen.push(messages)
        turn += 1
        if (turn === 1) {
          entered()
          await releaseFirstTurn
          return {
            toolCalls: [{ id: 'list', name: 'list_questions', arguments: JSON.stringify({}) }],
          }
        }
        return { content: 'stopped after reading the steer', toolCalls: [] }
      },
    })

    await firstTurnEntered
    expect(handle.deliver({ junk: true })).toBe(false)
    expect(handle.deliver({ steer: 'also test the negative case', interrupt: false })).toBe(true)
    release()
    await running

    expect(seen).toHaveLength(2)
    expect(seen[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('also test the negative case'),
        }),
      ]),
    )
    expect(() => handle.deliver({ steer: 'after completion' })).toThrow()
  })

  it('runDir makes the run durable and resumable; unset stays in-memory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supervise-rundir-'))
    try {
      const script = () =>
        scriptedBrain([
          {
            toolCalls: [
              { name: 'spawn_agent', arguments: { profile: { name: 'worker' }, task: 'go' } },
            ],
          },
          { toolCalls: [{ name: 'await_event', arguments: {} }] },
          { content: 'done' },
        ])
      const opts = {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
        runId: 'durable-run',
        runDir: dir,
      }

      const first = await supervise({ name: 'root', harness: 'cli-base' }, 'solve it', {
        ...opts,
        brain: script(),
      })
      expect(first.kind).toBe('winner')

      // The journal really landed on disk with the settled child, not in a process-lifetime map.
      const journal = await readFile(join(dir, 'spawn-journal.jsonl'), 'utf8')
      const records = journal
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as { kind: string; event?: { kind: string } })
      expect(records[0]?.kind).toBe('begin')
      expect(records.some((r) => r.event?.kind === 'settled')).toBe(true)

      // A second `supervise()` against the SAME runDir + runId takes the resume path. Without the
      // `resume` flag threaded through, this would fail loud in `beginTree` ("already begun at …,
      // refusing to overwrite") because the wall-clock `at` differs between the two calls.
      const second = await supervise({ name: 'root', harness: 'cli-base' }, 'solve it', {
        ...opts,
        brain: script(),
      })
      expect(second.kind).toBe('winner')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('replays one durable settlement with the same event id after the observer commits but loses its acknowledgement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supervise-observer-retry-'))
    try {
      const writes = new Set<string>()
      let physicalWrites = 0
      let acknowledge = false
      let replayCommitted = false
      const observations: Array<{
        eventId: string
        seq: number
        at: number
        resumed: boolean
      }> = []
      const onCoordinationEvent: NonNullable<SuperviseOptions['onCoordinationEvent']> = async (
        _context,
        eventId,
        record,
      ) => {
        if (record.event.type !== 'settled') return
        observations.push({
          eventId,
          seq: record.seq,
          at: record.at,
          resumed: record.event.worker?.resumed === true,
        })
        if (!writes.has(eventId)) {
          writes.add(eventId)
          physicalWrites += 1
        }
        if (!acknowledge) throw new Error('observer commit succeeded; acknowledgement was lost')
        replayCommitted = true
      }
      const common = {
        budget,
        makeWorkerAgent: () => deliveringLeaf('worker', { answer: 42 }),
        runId: 'observer-retry',
        runDir: dir,
        onCoordinationEvent,
      }
      const first = await supervise({ name: 'root', harness: 'cli-base' }, 'solve it', {
        ...common,
        brain: scriptedBrain([
          {
            toolCalls: [
              { name: 'spawn_agent', arguments: { profile: { name: 'worker' }, task: 'go' } },
            ],
          },
          { toolCalls: [{ name: 'await_event', arguments: {} }] },
          { content: 'stop after the observer error' },
        ]),
      })
      expect(first.kind).toBe('no-winner')
      expect(physicalWrites).toBe(1)
      expect(observations.length).toBeGreaterThan(0)
      expect(new Set(observations.map((entry) => entry.eventId))).toHaveLength(1)

      acknowledge = true
      const replayScript = scriptedBrain([
        { toolCalls: [{ name: 'await_event', arguments: { kinds: ['settled'] } }] },
        { content: 'finish from committed work' },
      ])
      const replayBrain: typeof replayScript = async (...args) => {
        expect(replayCommitted).toBe(true)
        return replayScript(...args)
      }
      const second = await supervise({ name: 'root', harness: 'cli-base' }, 'solve it', {
        ...common,
        brain: replayBrain,
      })

      expect(second.kind).toBe('winner')
      expect(physicalWrites).toBe(1)
      expect(new Set(observations.map((entry) => entry.eventId))).toHaveLength(1)
      expect(observations.some((entry) => entry.resumed)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('gives two attempts of one keyed assignment distinct worker and event identities', async () => {
    let attempt = 0
    const events: Array<{ eventId: string; workerId: string; assignmentId?: string }> = []
    const result = await supervise({ name: 'root', harness: 'cli-base' }, 'retry once', {
      budget,
      makeWorkerAgent: () =>
        attempt++ === 0
          ? failingLeaf('same-worker', 'first attempt failed')
          : deliveringLeaf('same-worker', { answer: 42 }),
      brain: scriptedBrain([
        {
          toolCalls: [
            {
              name: 'spawn_agent',
              arguments: { profile: { name: 'same-worker' }, task: 'go', key: 'same-assignment' },
            },
          ],
        },
        { toolCalls: [{ name: 'await_event', arguments: { kinds: ['settled'] } }] },
        {
          toolCalls: [
            {
              name: 'spawn_agent',
              arguments: { profile: { name: 'same-worker' }, task: 'go', key: 'same-assignment' },
            },
          ],
        },
        { toolCalls: [{ name: 'await_event', arguments: { kinds: ['settled'] } }] },
        { content: 'done' },
      ]),
      onCoordinationEvent: (_context, eventId, record) => {
        if (record.event.type !== 'settled') return
        events.push({
          eventId,
          workerId: record.event.worker.id,
          assignmentId: record.event.worker.assignmentId,
        })
      },
    })

    expect(result.kind).toBe('winner')
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.assignmentId)).toEqual([
      'key:same-assignment',
      'key:same-assignment',
    ])
    expect(new Set(events.map((event) => event.workerId)).size).toBe(2)
    expect(new Set(events.map((event) => event.eventId)).size).toBe(2)
  })

  it('workerFromBackend builds a spawnable worker leaf with a deferred executor factory', () => {
    const make = workerFromBackend({
      backend: 'router-tools',
      routerBaseUrl: 'http://localhost',
      routerKey: 'k',
      model: 'm',
    } as ExecutorConfig)
    const w = make({ name: 'w' }) as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    expect(w.name).toBe('w')
    expect(w.executorSpec.executorFactory).toBeDefined()
    expect(w.executorSpec.executor).toBeUndefined()
  })

  it('workerFromBackend captures its reusable backend before callers can redirect it', () => {
    const backend: ExecutorConfig = {
      backend: 'router',
      routerBaseUrl: 'http://router.test',
      routerKey: 'key',
      model: 'safe-model',
    }
    const make = workerFromBackend(backend)
    const mutableBackend = backend as { backend: string }
    mutableBackend.backend = 'cli'
    const worker = make({ name: 'worker' }) as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
    const executor = worker.executorSpec.executorFactory?.(worker.executorSpec, {
      signal: new AbortController().signal,
      seams: {},
    })

    expect(executor?.runtime).toBe('router')
  })

  it('uses a provider backend runtime override for prepared workers', () => {
    const provider = {
      name: 'provider-default-runtime',
      capabilities: async () => ({}),
      create: async () => {
        throw new Error('provider must not start during executor construction')
      },
    } as AgentEnvironmentProvider
    const make = workerFromBackend(
      { backend: 'provider', provider, runtime: 'custom-provider-runtime' },
      undefined,
      async () => {
        throw new Error('preparation must not start during executor construction')
      },
    )
    const worker = make({ name: 'prepared-provider-worker' }) as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
    const executor = worker.executorSpec.executorFactory?.(worker.executorSpec, {
      signal: new AbortController().signal,
      node: {
        rootId: 'provider-root',
        parentId: 'provider-root',
        nodeId: 'provider-child',
        attemptId: 'provider-attempt',
      },
      seams: {},
    })

    expect(executor?.runtime).toBe('custom-provider-runtime')
  })

  it('workerFromBackend rejects post-identity profile overlays and shared execution ids', () => {
    const invalid: ExecutorConfig[] = [
      {
        backend: 'bridge',
        bridgeUrl: 'http://bridge.test',
        bridgeBearer: 'secret',
        model: 'model',
        agentProfile: { name: 'late-overlay' },
      },
      {
        backend: 'bridge',
        bridgeUrl: 'http://bridge.test',
        bridgeBearer: 'secret',
        model: 'model',
        sessionId: 'SHARED',
      },
      {
        backend: 'cli-worktree',
        repoRoot: '/repo',
        harness: 'codex',
        runId: 'SHARED',
      },
      {
        backend: 'cli-worktree',
        repoRoot: '/repo',
        bridge: {
          bridgeUrl: 'http://bridge.test',
          bridgeBearer: 'secret',
          model: 'model',
          sessionId: 'SHARED',
        },
      },
    ]

    for (const config of invalid) {
      expect(() => workerFromBackend(config)).toThrow(/not allowed|isolated id/)
    }
  })

  it('refuses profile behavior a limited backend would silently drop', () => {
    const routerWorker = workerFromBackend({
      backend: 'router',
      routerBaseUrl: 'http://localhost',
      routerKey: 'k',
      model: 'm',
    })
    expect(() =>
      routerWorker({
        name: 'rich-worker',
        model: { default: 'm', reasoningEffort: 'high' },
        tools: { shell: true },
      }),
    ).toThrow(/modelReasoningEffort, tools/)

    const rawCliWorker = workerFromBackend({ backend: 'cli', bin: '/bin/true' })
    expect(() =>
      rawCliWorker({ name: 'raw-cli', prompt: { systemPrompt: 'This used to be ignored.' } }),
    ).toThrow(/systemPrompt/)

    const localWorktreeWorker = workerFromBackend({
      backend: 'cli-worktree',
      repoRoot: '/workspace',
      harness: 'claude',
    })
    expect(() =>
      localWorktreeWorker({
        name: 'local-worktree',
        connections: [{ connectionId: 'github', capabilities: ['issues:read'] }],
      }),
    ).toThrow(/connections/)

    const bridgedWorktreeWorker = workerFromBackend({
      backend: 'cli-worktree',
      repoRoot: '/workspace',
      bridge: { bridgeUrl: 'http://localhost', bridgeBearer: 'secret', model: 'm' },
    })
    expect(() =>
      bridgedWorktreeWorker({
        name: 'bridged-worktree',
        connections: [{ connectionId: 'github', capabilities: ['issues:read'] }],
      }),
    ).not.toThrow()
  })

  it('refuses noncanonical or forged root identity before compute starts', () => {
    const makeWorkerAgent = () => deliveringLeaf('w', {})
    expect(() =>
      supervise(
        { name: 'root', harness: 'cli-base' },
        { value: 1n },
        {
          budget,
          makeWorkerAgent,
          brain: scriptedBrain([{ content: 'unused' }]),
        },
      ),
    ).toThrow(/canonical JSON/)
    expect(() =>
      supervise({ name: 'root', harness: 'cli-base' }, 'task', {
        budget,
        makeWorkerAgent,
        brain: scriptedBrain([{ content: 'unused' }]),
        execution: { candidateDigest: 'not-a-digest' as never },
      }),
    ).toThrow(/candidateDigest must be a sha256 digest/)
  })

  it('refuses an unsafe authored profile before reserving budget or starting a worker', async () => {
    const journal = new InMemorySpawnJournal()
    const brain = scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: {
              profile: {
                name: 'unsafe-worker',
                prompt: { systemPrompt: 'run the task' },
                hooks: { beforeTool: [{ command: 'curl https://example.test' }] },
              },
              task: 'go',
            },
          },
        ],
      },
      { content: 'profile was refused' },
    ])
    const result = await supervise({ name: 'root', harness: 'cli-base' }, 't', {
      budget,
      backend: {
        backend: 'bridge',
        bridgeUrl: 'http://127.0.0.1:1',
        bridgeBearer: 'unused',
        model: 'codex/test',
      },
      brain,
      journal,
      runId: 'unsafe-profile',
    })

    expect(result.kind).toBe('no-winner')
    const events = await journal.loadTree('unsafe-profile')
    expect(events?.filter((event) => event.kind === 'spawned').map((event) => event.id)).toEqual([
      'unsafe-profile',
    ])
  })

  it.each([
    {
      capability: 'remote MCP',
      profile: {
        name: 'remote-mcp-worker',
        mcp: {
          metadata: { transport: 'http' as const, url: 'http://169.254.169.254/latest/meta-data' },
        },
      },
    },
    {
      capability: 'hub connection',
      profile: {
        name: 'connected-worker',
        connections: [{ connectionId: 'private-mail', capabilities: ['read'] }],
      },
    },
  ])('fails closed on an authored $capability unless the caller grants it', async ({ profile }) => {
    const journal = new InMemorySpawnJournal()
    const brain = scriptedBrain([
      {
        toolCalls: [{ name: 'spawn_agent', arguments: { profile, task: 'go' } }],
      },
      { content: 'profile was refused' },
    ])

    const result = await supervise({ name: 'root', harness: 'cli-base' }, 't', {
      budget,
      backend: {
        backend: 'bridge',
        bridgeUrl: 'http://127.0.0.1:1',
        bridgeBearer: 'unused',
        model: 'codex/test',
      },
      brain,
      journal,
      runId: `unsafe-${profile.name}`,
    })

    expect(result.kind).toBe('no-winner')
    const events = await journal.loadTree(`unsafe-${profile.name}`)
    expect(events?.filter((event) => event.kind === 'spawned').map((event) => event.id)).toEqual([
      `unsafe-${profile.name}`,
    ])
  })

  it('fails loud with neither backend nor makeWorkerAgent', () => {
    expect(() => supervise({ name: 'r', harness: 'cli-base' }, 't', { budget })).toThrow(
      /backend|makeWorkerAgent/,
    )
  })

  it('refuses spawn authorization with a caller-owned worker factory before anything starts', async () => {
    const journal = new InMemorySpawnJournal()
    let factoryCalls = 0
    let brainCalls = 0
    let authorizationCalls = 0

    expect(() =>
      supervise({ name: 'r', harness: 'cli-base' }, 't', {
        budget,
        journal,
        runId: 'invalid-custom-authority',
        makeWorkerAgent: () => {
          factoryCalls += 1
          return deliveringLeaf('unused', {})
        },
        brain: async () => {
          brainCalls += 1
          return { toolCalls: [], content: 'unused' }
        },
        authorizeSpawn(input) {
          authorizationCalls += 1
          return { profile: input.profile }
        },
      }),
    ).toThrow(/authorizeSpawn cannot be combined with caller-owned makeWorkerAgent/)

    expect({ factoryCalls, brainCalls, authorizationCalls }).toEqual({
      factoryCalls: 0,
      brainCalls: 0,
      authorizationCalls: 0,
    })
    expect(await journal.loadTree('invalid-custom-authority')).toBeUndefined()
  })

  it('allowedModels rejects a profile model outside the allowed set', () => {
    expect(() =>
      supervise({ name: 'r', harness: 'cli-base', model: { default: 'gpt-4.1' } }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        allowedModels: ['deepseek-v4-flash'],
      }),
    ).toThrow(/gpt-4\.1.*not in the allowed set/)
  })

  it.each([
    {
      field: 'small model',
      profile: { model: { default: 'safe', small: 'unsafe-small' } },
      rejected: 'unsafe-small',
    },
    {
      field: 'subagent model',
      profile: { subagents: { critic: { model: 'unsafe-subagent' } } },
      rejected: 'unsafe-subagent',
    },
    {
      field: 'mode model',
      profile: { modes: { review: { model: 'unsafe-mode' } } },
      rejected: 'unsafe-mode',
    },
  ])('allowedModels rejects a hidden $field', ({ profile, rejected }) => {
    expect(() =>
      supervise({ name: 'r', harness: 'cli-base', ...profile }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        allowedModels: ['safe'],
      }),
    ).toThrow(new RegExp(`${rejected}.*not in the allowed set`))
  })

  it('refuses every backend profile overlay before it can bypass authorization', () => {
    expect(() =>
      supervise({ name: 'r', harness: 'cli-base', model: { default: 'safe' } }, 't', {
        budget,
        backend: {
          backend: 'bridge',
          bridgeUrl: 'http://127.0.0.1:1',
          bridgeBearer: 'unused',
          model: 'safe',
          agentProfile: { model: { default: 'unsafe-overlay' } },
        },
        allowedModels: ['safe'],
      }),
    ).toThrow(/backend agentProfile overlays are not allowed/)
  })

  it('refuses a fixed session id on the reusable driver backend', () => {
    expect(() =>
      supervise({ name: 'r', harness: 'codex' }, 't', {
        budget,
        backend: {
          backend: 'bridge',
          bridgeUrl: 'http://127.0.0.1:1',
          bridgeBearer: 'unused',
          model: 'worker-model',
        },
        driverBackend: {
          backend: 'bridge',
          bridgeUrl: 'http://127.0.0.1:1',
          bridgeBearer: 'unused',
          model: 'driver-model',
          sessionId: 'SHARED',
        },
      }),
    ).toThrow(/driveHarnessFromBackend: fixed sessionId.*isolated id/)
  })

  it('refuses an automatic external supervisor on a backend that cannot receive coordination tools', () => {
    expect(() =>
      supervise({ name: 'r', harness: 'codex' }, 't', {
        budget,
        backend: {
          backend: 'router-tools',
          routerBaseUrl: 'http://127.0.0.1:1',
          routerKey: 'unused',
          model: 'safe',
        },
      }),
    ).toThrow(/requires a local bridge driverBackend.*explicit driveHarness.*resolveDriveHarness/)
  })

  it('allowedModels rejects a router model outside the allowed set', () => {
    expect(() =>
      supervise({ name: 'r', harness: 'cli-base' }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        router: { routerBaseUrl: 'http://localhost', routerKey: 'k', model: 'gpt-4.1' },
        allowedModels: ['deepseek-v4-flash'],
      }),
    ).toThrow(/gpt-4\.1.*not in the allowed set/)
  })

  it('allowedModels rejects a backend model outside the allowed set', () => {
    expect(() =>
      supervise({ name: 'r', harness: 'cli-base' }, 't', {
        budget,
        backend: {
          backend: 'router-tools',
          routerBaseUrl: 'http://localhost',
          routerKey: 'k',
          model: 'gpt-4.1',
        } as ExecutorConfig,
        allowedModels: ['deepseek-v4-flash'],
      }),
    ).toThrow(/gpt-4\.1.*not in the allowed set/)
  })

  it('allowedModels passes when every configured model is in the set', async () => {
    const result = await supervise(
      {
        name: 'root',
        harness: 'cli-base',
        model: { default: 'deepseek-v4-flash' },
      },
      't',
      {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', { answer: 1 }),
        router: {
          routerBaseUrl: 'http://unused.test',
          routerKey: 'test',
          model: 'deepseek-v4-flash',
          complete: async () => ({ choices: [{ message: { content: 'done' } }] }),
        },
        allowedModels: ['deepseek-v4-flash'],
      },
    )
    expect(result.kind).toBeDefined()
  })

  it('allowedModels unset is unrestricted (any model passes)', async () => {
    const result = await supervise(
      { name: 'root', harness: 'cli-base', model: { default: 'anything' } },
      't',
      {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', { answer: 1 }),
        router: {
          routerBaseUrl: 'http://unused.test',
          routerKey: 'test',
          model: 'anything',
          complete: async () => ({ choices: [{ message: { content: 'done' } }] }),
        },
      },
    )
    expect(result.kind).toBeDefined()
  })
})
