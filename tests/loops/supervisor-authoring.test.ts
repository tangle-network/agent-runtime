import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  type AuthoredProfile,
  asAuthoredProfile,
  supervisorSkill,
} from '../../src/runtime/supervise/authoring'
import {
  coordinationDriverAgent,
  type DriverChat,
  type DriverTurn,
} from '../../src/runtime/supervise/coordination-driver'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'

// A delivering leaf worker (settles valid) — stands in for a real model call in this offline proof.
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

function scriptedChat(turns: DriverTurn[]): DriverChat {
  let i = 0
  return {
    next: async () => {
      const t = turns[Math.min(i, turns.length - 1)] ?? {}
      i += 1
      return t
    },
  }
}

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

describe('supervisor authoring — the supervisor DESIGNS each worker (profile), guided by a skill', () => {
  it('authors a DISTINCT, tailored profile per sub-task, and they flow to the workers', async () => {
    const authored: AuthoredProfile[] = []
    // The scripted supervisor (what a skill-guided LLM would emit): two sub-tasks, two tailored recipes.
    const turns: DriverTurn[] = [
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: {
              profile: {
                name: 'parser',
                systemPrompt:
                  'You are a PARSER specialist. Tokenize the expression into numbers, operators and parens; emit a JSON token list. Validate balanced parens.',
              },
              task: 'parse the expression',
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: {
              profile: {
                name: 'evaluator',
                systemPrompt:
                  'You are an EVALUATOR specialist. Given a token list, apply operator precedence and compute the numeric result. Return only the number.',
                model: 'deepseek-chat',
              },
              task: 'evaluate the tokens',
            },
          },
        ],
      },
      {
        toolCalls: [
          { name: 'await_event', arguments: {} },
          { name: 'await_event', arguments: {} },
        ],
      },
      { content: 'done' },
    ]

    let n = 0
    const makeWorker = (raw: unknown): Agent<unknown, unknown> => {
      const p = asAuthoredProfile(raw)
      if (p) authored.push(p)
      return deliveringLeaf(p?.name ?? `w${n++}`, { ok: true })
    }

    const blobs = new InMemoryResultBlobStore() // ONE shared store: workers settle into it, finalize reads it
    const root = coordinationDriverAgent({
      name: 'supervisor',
      chat: scriptedChat(turns),
      blobs,
      makeWorkerAgent: makeWorker,
      perWorker,
      systemPrompt: supervisorSkill({ goal: 'evaluate an arithmetic expression' }), // the SKILL is the supervisor's prompt
      maxTurns: 8,
    })
    const result = await createSupervisor<unknown, unknown>().run(root, 'evaluate "1 + 2 * 3"', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'auth',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })

    expect(result.kind).toBe('winner') // a worker delivered
    // The supervisor authored TWO workers with DISTINCT, tailored instructions — not empty placeholders.
    expect(authored.length).toBe(2)
    expect(authored[0]!.name).toBe('parser')
    expect(authored[1]!.name).toBe('evaluator')
    expect(authored[0]!.systemPrompt).not.toBe(authored[1]!.systemPrompt)
    expect(authored[0]!.systemPrompt).toContain('PARSER')
    expect(authored[1]!.model).toBe('deepseek-chat') // the supervisor also chose the model per sub-task
  })

  it('rejects an empty/placeholder profile (a skill violation the system can catch)', () => {
    expect(asAuthoredProfile({})).toBeNull()
    expect(asAuthoredProfile({ systemPrompt: '' })).toBeNull()
    expect(asAuthoredProfile({ systemPrompt: '   ' })).toBeNull()
    expect(asAuthoredProfile({ name: 'w', systemPrompt: 'real instructions' })?.name).toBe('w')
  })

  it('the skill is the supervisor prompt and demands authored (non-empty) profiles', () => {
    const skill = supervisorSkill()
    expect(skill).toContain('SUPERVISOR')
    expect(skill).toContain('spawn_worker')
    expect(skill.toLowerCase()).toContain('never spawn a worker with an empty profile')
  })
})
