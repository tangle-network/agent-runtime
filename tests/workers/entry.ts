/**
 * Test-only worker entry. Builds a `SessionSupervisorDO` over an in-memory
 * store + a controllable scripted adapter, so a vitest-pool-workers test can
 * drive the real Cloudflare DO host under real `workerd`. Not a deployable
 * Worker — referenced only by `wrangler.workers.toml`.
 *
 * The adapter is parameterised through the request URL (`?events=N&runId=…`)
 * so the test injects different scenarios without recompiling. The in-memory
 * store + scripted-adapter factory live at module scope; they survive across
 * requests inside one workerd run, matching how a real product's DO would
 * share a substrate binding across requests.
 */

import {
  createSessionSupervisorDO,
  type DurableRunManifest,
  InMemoryDurableRunStore,
  type RunHandle,
  type SandboxReconnectAdapter,
  type SupervisedEvent,
} from '../../src/durable'

interface TestEnv {
  SESSION_SUPERVISOR: DurableObjectNamespace
}

const store = new InMemoryDurableRunStore()

const manifest = {
  projectId: 'test',
  scenarioId: 'persona-1',
  task: { id: 'task-1', intent: 'chat', domain: 'test' },
  input: { q: 'hello' },
} as unknown as DurableRunManifest

function scriptedAdapter(n: number): SandboxReconnectAdapter<number> {
  const ids = Array.from({ length: n }, (_, i) => i)
  return {
    async *start(): AsyncGenerator<SupervisedEvent<number>> {
      for (const i of ids) {
        const handle: RunHandle | undefined =
          i === 0 ? { kind: 'sandbox', runId: 'sbx-test', status: 'running' } : undefined
        yield { eventId: `e${i}`, payload: i, handle }
      }
    },
    async *attach(
      _handle: RunHandle,
      afterEventId: string | undefined,
    ): AsyncGenerator<SupervisedEvent<number>> {
      const found = afterEventId ? ids.findIndex((i) => `e${i}` === afterEventId) : -1
      for (let i = found + 1; i < ids.length; i++) yield { eventId: `e${i}`, payload: i }
    },
  }
}

export const TestSessionSupervisor = createSessionSupervisorDO<number, TestEnv>({
  async resolveRun(request) {
    const url = new URL(request.url)
    const runId = url.searchParams.get('runId') ?? 'r1'
    const events = Number(url.searchParams.get('events') ?? '4')
    return {
      store,
      runId,
      manifest,
      workerId: 'w-fetch',
      adapter: scriptedAdapter(events),
    }
  },
  async resolveOrphan(runId) {
    return {
      store,
      runId,
      manifest,
      workerId: 'w-alarm',
      adapter: scriptedAdapter(4),
    }
  },
  encodeEvent: (event) => `data: ${event}\n`,
})

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('session') ?? 'default'
    const id = env.SESSION_SUPERVISOR.idFromName(sessionId)
    const stub = env.SESSION_SUPERVISOR.get(id)
    return stub.fetch(request)
  },
} satisfies ExportedHandler<TestEnv>
