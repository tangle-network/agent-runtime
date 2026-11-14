import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, expect, it } from 'vitest'
import { materializeTreeView } from '../../src/durable/spawn-journal/tree-view'
import { providerAsExecutor } from '../../src/runtime/environment-provider/provider-executor-admission'
import { createInMemoryRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, Settled } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

// What the CLI Bridge provider emits when the Bridge refuses a run before dispatch: a failed status
// frame with the Bridge's machine code, HTTP status and structured remedy, then a stream error.
const MESSAGE = 'Codex is not signed in with a subscription. Run: codex login'
const REMEDIATION = {
  cause: 'not_authenticated',
  fix: 'codex login',
  harness: 'codex',
  provider: 'openai',
} as const

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function refusingProvider(stateFile: string, remediation: boolean): AgentEnvironmentProvider {
  const base = durableRetainedProvider(stateFile)
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session(id, options) {
      const session = environment.session!(id, options)
      return {
        ...session,
        async *events(): AsyncIterable<AgentEnvironmentEvent> {
          yield {
            id: 'refused-0',
            type: 'status',
            data: {
              status: 'failed',
              error: MESSAGE,
              errorCode: 'subscription_required',
              statusCode: 403,
              ...(remediation ? { remediation: REMEDIATION } : {}),
            },
            normalized: { type: 'status', status: 'failed', detail: MESSAGE },
          }
          throw new Error(`cli-bridge: ${MESSAGE}`)
        },
        async result() {
          return {
            ...(await session.result()),
            text: '',
            success: false,
            error: `cli-bridge: ${MESSAGE}`,
          }
        },
      }
    },
  })
  return {
    ...base,
    create: async (input) => wrap(await base.create(input)),
    get: async (id) => {
      const environment = await base.get!(id)
      return environment && wrap(environment)
    },
  }
}

it.each([
  { name: 'keeps the structured remedy', remediation: true },
  { name: 'never reads a remedy from the message text', remediation: false },
])('a provider subscription refusal $name on the settled child', async ({ remediation }) => {
  const directory = await mkdtemp(join(tmpdir(), 'provider-subscription-remediation-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const provider = refusingProvider(join(directory, 'provider.json'), remediation)
  const worker: Agent<unknown, unknown> = Object.assign(
    { name: 'native-worker', act: async () => 'unused' },
    {
      executorSpec: {
        profile: testAgentProfile('native-worker', { harness: 'codex' }),
        harness: null,
        executorFactory: providerAsExecutor(provider),
      },
    },
  )
  const context = createInMemoryRunContext()
  let live: Settled<unknown> | undefined
  await createSupervisor<unknown, unknown>().run(
    {
      name: 'root',
      async act(_task, scope) {
        expect(
          scope.spawn(worker, 'refused task', {
            key: 'child',
            budget: { maxIterations: 1, maxTokens: 10 },
          }).ok,
        ).toBe(true)
        live = await scope.next()
        return 'finished'
      },
    },
    'task',
    { ...context, runId: 'subscription-refusal', budget: { maxIterations: 2, maxTokens: 20 } },
  )

  expect(live?.kind, JSON.stringify(live)).toBe('down')
  const failure = live?.kind === 'down' ? live.failure : undefined
  expect(failure).toMatchObject({
    code: 'credential-refused',
    owner: 'caller',
    providerCode: 'subscription_required',
    providerStatus: 403,
  })
  if (remediation) expect(failure?.remediation).toEqual(REMEDIATION)
  else expect(failure).not.toHaveProperty('remediation')
  // The journaled settlement and the tree read model carry the same classified failure.
  const events = (await context.journal.loadTree('subscription-refusal')) ?? []
  const settled = events.find((event) => event.kind === 'settled' && event.id === live?.handle.id)
  expect(settled).toMatchObject({ failure })
  expect(
    materializeTreeView(events).nodes.find((node) => node.id === live?.handle.id)?.failure,
  ).toEqual(failure)
})
