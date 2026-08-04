import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  type AuthoredProfile,
  asAuthoredProfile,
  supervisorInstructions,
} from '../../src/runtime/supervise/authoring'
import { driverAgent } from '../../src/runtime/supervise/coordination-driver'
import { supervisorPolicyPrompt } from '../../src/runtime/supervise/prompt-registry'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { defaultSupervisorPrompt } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { type ScriptedTurn, scriptedBrain } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

// A delivering leaf worker (settles valid) — stands in for a real model call in this offline proof.
function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield { kind: 'cost', usd: 0 } as UsageEvent
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
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor: ex }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

describe('supervisor authoring — the supervisor DESIGNS each worker (profile), guided by a skill', () => {
  it('authors a DISTINCT, tailored profile per sub-task, and they flow to the workers', async () => {
    const authored: AuthoredProfile[] = []
    // The scripted supervisor (what a skill-guided LLM would emit): two sub-tasks, two tailored recipes.
    const turns: ScriptedTurn[] = [
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: {
              profile: testAgentProfile('parser', {
                prompt: {
                  systemPrompt:
                    'You are a PARSER specialist. Tokenize the expression into numbers, operators and parens; emit a JSON token list. Validate balanced parens.',
                },
              }),
              task: 'parse the expression',
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: {
              profile: testAgentProfile('evaluator', {
                prompt: {
                  systemPrompt:
                    'You are an EVALUATOR specialist. Given a token list, apply operator precedence and compute the numeric result. Return only the number.',
                },
                model: { provider: 'tangle-router', default: 'deepseek-chat' },
              }),
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
    const makeWorker = (raw: AgentProfile): Agent<unknown, unknown> => {
      const p = asAuthoredProfile(raw)
      if (p) authored.push(p)
      return deliveringLeaf(p?.name ?? `w${n++}`, { ok: true })
    }

    const blobs = new InMemoryResultBlobStore() // ONE shared store: workers settle into it, finalize reads it
    const root = driverAgent({
      name: 'supervisor',
      brain: scriptedBrain(turns),
      blobs,
      makeWorkerAgent: makeWorker,
      perWorker,
      systemPrompt: supervisorInstructions({ goal: 'evaluate an arithmetic expression' }), // the SKILL is the supervisor's prompt
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
    expect(authored[0]!.prompt.systemPrompt).not.toBe(authored[1]!.prompt.systemPrompt)
    expect(authored[0]!.prompt.systemPrompt).toContain('PARSER')
    expect(authored[1]!.model?.default).toBe('deepseek-chat')
  })

  it('rejects an empty/placeholder profile (a skill violation the system can catch)', () => {
    expect(asAuthoredProfile({})).toBeNull()
    expect(asAuthoredProfile(testAgentProfile('w'))).toBeNull()
    expect(
      asAuthoredProfile(testAgentProfile('w', { prompt: { systemPrompt: 'real instructions' } }))
        ?.name,
    ).toBe('w')
  })

  describe('asAuthoredProfile', () => {
    it('preserves a complete canonical profile, including its other prompt fields', () => {
      const authored = testAgentProfile('w', {
        prompt: { systemPrompt: 'canonical', instructions: ['one'] },
        model: { provider: 'offline', default: 'm', small: 's' },
      })
      expect(asAuthoredProfile(authored)).toEqual(authored)
    })

    it('refuses a canonical profile whose system prompt is blank', () => {
      expect(
        asAuthoredProfile(testAgentProfile('w', { prompt: { systemPrompt: '  ' } })),
      ).toBeNull()
    })

    it('uses the canonical worker name when the optional name is omitted', () => {
      const profile = testAgentProfile('temporary', {
        prompt: { systemPrompt: 'Do the assigned work.' },
      })
      const { name: _name, ...unnamed } = profile
      expect(asAuthoredProfile(unnamed)?.name).toBe('worker')
    })
  })

  it('the skill is the supervisor prompt and demands authored (non-empty) profiles', () => {
    const skill = supervisorInstructions()
    expect(skill).toContain('You are a supervisor')
    expect(skill).toContain('spawn_agent')
    expect(skill.toLowerCase()).toContain('never spawn a worker with an empty profile')
  })

  it('both front doors carry the ONE registry policy — entry point no longer selects the stance', () => {
    // The package used to ship two contradictory defaults: the router arm's "do small work
    // YOURSELF" vs the delegate door's "you do NOT do the work yourself". This is the
    // discriminating check: the exact policy text is a shared block of BOTH prompts, and the old
    // contradictory opener is gone.
    expect(defaultSupervisorPrompt).toBe(supervisorPolicyPrompt.text)
    expect(supervisorInstructions()).toContain(supervisorPolicyPrompt.text)
    expect(supervisorInstructions()).not.toContain('You do NOT do the work yourself')
    expect(defaultSupervisorPrompt).not.toContain(
      'Do small, sequential work YOURSELF when you have work tools',
    )
  })
})
