import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { ConfigError } from '../../src/errors'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import {
  type DriveHarness,
  defaultSupervisorPrompt,
  resolveSupervisorProfile,
  type SupervisorProfile,
  supervisorAgent,
} from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { scriptedBrain } from './scripted-brain'

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

// A real delivering leaf — NOT a mock of the spawn path; HTTP→MCP→Scope.spawn→settle is real.
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

async function jsonRpc(url: string, method: string, params: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return r.json()
}

function runSupervisor(
  root: Agent<unknown, unknown>,
  blobs: InMemoryResultBlobStore,
  journal: InMemorySpawnJournal,
) {
  return createSupervisor<unknown, unknown>().run(root, 'solve it', {
    budget: { maxIterations: 100, maxTokens: 100_000 },
    runId: 'sup',
    journal,
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => 0,
  })
}

describe('supervisorAgent — the brain is resolved from profile.harness (backend-as-data)', () => {
  it('ROUTER arm (harness null): the in-process tool-loop drives a worker to delivery', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const worker = deliveringLeaf('w', { answer: 42 })
    // A scripted brain stands in for routerBrain (no creds): spawn → await → stop.
    const brain = scriptedBrain([
      {
        toolCalls: [
          { name: 'spawn_agent', arguments: { profile: { kind: 'worker' }, task: 'go' } },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    const root = supervisorAgent(
      { name: 'root', harness: null, systemPrompt: 'drive the worker' },
      { brain, blobs, makeWorkerAgent: () => worker, perWorker, maxTurns: 8 },
    )
    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
  })

  it('SANDBOX arm (harness=opencode): a sandboxed harness drives the verbs over the live MCP', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    // The stub harness drives the coordination MCP over REAL HTTP — exactly what an in-box
    // opencode/claude-code supervisor does via mcp.mcpServers. No router brain, no hand-built loop.
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'spawn_agent',
        arguments: { profile: {}, task: 'go' },
      })
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'await_event', arguments: {} })
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
    }
    const root = supervisorAgent(
      { name: 'sup', harness: 'opencode', systemPrompt: 'delegate, do not solve' },
      { blobs, makeWorkerAgent: () => deliveringLeaf('w', { answer: 7 }), perWorker, driveHarness },
    )
    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
  })

  it('SANDBOX arm retains a checked direct result even when the backend exits with an error afterward', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'submit_result',
        arguments: { result: { answer: 42 } },
      })
      throw new Error('backend exited after submission')
    }
    const root = supervisorAgent(
      { name: 'sup', harness: 'pi', systemPrompt: 'solve or delegate' },
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driveHarness,
        deliverable: {
          describe: 'an object whose answer is 42',
          check: (result) => (result as { answer?: unknown }).answer === 42,
        },
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
  })

  it('fails loud when a sandboxed-harness supervisor has no driveHarness substrate', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(
        { name: 'sup', harness: 'opencode' },
        { blobs, makeWorkerAgent: () => deliveringLeaf('w', {}), perWorker },
      ),
    ).toThrow(/driveHarness/)
  })

  it('fails loud when a router-brained supervisor has neither a brain nor a router config', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(
        { name: 'root', harness: null },
        { blobs, makeWorkerAgent: () => deliveringLeaf('w', {}), perWorker },
      ),
    ).toThrow(/router/)
  })
})

describe('resolveSupervisorProfile — a canonical AgentProfile IS a supervisor profile', () => {
  it('reduces a canonical AgentProfile: model.default is the id, prompt.systemPrompt is the prompt', () => {
    const profile: AgentProfile = {
      name: 'root',
      harness: 'claude-code',
      model: { default: 'anthropic/claude-opus-5', small: 'anthropic/claude-haiku-5' },
      prompt: { systemPrompt: 'delegate, do not solve' },
    }
    expect(resolveSupervisorProfile(profile)).toEqual({
      name: 'root',
      harness: 'claude-code',
      modelId: 'anthropic/claude-opus-5',
      systemPrompt: 'delegate, do not solve',
    })
  })

  it('takes the hints default as the id and defaults name/harness (no reasoningEffort field)', () => {
    expect(resolveSupervisorProfile({ model: { default: 'm', reasoningEffort: 'xhigh' } })).toEqual(
      {
        name: 'supervisor',
        harness: null,
        modelId: 'm',
      },
    )
  })

  it('leaves a plain string model and a top-level systemPrompt exactly as given', () => {
    expect(resolveSupervisorProfile({ name: 'r', model: 'gpt-5.4', systemPrompt: 'go' })).toEqual({
      name: 'r',
      harness: null,
      modelId: 'gpt-5.4',
      systemPrompt: 'go',
    })
  })

  it('accepts two IDENTICAL spellings of the same system prompt', () => {
    expect(
      resolveSupervisorProfile({ prompt: { systemPrompt: 'same' }, systemPrompt: 'same' })
        .systemPrompt,
    ).toBe('same')
  })

  it('fails loud when prompt.systemPrompt and systemPrompt disagree, naming both values', () => {
    expect(() =>
      resolveSupervisorProfile({
        prompt: { systemPrompt: 'from the prompt block' },
        systemPrompt: 'from the top level',
      }),
    ).toThrow(/prompt\.systemPrompt.*from the prompt block.*systemPrompt.*from the top level/s)
  })

  // `AgentProfileModelHints.default` is OPTIONAL in the canonical schema — `{ provider: 'anthropic' }`
  // is a profile the schema accepts — so hints with no id name NO model, which is the documented
  // "the router config's model applies" case, not a fault.
  it('resolves hints with no usable default to no model id at all', () => {
    expect(resolveSupervisorProfile({ model: { small: 'cheap' } })).toEqual({
      name: 'supervisor',
      harness: null,
    })
    expect(resolveSupervisorProfile({ model: { provider: 'anthropic' } }).modelId).toBeUndefined()
    expect(resolveSupervisorProfile({ model: { default: '' } }).modelId).toBeUndefined()
  })

  it('appends prompt.instructions and resources.instructions to the system prompt, in that order', () => {
    expect(
      resolveSupervisorProfile({
        prompt: { systemPrompt: 'delegate, do not solve', instructions: ['one', 'two'] },
        resources: { instructions: 'from resources' },
      }).systemPrompt,
    ).toBe('delegate, do not solve\none\ntwo\nfrom resources')
  })

  it('reads an INLINE resources.instructions resource as its content', () => {
    expect(
      resolveSupervisorProfile({
        systemPrompt: 'base',
        resources: { instructions: { kind: 'inline', name: 'memory', content: 'learned: X' } },
      }).systemPrompt,
    ).toBe('base\nlearned: X')
  })

  it('resolves instruction lines even when no system prompt is named', () => {
    expect(resolveSupervisorProfile({ prompt: { instructions: ['only this'] } }).systemPrompt).toBe(
      'only this',
    )
  })

  it('fails loud on a github resources.instructions reference it cannot fetch', () => {
    expect(() =>
      resolveSupervisorProfile({
        resources: { instructions: { kind: 'github', path: 'docs/INSTRUCTIONS.md' } },
      }),
    ).toThrow(/github resource reference.*docs\/INSTRUCTIONS\.md/s)
  })

  it('bounds the disagreeing-prompt message: lengths and excerpts, never two whole prompts', () => {
    const long = 'A'.repeat(4000)
    let message = ''
    try {
      resolveSupervisorProfile({ prompt: { systemPrompt: long }, systemPrompt: `${long}B` })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/4000 chars/)
    expect(message).toMatch(/4001 chars/)
    expect(message.length).toBeLessThan(400)
  })
})

describe('supervisorAgent — coordination bind + prompt hoisting on the harness arm', () => {
  it('SANDBOX arm hands the harness the resolved prompt BESIDE the profile, not hoisted onto it', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    // A canonical AgentProfile: the schema rejects unknown top-level keys, so a `systemPrompt`
    // hoisted onto this object would make the profile fail its own validator.
    const profile: AgentProfile = {
      name: 'sup',
      harness: 'opencode',
      prompt: { systemPrompt: 'delegate, do not solve', instructions: ['keep it small'] },
      resources: { instructions: 'prefer the fewest workers' },
    }
    let seen: SupervisorProfile | undefined
    let seenPrompt: string | undefined
    const driveHarness: DriveHarness = async (args) => {
      seen = args.profile
      seenPrompt = args.systemPrompt
    }
    const root = supervisorAgent(profile, {
      blobs,
      makeWorkerAgent: () => deliveringLeaf('w', {}),
      perWorker,
      driveHarness,
    })
    await runSupervisor(root, blobs, journal)
    expect(seen).toBe(profile)
    expect(seen).toEqual(profile)
    expect(Object.hasOwn(seen as object, 'systemPrompt')).toBe(false)
    expect(seenPrompt).toBe('delegate, do not solve\nkeep it small\nprefer the fewest workers')
  })

  it('SANDBOX arm builds and runs with a model the router could not resolve', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let ran = false
    const root = supervisorAgent(
      // Valid canonical profile: `model.default` is optional upstream.
      { name: 'sup', harness: 'opencode', model: { provider: 'anthropic' } },
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        driveHarness: async () => {
          ran = true
        },
      },
    )
    await runSupervisor(root, blobs, journal)
    expect(ran).toBe(true)
  })

  it("appends instruction lines to the arm's active prompt instead of replacing it", async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let seen: string | undefined
    // A profile that names ONLY instructions: the default standing prompt must survive, with
    // the lines appended to it.
    const root = supervisorAgent(
      { name: 'sup', harness: null, prompt: { instructions: ['never edit main'] } },
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        brain: async (messages) => {
          seen = messages.find((m) => m.role === 'system')?.content as string
          return { content: '', toolCalls: [] }
        },
      },
    )
    await runSupervisor(root, blobs, journal)
    expect(seen).toContain(defaultSupervisorPrompt)
    expect(seen?.endsWith('never edit main')).toBe(true)
  })

  it('leaves a harness supervisor with no prompt when its profile names none', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let seen: unknown = 'unset'
    // The harness carries its own standing prompt, so the router's default must NOT leak in.
    const root = supervisorAgent(
      { name: 'sup', harness: 'opencode' },
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        driveHarness: async (args: Parameters<DriveHarness>[0]) => {
          seen = args.systemPrompt
        },
      },
    )
    await runSupervisor(root, blobs, journal)
    expect(seen).toBeUndefined()
  })

  it('refuses a coordination binding on a router-brained supervisor', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(
        { name: 'sup', harness: null },
        {
          blobs,
          makeWorkerAgent: () => deliveringLeaf('w', {}),
          perWorker,
          brain: async () => ({ content: '', toolCalls: [] }),
          coordination: { host: '127.0.0.1' },
        },
      ),
    ).toThrow(ConfigError)
  })

  it('refuses a non-loopback coordination host with no acknowledgment (a ConfigError)', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(
        { name: 'sup', harness: 'opencode' },
        {
          blobs,
          makeWorkerAgent: () => deliveringLeaf('w', {}),
          perWorker,
          driveHarness: async () => {},
          coordination: { host: '0.0.0.0' },
        },
      ),
    ).toThrow(ConfigError)
  })

  it('checks the bind SNAPSHOT: mutating deps.coordination after build cannot change the host', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let url = ''
    const coordination: { host: string } = { host: '127.0.0.1' }
    const root = supervisorAgent(
      { name: 'sup', harness: 'opencode' },
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        driveHarness: async ({ coordinationMcpUrl }) => {
          url = coordinationMcpUrl
        },
        coordination,
      },
    )
    coordination.host = '0.0.0.0'
    await runSupervisor(root, blobs, journal)
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })

  it('refuses a non-loopback coordination host with no acknowledgment', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(
        { name: 'sup', harness: 'opencode' },
        {
          blobs,
          makeWorkerAgent: () => deliveringLeaf('w', {}),
          perWorker,
          driveHarness: async () => {},
          coordination: { host: '0.0.0.0' },
        },
      ),
    ).toThrow(/not a loopback address.*allowUnauthenticatedRemote/s)
  })

  it.each(['127.0.0.1', 'localhost', '::1', '[::1]'])(
    'accepts the loopback host %s with no acknowledgment',
    (host) => {
      const blobs = new InMemoryResultBlobStore()
      expect(() =>
        supervisorAgent(
          { name: 'sup', harness: 'opencode' },
          {
            blobs,
            makeWorkerAgent: () => deliveringLeaf('w', {}),
            perWorker,
            driveHarness: async () => {},
            coordination: { host },
          },
        ),
      ).not.toThrow()
    },
  )

  it('binds an acknowledged non-loopback host and hands the harness that URL', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let url = ''
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      url = coordinationMcpUrl
    }
    const root = supervisorAgent(
      { name: 'sup', harness: 'opencode' },
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        driveHarness,
        coordination: { host: '0.0.0.0', allowUnauthenticatedRemote: true },
      },
    )
    await runSupervisor(root, blobs, journal)
    expect(url).toMatch(/^http:\/\/0\.0\.0\.0:\d+\/mcp$/)
  })
})
