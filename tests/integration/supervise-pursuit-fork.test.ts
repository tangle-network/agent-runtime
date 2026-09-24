import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProfileDiff,
  applyAgentProfileDiff,
  canonicalAgentProfileDigest,
  type Sha256Digest,
  sha256Bytes,
} from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RUN_FORK_CORRELATION_KEYS } from '../../src/durable/run-fork'
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
const rootProfile = testAgentProfile('fork-root', {
  prompt: { systemPrompt: 'Delegate once, wait, then stop.' },
  tools: runtimeToolDeclarations('spawn_worker', 'await_event', 'stop'),
})
const change: AgentProfileDiff = {
  kind: 'agent-profile-diff',
  id: 'prompt:state-the-plan',
  set: { name: 'fork-root', prompt: { appendSystemPrompt: 'State the plan before you delegate.' } },
}

describe('supervisePursuit fork', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pursuit-fork-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('runs the parent profile plus one change, records the parent, and never writes the parent', async () => {
    const parentDir = join(root, 'parent')
    await run(parentDir, 'run:parent')
    const settleDigest = await settleDigestOf(parentDir)
    const before = await treeDigests(parentDir)

    const forkDir = join(root, 'fork')
    const forked = await run(forkDir, 'run:fork', {
      fork: { runDir: parentDir, settleDigest, change },
      execution: { correlation: { experimentId: 'versions' } },
    })

    expect(forked.result.kind).toBe('winner')
    expect(await treeDigests(parentDir)).toEqual(before)
    const identity = (await rootSpawn(forkDir, 'run:fork')).identity
    expect(identity?.profileDigest).toBe(
      canonicalAgentProfileDigest(applyAgentProfileDiff(rootProfile, change)),
    )
    expect(Object.keys(identity?.correlation ?? {})).toEqual(
      expect.arrayContaining([...RUN_FORK_CORRELATION_KEYS]),
    )
    expect(identity?.correlation).toEqual({
      experimentId: 'versions',
      forkParentRunId: 'run:parent',
      forkParentSettleDigest: settleDigest,
      forkProfileDiffId: change.id,
      lineageRootRunId: 'run:parent',
    })

    // A fork of the fork stays in the first run's lineage. Its parent profile is the fork's.
    const grandchildDir = join(root, 'grandchild')
    await run(grandchildDir, 'run:grandchild', {
      profile: applyAgentProfileDiff(rootProfile, change),
      fork: {
        runDir: forkDir,
        settleDigest: await settleDigestOf(forkDir),
        change: { kind: 'agent-profile-diff', id: 'name:v3', set: { name: 'fork-root-v3' } },
      },
    })
    const lineage = (await rootSpawn(grandchildDir, 'run:grandchild')).identity?.correlation
    expect(lineage?.forkParentRunId).toBe('run:fork')
    expect(lineage?.lineageRootRunId).toBe('run:parent')
  })

  it('refuses before the fork journal exists when the fork is not the parent plus one change', async () => {
    const parentDir = join(root, 'parent')
    await run(parentDir, 'run:parent')
    const settleDigest = await settleDigestOf(parentDir)
    const unsettledDir = join(root, 'unsettled')
    await mkdir(unsettledDir)
    const refusals: Array<[string, Record<string, unknown>, RegExp]> = [
      [
        'a different seal',
        { fork: { runDir: parentDir, settleDigest: `sha256:${'0'.repeat(64)}`, change } },
        /hashes to sha256:/,
      ],
      [
        'a changed task',
        { task: 'another task', fork: { runDir: parentDir, settleDigest, change } },
        /task is not the parent's/,
      ],
      [
        'a changed budget',
        {
          budget: { ...budget, maxIterations: 99 },
          fork: { runDir: parentDir, settleDigest, change },
        },
        /budget is not the parent's/,
      ],
      [
        'a change that changes nothing',
        {
          fork: {
            runDir: parentDir,
            settleDigest,
            change: { kind: 'agent-profile-diff', id: 'noop', set: { name: 'fork-root' } },
          },
        },
        /leaves the parent's profile unchanged/,
      ],
      [
        'a change without an id',
        { fork: { runDir: parentDir, settleDigest, change: { ...change, id: undefined } } },
        /change.id must be a non-empty string/,
      ],
      [
        'a caller-written fork key',
        {
          execution: { correlation: { lineageRootRunId: 'forged' } },
          fork: { runDir: parentDir, settleDigest, change },
        },
        /cannot set lineageRootRunId/,
      ],
      [
        'an unsettled parent',
        { fork: { runDir: unsettledDir, settleDigest, change } },
        /holds no result.json/,
      ],
    ]
    for (const [label, overrides, message] of refusals) {
      const forkDir = join(root, `refused-${label.replaceAll(' ', '-')}`)
      await expect(run(forkDir, 'run:fork', overrides), label).rejects.toThrow(message)
      expect(await exists(forkDir), label).toBe(false)
    }
    await expect(
      run(join(root, 'same-run-id'), 'run:parent', {
        fork: { runDir: parentDir, settleDigest, change },
      }),
    ).rejects.toThrow(/a fork needs its own runId/)
  })

  it('refuses a fork directory inside or around the parent, which would write the parent', async () => {
    const parentDir = join(root, 'parent')
    await run(parentDir, 'run:parent')
    const settleDigest = await settleDigestOf(parentDir)
    const before = await treeDigests(parentDir)

    for (const forkDir of [join(parentDir, 'forks', 'v2'), root]) {
      await expect(
        run(forkDir, 'run:fork', { fork: { runDir: parentDir, settleDigest, change } }),
      ).rejects.toThrow(/overlaps the parent's runDir/)
    }
    expect(await treeDigests(parentDir)).toEqual(before)
    expect(await exists(join(parentDir, 'forks'))).toBe(false)
    expect(await exists(join(root, 'supervise.lock'))).toBe(false)
  })

  it('refuses a parent with a node that never reached a terminal record', async () => {
    const parentDir = join(root, 'parent')
    await run(parentDir, 'run:parent')
    const settleDigest = await settleDigestOf(parentDir)
    // The seal covers result.json; the journal can still hold a child that a lost process started.
    await new FileSpawnJournal(join(parentDir, 'spawn-journal.jsonl')).appendEvent('run:parent', {
      kind: 'spawned',
      id: 'run:parent:s9',
      parent: 'run:parent',
      label: 'lost',
      budget: perWorker,
      runtime: 'record-test-worker',
      seq: 9,
      at: new Date().toISOString(),
    })

    await expect(
      run(join(root, 'fork'), 'run:fork', { fork: { runDir: parentDir, settleDigest, change } }),
    ).rejects.toThrow(/uncertain nodes: run:parent:s9 \(no terminal record\)/)
  })

  it('verifies the fork again on resume, so a resume cannot swap the change', async () => {
    const parentDir = join(root, 'parent')
    await run(parentDir, 'run:parent')
    const settleDigest = await settleDigestOf(parentDir)
    const before = await treeDigests(parentDir)
    const forkDir = join(root, 'fork')
    await run(forkDir, 'run:fork', { fork: { runDir: parentDir, settleDigest, change } })
    // A process that died after its journal and before its settle record leaves this state.
    await rm(join(forkDir, 'result.json'))

    const other: AgentProfileDiff = {
      ...change,
      id: 'prompt:other',
      set: { name: 'fork-root-other' },
    }
    await expect(
      run(forkDir, 'run:fork', { fork: { runDir: parentDir, settleDigest, change: other } }),
    ).rejects.toThrow(/resume identity mismatch/)
    const resumed = await run(forkDir, 'run:fork', {
      fork: { runDir: parentDir, settleDigest, change },
    })
    expect(resumed.result.kind).toBe('winner')
    expect(await treeDigests(parentDir)).toEqual(before)
  })
})

function run(runDir: string, runId: string, overrides: Record<string, unknown> = {}) {
  const { profile = rootProfile, task: runTask = task, ...options } = overrides
  return supervisePursuit(profile as typeof rootProfile, runTask, {
    pursuitId: 'pursuit:fork',
    runId,
    runDir,
    budget,
    perWorker,
    driveHarness,
    makeWorkerAgent: () => deliveringLeaf('worker'),
    ...options,
  })
}

async function settleDigestOf(runDir: string): Promise<Sha256Digest> {
  return sha256Bytes(await readFile(join(runDir, 'result.json')))
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

/** Every file under a directory, by relative path, with the digest of its bytes. */
async function treeDigests(dir: string, prefix = ''): Promise<Record<string, string>> {
  const digests: Record<string, string> = {}
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) Object.assign(digests, await treeDigests(dir, path))
    else digests[path] = sha256Bytes(await readFile(join(dir, path)))
  }
  return digests
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

function deliveringLeaf(name: string): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'record-test-worker',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield { kind: 'cost', usd: 0, usdKnown: true, provenance: 'provider-receipt' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `record:${name}`,
      out: { worker: name },
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
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
