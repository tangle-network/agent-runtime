import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../../src/errors'
import type { DeliverableSpec } from '../../src/runtime/supervise/completion-gate'
import type { SupervisorFinalizer } from '../../src/runtime/supervise/finalizer'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import {
  type SuperviseRegistryTable,
  supervise,
  workerFromBackend,
} from '../../src/runtime/supervise/supervise'
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

/** A registry table over a plain record — the resolver port every `opts.registry` entry speaks. */
function table<T>(entries: Record<string, T>): SuperviseRegistryTable<T> {
  const map = new Map(Object.entries(entries))
  return { resolve: (name) => map.get(name) }
}

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

describe('supervise — the one-call convenience (defaults blobs/perWorker/journal/executors)', () => {
  it('runs a supervisor to delivery from just profile + task + worker seam + brain + budget', async () => {
    const brain = scriptedBrain([
      {
        toolCalls: [
          { name: 'spawn_agent', arguments: { profile: { kind: 'worker' }, task: 'go' } },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    const result = await supervise(
      { name: 'root', harness: null, systemPrompt: 'drive the worker' },
      'solve it',
      { budget, makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }), brain },
    )
    expect(result.kind).toBe('winner')
  })

  it('threads the independent check to direct supervisor submissions', async () => {
    const brain = scriptedBrain([
      { toolCalls: [{ name: 'submit_result', arguments: { result: { answer: 42 } } }] },
      { content: 'must not need another turn' },
    ])
    const result = await supervise(
      { name: 'root', harness: null, systemPrompt: 'solve or delegate' },
      'solve it directly',
      {
        budget,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        brain,
        deliverable: {
          describe: 'an object whose answer is 42',
          check: (value) => (value as { answer?: unknown }).answer === 42,
        },
      },
    )

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
  })

  it('runDir makes the run durable and resumable; unset stays in-memory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supervise-rundir-'))
    try {
      const script = () =>
        scriptedBrain([
          {
            toolCalls: [
              { name: 'spawn_agent', arguments: { profile: { kind: 'worker' }, task: 'go' } },
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

      const first = await supervise({ name: 'root', harness: null }, 'solve it', {
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
      const second = await supervise({ name: 'root', harness: null }, 'solve it', {
        ...opts,
        brain: script(),
      })
      expect(second.kind).toBe('winner')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('workerFromBackend builds a spawnable worker leaf with an executor (no network)', () => {
    const make = workerFromBackend({
      backend: 'router-tools',
      routerBaseUrl: 'http://localhost',
      routerKey: 'k',
      model: 'm',
    } as ExecutorConfig)
    const w = make({ name: 'w' }) as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    expect(w.name).toBe('w')
    expect(w.executorSpec.executor).toBeDefined()
  })

  it('fails loud with neither backend nor makeWorkerAgent', () => {
    expect(() => supervise({ name: 'r', harness: null }, 't', { budget })).toThrow(
      /backend|makeWorkerAgent/,
    )
  })

  it('allowedModels rejects a profile model outside the allowed set', () => {
    expect(() =>
      supervise({ name: 'r', harness: null, model: 'gpt-4.1' }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        allowedModels: ['deepseek-v4-flash'],
      }),
    ).toThrow(/gpt-4\.1.*not in the allowed set/)
  })

  it('allowedModels rejects a router model outside the allowed set', () => {
    expect(() =>
      supervise({ name: 'r', harness: null }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        router: { routerBaseUrl: 'http://localhost', routerKey: 'k', model: 'gpt-4.1' },
        allowedModels: ['deepseek-v4-flash'],
      }),
    ).toThrow(/gpt-4\.1.*not in the allowed set/)
  })

  it('allowedModels rejects a backend model outside the allowed set', () => {
    expect(() =>
      supervise({ name: 'r', harness: null }, 't', {
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
    const brain = scriptedBrain([{ content: 'done' }])
    const result = await supervise(
      { name: 'root', harness: null, model: 'deepseek-v4-flash' },
      't',
      {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', { answer: 1 }),
        brain,
        allowedModels: ['deepseek-v4-flash'],
      },
    )
    expect(result.kind).toBeDefined()
  })

  it('allowedModels unset is unrestricted (any model passes)', async () => {
    const brain = scriptedBrain([{ content: 'done' }])
    const result = await supervise({ name: 'root', harness: null, model: 'anything' }, 't', {
      budget,
      makeWorkerAgent: () => deliveringLeaf('w', { answer: 1 }),
      brain,
    })
    expect(result.kind).toBeDefined()
  })

  it('allowedModels reads a canonical AgentProfile model through its resolved default id', () => {
    expect(() =>
      supervise({ name: 'r', harness: null, model: { default: 'gpt-4.1' } }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        allowedModels: ['deepseek-v4-flash'],
      }),
    ).toThrow(/gpt-4\.1.*not in the allowed set/)
  })
})

describe('supervise — a canonical AgentProfile root reaches the router as a model ID', () => {
  it("sends the model hints' default id, not the hints object, to the router", async () => {
    const sentModels: unknown[] = []
    // The offline seam (RouterConfig.complete): the real routerBrain path runs, no network.
    const result = await supervise(
      {
        name: 'root',
        harness: null,
        model: { default: 'anthropic/claude-opus-5', reasoningEffort: 'high' },
        prompt: { systemPrompt: 'delegate, do not solve' },
      },
      'solve it',
      {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
        router: {
          routerBaseUrl: 'http://router.invalid',
          routerKey: 'k',
          model: 'config-fallback-model',
          complete: async (body) => {
            sentModels.push(body.model)
            return { choices: [{ message: { content: 'done' } }] }
          },
        },
      },
    )
    expect(result.kind).toBeDefined()
    expect(sentModels).toEqual(['anthropic/claude-opus-5'])
  })

  it('sends the instruction lines to the router inside the system message', async () => {
    const systemMessages: unknown[] = []
    await supervise(
      {
        name: 'root',
        harness: null,
        prompt: { systemPrompt: 'delegate, do not solve', instructions: ['keep it small'] },
        resources: { instructions: 'prefer the fewest workers' },
      },
      'solve it',
      {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        router: {
          routerBaseUrl: 'http://router.invalid',
          routerKey: 'k',
          model: 'm',
          complete: async (body) => {
            const messages = body.messages as Array<{ role: string; content: unknown }>
            systemMessages.push(messages.find((m) => m.role === 'system')?.content)
            return { choices: [{ message: { content: 'done' } }] }
          },
        },
      },
    )
    expect(systemMessages[0]).toBe(
      'delegate, do not solve\nkeep it small\nprefer the fewest workers',
    )
  })

  it("keeps the router config's model when the profile's hints resolve to no id", async () => {
    const sentModels: unknown[] = []
    // `AgentProfileModelHints.default` is optional upstream — this profile passes
    // `agentProfileSchema.safeParse`, so it must RUN, not be rejected.
    const result = await supervise(
      { name: 'root', harness: null, model: { provider: 'anthropic', small: 'cheap' } },
      'solve it',
      {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        router: {
          routerBaseUrl: 'http://router.invalid',
          routerKey: 'k',
          model: 'config-fallback-model',
          complete: async (body) => {
            sentModels.push(body.model)
            return { choices: [{ message: { content: 'done' } }] }
          },
        },
      },
    )
    expect(result.kind).toBeDefined()
    expect(sentModels).toEqual(['config-fallback-model'])
  })

  it("keeps the router config's own model when the profile names none", async () => {
    const sentModels: unknown[] = []
    await supervise({ name: 'root', harness: null }, 'solve it', {
      budget,
      makeWorkerAgent: () => deliveringLeaf('w', {}),
      router: {
        routerBaseUrl: 'http://router.invalid',
        routerKey: 'k',
        model: 'config-fallback-model',
        complete: async (body) => {
          sentModels.push(body.model)
          return { choices: [{ message: { content: 'done' } }] }
        },
      },
    })
    expect(sentModels).toEqual(['config-fallback-model'])
  })
})

describe('supervise — the code-valued options are nameable, so a run configuration can carry them', () => {
  const spawnAwaitStop = () =>
    scriptedBrain([
      { toolCalls: [{ name: 'spawn_agent', arguments: { profile: {}, task: 'go' } }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])

  it('a NAMED deliverable registers submit_result and gates the direct submission', async () => {
    const brain = scriptedBrain([
      { toolCalls: [{ name: 'submit_result', arguments: { result: { answer: 42 } } }] },
      { content: 'must not need another turn' },
    ])
    const result = await supervise({ name: 'root', harness: null }, 'solve it directly', {
      budget,
      makeWorkerAgent: () => deliveringLeaf('unused', {}),
      brain,
      deliverable: 'answer-is-42',
      registry: {
        deliverables: table({
          'answer-is-42': { check: (v) => (v as { answer?: unknown }).answer === 42 },
        }),
      },
    })
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
  })

  it('a NAMED finalizer decides the run output', async () => {
    const result = await supervise({ name: 'root', harness: null }, 'solve it', {
      budget,
      makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
      brain: spawnAwaitStop(),
      finalizer: 'count-delivered',
      registry: {
        finalizers: table({
          'count-delivered': (ctx) => ({ deliveredCount: ctx.delivered.length }),
        }),
      },
    })
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ deliveredCount: 1 })
  })

  it('a registry TYPO is a ConfigError naming the option, the name, and the table', () => {
    expect(() =>
      supervise({ name: 'root', harness: null }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        deliverable: 'answer-is-43',
        registry: { deliverables: table({ 'answer-is-42': { check: () => true } }) },
      }),
    ).toThrow(ConfigError)
    expect(() =>
      supervise({ name: 'root', harness: null }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        deliverable: 'answer-is-43',
        registry: { deliverables: table({ 'answer-is-42': { check: () => true } }) },
      }),
    ).toThrow(/opts\.deliverable = "answer-is-43" is not in opts\.registry\.deliverables/)
  })

  it('a name with no registry for that option fails loud saying so', () => {
    expect(() =>
      supervise({ name: 'root', harness: null }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        finalizer: 'count-delivered',
      }),
    ).toThrow(/opts\.finalizer = "count-delivered".*no opts\.registry\.finalizers/s)
  })

  it('names the probes option in its own resolution failure', () => {
    expect(() =>
      supervise({ name: 'root', harness: null }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        probes: 'file-exists',
        registry: { probes: table({ 'dir-exists': { resolve: () => undefined } }) },
      }),
    ).toThrow(/opts\.probes = "file-exists" is not in opts\.registry\.probes/)
  })

  it('a registry table is a resolver PORT: it is asked only for the names a run uses', async () => {
    const asked: string[] = []
    const lazy: SuperviseRegistryTable<SupervisorFinalizer> = {
      resolve: (name) => {
        asked.push(name)
        return name === 'count-delivered'
          ? (ctx) => ({ deliveredCount: ctx.delivered.length })
          : undefined
      },
    }
    const deliverables: SuperviseRegistryTable<DeliverableSpec<unknown>> = {
      resolve: (name) => {
        asked.push(`deliverable:${name}`)
        return { check: () => true }
      },
    }
    const result = await supervise({ name: 'root', harness: null }, 'solve it', {
      budget,
      makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
      brain: spawnAwaitStop(),
      finalizer: 'count-delivered',
      registry: { finalizers: lazy, deliverables },
    })
    expect(result.kind === 'winner' ? result.out : null).toEqual({ deliveredCount: 1 })
    // The deliverables table was never consulted: `opts.deliverable` named nothing, so nothing
    // in it was constructed or resolved.
    expect(asked).toEqual(['count-delivered'])
  })

  it('a non-string option value is untouched (existing callers keep passing values)', async () => {
    const result = await supervise({ name: 'root', harness: null }, 'solve it', {
      budget,
      makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
      brain: spawnAwaitStop(),
      finalizer: (ctx) => ({ deliveredCount: ctx.delivered.length }),
    })
    expect(result.kind === 'winner' ? result.out : null).toEqual({ deliveredCount: 1 })
  })
})

describe('supervise — the coordination bind is opt-in and fails closed off loopback', () => {
  const harnessOpts = {
    budget,
    makeWorkerAgent: () => deliveringLeaf('w', {}),
    driveHarness: async () => {},
  }

  it('refuses a non-loopback coordination host with no acknowledgment', () => {
    expect(() =>
      supervise({ name: 'root', harness: 'opencode' }, 't', {
        ...harnessOpts,
        coordination: { host: '10.0.0.7', port: 8931 },
      }),
    ).toThrow(/not a loopback address.*allowUnauthenticatedRemote/s)
  })

  it('passes an acknowledged non-loopback bind through to the coordination server', async () => {
    let url = ''
    await supervise({ name: 'root', harness: 'opencode' }, 't', {
      ...harnessOpts,
      driveHarness: async ({ coordinationMcpUrl }) => {
        url = coordinationMcpUrl
      },
      coordination: { host: '0.0.0.0', allowUnauthenticatedRemote: true },
    })
    expect(url).toMatch(/^http:\/\/0\.0\.0\.0:\d+\/mcp$/)
  })

  it('binds the requested loopback host with no acknowledgment needed', async () => {
    let url = ''
    await supervise({ name: 'root', harness: 'opencode' }, 't', {
      ...harnessOpts,
      driveHarness: async ({ coordinationMcpUrl }) => {
        url = coordinationMcpUrl
      },
      coordination: { host: '127.0.0.1' },
    })
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })
})
