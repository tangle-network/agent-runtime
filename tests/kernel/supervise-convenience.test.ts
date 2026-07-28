import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import { supervise, workerFromBackend } from '../../src/runtime/supervise/supervise'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { scriptedBrain } from './scripted-brain'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }

function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
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
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: ex }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

describe('supervise — the one-call convenience (defaults blobs/perWorker/journal/executors)', () => {
  it('runs a supervisor to delivery from just profile + task + worker seam + brain + budget', async () => {
    const brain = scriptedBrain([
      {
        toolCalls: [
          { name: 'spawn_agent', arguments: { profile: { kind: 'worker' }, task: 'go' } },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    const result = await supervise(
      { name: 'root', harness: null, systemPrompt: 'drive the worker' },
      'solve it',
      { budget, makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }), brain },
    )
    expect(result.kind).toBe('winner')
  })

  it('runDir makes the run durable and resumable; unset stays in-memory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supervise-rundir-'))
    try {
      const script = () =>
        scriptedBrain([
          {
            toolCalls: [
              { name: 'spawn_agent', arguments: { profile: { kind: 'worker' }, task: 'go' } },
            ],
          },
          { toolCalls: [{ name: 'await_event', arguments: {} }] },
          { content: 'done' },
        ])
      const opts = {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
        runId: 'durable-run',
        runDir: dir,
      }

      const first = await supervise({ name: 'root', harness: null }, 'solve it', {
        ...opts,
        brain: script(),
      })
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
      const second = await supervise({ name: 'root', harness: null }, 'solve it', {
        ...opts,
        brain: script(),
      })
      expect(second.kind).toBe('winner')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('workerFromBackend builds a spawnable worker leaf with an executor (no network)', () => {
    const make = workerFromBackend({
      backend: 'router-tools',
      routerBaseUrl: 'http://localhost',
      routerKey: 'k',
      model: 'm',
    } as ExecutorConfig)
    const w = make({ name: 'w' }) as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    expect(w.name).toBe('w')
    expect(w.executorSpec.executor).toBeDefined()
  })

  it('fails loud with neither backend nor makeWorkerAgent', () => {
    expect(() => supervise({ name: 'r', harness: null }, 't', { budget })).toThrow(
      /backend|makeWorkerAgent/,
    )
  })

  it('allowedModels rejects a profile model outside the allowed set', () => {
    expect(() =>
      supervise({ name: 'r', harness: null, model: 'gpt-4.1' }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        allowedModels: ['deepseek-v4-flash'],
      }),
    ).toThrow(/gpt-4\.1.*not in the allowed set/)
  })

  it('allowedModels rejects a router model outside the allowed set', () => {
    expect(() =>
      supervise({ name: 'r', harness: null }, 't', {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        router: { routerBaseUrl: 'http://localhost', routerKey: 'k', model: 'gpt-4.1' },
        allowedModels: ['deepseek-v4-flash'],
      }),
    ).toThrow(/gpt-4\.1.*not in the allowed set/)
  })

  it('allowedModels rejects a backend model outside the allowed set', () => {
    expect(() =>
      supervise({ name: 'r', harness: null }, 't', {
        budget,
        backend: {
          backend: 'router-tools',
          routerBaseUrl: 'http://localhost',
          routerKey: 'k',
          model: 'gpt-4.1',
        } as ExecutorConfig,
        allowedModels: ['deepseek-v4-flash'],
      }),
    ).toThrow(/gpt-4\.1.*not in the allowed set/)
  })

  it('allowedModels passes when every configured model is in the set', async () => {
    const brain = scriptedBrain([{ content: 'done' }])
    const result = await supervise(
      { name: 'root', harness: null, model: 'deepseek-v4-flash' },
      't',
      {
        budget,
        makeWorkerAgent: () => deliveringLeaf('w', { answer: 1 }),
        brain,
        allowedModels: ['deepseek-v4-flash'],
      },
    )
    expect(result.kind).toBeDefined()
  })

  it('allowedModels unset is unrestricted (any model passes)', async () => {
    const brain = scriptedBrain([{ content: 'done' }])
    const result = await supervise({ name: 'root', harness: null, model: 'anything' }, 't', {
      budget,
      makeWorkerAgent: () => deliveringLeaf('w', { answer: 1 }),
      brain,
    })
    expect(result.kind).toBeDefined()
  })
})
