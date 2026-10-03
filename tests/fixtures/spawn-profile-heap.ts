// One coordinator process for tests/spawn-profile-heap.test.ts. The root spawns children whose
// authorized profile mounts one shared file packet, as Discovery's childFiles grant does. `live`
// waits until every child is dispatched to the provider, then exits with all of them in flight.
// `replay` re-enters the same run directory, which recovers those children from their blobs.
import { existsSync, readFileSync } from 'node:fs'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

const [mode, runDir, count] = process.argv.slice(2)
if ((mode !== 'live' && mode !== 'replay') || !runDir || !count) {
  throw new Error('usage: spawn-profile-heap.ts live|replay <runDir> <children>')
}
const children = Number(count)
const runId = 'spawn-profile-heap'
const providerState = `${runDir}.provider.json`

// 40 files of 100,000 bytes: a 4 MB packet. A JSON round trip gives flat parsed strings, like a
// record read from disk.
const packet = JSON.parse(
  JSON.stringify(
    Array.from({ length: 40 }, (_, index) => ({
      path: `inputs/source-${index}.md`,
      resource: {
        kind: 'inline',
        name: `source-${index}`,
        content: `${index}:`.padEnd(100_000, String.fromCharCode(97 + (index % 26))),
      },
    })),
  ),
) as NonNullable<NonNullable<AgentProfile['resources']>['files']>
const packetBytes = packet.reduce(
  (total, file) => total + (file.resource as { content: string }).content.length,
  0,
)

function heapUsed(): number {
  const gc = (globalThis as { gc?: () => void }).gc
  if (!gc) throw new Error('run with --expose-gc')
  gc()
  gc()
  return process.memoryUsage().heapUsed
}

/** Workers report `started` and then stay in flight until aborted, like a long hosted worker. */
function inFlight(base: AgentEnvironmentProvider): AgentEnvironmentProvider {
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session: (id, options) => {
      const session = environment.session!(id, options)
      return {
        ...session,
        async *events(eventOptions) {
          for await (const event of session.events(eventOptions)) {
            if (event.type === 'status') yield event
          }
          await new Promise((resolve) =>
            eventOptions?.signal?.addEventListener('abort', resolve, { once: true }),
          )
        },
      }
    },
  })
  return {
    ...base,
    create: async (input) => wrap(await base.create(input)),
    get: async (id) => {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
}

function dispatched(): number {
  if (!existsSync(providerState)) return 0
  const state = JSON.parse(readFileSync(providerState, 'utf8')) as {
    environments: Record<string, { sessions: Record<string, { dispatches: unknown[] }> }>
  }
  return Object.values(state.environments).filter((environment) =>
    Object.values(environment.sessions).some((session) => session.dispatches.length > 0),
  ).length
}

async function spawn(url: string, headers: Readonly<Record<string, string>>, index: number) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: index,
      method: 'tools/call',
      params: {
        name: 'spawn_worker',
        arguments: {
          profile: testAgentProfile(`worker-${index}`),
          task: `part ${index}`,
          label: `w${index}`,
        },
      },
    }),
  })
  if (!response.ok) throw new Error(`spawn_worker returned ${response.status}`)
}

async function waitDispatched(expected: number): Promise<void> {
  const deadline = Date.now() + 60_000
  while (dispatched() < expected) {
    if (Date.now() > deadline) throw new Error(`${dispatched()} of ${expected} children dispatched`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

await supervisePursuit(
  testAgentProfile('heap-root', { tools: runtimeToolDeclarations('spawn_worker') }),
  'spawn the workers',
  {
    pursuitId: 'pursuit:spawn-profile-heap',
    runId,
    runDir,
    budget: { maxIterations: 1_000, maxTokens: 10_000_000 },
    perWorker: { maxIterations: 4, maxTokens: 10_000 },
    workerSlots: children + 2,
    childSettleGraceMs: null,
    backend: { backend: 'provider', provider: inFlight(durableRetainedProvider(providerState)) },
    coordination: {
      authentication: {
        signingKeys: { activeKeyId: 'k', keys: { k: 'heap-test-secret-'.repeat(3) } },
      },
      publicUrl: (address: { port: number }) => `http://127.0.0.1:${address.port}/manager`,
    },
    // The same grant Discovery installs: every child mounts the record's packet.
    authorizeSpawn: ({ profile }) => ({
      profile: { ...profile, resources: { ...profile.resources, files: [...packet] } },
    }),
    driveHarness: async ({ coordinationMcpUrl, coordinationMcpHeaders }) => {
      const atEntry = heapUsed()
      if (mode === 'live') {
        for (let index = 0; index < children; index++) {
          await spawn(coordinationMcpUrl, coordinationMcpHeaders ?? {}, index)
          await waitDispatched(index + 1)
        }
      }
      console.log(
        JSON.stringify({
          mode,
          children,
          packetBytes,
          heapAtRootEntry: atEntry,
          heapAfter: heapUsed(),
        }),
      )
      process.exit(0)
    },
  },
)
throw new Error('the root driver must end the process')
