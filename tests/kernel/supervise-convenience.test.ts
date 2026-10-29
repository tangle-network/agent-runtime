import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/in-memory-spawn-stores'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import type { SuperviseOptions } from '../../src/runtime/supervise/supervise'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { superviseForTest } from '../helpers/runtime-with-test-brain'
import { scriptedDriverBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }

function rootProfile(overrides: Parameters<typeof testAgentProfile>[1] = {}): AgentProfile {
  return testAgentProfile('root', { harness: 'cli-base', ...overrides })
}

function workerProfile(name = 'worker'): AgentProfile {
  return testAgentProfile(name)
}

function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield { kind: 'cost', usd: 0, usdKnown: true, provenance: 'provider-receipt' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${name}`,
      out,
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: workerProfile(name), harness: null, executor: ex }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

describe('supervise — the one-call convenience (defaults blobs/perWorker/journal/executors)', () => {
  it('uses a child-specific completion check when a managed child submits its own result', async () => {
    let childCheckCalls = 0
    let childRefusal: unknown
    const journal = new InMemorySpawnJournal()
    const child = testAgentProfile('specialist', {
      harness: 'opencode',
      tools: runtimeToolDeclarations('submit_result'),
    })
    const call = async (url: string, name: string, args: Record<string, unknown>) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: name,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      })
      return response.json()
    }
    let rootTurns = 0
    const driveHarness: DriveHarness = async ({ profile, coordinationMcpUrl }) => {
      if (profile.name === 'root') {
        // The root spawns on its first turn and ends it; its wake has nothing more to start.
        rootTurns += 1
        if (rootTurns === 1) {
          await call(coordinationMcpUrl, 'spawn_worker', { profile: child, task: 'solve' })
        }
        return
      }
      childRefusal = await call(coordinationMcpUrl, 'submit_result', { result: { answer: 0 } })
      await call(coordinationMcpUrl, 'submit_result', { result: { answer: 42 } })
    }

    const result = await superviseForTest(
      testAgentProfile('root', {
        harness: 'opencode',
        tools: runtimeToolDeclarations('spawn_worker'),
      }),
      'delegate',
      {
        budget,
        perWorker: { maxIterations: 4, maxTokens: 10_000 },
        makeLeafAgent: () => deliveringLeaf('unused', {}),
        driveHarness,
        journal,
        runId: 'parent-contract',
        // The run-wide check deliberately rejects the child's output. A profile-managed child
        // must instead receive the check selected for its exact authorized assignment.
        deliverable: {
          check: () => ({
            pass: false,
            failures: ['FAIL root-obligation run: remains incomplete'],
          }),
        },
        // A deadline already past: no manager is re-entered for its unmet check, so the counts below are exact.
        continuation: testContinuation({ deadline: 1 }),
        resolveDeliverable: (input) =>
          input.profile.name === 'specialist'
            ? {
                check: (value) => {
                  childCheckCalls += 1
                  const answer =
                    typeof value === 'object' && value !== null
                      ? (value as { answer?: unknown }).answer
                      : undefined
                  return answer === 42
                    ? true
                    : { pass: false, failures: ['FAIL answer result.answer: must equal 42'] }
                },
              }
            : undefined,
      },
    )

    // The child receives its own refusal before its corrected submission passes.
    expect(childCheckCalls).toBe(2)
    expect(JSON.stringify(childRefusal)).toContain('FAIL answer result.answer: must equal 42')
    expect(JSON.stringify(childRefusal)).not.toContain('root-obligation')
    expect(await journal.loadTree('parent-contract')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'settled',
          id: 'parent-contract:s0',
          status: 'done',
          verdict: expect.objectContaining({ valid: true }),
        }),
      ]),
    )
    // A child that satisfies its narrower assignment does not complete the parent. The run-wide
    // check rejects the child's output, no continuation is configured, so the parent's contract
    // stays unmet and the partial component is not promoted to the winner.
    expect(result.kind).toBe('no-winner')
  })

  it('a managed child with no check of its own settles on its accepted submission and wakes its manager', async () => {
    // test-retained-root-wake-20261018b (2026-10-18): the child's submit_result was refused with the
    // run's check ("Expected: the canary runs to its deadline"), so it never settled and its waiting
    // manager was only ever woken by the heartbeat.
    const journal = new InMemorySpawnJournal()
    const child = testAgentProfile('delay', {
      harness: 'opencode',
      tools: runtimeToolDeclarations('submit_result'),
    })
    const call = async (url: string, name: string, args: Record<string, unknown>) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: name,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      })
      return response.json()
    }
    const rootTasks: unknown[] = []
    let childReply: unknown
    const driveHarness: DriveHarness = async ({ profile, task, coordinationMcpUrl }) => {
      if (profile.name === 'root') {
        rootTasks.push(task)
        if (rootTasks.length === 1) {
          await call(coordinationMcpUrl, 'spawn_worker', {
            profile: child,
            task: 'submit CHILD: ready',
          })
        }
        return
      }
      childReply = await call(coordinationMcpUrl, 'submit_result', { result: 'CHILD: ready' })
    }

    await superviseForTest(
      testAgentProfile('root', {
        harness: 'opencode',
        tools: runtimeToolDeclarations('spawn_worker'),
      }),
      'delegate',
      {
        budget,
        perWorker: { maxIterations: 4, maxTokens: 10_000 },
        makeLeafAgent: () => deliveringLeaf('unused', {}),
        driveHarness,
        journal,
        runId: 'own-submission',
        // The run's check passes nothing, as a Lab run's does until its deadline.
        deliverable: {
          describe: 'what only the run deadline ends',
          check: () => ({ pass: false, failures: ['FAIL run: incomplete'] }),
        },
        continuation: testContinuation({ deadline: 1 }),
      },
    )

    // The child's submission is accepted against no check but its own, and settles it done.
    expect(JSON.stringify(childReply)).toMatch(/accepted\\?"\s*:\s*true/)
    expect(JSON.stringify(childReply)).not.toContain('FAIL run')
    expect(await journal.loadTree('own-submission')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'settled', id: 'own-submission:s0', status: 'done' }),
      ]),
    )
    // The settle, not the heartbeat, starts the manager's next turn.
    expect(rootTasks.length).toBeGreaterThanOrEqual(2)
    expect(String(rootTasks[1])).toContain('own-submission:s0')
    expect(String(rootTasks[1])).toContain('"settled"')
    expect(String(rootTasks[1])).not.toContain('Nothing reached your inbox')
  })

  it('runDir makes the run durable and resumable; unset stays in-memory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supervise-rundir-'))
    try {
      const script = () =>
        scriptedDriverBrain([
          {
            toolCalls: [
              { name: 'spawn_worker', arguments: { profile: workerProfile(), task: 'go' } },
            ],
          },
          { content: 'waiting for the worker' },
          { content: 'done' },
        ])
      const opts = {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
        runId: 'durable-run',
        runDir: dir,
      }

      const first = await superviseForTest(
        rootProfile({ tools: runtimeToolDeclarations('spawn_worker') }),
        'solve it',
        {
          ...opts,
          brain: script(),
        },
      )
      expect(first.kind).toBe('winner')

      // The journal really landed on disk with the settled child, not in a process-lifetime map.
      const journal = await readFile(join(dir, 'spawn-journal.jsonl'), 'utf8')
      const records = journal
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as { kind: string; event?: { kind: string } })
      expect(records[0]?.kind).toBe('begin')
      expect(records.some((r) => r.event?.kind === 'settled')).toBe(true)

      // A second `supervise()` against the SAME runDir + runId takes the resume path. Without the
      // `resume` flag threaded through, this would fail loud in `beginTree` ("already begun at …,
      // refusing to overwrite") because the wall-clock `at` differs between the two calls.
      const second = await superviseForTest(
        rootProfile({ tools: runtimeToolDeclarations('spawn_worker') }),
        'solve it',
        {
          ...opts,
          brain: script(),
        },
      )
      expect(second.kind).toBe('winner')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('replays one durable settlement with the same event id after the observer commits but loses its acknowledgement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supervise-observer-retry-'))
    try {
      const writes = new Set<string>()
      let physicalWrites = 0
      let acknowledge = false
      let replayCommitted = false
      const observations: Array<{
        eventId: string
        seq: number
        at: number
        resumed: boolean
      }> = []
      const onCoordinationEvent: NonNullable<SuperviseOptions['onCoordinationEvent']> = async (
        _context,
        eventId,
        record,
      ) => {
        if (record.event.type !== 'settled') return
        observations.push({
          eventId,
          seq: record.seq,
          at: record.at,
          resumed: record.event.worker?.resumed === true,
        })
        if (!writes.has(eventId)) {
          writes.add(eventId)
          physicalWrites += 1
        }
        if (!acknowledge) throw new Error('observer commit succeeded; acknowledgement was lost')
        replayCommitted = true
      }
      const common = {
        budget,
        makeWorkerAgent: () => deliveringLeaf('worker', { answer: 42 }),
        runId: 'observer-retry',
        runDir: dir,
        onCoordinationEvent,
      }
      const first = await superviseForTest(
        rootProfile({ tools: runtimeToolDeclarations('spawn_worker') }),
        'solve it',
        {
          ...common,
          brain: scriptedDriverBrain([
            {
              toolCalls: [
                { name: 'spawn_worker', arguments: { profile: workerProfile(), task: 'go' } },
              ],
            },
            { content: 'waiting for the worker' },
            { content: 'stop after the observer error' },
          ]),
        },
      )
      expect(first.kind).toBe('no-winner')
      expect(physicalWrites).toBe(1)
      expect(observations.length).toBeGreaterThan(0)
      expect(new Set(observations.map((entry) => entry.eventId))).toHaveLength(1)

      acknowledge = true
      const replayScript = scriptedDriverBrain([
        { content: 'waiting for the worker' },
        { content: 'finish from committed work' },
      ])
      const replayBrain: typeof replayScript = async (...args) => {
        expect(replayCommitted).toBe(true)
        return replayScript(...args)
      }
      const second = await superviseForTest(
        rootProfile({ tools: runtimeToolDeclarations('spawn_worker') }),
        'solve it',
        {
          ...common,
          brain: replayBrain,
        },
      )

      expect(second.kind).toBe('winner')
      expect(physicalWrites).toBe(1)
      expect(new Set(observations.map((entry) => entry.eventId))).toHaveLength(1)
      expect(observations.some((entry) => entry.resumed)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('supervise — the coordination bind is opt-in and fails closed off loopback', () => {
  const harnessOpts = {
    budget,
    makeWorkerAgent: () => deliveringLeaf('w', {}),
    driveHarness: async () => {},
  }

  it('passes an authenticated non-loopback bind through to the coordination server', async () => {
    let url = ''
    await superviseForTest(testAgentProfile('root', { harness: 'opencode' }), 't', {
      ...harnessOpts,
      driveHarness: async ({ coordinationMcpUrl }) => {
        url = coordinationMcpUrl
      },
      coordination: { host: '0.0.0.0', authentication: true },
    })
    expect(url).toMatch(/^http:\/\/0\.0\.0\.0:\d+\/mcp$/)
  })

  it('binds the requested loopback host without authentication needed', async () => {
    let url = ''
    await superviseForTest(testAgentProfile('root', { harness: 'opencode' }), 't', {
      ...harnessOpts,
      driveHarness: async ({ coordinationMcpUrl }) => {
        url = coordinationMcpUrl
      },
      coordination: { host: '127.0.0.1' },
    })
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })
})

describe('supervise — peerMail threads from options through both supervisor arms', () => {
  async function callTool(
    url: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ result?: unknown; error?: unknown }> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    return (await response.json()) as { result?: unknown; error?: unknown }
  }

  const offlineBackend: ExecutorConfig = {
    backend: 'router-tools',
    routerBaseUrl: 'http://offline.test/v1',
    routerKey: 'test',
    tools: [],
    executeToolCall: async () => '',
    complete: async () => ({
      model: 'offline-test-model',
      choices: [{ message: { content: 'done', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, cost_usd: 0 },
    }),
  }

  it('refuses a router-brained nested driver as a loud spawn error, not a silent no-mail run', async () => {
    const spawnReplies: unknown[] = []
    await superviseForTest(
      testAgentProfile('root', {
        harness: 'opencode',
        tools: runtimeToolDeclarations('spawn_worker', 'stop'),
      }),
      'delegate',
      {
        budget,
        backend: offlineBackend,
        peerMail: true,
        driveHarness: async ({ coordinationMcpUrl }) => {
          spawnReplies.push(
            await callTool(coordinationMcpUrl, 'spawn_worker', {
              profile: testAgentProfile('lead', {
                harness: 'cli-base',
                tools: runtimeToolDeclarations('spawn_worker'),
              }),
              task: 'coordinate',
            }),
          )
          await callTool(coordinationMcpUrl, 'stop', {})
        },
      },
    )
    expect(spawnReplies).toHaveLength(1)
    expect(JSON.stringify(spawnReplies[0])).toContain(
      'peerMail is only served by a harness-brained supervisor',
    )
  })
})
