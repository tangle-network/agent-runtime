import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { SpawnEvent, SpawnJournal } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('retained external supervisor recovery', () => {
  it('reconnects the original manager and credential after partial accounting without another create or charge', async () => {
    const fixture = await setup('metered')
    await fixture.first()
    const before = await fixture.events()
    expect(
      before.some(
        (event) => event.kind === 'execution-admitted' && event.admission.phase === 'dispatched',
      ),
    ).toBe(true)
    expect(before.some((event) => event.kind === 'execution-result')).toBe(false)
    expect(tokenTotal(before)).toBe(5)
    await fixture.resume()
    const after = await fixture.events()
    expect(fixture.creates()).toBe(1)
    expect(tokenTotal(after)).toBe(5)
    expect(after.filter((event) => event.kind === 'execution-input')).toHaveLength(1)
    expect(after.filter((event) => event.kind === 'execution-result')).toHaveLength(1)
    expect(fixture.reconnections()).toBeGreaterThan(0)
    expect(fixture.authorizedRequests()).toBeGreaterThan(1)
  })

  it('reconciles a same-process driver retry against already committed usage', async () => {
    const fixture = await setup('metered', false, true)
    await fixture.first()
    const events = await fixture.events()
    expect(events.filter((event) => event.kind === 'execution-input')).toHaveLength(1)
    expect(events.filter((event) => event.kind === 'execution-result')).toHaveLength(1)
    expect(tokenTotal(events)).toBe(5)
    expect(fixture.creates()).toBe(1)
  })

  it('reuses accepted manager evidence after environment deletion without a new binding or inference', async () => {
    const fixture = await setup('settled')
    await fixture.first()
    const before = await fixture.events()
    expect(before.some((event) => event.kind === 'execution-result')).toBe(true)
    expect(JSON.parse(await readFile(fixture.stateFile, 'utf8')).environments).toEqual({})
    const bindings = before.filter((event) => event.kind === 'execution-bound')
    await fixture.resume()
    const after = await fixture.events()
    expect(fixture.creates()).toBe(1)
    expect(fixture.reconnections()).toBe(0)
    expect(after.filter((event) => event.kind === 'execution-bound')).toEqual(bindings)
    expect(tokenTotal(after)).toBe(5)
  })

  it('allocates distinct provider keys for a deliberate second manager drive', async () => {
    const fixture = await setup(undefined, true)
    await fixture.resume()
    const events = await fixture.events()
    const inputs = events.filter((event) => event.kind === 'execution-input')
    const intents = events.flatMap((event) =>
      event.kind === 'execution-admitted' && event.admission.phase === 'intent'
        ? [event.admission]
        : [],
    )
    expect(inputs).toHaveLength(2)
    expect(new Set(inputs.map((event) => event.seq)).size).toBe(2)
    expect(new Set(intents.map((intent) => intent.idempotencyKey)).size).toBe(2)
    expect(fixture.creates()).toBe(2)
    expect(tokenTotal(events)).toBe(10)
  })
})

function tokenTotal(events: SpawnEvent[]): number {
  return events.reduce(
    (sum, event) =>
      event.kind === 'metered' ? sum + event.spend.tokens.input + event.spend.tokens.output : sum,
    0,
  )
}

async function setup(loss?: 'metered' | 'settled', repeat = false, retry = false) {
  const directory = await mkdtemp(join(tmpdir(), 'retained-owner-'))
  directories.push(directory)
  const stateFile = join(directory, 'provider.json')
  const runDirectory = join(directory, 'run')
  const context = createFileRunContext(runDirectory)
  let creates = 0
  let reconnects = 0
  let authorizedRequests = 0
  let originalToken: string | undefined
  let port = 0
  let injected = false
  const profile = testAgentProfile('owner', {
    harness: 'codex',
    tools: runtimeToolDeclarations('stop'),
  })
  const requestOriginalCredential = async () => {
    if (!originalToken) throw new Error('missing original private credential')
    const response = await fetch(`http://127.0.0.1:${port}/manager`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${originalToken}`,
        Host: 'coordination.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(response.status).toBe(200)
    authorizedRequests++
  }
  const provider = (): AgentEnvironmentProvider => {
    const base = durableRetainedProvider(stateFile)
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      session: (id, options) => {
        const session = environment.session!(id, options)
        return {
          ...session,
          result: async () => ({
            ...(await session.result()),
            usage: { inputTokens: 3, outputTokens: 2 },
          }),
        }
      },
    })
    return {
      ...base,
      capabilities: async () => ({
        ...(await base.capabilities()),
        create: { runtimeAttachments: { mcp: true } },
      }),
      create: async (input) => {
        creates++
        originalToken ??= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN
        await requestOriginalCredential()
        expect(input.profile?.mcp?.['agent-runtime-coordination']).toBeUndefined()
        return wrap(await base.create(input))
      },
      get: async (id) => {
        reconnects++
        await requestOriginalCredential()
        const environment = await base.get!(id)
        return environment ? wrap(environment) : null
      },
    }
  }
  const run = async (interrupt: boolean) => {
    const current = createFileRunContext(runDirectory)
    const journal: SpawnJournal = {
      beginTree: current.journal.beginTree.bind(current.journal),
      loadTree: current.journal.loadTree.bind(current.journal),
      appendEvent: async (root, event) => {
        await current.journal.appendEvent(root, event)
        if (
          interrupt &&
          !injected &&
          loss === 'metered' &&
          event.kind === 'metered' &&
          event.spend.tokens.input > 0
        ) {
          injected = true
          throw new Error('test process lost after usage commit')
        }
      },
    }
    try {
      return await supervise(profile, 'Coordinate the work.', {
        runDir: runDirectory,
        journal,
        blobs: current.blobs,
        runId: 'owner-run',
        backend: { backend: 'provider', provider: provider() },
        budget: { maxIterations: 8, maxTokens: 100 },
        perWorker: { maxIterations: 1, maxTokens: 10 },
        driverRetry: retry
          ? { maxAttempts: 2, initialBackoffMs: 0, maxBackoffMs: 0 }
          : { enabled: false },
        finalizer: () => {
          if (interrupt && !injected && loss === 'settled') {
            injected = true
            throw new Error('test process lost after provider release')
          }
          return undefined
        },
        ...(repeat
          ? {
              repromptOnUnmet: 1,
              deliverable: { describe: 'A checked delivery', check: async () => false },
            }
          : {}),
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address) => {
            port = address.port
            return 'https://coordination.example/manager'
          },
        },
      })
    } catch (error) {
      if (!interrupt || !injected) throw error
      return undefined
    }
  }
  return {
    stateFile,
    creates: () => creates,
    reconnections: () => reconnects,
    authorizedRequests: () => authorizedRequests,
    events: async () => (await context.journal.loadTree('owner-run')) ?? [],
    first: async () => {
      await run(true)
      expect(injected).toBe(true)
      reconnects = 0
    },
    resume: () => run(false),
  }
}
