/**
 * The ADC integration spike, executed: agent-dev-container's real `pr-review-with-approval`
 * template runs on the engine — approve and timeout paths, the human park across a process
 * restart, kill-anywhere durability over HOST kinds (a settled agent run or posted review is
 * never re-executed), the conserved pool capping the run the way `maxRunCostUsd` does, and the
 * engine settles projected back onto the `actionResults` shape ADC's UI reads.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import { FileSpawnJournal, InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import {
  agentKind,
  createGraphEngine,
  createGraphRun,
  type GraphEngine,
  runEngineGraph,
  scriptKind,
  subgraphKind,
  supervisorKind,
} from '../../src/runtime/graph'
import type { SpawnEvent, SpawnJournal } from '../../src/runtime/supervise/types'
import { integrationInvokeKind } from './fixtures/adc-kinds'
import {
  type AdcRunAgent,
  actionResultsFromRun,
  adcAgentRunKind,
  adcDecisionKind,
  lowerPrReviewWithApproval,
  type PrTrigger,
} from './fixtures/adc-workflow'

const REVIEW_TEXT = 'LGTM overall; one nit in src/scheduler.ts:41.'
const AGENT_COST = { costUsd: 0.42, inputTokens: 9_000, outputTokens: 1_200 }

const trigger: PrTrigger = {
  payload: {
    pull_request: { number: 1417, title: 'fix: journal the woken seq' },
    repository: {
      full_name: 'tangle-network/agent-runtime',
      name: 'agent-runtime',
      owner: { login: 'tangle-network' },
    },
  },
}

function fakeHost() {
  const runAgent: AdcRunAgent = {
    run: vi.fn(async () => ({ finalMessage: REVIEW_TEXT, ...AGENT_COST })),
  }
  // A crash between the provider call and its journaled settle replays the call: the engine is
  // at-least-once at an external effect. The idempotency key is what makes delivery exactly-once
  // — this fake models the key ADC's hub executor must accept, derived from the request.
  const posted = new Map<string, { id: number; state: string }>()
  const integrations = {
    deliveries: () => posted.size,
    invoke: vi.fn(async (connector: string, operation: string, args: unknown) => {
      const key = JSON.stringify([connector, operation, args])
      const existing = posted.get(key)
      if (existing !== undefined) return existing
      const response = { id: 991, state: 'COMMENTED' }
      posted.set(key, response)
      return response
    }),
  }
  return { runAgent, integrations }
}

function engine(host: ReturnType<typeof fakeHost>): GraphEngine {
  return createGraphEngine({
    coreKinds: [
      agentKind({}),
      supervisorKind({
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () => ({ name: 'x', act: async () => 1 }),
      }),
      scriptKind(),
      subgraphKind(),
    ],
    kinds: [adcAgentRunKind(), adcDecisionKind(), integrationInvokeKind()],
    effects: { runAgent: host.runAgent, integrations: host.integrations },
  })
}

const budget = { maxIterations: 40, maxTokens: 100_000, maxUsd: 5 }
const perNode = { maxIterations: 5, maxTokens: 50_000, maxUsd: 1 }

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})
const journalPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'adc-spike-'))
  dirs.push(dir)
  return join(dir, 'journal.jsonl')
}

const EXPECTED_POST = {
  owner: 'tangle-network',
  repo: 'agent-runtime',
  pull_number: 1417,
  event: 'COMMENT',
  body: REVIEW_TEXT,
}

class KillError extends Error {}

/** Allows the first `limit` appends, then kills the process stand-in at the boundary. */
/**
 * The park is observable only through the journal — the run handle has no "parked" signal, so a
 * host does what ADC's decision store does: watch for the durable `waiting` event and read the
 * token FROM it. Tokens are minted per VISIT: a crash before the park was journaled re-enters
 * the node as a new visit with a new token, so a precomputed token is a stale ask.
 */
async function pendingParkToken(path: string, runId: string): Promise<string | undefined> {
  const events = (await new FileSpawnJournal(path).loadTree(runId)) ?? []
  const waiting = new Map<string, string>()
  const woken = new Set<string>()
  for (const event of events) {
    if (event.kind === 'waiting' && event.spec.kind === 'token') {
      waiting.set(event.id, event.spec.token)
    }
    if (event.kind === 'woken') woken.add(event.id)
  }
  for (const [id, token] of waiting) if (!woken.has(id)) return token
  return undefined
}

async function awaitParkToken(path: string, runId: string): Promise<string> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const token = await pendingParkToken(path, runId)
    if (token !== undefined) return token
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`no pending park for ${runId} within 5s`)
}

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

describe('pr-review-with-approval on the engine', () => {
  it('approve path: the human wake releases the guarded edge and the review is posted once', async () => {
    const host = fakeHost()
    const path = journalPath()
    const run = createGraphRun(engine(host), lowerPrReviewWithApproval(trigger), 'review PR 1417', {
      budget,
      perNode,
      journal: new FileSpawnJournal(path),
      blobs: new InMemoryResultBlobStore(),
      runId: 'approve-run',
      waitForWakes: true,
      finalizer: 'collectDelivered',
    })

    // The host reads the token from the durable `waiting` event; on an uninterrupted run it is
    // also recomputable from run identity alone (visit 1 of the decision node).
    const token = await awaitParkToken(path, 'approve-run')
    expect(token).toBe(
      contentAddress({ runId: 'approve-run', instance: 'step-2#1', kind: 'graph-suspension' }),
    )
    await run.resume(token, { choice: 'approve', note: 'ship it' })

    const result = await run.done
    expect(result.kind).toBe('winner')
    expect(host.runAgent.run).toHaveBeenCalledTimes(1)
    expect(host.integrations.invoke).toHaveBeenCalledTimes(1)
    expect(host.integrations.invoke).toHaveBeenCalledWith(
      'github',
      'pulls.reviews.create',
      EXPECTED_POST,
    )
    const settles = result.kind === 'winner' ? result.settles : []
    const decision = settles.find((settle) => settle.node === 'step-2')
    expect(decision?.out).toEqual({ choice: 'approve', note: 'ship it' })
  })

  it('timeout path: offline, the decision resolves to its default and the post is skipped — the run still completes', async () => {
    const host = fakeHost()
    const result = await runEngineGraph(
      engine(host),
      lowerPrReviewWithApproval(trigger),
      'review PR 1417',
      {
        budget,
        perNode,
        journal: new FileSpawnJournal(journalPath()),
        blobs: new InMemoryResultBlobStore(),
        runId: 'timeout-run',
        finalizer: 'collectDelivered',
      },
    )
    expect(result.kind).toBe('winner')
    expect(host.runAgent.run).toHaveBeenCalledTimes(1)
    expect(host.integrations.invoke).not.toHaveBeenCalled()
    const settles = result.kind === 'winner' ? result.settles : []
    expect(settles.find((settle) => settle.node === 'step-2')?.out).toEqual({
      choice: 'reject',
      timedOut: true,
    })
    expect(settles.find((settle) => settle.node === 'step-3')).toBeUndefined()

    const rows = actionResultsFromRun(result)
    expect(rows.map((row) => [row.nodeId, row.status])).toEqual([
      ['step-1', 'succeeded'],
      ['step-2', 'succeeded'],
      ['step-3', 'skipped'],
    ])
    expect(rows[0]?.costUsd).toBe(AGENT_COST.costUsd)
  })

  it('kill-anywhere: at every journal boundary, a restart re-runs no settled host call — the agent never re-runs, the review never double-posts', async () => {
    // Phase 0: the uninterrupted approve-path run — reference bytes and the append count.
    const referenceHost = fakeHost()
    const referencePath = journalPath()
    const referenceJournal = new KillingJournal(
      new FileSpawnJournal(referencePath),
      Number.MAX_SAFE_INTEGER,
    )
    const reference = createGraphRun(
      engine(referenceHost),
      lowerPrReviewWithApproval(trigger),
      'review PR 1417',
      {
        budget,
        perNode,
        journal: referenceJournal,
        blobs: new InMemoryResultBlobStore(),
        runId: 'kill-run',
        waitForWakes: true,
        finalizer: 'collectDelivered',
      },
    )
    await reference.resume(await awaitParkToken(referencePath, 'kill-run'), { choice: 'approve' })
    const referenceResult = await reference.done
    expect(referenceResult.kind).toBe('winner')
    const referenceBytes = JSON.stringify(
      referenceResult.kind === 'winner' ? referenceResult.out : undefined,
    )
    const totalAppends = referenceJournal.appends
    expect(totalAppends).toBeGreaterThan(10)

    for (let kill = 1; kill < totalAppends; kill += 1) {
      const host = fakeHost()
      const path = journalPath()
      const blobs = new InMemoryResultBlobStore()
      const spec = lowerPrReviewWithApproval(trigger)
      const firstAbort = new AbortController()
      const first = createGraphRun(engine(host), spec, 'review PR 1417', {
        budget,
        perNode,
        journal: new KillingJournal(new FileSpawnJournal(path), kill),
        blobs,
        runId: 'kill-run',
        waitForWakes: true,
        finalizer: 'collectDelivered',
        signal: firstAbort.signal,
      })
      // The kill can land before the park, after it, or INSIDE the wake processing. The host
      // flow is always: observe the durable waiting event, wake ITS token. When the kill eats
      // the wake itself the run stays parked, so the process stand-in is shot down with the
      // abort signal, the way a dead host process takes its run down.
      const firstOutcome = first.done.then(
        () => 'completed' as const,
        (error) => (error instanceof KillError ? ('killed' as const) : ('down' as const)),
      )
      const raced = await Promise.race([
        firstOutcome,
        awaitParkToken(path, 'kill-run').then(
          (token) => ({ token }),
          () => 'no-park' as const,
        ),
      ])
      let killedInWake = false
      if (typeof raced === 'object') {
        const wakeError = await first.resume(raced.token, { choice: 'approve' }).then(
          () => undefined,
          (error: unknown) => error,
        )
        killedInWake = wakeError instanceof KillError
        if (killedInWake) firstAbort.abort('wake path killed')
      }
      const ended = await firstOutcome
      expect(
        ended === 'killed' || killedInWake,
        `boundary ${kill} should kill (ended ${ended})`,
      ).toBe(true)

      const agentCallsBeforeRestart = host.runAgent.run.mock.calls.length
      const postCallsBeforeRestart = host.integrations.invoke.mock.calls.length

      // Which nodes SETTLED before the kill — their host calls may never happen again.
      const journaled = (await new FileSpawnJournal(path).loadTree('kill-run')) ?? []
      const spawnedLabels = new Map(
        journaled.flatMap((ev) => (ev.kind === 'spawned' ? [[ev.id, ev.label]] : [])),
      )
      const settledNodes = new Set(
        journaled.flatMap((ev) =>
          ev.kind === 'settled' && ev.id !== 'kill-run'
            ? [String(spawnedLabels.get(ev.id) ?? '').split('#')[0] ?? '']
            : [],
        ),
      )

      const restarted = createGraphRun(engine(host), spec, 'review PR 1417', {
        budget,
        perNode,
        journal: new FileSpawnJournal(path),
        blobs,
        runId: 'kill-run',
        resume: true,
        waitForWakes: true,
        finalizer: 'collectDelivered',
      })
      // The restart may need a fresh wake — for the ORIGINAL token (park survived), or a NEW one
      // (the crash landed before the park was durable, so the re-entered visit re-minted) — or
      // none at all (the woken event survived). The journal, not a guess, says which.
      const restartRace = await Promise.race([
        restarted.done.then(() => 'done' as const),
        awaitParkToken(path, 'kill-run').then(
          (token) => ({ token }),
          () => 'no-park' as const,
        ),
      ])
      if (typeof restartRace === 'object') {
        await restarted.resume(restartRace.token, { choice: 'approve' }).catch((error) => {
          expect(String(error), `boundary ${kill} re-wake`).toMatch(/completed|already/)
        })
      }
      const resumed = await restarted.done
      expect(resumed.kind, `boundary ${kill} result`).toBe('winner')
      expect(
        JSON.stringify(resumed.kind === 'winner' ? resumed.out : undefined),
        `boundary ${kill} bytes`,
      ).toBe(referenceBytes)

      if (settledNodes.has('step-1')) {
        expect(
          host.runAgent.run.mock.calls.length,
          `boundary ${kill}: settled agent run re-executed`,
        ).toBe(agentCallsBeforeRestart)
      }
      if (settledNodes.has('step-3')) {
        expect(
          host.integrations.invoke.mock.calls.length,
          `boundary ${kill}: posted review re-posted`,
        ).toBe(postCallsBeforeRestart)
      }
      // The absolute law regardless of where the kill landed: at most one DELIVERED post. A
      // kill between the provider call and its settle may re-CALL (at-least-once), and the
      // idempotency key collapses it to one delivery — the contract an ADC lift must keep.
      expect(
        host.integrations.deliveries(),
        `boundary ${kill}: delivered posts`,
      ).toBeLessThanOrEqual(1)
    }
  }, 180_000)

  it("budget cap: a pool smaller than the agent's spend fails the run the way maxRunCostUsd does", async () => {
    const host = fakeHost()
    const result = await runEngineGraph(
      engine(host),
      lowerPrReviewWithApproval(trigger),
      'review PR 1417',
      {
        budget: { maxIterations: 40, maxTokens: 100_000, maxUsd: 0.1 },
        perNode: { maxIterations: 5, maxTokens: 50_000, maxUsd: 0.1 },
        journal: new FileSpawnJournal(journalPath()),
        blobs: new InMemoryResultBlobStore(),
        runId: 'capped-run',
        finalizer: 'collectDelivered',
      },
    )
    expect(result.kind).toBe('no-winner')
    expect(host.integrations.invoke).not.toHaveBeenCalled()
  })

  it('UI projection: the approve-path settles map onto the actionResults rows the run detail reads', async () => {
    const host = fakeHost()
    const path = journalPath()
    const run = createGraphRun(engine(host), lowerPrReviewWithApproval(trigger), 'review PR 1417', {
      budget,
      perNode,
      journal: new FileSpawnJournal(path),
      blobs: new InMemoryResultBlobStore(),
      runId: 'ui-run',
      waitForWakes: true,
      finalizer: 'collectDelivered',
    })
    const uiToken = await awaitParkToken(path, 'ui-run')
    await run.resume(uiToken, { choice: 'approve' })
    const result = await run.done
    const rows = actionResultsFromRun(result)
    expect(rows).toEqual([
      {
        index: 0,
        kind: 'agent.run',
        nodeId: 'step-1',
        status: 'succeeded',
        output: { finalMessage: REVIEW_TEXT, costUsd: AGENT_COST.costUsd },
        costUsd: AGENT_COST.costUsd,
      },
      {
        index: 1,
        kind: 'decision',
        nodeId: 'step-2',
        status: 'succeeded',
        output: { choice: 'approve' },
      },
      {
        index: 2,
        kind: 'integration.invoke',
        nodeId: 'step-3',
        status: 'succeeded',
        output: { id: 991, state: 'COMMENTED' },
      },
    ])
  })
})
