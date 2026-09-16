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
  it('reconstructs a reprompt interrupted after environment admission without a third dispatch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retained-owner-reprompt-crash-'))
    directories.push(directory)
    const stateFile = join(directory, 'provider.json')
    const runDirectory = join(directory, 'run')
    const context = createFileRunContext(runDirectory)
    let creates = 0
    let dispatches = 0
    let destroys = 0
    let failed = false
    let port = 0
    let token = ''
    const turns: AgentTurnInput[] = []
    const environmentIds: string[] = []
    const provider: AgentEnvironmentProvider = {
      ...durableRetainedProvider(stateFile),
      capabilities: async () => ({
        ...(await durableRetainedProvider(stateFile).capabilities()),
        create: { runtimeAttachments: { mcp: true } },
      }),
      create: async (input) => {
        creates++
        token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
        const environment = await durableRetainedProvider(stateFile).create(input)
        return wrap(environment)
      },
      get: async (id) => {
        const environment = await durableRetainedProvider(stateFile).get!(id)
        return environment ? wrap(environment) : null
      },
    }
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      session: (id, sessionOptions) => {
        const session = environment.session!(id, sessionOptions)
        return {
          ...session,
          result: async () => ({
            ...(await session.result()),
            usage:
              sessionOptions?.controlRef?.executionId === turns[1]?.executionId
                ? { inputTokens: 5, outputTokens: 5 }
                : { inputTokens: 0, outputTokens: 0 },
          }),
        }
      },
      dispatch: async (turn) => {
        dispatches++
        turns.push(turn)
        environmentIds.push(environment.id)
        const result = await environment.dispatch(turn)
        if (dispatches === 2) {
          const response = await fetch(`http://127.0.0.1:${port}/manager`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'resumed-final',
              method: 'tools/call',
              params: { name: 'submit_result', arguments: { result: { answer: 'resumed' } } },
            }),
          })
          if (!response.ok) throw new Error(`submit_result returned ${response.status}`)
        }
        return result
      },
      destroy: async () => {
        destroys++
        await environment.destroy?.()
      },
    })
    const profile = testAgentProfile('root', {
      harness: 'codex',
      tools: runtimeToolDeclarations('submit_result'),
    })
    const options = {
      runDir: runDirectory,
      runId: 'reprompt-crash-root',
      backend: { backend: 'provider' as const, provider },
      driverBackend: { backend: 'provider' as const, provider },
      budget: { maxIterations: 8, maxTokens: 100 },
      driverRetry: { enabled: false },
      repromptOnUnmet: 1,
      deliverable: {
        describe: 'resumed answer',
        check: (v: unknown) => (v as { answer?: string }).answer === 'resumed',
      },
      coordination: {
        authentication: {
          signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
        },
        publicUrl: (address: { port: number }) => {
          port = address.port
          return 'https://coordination.example/manager'
        },
      },
      journal: {
        beginTree: context.journal.beginTree.bind(context.journal),
        loadTree: context.journal.loadTree.bind(context.journal),
        appendEvent: async (root: string, event: SpawnEvent) => {
          await context.journal.appendEvent(root, event)
          if (
            !failed &&
            event.kind === 'execution-admitted' &&
            event.admission.phase === 'environment'
          ) {
            const prior = (await context.journal.loadTree(root)) ?? []
            if (
              prior.filter(
                (e) => e.kind === 'execution-admitted' && e.admission.phase === 'environment',
              ).length === 2
            ) {
              failed = true
              throw new Error('test crash after second environment admission')
            }
          }
        },
      },
      blobs: context.blobs,
    }
    const interrupted = await supervise(profile, 'answer', options)
    expect(interrupted).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
    const resumeAbort = new AbortController()
    const resumeTimer = setTimeout(() => resumeAbort.abort(new Error('resume timeout')), 5_000)
    const result = await supervise(profile, 'answer', {
      ...options,
      retainedAtSettlement: 'release',
      signal: resumeAbort.signal,
    })
    clearTimeout(resumeTimer)
    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'resumed' } })
    expect(creates).toBe(1)
    expect(dispatches).toBe(2)
    expect(new Set(turns.map((turn) => turn.sessionId)).size).toBe(1)
    expect(new Set(turns.map((turn) => turn.executionId)).size).toBe(2)
    expect(new Set(turns.map((turn) => turn.turnId)).size).toBe(2)
    expect(destroys).toBe(1)
    const events = (await context.journal.loadTree('reprompt-crash-root')) ?? []
    const environments = events.filter(
      (event) => event.kind === 'execution-admitted' && event.admission.phase === 'environment',
    )
    expect(environments).toHaveLength(2)
    const resumed = environments[1]
    expect(resumed?.kind === 'execution-admitted' ? resumed.admission : undefined).toMatchObject({
      environmentId: environmentIds[1],
      sessionId: turns[1]?.sessionId,
      executionId: turns[1]?.executionId,
    })
    expect(
      events.reduce(
        (total, event) =>
          event.kind === 'metered'
            ? total + event.spend.tokens.input + event.spend.tokens.output
            : total,
        0,
      ),
    ).toBe(10)
  })

  it.each(['release', 'keep', 'release-failed'] as const)(
    're-prompts one retained provider conversation with %s cleanup',
    async (cleanup) => {
      const directory = await mkdtemp(join(tmpdir(), 'retained-owner-reprompt-'))
      directories.push(directory)
      const stateFile = join(directory, 'provider.json')
      const runDirectory = join(directory, 'run')
      const context = createFileRunContext(runDirectory)
      let creates = 0
      let destroys = 0
      let coordinationPort = 0
      let coordinationToken = ''
      const turns: Array<{
        environmentId: string
        sessionId?: string
        executionId?: string
        turnId?: string
      }> = []
      let reprompt = 0
      const wrapEnvironment = (environment: AgentEnvironment): AgentEnvironment => ({
        ...environment,
        dispatch: async (turn) => {
          turns.push({
            environmentId: environment.id,
            sessionId: turn.sessionId,
            executionId: turn.executionId,
            turnId: turn.turnId,
          })
          const dispatched = await environment.dispatch(turn)
          reprompt++
          if (reprompt === 3) {
            const response = await fetch(`http://127.0.0.1:${coordinationPort}/manager`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${coordinationToken}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'final-submission',
                method: 'tools/call',
                params: {
                  name: 'submit_result',
                  arguments: { result: { answer: 'final reprompt' } },
                },
              }),
            })
            if (!response.ok) throw new Error(`submit_result returned ${response.status}`)
          }
          return dispatched
        },
        destroy: async () => {
          destroys++
          if (cleanup === 'release-failed') throw new Error('provider cleanup unavailable')
          await environment.destroy?.()
        },
      })

      const provider: AgentEnvironmentProvider = {
        ...durableRetainedProvider(stateFile),
        capabilities: async () => ({
          ...(await durableRetainedProvider(stateFile).capabilities()),
          create: { runtimeAttachments: { mcp: true } },
        }),
        create: async (input) => {
          creates++
          coordinationToken ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
          const base = durableRetainedProvider(stateFile)
          const environment = await base.create(input)
          return wrapEnvironment(environment)
        },
        get: async (id) => {
          const base = durableRetainedProvider(stateFile)
          const environment = await base.get!(id)
          if (!environment) return null
          return wrapEnvironment(environment)
        },
      }

      const result = await supervise(
        testAgentProfile('root', {
          harness: 'codex',
          tools: runtimeToolDeclarations('submit_result'),
        }),
        'Produce the answer.',
        {
          runDir: runDirectory,
          journal: context.journal,
          blobs: context.blobs,
          runId: 'reprompt-root',
          backend: { backend: 'provider', provider },
          driverBackend: { backend: 'provider', provider },
          budget: { maxIterations: 8, maxTokens: 100 },
          driverRetry: { enabled: false },
          repromptOnUnmet: 2,
          retainedAtSettlement: cleanup === 'keep' ? 'keep' : 'release',
          deliverable: {
            describe: 'an answer from the final reprompt',
            check: (value) => (value as { answer?: unknown }).answer === 'final reprompt',
          },
          coordination: {
            authentication: {
              signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
            },
            publicUrl: (address) => {
              coordinationPort = address.port
              return `https://coordination.example:${address.port}/manager`
            },
          },
        },
      )

      expect(creates).toBe(1)
      expect(result.kind).toBe('winner')
      expect(result).toMatchObject({ out: { answer: 'final reprompt' } })
      expect(turns).toHaveLength(3)
      expect(new Set(turns.map((turn) => turn.environmentId)).size).toBe(1)
      expect(turns.every((turn) => turn.sessionId !== undefined)).toBe(true)
      expect(new Set(turns.map((turn) => turn.sessionId)).size).toBe(1)
      expect(turns.every((turn) => turn.executionId !== undefined)).toBe(true)
      expect(new Set(turns.map((turn) => turn.executionId)).size).toBe(3)
      expect(turns.every((turn) => turn.turnId !== undefined)).toBe(true)
      expect(new Set(turns.map((turn) => turn.turnId)).size).toBe(3)
      expect(destroys).toBe(cleanup === 'keep' ? 0 : 1)
      const events = (await context.journal.loadTree('reprompt-root')) ?? []
      expect(events.filter((event) => event.kind === 'execution-result')).toHaveLength(3)
      expect(events.filter((event) => event.kind === 'environment-teardown')).toMatchObject(
        cleanup === 'keep'
          ? []
          : [{ destroyed: cleanup === 'release', environmentId: turns[0]?.environmentId }],
      )
      if (cleanup === 'release-failed') {
        expect(result.teardownUnconfirmed).toEqual([
          { id: 'reprompt-root', label: 'scope owner', runtime: provider.name, status: 'done' },
        ])
        expect(events.filter((event) => event.kind === 'teardown-unconfirmed')).toHaveLength(1)
      } else {
        expect(result.teardownUnconfirmed).toBeUndefined()
      }
    },
  )

  it('keeps historical unclassified root usage incomplete when replay supplies a cache split', async () => {
    const fixture = await setup('metered', false, false, true)
    await fixture.first()
    await fixture.resume()
    const metered = (await fixture.events()).flatMap((event) =>
      event.kind === 'metered' ? [event.spend] : [],
    )
    expect(tokenTotal(await fixture.events())).toBe(5)
    expect(metered.reduce((total, spend) => total + (spend.tokens.cacheRead ?? 0), 0)).toBe(0)
    expect(metered.some((spend) => spend.tokens.cacheBreakdownKnown === false)).toBe(true)
    expect(fixture.creates()).toBe(1)
  })

  it.each(['metered', 'settled'] as const)(
    'retains the root cache split once after losing its %s acknowledgement',
    async (loss) => {
      const fixture = await setup(loss)
      await fixture.first()
      await fixture.resume()
      const metered = (await fixture.events()).flatMap((event) =>
        event.kind === 'metered' ? [event.spend] : [],
      )
      expect(metered.reduce((total, spend) => total + (spend.tokens.cacheRead ?? 0), 0)).toBe(1)
      expect(metered.reduce((total, spend) => total + (spend.tokens.cacheWrite ?? 0), 0)).toBe(1)
      expect(metered.reduce((total, spend) => total + (spend.tokens.freshInput ?? 0), 0)).toBe(1)
      expect(fixture.creates()).toBe(1)
    },
  )

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
    const provider = durableRetainedProvider(fixture.stateFile)
    for (const environment of await provider.list!()) {
      await (await provider.get!(environment.id))?.destroy?.()
    }
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
    expect(new Set(intents.map((intent) => intent.idempotencyKey)).size).toBe(1)
    expect(fixture.creates()).toBe(1)
    expect(tokenTotal(events)).toBe(10)
    // The second drive ran in the SAME environment. Its report must bind as known to the one
    // committed materialization. Before the provider stopped writing the environment id into the
    // plan, this second binding was unknown with reason invalid-executor-report: the id moved
    // materializationPlanDigest, the guard refused the receipt, and on the fleet every retry hit
    // the same wall (mech-interp-foundations-pi-20260914e, -20260915g, -20260915h, -20260915i).
    // This test ran green through all four of those runs because it never looked at the binding.
    const bindings = events.flatMap((event) =>
      event.kind === 'execution-bound' ? [event.binding.status] : [],
    )
    expect(bindings).toEqual(['known', 'known'])
    expect(events.filter((event) => event.kind === 'materialized')).toHaveLength(1)
  })
})

function tokenTotal(events: SpawnEvent[]): number {
  return events.reduce(
    (sum, event) =>
      event.kind === 'metered' ? sum + event.spend.tokens.input + event.spend.tokens.output : sum,
    0,
  )
}

async function setup(
  loss?: 'metered' | 'settled',
  repeat = false,
  retry = false,
  historicalUnknown = false,
) {
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
            usage: {
              inputTokens: 3,
              outputTokens: 2,
              ...(historicalUnknown && !injected
                ? {}
                : { cacheReadInputTokens: 1, cacheCreationInputTokens: 1 }),
            },
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
