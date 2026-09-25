import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-retry'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { SpawnEvent, SpawnJournal } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('retained external supervisor recovery', () => {
  it.each([1, 2] as const)(
    'recovers a continuation (maxBarren %s) after interrupted admission without a third dispatch',
    async (maxBarren) => {
      const directory = await mkdtemp(join(tmpdir(), 'retained-owner-reprompt-crash-'))
      directories.push(directory)
      const proxy = await coordinationProxy()
      proxies.push(proxy)
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
        budget: { maxIterations: 8, maxTokens: 100, deadlineMs: 60_000 },
        driverRetry: { enabled: false },
        continuation: testContinuation({ maxBarren }),
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
            proxy.forwardTo(port)
            return `${proxy.url}/manager`
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
    },
  )

  it.each([
    { cleanup: 'release', continuations: 2 },
    { cleanup: 'keep', continuations: 2 },
    { cleanup: 'release-failed', continuations: 2 },
    { cleanup: 'release', continuations: 3 },
  ] as const)(
    'continues one retained provider conversation with $cleanup cleanup and maxBarren $continuations',
    async ({ cleanup, continuations }) => {
      // The director submits on its third turn, inside every barren bound tested here.
      const expectedTurns = 3
      const directory = await mkdtemp(join(tmpdir(), 'retained-owner-reprompt-'))
      directories.push(directory)
      const proxy = await coordinationProxy()
      proxies.push(proxy)
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
          if (reprompt === expectedTurns) {
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
          budget: { maxIterations: 100, maxTokens: 1000, deadlineMs: 60_000 },
          driverRetry: { enabled: false },
          continuation: testContinuation({ maxBarren: continuations }),
          retainedAtSettlement: cleanup === 'keep' ? 'keep' : 'release',
          // One release, as the assertions below count it.
          teardownConfirmMs: 0,
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
              proxy.forwardTo(coordinationPort)
              return `${proxy.url}/manager`
            },
          },
        },
      )

      expect(creates).toBe(1)
      expect(result.kind).toBe('winner')
      expect(result).toMatchObject({ out: { answer: 'final reprompt' } })
      expect(turns).toHaveLength(expectedTurns)
      expect(new Set(turns.map((turn) => turn.environmentId)).size).toBe(1)
      expect(turns.every((turn) => turn.sessionId !== undefined)).toBe(true)
      expect(new Set(turns.map((turn) => turn.sessionId)).size).toBe(1)
      expect(turns.every((turn) => turn.executionId !== undefined)).toBe(true)
      expect(new Set(turns.map((turn) => turn.executionId)).size).toBe(expectedTurns)
      expect(turns.every((turn) => turn.turnId !== undefined)).toBe(true)
      expect(new Set(turns.map((turn) => turn.turnId)).size).toBe(expectedTurns)
      expect(destroys).toBe(cleanup === 'keep' ? 0 : 1)
      const events = (await context.journal.loadTree('reprompt-root')) ?? []
      expect(events.filter((event) => event.kind === 'execution-result')).toHaveLength(
        expectedTurns,
      )
      expect(events.filter((event) => event.kind === 'environment-teardown')).toMatchObject(
        cleanup === 'keep'
          ? []
          : [{ destroyed: cleanup === 'release', environmentId: turns[0]?.environmentId }],
      )
      if (cleanup === 'release-failed') {
        expect(result.teardownUnconfirmed).toEqual([
          {
            id: 'reprompt-root',
            label: 'scope owner',
            runtime: provider.name,
            status: 'done',
            environments: [{ provider: provider.name, environmentId: turns[0]?.environmentId }],
            detail: 'retained owner environment cleanup was not confirmed',
          },
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

  it('starts a new environment, told the objective, when the provider lost the one it was running in', async () => {
    // Autopsy A on the retained path. Before: the root's sandbox was deleted after it admitted a
    // turn, every retry asked the provider to reconnect to it, each was refused "retained provider
    // execution requires reconciliation before replacement", and the run ended driver-failed
    // (autopsy-a-before-20260924a). An environment the provider no longer holds runs nothing, so
    // the next drive is a new invocation in a new environment, and its task says why.
    const directory = await mkdtemp(join(tmpdir(), 'retained-owner-lost-'))
    directories.push(directory)
    const proxy = await coordinationProxy()
    proxies.push(proxy)
    const stateFile = join(directory, 'provider.json')
    const runDirectory = join(directory, 'run')
    const context = createFileRunContext(runDirectory)
    let creates = 0
    let port = 0
    let token = ''
    const prompts: string[] = []
    const environmentIds: string[] = []
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      dispatch: async (turn) => {
        prompts.push(String(turn.prompt ?? ''))
        environmentIds.push(environment.id)
        const dispatched = await environment.dispatch(turn)
        if (prompts.length === 1) {
          // The sandbox disappears after it admitted the turn.
          await environment.destroy?.()
          return dispatched
        }
        const response = await fetch(`http://127.0.0.1:${port}/manager`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'replacement-final',
            method: 'tools/call',
            params: { name: 'submit_result', arguments: { result: { answer: 'replaced' } } },
          }),
        })
        if (!response.ok) throw new Error(`submit_result returned ${response.status}`)
        return dispatched
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
        token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
        return wrap(await durableRetainedProvider(stateFile).create(input))
      },
      get: async (id) => {
        const environment = await durableRetainedProvider(stateFile).get!(id)
        return environment ? wrap(environment) : null
      },
    }
    const result = await supervise(
      testAgentProfile('root', {
        harness: 'codex',
        tools: runtimeToolDeclarations('submit_result'),
      }),
      'Answer the question from the holder.',
      {
        runDir: runDirectory,
        journal: context.journal,
        blobs: context.blobs,
        runId: 'lost-root',
        backend: { backend: 'provider', provider },
        driverBackend: { backend: 'provider', provider },
        budget: { maxIterations: 20, maxTokens: 1000, deadlineMs: 60_000 },
        driverRetry: { initialBackoffMs: 0, maxBackoffMs: 0 },
        continuation: testContinuation(),
        retainedAtSettlement: 'release',
        teardownConfirmMs: 0,
        deliverable: {
          describe: 'the replaced answer',
          check: (value) => (value as { answer?: unknown }).answer === 'replaced',
        },
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address) => {
            port = address.port
            proxy.forwardTo(port)
            return `${proxy.url}/manager`
          },
        },
      },
    )

    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'replaced' } })
    expect(creates).toBe(2)
    expect(new Set(environmentIds).size).toBe(2)
    expect(prompts[0]).toBe('Answer the question from the holder.')
    expect(prompts[1]).toContain('Answer the question from the holder.')
    expect(prompts[1]).toContain(`Your previous environment (${environmentIds[0]}) is gone`)
    expect(prompts[1]).toContain('the replaced answer')
    const events = (await context.journal.loadTree('lost-root')) ?? []
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'environment-teardown',
        environmentId: environmentIds[0],
        destroyed: true,
        detail: expect.stringMatching(/^lost:/u),
      }),
    )
    expect(events.filter((event) => event.kind === 'execution-input')).toHaveLength(2)
    expect(result.continuation).toMatchObject({
      attempts: 2,
      failureRetries: 1,
      reprompts: 0,
      environmentReplacements: 1,
      closedBy: 'result-accepted',
    })
  })

  it("restores the lost environment's workspace from its latest checkpoint", async () => {
    // Autopsy A, the files. After agent-runtime#1356 a director whose sandbox was deleted was
    // re-entered in a new one with the coordinator's state, but its files were gone: the new
    // director found no objective.md and wrote a new nonce (autopsy-a-after-20260924b). A
    // coordination call now checkpoints the workspace, and the replacement is created from it.
    const directory = await mkdtemp(join(tmpdir(), 'retained-owner-restore-'))
    directories.push(directory)
    const proxy = await coordinationProxy()
    proxies.push(proxy)
    const stateFile = join(directory, 'provider.json')
    const runDirectory = join(directory, 'run')
    const context = createFileRunContext(runDirectory)
    const files = new Map<string, Map<string, string>>()
    const filesOf = (id: string) => {
      const held = files.get(id) ?? new Map<string, string>()
      files.set(id, held)
      return held
    }
    const checkpoints = new Map<string, Map<string, string>>()
    const createInputs: Parameters<AgentEnvironmentProvider['create']>[0][] = []
    const environmentIds: string[] = []
    const prompts: string[] = []
    let port = 0
    let token = ''
    const callTool = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${port}/manager`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `${name}-${prompts.length}`,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      })
      if (!response.ok) throw new Error(`${name} returned ${response.status}`)
    }
    const journaled = async (kind: SpawnEvent['kind']) =>
      ((await context.journal.loadTree('restore-root')) ?? []).some((event) => event.kind === kind)
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      read: async (path) => {
        const content = filesOf(environment.id).get(path)
        if (content === undefined) throw new Error(`${path} does not exist`)
        return content
      },
      write: async (path, content) => {
        filesOf(environment.id).set(path, content)
      },
      workspaceBranching: {
        checkpoint: async (request) => {
          const checkpointId = `checkpoint-${checkpoints.size + 1}`
          checkpoints.set(checkpointId, new Map(filesOf(environment.id)))
          return {
            status: 'created',
            idempotencyKey: request.idempotencyKey,
            requestDigest: request.requestDigest,
            checkpoint: {
              checkpointId,
              provider: environment.provider,
              source: request.source,
              idempotencyKey: request.idempotencyKey,
              requestDigest: request.requestDigest,
              createdAt: new Date().toISOString(),
            },
          }
        },
        deleteCheckpoint: async (request) => ({ ...request, status: 'deleted' }),
        lookupCheckpoint: async () => {
          throw new Error('not used')
        },
        fork: async () => {
          throw new Error('not used')
        },
        lookupFork: async () => {
          throw new Error('not used')
        },
        destroyFork: async () => {
          throw new Error('not used')
        },
      },
      dispatch: async (turn) => {
        prompts.push(String(turn.prompt ?? ''))
        environmentIds.push(environment.id)
        const dispatched = await environment.dispatch!(turn)
        if (prompts.length === 2) {
          // The re-entered director reads the file its predecessor wrote and submits it.
          const objective = filesOf(environment.id).get('objective.md') ?? 'missing'
          await callTool('submit_result', { result: { answer: objective } })
        }
        return dispatched
      },
      session: (id, options) => {
        const session = environment.session!(id, options)
        if (prompts.length !== 1) return session
        return {
          ...session,
          // The first director writes its objective, makes one coordination call, and then its
          // sandbox is deleted mid-turn.
          async *events() {
            filesOf(environment.id).set('objective.md', 'nonce-first-turn')
            await callTool('read_journal', {})
            for (let waited = 0; !(await journaled('workspace-checkpoint')); waited += 10) {
              if (waited > 5_000) throw new Error('no workspace checkpoint was journaled')
              await new Promise((resolve) => setTimeout(resolve, 10))
            }
            await environment.destroy?.()
            throw new Error('Sandbox not found')
          },
        }
      },
    })
    const base = durableRetainedProvider(stateFile)
    const provider: AgentEnvironmentProvider = {
      ...base,
      capabilities: async () => ({
        ...(await base.capabilities()),
        create: { runtimeAttachments: { mcp: true }, workspaceCheckpoint: true },
      }),
      create: async (input) => {
        createInputs.push(input)
        token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
        const environment = await base.create(input)
        const checkpoint = input.workspace?.checkpoint
        if (checkpoint !== undefined) {
          files.set(environment.id, new Map(checkpoints.get(checkpoint.checkpointId)))
        }
        return wrap(environment)
      },
      get: async (id) => {
        const environment = await base.get!(id)
        return environment ? wrap(environment) : null
      },
    }
    const result = await supervise(
      testAgentProfile('root', {
        harness: 'codex',
        tools: runtimeToolDeclarations('submit_result', 'read_journal'),
      }),
      'Write objective.md, then submit its content.',
      {
        runDir: runDirectory,
        journal: context.journal,
        blobs: context.blobs,
        runId: 'restore-root',
        backend: { backend: 'provider', provider },
        driverBackend: { backend: 'provider', provider },
        budget: { maxIterations: 20, maxTokens: 1000, deadlineMs: 60_000 },
        driverRetry: { initialBackoffMs: 0, maxBackoffMs: 0 },
        continuation: testContinuation({ maxBarren: 2 }),
        retainedAtSettlement: 'release',
        teardownConfirmMs: 0,
        deliverable: {
          describe: 'the content of objective.md',
          check: (value) => (value as { answer?: unknown }).answer === 'nonce-first-turn',
        },
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address) => {
            port = address.port
            proxy.forwardTo(port)
            return `${proxy.url}/manager`
          },
        },
      },
    )

    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'nonce-first-turn' } })
    expect(createInputs).toHaveLength(2)
    expect(new Set(environmentIds).size).toBe(2)
    const events = (await context.journal.loadTree('restore-root')) ?? []
    const checkpoint = events.find((event) => event.kind === 'workspace-checkpoint')
    expect(checkpoint).toMatchObject({
      kind: 'workspace-checkpoint',
      environmentId: environmentIds[0],
      marker: { path: '.agent-runtime-checkpoint' },
    })
    if (checkpoint?.kind !== 'workspace-checkpoint') throw new Error('no checkpoint')
    expect(createInputs[0]?.workspace?.checkpoint).toBeUndefined()
    expect(createInputs[1]?.workspace?.checkpoint).toEqual(checkpoint.checkpoint)
    expect(prompts[1]).toContain(`Your previous environment (${environmentIds[0]}) is gone`)
    expect(prompts[1]).toContain(
      `Its files were restored from a checkpoint taken at ${checkpoint.at}`,
    )
    expect(prompts[1]).toContain('Read the files you already wrote before you repeat any step')
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'workspace-restored',
        environmentId: environmentIds[1],
        checkpointId: checkpoint.checkpoint.checkpointId,
        sourceEnvironmentId: environmentIds[0],
        verified: true,
      }),
    )
    expect(result.continuation).toMatchObject({
      environmentReplacements: 1,
      workspaceRestores: 1,
      closedBy: 'result-accepted',
    })
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

  it.each([false, true])(
    'preserves a provider create failure (frozen: %s) without retrying unknown cost',
    async (frozen) => {
      const directory = await mkdtemp(join(tmpdir(), 'retained-owner-create-failure-'))
      directories.push(directory)
      const proxy = await coordinationProxy()
      proxies.push(proxy)
      const runDirectory = join(directory, 'run')
      const context = createFileRunContext(runDirectory)
      const base = durableRetainedProvider(join(directory, 'provider.json'))
      const providerError = new Error('egress enabled but no model API key resolved')
      if (frozen) Object.freeze(providerError)
      const attempts: DriverAttemptRecord[] = []
      let creates = 0
      const provider: AgentEnvironmentProvider = {
        ...base,
        capabilities: async () => ({
          ...(await base.capabilities()),
          create: { runtimeAttachments: { mcp: true } },
        }),
        create: async () => {
          creates += 1
          throw providerError
        },
      }
      const result = await supervise(
        testAgentProfile('root', { harness: 'codex' }),
        'Answer the task.',
        {
          runDir: runDirectory,
          runId: 'create-failure-root',
          journal: context.journal,
          blobs: context.blobs,
          backend: { backend: 'provider', provider },
          driverBackend: { backend: 'provider', provider },
          budget: { maxIterations: 4, maxTokens: 100, maxUsd: 1 },
          driverRetry: { maxAttempts: 3, initialBackoffMs: 0, maxBackoffMs: 0 },
          onDriverAttempt: (record) => void attempts.push(record),
          coordination: {
            authentication: {
              signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
            },
            publicUrl: (address) => {
              proxy.forwardTo(address.port)
              return `${proxy.url}/manager`
            },
          },
        },
      )
      expect(result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
      if (result.kind === 'no-winner' && result.reason === 'driver-failed') {
        expect(result.error.message).toContain('egress enabled but no model API key resolved')
      }
      expect(creates).toBe(1)
      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatchObject({ classification: 'terminal', stop: 'terminal-error' })
      const events = (await context.journal.loadTree('create-failure-root')) ?? []
      expect(events.filter((event) => event.kind === 'execution-admitted')).toHaveLength(1)
      expect(events.some((event) => event.kind === 'metered' && !event.spend.usdKnown)).toBe(true)
      expect(result.kind === 'no-winner' ? result.spentTotal.usdKnown : true).toBe(false)
    },
  )
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
  const proxy = await coordinationProxy()
  proxies.push(proxy)
  const stateFile = join(directory, 'provider.json')
  const runDirectory = join(directory, 'run')
  const context = createFileRunContext(runDirectory)
  let creates = 0
  let reconnects = 0
  let authorizedRequests = 0
  let originalToken: string | undefined
  let port = 0
  let injected = false
  // A manager with a check is never granted stop; it ends through submit_result.
  const profile = testAgentProfile('owner', {
    harness: 'codex',
    tools: runtimeToolDeclarations(repeat ? 'submit_result' : 'stop'),
  })
  const requestOriginalCredential = async () => {
    if (!originalToken) throw new Error('missing original private credential')
    const response = await fetch(`http://127.0.0.1:${port}/manager`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${originalToken}`,
        Host: new URL(proxy.url).host,
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
              continuation: testContinuation({ maxBarren: 1 }),
              deliverable: { describe: 'A checked delivery', check: async () => false },
            }
          : {}),
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address) => {
            port = address.port
            proxy.forwardTo(port)
            return `${proxy.url}/manager`
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
