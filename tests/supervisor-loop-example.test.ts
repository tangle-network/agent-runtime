import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  demoCheck,
  demoGoal,
  expectedAnswer,
  scriptedSupervisorChat,
} from '../examples/supervisor-loop/shared'
import { gateOnDeliverable } from '../src/runtime/supervise/completion-gate'
import { supervise } from '../src/runtime/supervise/supervise'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../src/runtime/supervise/types'

// ── An offline worker leaf — returns the ANSWER=42 marker, no network/LLM ─────────
// The example's runners build this leaf from a real backend (`workerFromBackend`); here
// we inject an equivalent in-process executor so the surviving supervise() + scripted-brain
// path runs end-to-end at $0. The output rides the `content` field so the example's deployable
// check (`demoCheck`) matches its content branch.
function answerExecutor(): Executor<unknown> {
  const out = { content: expectedAnswer }
  return {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      return (async function* () {
        yield { kind: 'iteration' }
        yield { kind: 'tokens', input: 1, output: 1 }
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      return {
        outRef: `worker:${expectedAnswer}`,
        out,
        spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
      }
    },
  }
}

/** The worker seam the example's scripted brain spawns into: an offline leaf gated on the
 *  SAME deployable check (`demoCheck`) the real runners use — settled ⟺ delivered. */
function makeWorkerAgent(rawProfile: unknown): Agent<unknown, unknown> {
  const p = (rawProfile ?? {}) as { name?: unknown }
  const name = typeof p.name === 'string' && p.name.length > 0 ? p.name : 'worker'
  const spec: AgentSpec = {
    profile: { name } as AgentProfile,
    harness: null,
    executor: gateOnDeliverable(answerExecutor(), {
      check: demoCheck,
      describe: `worker output contains ${expectedAnswer}`,
    }),
  }
  return { name, act: async () => '', executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

describe('supervisor-loop example — supervise() on the scripted brain (offline, $0)', () => {
  it('the surviving example path drives a worker to a CHECKED delivery and returns a winner', async () => {
    const result = await supervise(
      {
        name: 'supervisor',
        harness: 'cli-base',
        prompt: {
          systemPrompt: 'You are a supervisor. Spawn a worker, await it, and stop on delivery.',
        },
      },
      demoGoal,
      {
        // The example's offline brain (a fixed spawn → await → stop plan) + an injected worker
        // seam — exactly the no-creds wiring the runners default to.
        brain: scriptedSupervisorChat(1, 'solver'),
        makeWorkerAgent,
        budget: { maxIterations: 50, maxTokens: 500_000 },
        runId: 'supervisor-loop-example-test',
      },
    )

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') {
      expect(demoCheck(result.out)).toBe(true)
      expect((result.out as { content: string }).content).toBe(expectedAnswer)
      // One worker was spawned + delivered.
      expect(result.tree.nodes.length).toBeGreaterThanOrEqual(1)
    }
  })
})
