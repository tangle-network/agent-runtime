import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProfileDiff,
  applyAgentProfileDiff,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertPursuitVersions,
  type PursuitVersions,
  type VersionJudge,
} from '../../src/durable/pursuit-versions'
import { FileSpawnJournal } from '../../src/durable/spawn-journal'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  SpawnEvent,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }
const perWorker: Budget = { maxIterations: 4, maxTokens: 1_000 }
const task = 'deliver one settled result'
const rootProfile = testAgentProfile('versions-root', {
  prompt: { systemPrompt: 'Delegate once, wait, then stop.' },
  tools: runtimeToolDeclarations('spawn_worker', 'await_event', 'stop'),
})
const digest = `sha256:${'a'.repeat(64)}` as const

describe('supervisePursuit versions', () => {
  let root: string
  let driven: number
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pursuit-versions-'))
    driven = 0
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('continues from the best version until the judge stops improving, and records each parent', async () => {
    // Version 2 is the best; versions 3 and 4 both fork from it and neither beats it.
    const scores = [1, 3, 2, 3]
    const firstDir = join(root, 'run')
    const chain = await run(firstDir, {
      judge: judgeFrom(scores),
      next: ({ best, versions }) => change(`prompt:v${versions.length + 1}-from-v${best.version}`),
      stop: { patience: 2, maxVersions: 10, maxUsd: 100, deadlineMs: 600_000 },
    })

    const record = chain.versions!
    expect(driven).toBe(4)
    expect(record.stopped.reason).toBe('no-improvement')
    expect(record.best).toBe(2)
    expect(
      record.versions.map((item) => [item.version, item.verdict.score, item.improved]),
    ).toEqual([
      [1, 1, true],
      [2, 3, true],
      [3, 2, false],
      [4, 3, false],
    ])
    expect(record.versions.map((item) => item.parent?.runId)).toEqual([
      undefined,
      'run:versions',
      'run:versions.v2',
      'run:versions.v2',
    ])
    expect(chain.settlePath).toBe(join(`${firstDir}.v2`, 'result.json'))

    // Each later version is a Runtime fork of its parent: its root records the parent, the seal
    // and the change, and executes the parent's profile plus that change.
    const v2 = record.versions[1]!
    const v4 = record.versions[3]!
    const v4Root = await rootSpawn(`${firstDir}.v4`, 'run:versions.v4')
    expect(v4Root.identity?.correlation).toMatchObject({
      forkParentRunId: 'run:versions.v2',
      forkParentSettleDigest: v2.settleDigest,
      forkProfileDiffId: 'prompt:v4-from-v2',
      lineageRootRunId: 'run:versions',
    })
    expect(v4Root.identity?.profileDigest).toBe(
      canonicalAgentProfileDigest(applyAgentProfileDiff(v2.profile, v4.change!)),
    )
    expect(v4.lineage).toEqual({
      source: 'human',
      runIds: ['run:versions.v2'],
      profileDiffIds: ['prompt:v4-from-v2'],
    })

    // The ledger holds the same chain, and a second call reads it back without running anything.
    const ledger = (await readFile(join(`${firstDir}.versions`, 'versions.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string })
    expect(ledger.map((line) => line.kind)).toEqual([
      'chain',
      'judged',
      'start',
      'judged',
      'start',
      'judged',
      'start',
      'judged',
      'stopped',
    ])
    const again = await run(firstDir, {
      judge: judgeFrom(scores),
      next: () => {
        throw new Error('a stopped chain asks for no change')
      },
      stop: { patience: 2, maxVersions: 10, maxUsd: 100, deadlineMs: 600_000 },
    })
    expect(driven).toBe(4)
    expect(again.versions?.stopped).toEqual(record.stopped)
  }, 120_000)

  it('never starts a version past its version, dollar or time cap', async () => {
    const caps: Array<[string, PursuitVersions['stop'], number, string, number]> = [
      [
        'versions',
        { patience: 9, maxVersions: 2, maxUsd: 100, deadlineMs: 600_000 },
        2,
        'max-versions',
        0,
      ],
      // Every version spends $1, so the second reaches a $1.50 cap and no third starts.
      [
        'dollars',
        { patience: 9, maxVersions: 9, maxUsd: 1.5, deadlineMs: 600_000 },
        2,
        'max-usd',
        0,
      ],
      // The chain's clock runs out while the judge reads the first version.
      [
        'time',
        { patience: 9, maxVersions: 9, maxUsd: 100, deadlineMs: 1_000 },
        1,
        'deadline',
        1_200,
      ],
    ]
    for (const [label, stop, ran, reason, judgeMs] of caps) {
      driven = 0
      const firstDir = join(root, label)
      const chain = await run(firstDir, {
        judge: judgeFrom([1, 2, 3, 4, 5, 6, 7, 8, 9], judgeMs),
        next: ({ versions }) => change(`prompt:${label}-v${versions.length + 1}`),
        stop,
      })
      expect(chain.versions?.stopped.reason, label).toBe(reason)
      expect(chain.versions?.versions.length, label).toBe(ran)
      expect(driven, label).toBeLessThanOrEqual(ran)
      expect(await exists(`${firstDir}.v${ran + 1}`), label).toBe(false)
    }
  }, 120_000)

  it('refuses a chain without every cap, and a verdict from another judge', async () => {
    const stop = { patience: 1, maxVersions: 2, maxUsd: 1, deadlineMs: 1_000 }
    for (const missing of ['patience', 'maxVersions', 'maxUsd', 'deadlineMs'] as const) {
      const { [missing]: _dropped, ...partial } = stop
      expect(() =>
        assertPursuitVersions({ judge: judgeFrom([1]), next: () => change('x'), stop: partial }),
      ).toThrow(new RegExp(`stop.${missing}`))
    }
    const impostor: VersionJudge = {
      digest,
      judge: async () => ({ score: 1, judgeDigest: `sha256:${'b'.repeat(64)}` }),
    }
    await expect(
      run(join(root, 'impostor'), { judge: impostor, next: () => change('x'), stop }),
    ).rejects.toThrow(/not the pinned judge/)
  })

  function run(runDir: string, versions: PursuitVersions) {
    return supervisePursuit(rootProfile, task, {
      pursuitId: 'pursuit:versions',
      runId: 'run:versions',
      runDir,
      budget,
      perWorker,
      driveHarness: async (input) => {
        driven += 1
        await driveHarness(input)
      },
      makeWorkerAgent: () => deliveringLeaf('worker', 1),
      versions,
    })
  }
})

function judgeFrom(scores: readonly number[], delayMs = 0): VersionJudge {
  return {
    digest,
    judge: async (version) => {
      if (delayMs > 0) await new Promise((done) => setTimeout(done, delayMs))
      return {
        score: scores[version.version - 1] ?? null,
        judgeDigest: digest,
        detail: { runId: version.runId },
      }
    },
  }
}

function change(id: string): AgentProfileDiff {
  return {
    kind: 'agent-profile-diff',
    id,
    source: { kind: 'human' },
    set: { name: 'versions-root', prompt: { appendSystemPrompt: `Change ${id}.` } },
  }
}

async function rootSpawn(runDir: string, runId: string) {
  const events =
    (await new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl')).loadTree(runId)) ?? []
  const spawned = events.find(
    (event): event is Extract<SpawnEvent, { kind: 'spawned' }> =>
      event.kind === 'spawned' && event.parent === undefined,
  )
  if (spawned === undefined) throw new Error(`no root spawn in ${runDir}`)
  return spawned
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

function deliveringLeaf(name: string, usd: number): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'record-test-worker',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield { kind: 'cost', usd, usdKnown: true, provenance: 'provider-receipt' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `record:${name}`,
      out: { worker: name },
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => ({ worker: name }), executorSpec: spec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

async function jsonRpc(url: string, method: string, params: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) throw new Error(`coordination MCP returned ${response.status}`)
  const body = await response.json()
  if (body.error || body.result?.isError) throw new Error(JSON.stringify(body))
}

const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
  await jsonRpc(coordinationMcpUrl, 'tools/call', {
    name: 'spawn_worker',
    arguments: { profile: testAgentProfile('worker'), task: 'deliver', label: 'worker' },
  })
  await jsonRpc(coordinationMcpUrl, 'tools/call', {
    name: 'await_event',
    arguments: { kinds: ['settled'] },
  })
  await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
}
