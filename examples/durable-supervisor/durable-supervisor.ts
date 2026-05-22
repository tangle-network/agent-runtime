/**
 * Durable run supervisor — the cross-worker resume keystone.
 *
 * Worker 1 drains a few events of a long turn, then its isolate "dies"
 * (we stop pulling the generator and expire the lease). Worker 2 picks
 * the same `runId` up: it re-yields the logged prefix from the substrate
 * and resumes via `adapter.attach(handle, cursor)`. The caller sees the
 * complete event sequence exactly once — no gap, no duplicate.
 *
 * Run with:
 *   pnpm tsx examples/durable-supervisor/durable-supervisor.ts
 */

import {
  type DurableRunManifest,
  InMemoryDurableRunStore,
  type RunHandle,
  runSupervisedTurn,
  type SandboxReconnectAdapter,
  type SupervisedEvent,
} from '@tangle-network/agent-runtime'

// ── Your scripted "sandbox" — pretend the events are streaming from
// somewhere durable (a sandbox container that outlives the worker). ────
function scriptedAdapter(): SandboxReconnectAdapter<string> {
  const script = ['intro', 'analysis', 'finding-1', 'finding-2', 'conclusion']
  return {
    async *start(): AsyncGenerator<SupervisedEvent<string>> {
      for (const [i, payload] of script.entries()) {
        // The first frame carries the handle — that is what the substrate
        // uses to re-attach.
        const handle: RunHandle | undefined =
          i === 0 ? { kind: 'sandbox', runId: 'sbx-1', status: 'running' } : undefined
        yield { eventId: `e${i}`, payload, handle }
      }
    },
    async *attach(_handle, afterEventId) {
      const idx = afterEventId ? script.findIndex((_, i) => `e${i}` === afterEventId) : -1
      for (let i = idx + 1; i < script.length; i++) {
        yield { eventId: `e${i}`, payload: script[i]! }
      }
    },
  }
}

const manifest = {
  projectId: 'demo',
  scenarioId: 'persona-1',
  task: { id: 'long-turn', intent: 'chat', domain: 'demo' },
  input: { q: 'analyse the brief' },
} as unknown as DurableRunManifest

async function main() {
  const store = new InMemoryDurableRunStore()
  const runId = 'turn-1'

  // ── Worker 1 — drains 2 of 5 events, then dies mid-stream ────────────
  const w1 = runSupervisedTurn({
    store,
    runId,
    manifest,
    workerId: 'w1',
    adapter: scriptedAdapter(),
  })
  const partial: string[] = []
  for await (const event of w1.stream) {
    partial.push(event)
    if (partial.length >= 2) break // worker 1's isolate "dies"
  }
  console.log('worker 1 saw:  ', partial) // ['intro', 'analysis']
  console.log('store has:     ', (await store.readStreamEvents(runId)).length, 'events') // 2

  // Worker 1 stopped heartbeating; its lease lapses.
  store._expireLease(runId)

  // ── Worker 2 picks up the same runId ─────────────────────────────────
  const w2 = runSupervisedTurn({
    store,
    runId,
    manifest,
    workerId: 'w2',
    adapter: scriptedAdapter(),
  })
  const full: string[] = []
  for await (const event of w2.stream) full.push(event)

  console.log('worker 2 saw:  ', full) // complete sequence, exactly once
  console.log('worker 2 mode: ', w2.mode()) // 'resumed'
  console.log('store has:     ', (await store.readStreamEvents(runId)).length, 'events') // 5
  console.log('record status: ', w2.record()?.status) // 'completed'
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
