/**
 * THE durability bar (agent-runtime#974/#981): kill a file-journaled run at EVERY journal
 * boundary, restart with the same journal, and prove zero settled nodes re-executed and — the
 * graph being all-pure — a byte-identical final result. Plus the suspension protocol (#976): a
 * parked node survives restart pending with a recomputable token, and `resume` settles it.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import { FileSpawnJournal, InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import {
  agentKind,
  createGraphEngine,
  createGraphRun,
  type EngineGraphSpec,
  runEngineGraph,
  scriptKind,
  subgraphKind,
  supervisorKind,
  suspended,
} from '../../src/runtime/graph'
import type { SpawnEvent, SpawnJournal } from '../../src/runtime/supervise/types'

const engine = () =>
  createGraphEngine({
    coreKinds: [
      agentKind({}),
      supervisorKind({
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () => ({ name: 'x', act: async () => 1 }),
      }),
      scriptKind(),
      subgraphKind(),
    ],
  })

const budget = { maxIterations: 60, maxTokens: 100_000 }
const perNode = { maxIterations: 5, maxTokens: 5_000 }

class KillError extends Error {}

/** Allows the first `limit` appends, then kills the process stand-in at the boundary. */
class KillingJournal implements SpawnJournal {
  appends = 0
  constructor(
    private readonly inner: SpawnJournal,
    private readonly limit: number,
  ) {}
  loadTree(root: string) {
    return this.inner.loadTree(root)
  }
  beginTree(root: string, at: string) {
    return this.inner.beginTree(root, at)
  }
  async appendEvent(root: string, ev: SpawnEvent): Promise<void> {
    if (this.appends >= this.limit)
      throw new KillError(`killed at journal append ${this.appends + 1}`)
    this.appends += 1
    return this.inner.appendEvent(root, ev)
  }
}

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})
const journalPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'graph-replay-'))
  dirs.push(dir)
  return join(dir, 'journal.jsonl')
}

/** All-pure 3-node chain; each body counts its executions into `runs`. */
function chain(runs: Map<string, number>): EngineGraphSpec {
  const count = (id: string) => runs.set(id, (runs.get(id) ?? 0) + 1)
  return {
    nodes: [
      {
        id: 'seed',
        kind: 'script/v1',
        config: {
          body: () => {
            count('seed')
            return { n: 3 }
          },
          pure: true,
        },
      },
      {
        id: 'double',
        kind: 'script/v1',
        config: {
          body: (inputs: Record<string, unknown>) => {
            count('double')
            return { n: Number((inputs.seeded as { n: number }).n) * 2 }
          },
          pure: true,
        },
        ports: { inputs: [{ name: 'seeded', schema: { type: 'object' } }] },
      },
      {
        id: 'sink',
        kind: 'script/v1',
        config: {
          body: (inputs: Record<string, unknown>) => {
            count('sink')
            return { final: Number((inputs.doubled as { n: number }).n) + 1 }
          },
          pure: true,
        },
        ports: { inputs: [{ name: 'doubled', schema: { type: 'object' } }] },
        deliverable: { check: (out: unknown) => (out as { final: number }).final === 7 },
      },
    ],
    edges: [
      { kind: 'data', from: { node: 'seed' }, to: { node: 'double', port: 'seeded' } },
      { kind: 'data', from: { node: 'double' }, to: { node: 'sink', port: 'doubled' } },
    ],
  }
}

describe('kill-anywhere replay — fold, never checkpoint', () => {
  it('killed at EVERY journal boundary, a restart re-executes no settled node and reproduces the result byte-identically', async () => {
    // Phase 0: the uninterrupted run — the reference bytes and the append count.
    const baselineRuns = new Map<string, number>()
    const baselinePath = journalPath()
    const baselineJournal = new KillingJournal(
      new FileSpawnJournal(baselinePath),
      Number.MAX_SAFE_INTEGER,
    )
    const blobs0 = new InMemoryResultBlobStore()
    const reference = await runEngineGraph(engine(), chain(baselineRuns), 'go', {
      budget,
      perNode,
      journal: baselineJournal,
      blobs: blobs0,
      runId: 'replay-run',
    })
    expect(reference.kind).toBe('winner')
    const referenceBytes = JSON.stringify(reference.kind === 'winner' ? reference.out : undefined)
    expect(referenceBytes).toBe(JSON.stringify({ final: 7 }))
    const totalAppends = baselineJournal.appends
    expect(totalAppends).toBeGreaterThan(8)

    for (let kill = 1; kill < totalAppends; kill += 1) {
      const runs = new Map<string, number>()
      const path = journalPath()
      const blobs = new InMemoryResultBlobStore()
      const spec = chain(runs)
      let killed = false
      try {
        await runEngineGraph(engine(), spec, 'go', {
          budget,
          perNode,
          journal: new KillingJournal(new FileSpawnJournal(path), kill),
          blobs,
          runId: 'replay-run',
        })
      } catch (error) {
        killed = true
        expect(error, `boundary ${kill}`).toBeInstanceOf(KillError)
      }
      expect(killed, `boundary ${kill} should kill`).toBe(true)

      // Which nodes had SETTLED before the kill — those may never run again.
      const journaled = (await new FileSpawnJournal(path).loadTree('replay-run')) ?? []
      const spawnedLabels = new Map(
        journaled.flatMap((ev) => (ev.kind === 'spawned' ? [[ev.id, ev.label]] : [])),
      )
      const settledNodes = new Set(
        journaled.flatMap((ev) =>
          ev.kind === 'settled' && ev.id !== 'replay-run'
            ? [String(spawnedLabels.get(ev.id) ?? '').split('#')[0] ?? '']
            : [],
        ),
      )
      const runsBeforeRestart = new Map(runs)

      const resumed = await runEngineGraph(engine(), spec, 'go', {
        budget,
        perNode,
        journal: new FileSpawnJournal(path),
        blobs,
        runId: 'replay-run',
        resume: true,
      })
      expect(resumed.kind, `boundary ${kill} result`).toBe('winner')
      expect(
        JSON.stringify(resumed.kind === 'winner' ? resumed.out : undefined),
        `boundary ${kill} bytes`,
      ).toBe(referenceBytes)
      for (const node of settledNodes) {
        const before = runsBeforeRestart.get(node) ?? 0
        expect(runs.get(node) ?? 0, `boundary ${kill}: settled node ${node} re-executed`).toBe(
          before,
        )
      }
    }
  }, 120_000)
})

describe('suspensions survive restart (#976)', () => {
  it('a parked node returns suspended with a recomputable token; resume after restart settles it and the payload flows on', async () => {
    const path = journalPath()
    const blobs = new InMemoryResultBlobStore()
    const spec: EngineGraphSpec = {
      nodes: [
        { id: 'ask', kind: 'script/v1', config: { body: () => suspended(), pure: true } },
        {
          id: 'act',
          kind: 'script/v1',
          config: {
            body: (inputs: Record<string, unknown>) => ({
              acted: (inputs.answer as { choice: string }).choice,
            }),
            pure: true,
          },
          ports: { inputs: [{ name: 'answer', schema: { type: 'object' } }] },
          deliverable: { check: (out: unknown) => (out as { acted: string }).acted === 'ship' },
        },
      ],
      edges: [{ kind: 'data', from: { node: 'ask' }, to: { node: 'act', port: 'answer' } }],
    }
    const first = await runEngineGraph(engine(), spec, 'go', {
      budget,
      perNode,
      journal: new FileSpawnJournal(path),
      blobs,
      runId: 'suspend-run',
    })
    expect(first.kind).toBe('suspended')
    if (first.kind !== 'suspended') return
    expect(first.tokens).toHaveLength(1)
    const token = first.tokens[0] as string
    // The token is recomputable from the journal identity alone — no token table anywhere.
    expect(token).toBe(
      contentAddress({ runId: 'suspend-run', instance: 'ask#1', kind: 'graph-suspension' }),
    )

    // Restart: still parked, same token, and a live handle accepts the wake.
    const restarted = createGraphRun(engine(), spec, 'go', {
      budget,
      perNode,
      journal: new FileSpawnJournal(path),
      blobs,
      runId: 'suspend-run',
      resume: true,
      waitForWakes: true,
    })
    await restarted.resume(token, { choice: 'ship' })
    const done = await restarted.done
    expect(done.kind).toBe('winner')
    if (done.kind !== 'winner') return
    expect(done.out).toEqual({ acted: 'ship' })

    // A second wake of the same token is refused by name.
    await expect(restarted.resume(token, { choice: 'again' })).rejects.toThrow(/completed|already/)
  })

  it("offline, an onExpire 'default' suspension auto-resolves with its default — no host will answer", async () => {
    const path = journalPath()
    const spec: EngineGraphSpec = {
      nodes: [
        {
          id: 'ask',
          kind: 'script/v1',
          config: {
            body: () =>
              suspended({
                onExpire: 'default',
                expiresInMs: 60_000,
                default: { choice: 'fallback' },
              }),
            pure: true,
          },
        },
        {
          id: 'act',
          kind: 'script/v1',
          config: {
            body: (inputs: Record<string, unknown>) => ({
              acted: (inputs.answer as { choice: string }).choice,
            }),
            pure: true,
          },
          ports: { inputs: [{ name: 'answer', schema: { type: 'object' } }] },
          deliverable: { check: (out: unknown) => (out as { acted: string }).acted === 'fallback' },
        },
      ],
      edges: [{ kind: 'data', from: { node: 'ask' }, to: { node: 'act', port: 'answer' } }],
    }
    const res = await runEngineGraph(engine(), spec, 'go', {
      budget,
      perNode,
      journal: new FileSpawnJournal(path),
      blobs: new InMemoryResultBlobStore(),
      runId: 'default-run',
    })
    expect(res.kind).toBe('winner')
    if (res.kind !== 'winner') return
    expect(res.out).toEqual({ acted: 'fallback' })
  })
})
