import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import type { SpawnEvent, SpawnJournal } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('nested retained owner journal isolation', () => {
  for (const mode of [
    'normal',
    'retry',
    'pending',
    'parent-meter-before',
    'parent-meter-loss',
    'parent-terminal-loss',
  ] as const) {
    const retry = mode === 'retry' || mode === 'pending'
    const parentInterruption = mode.startsWith('parent-')
    it(`keeps backend evidence inside its owned tree (${mode})`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'nested-retained-owner-'))
      directories.push(directory)
      const context = createFileRunContext(join(directory, 'run'))
      const base = durableRetainedProvider(join(directory, 'provider.json'))
      let creates = 0
      let injected = false
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
      const provider: AgentEnvironmentProvider = {
        ...base,
        capabilities: async () => ({
          ...(await base.capabilities()),
          create: { runtimeAttachments: { mcp: true } },
        }),
        create: async (input) => {
          creates++
          return wrap(await base.create(input))
        },
        get: async (id) => {
          const environment = await base.get!(id)
          return environment ? wrap(environment) : null
        },
      }
      const journal: SpawnJournal = {
        beginTree: context.journal.beginTree.bind(context.journal),
        loadTree: context.journal.loadTree.bind(context.journal),
        appendEvent: async (root, event) => {
          const parentMeter =
            root === 'root' &&
            event.kind === 'metered' &&
            event.id !== 'root' &&
            event.spend.tokens.input > 0
          if (!injected && mode === 'parent-meter-before' && parentMeter) {
            injected = true
            throw new Error('parent inference write failed before persistence')
          }
          await context.journal.appendEvent(root, event)
          if (
            !injected &&
            ((mode === 'parent-meter-loss' && parentMeter) ||
              (mode === 'parent-terminal-loss' &&
                root === 'root' &&
                event.kind === 'settled' &&
                event.id !== 'root'))
          ) {
            injected = true
            throw new Error('parent settlement acknowledgement lost')
          }
          if (
            retry &&
            !injected &&
            root !== 'root' &&
            event.kind === 'metered' &&
            event.spend.tokens.input > 0
          ) {
            injected = true
            throw new Error('nested observation interrupted after usage commit')
          }
        },
      }
      const coordination = {
        authentication: {
          signingKeys: { activeKeyId: 'test', keys: { test: 'nested-test-secret-'.repeat(3) } },
        },
        publicUrl: () => 'https://coordination.example/nested',
      }
      const finalizer = () => ({ finalizedBy: 'manager' })
      const manager = testAgentProfile('manager', {
        harness: 'codex',
        tools: runtimeToolDeclarations('stop'),
      })
      const root = testAgentProfile('root', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
      })
      await supervise(root, 'Delegate.', {
        runDir: join(directory, 'run'),
        runId: 'root',
        journal,
        blobs: context.blobs,
        backend: { backend: 'provider', provider },
        budget: { maxIterations: 8, maxTokens: 100 },
        perWorker: { maxIterations: 3, maxTokens: 20 },
        driverRetry: {
          maxAttempts: mode === 'pending' ? 1 : 2,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
        },
        coordination,
        finalizer,
        brain: scriptedBrain([
          {
            toolCalls: [
              {
                name: 'spawn_worker',
                arguments: { profile: manager, task: 'Manage.', key: 'manager' },
              },
            ],
          },
          { toolCalls: [{ name: 'await_event', arguments: {} }] },
          { content: 'done' },
        ]),
      }).catch((error: unknown) => {
        if (!parentInterruption || !injected) throw error
      })
      const parent = (await context.journal.loadTree('root')) ?? []
      const spawn = parent.find((event) => event.kind === 'spawned' && event.key === 'manager')
      if (spawn?.kind !== 'spawned' || !spawn.ownedTreeRoot)
        throw new Error('manager was not admitted')
      const nested = (await context.journal.loadTree(spawn.ownedTreeRoot)) ?? []
      const { parent: _parent, ownedTreeRoot: _tree, ...expectedOwner } = spawn
      expect(nested[0]).toEqual(expectedOwner)
      expect(nested.filter((event) => event.kind === 'execution-input')).toHaveLength(1)
      expect(nested.filter((event) => event.kind === 'execution-result')).toHaveLength(
        mode === 'pending' ? 0 : 1,
      )
      if (mode === 'pending' || parentInterruption) {
        const terminalWritten = mode === 'parent-terminal-loss' || mode === 'parent-meter-loss'
        expect(parent.some((event) => event.kind === 'settled' && event.id === spawn.id)).toBe(
          terminalWritten,
        )
        if (parentInterruption) {
          expect(injected).toBe(true)
          expect(tokens(parent)).toBe(mode === 'parent-meter-before' ? 0 : 5)
          if (terminalWritten) {
            expect(
              parent.findIndex((event) => event.kind === 'metered' && event.id === spawn.id),
            ).toBeLessThan(
              parent.findIndex((event) => event.kind === 'settled' && event.id === spawn.id),
            )
          }
        }
        expect(nested.some((event) => event.kind === 'execution-admitted')).toBe(true)
        expect(creates).toBe(1)
        const restartedBase = durableRetainedProvider(join(directory, 'provider.json'))
        const restartedProvider: AgentEnvironmentProvider = {
          ...restartedBase,
          capabilities: async () => ({
            ...(await restartedBase.capabilities()),
            create: { runtimeAttachments: { mcp: true } },
          }),
          create: async (input) => {
            creates++
            return wrap(await restartedBase.create(input))
          },
          get: async (id) => {
            const environment = await restartedBase.get!(id)
            return environment ? wrap(environment) : null
          },
        }
        const restarted = createFileRunContext(join(directory, 'run'))
        await supervise(root, 'Delegate.', {
          runDir: join(directory, 'run'),
          runId: 'root',
          journal: restarted.journal,
          blobs: restarted.blobs,
          backend: { backend: 'provider', provider: restartedProvider },
          budget: { maxIterations: 8, maxTokens: 100 },
          perWorker: { maxIterations: 3, maxTokens: 20 },
          driverRetry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
          coordination,
          finalizer,
          brain: scriptedBrain([
            { toolCalls: [{ name: 'await_event', arguments: {} }] },
            { content: 'done' },
          ]),
        })
        const recoveredParent = (await restarted.journal.loadTree('root')) ?? []
        const recoveredNested = (await restarted.journal.loadTree(spawn.ownedTreeRoot)) ?? []
        const settlement = recoveredParent.find(
          (event) => event.kind === 'settled' && event.id === spawn.id,
        )
        expect(settlement, JSON.stringify(recoveredParent)).toMatchObject({
          kind: 'settled',
          status: 'done',
        })
        if (settlement?.kind === 'settled' && settlement.outRef) {
          expect(await restarted.blobs.get(settlement.outRef)).toEqual({ finalizedBy: 'manager' })
        }
        expect(recoveredNested.filter((event) => event.kind === 'execution-input')).toHaveLength(1)
        expect(recoveredNested.filter((event) => event.kind === 'execution-result')).toHaveLength(1)
        expect(
          recoveredParent.filter((event) => event.kind === 'spawned' && event.id === spawn.id),
        ).toHaveLength(1)
        expect(tokens(recoveredNested)).toBe(5)
        expect(tokens(recoveredParent)).toBe(5)
        expect(
          recoveredParent.filter((event) => event.kind === 'settled' && event.id === spawn.id),
        ).toHaveLength(1)
        expect(
          recoveredParent.filter(
            (event) =>
              event.kind === 'metered' && event.id === spawn.id && event.spend.tokens.input > 0,
          ),
        ).toHaveLength(1)
        expect(creates).toBe(1)
        return
      }
      expect(
        parent.some((event) => event.kind === 'execution-result' && event.id === spawn.id),
      ).toBe(false)
      const settlement = parent.find((event) => event.kind === 'settled' && event.id === spawn.id)
      expect(settlement, JSON.stringify(parent)).toMatchObject({ kind: 'settled', status: 'done' })
      if (settlement?.kind === 'settled' && settlement.outRef) {
        expect(await context.blobs.get(settlement.outRef)).not.toEqual(
          expect.objectContaining({ content: 'durable result' }),
        )
      }
      expect(tokens(nested)).toBe(5)
      expect(tokens(parent)).toBe(5)
      expect(creates).toBe(1)
      expect(injected).toBe(retry)
    })
  }
})

function tokens(events: SpawnEvent[]) {
  return events.reduce(
    (total, event) =>
      event.kind === 'metered'
        ? total + event.spend.tokens.input + event.spend.tokens.output
        : total,
    0,
  )
}
