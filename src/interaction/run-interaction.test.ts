import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { InMemoryInteractionJournal } from './journal'
import { runInteraction } from './run-interaction'
import type { InteractionActor, InteractionTurn } from './types'

interface ProviderCapture {
  creates: number
  gets: string[]
  destroyed: string[]
  turns: Array<AgentTurnInput & { environmentId: string }>
}

function provider(
  name: string,
  reply: (prompt: string, call: number) => string,
  options: { failFirst?: boolean; sessionsContinue?: boolean } = {},
): { provider: AgentEnvironmentProvider; capture: ProviderCapture } {
  const capture: ProviderCapture = { creates: 0, gets: [], destroyed: [], turns: [] }
  const environments = new Map<string, AgentEnvironment>()
  let calls = 0

  const createEnvironment = (id: string): AgentEnvironment => {
    let destroyed = false
    return {
      id,
      provider: name,
      async status() {
        return destroyed ? 'stopped' : 'running'
      },
      async *stream(input): AsyncIterable<AgentEnvironmentEvent> {
        if (destroyed) throw new Error('environment stopped')
        capture.turns.push({ ...input, environmentId: id })
        calls += 1
        if (options.failFirst && calls === 1) throw new Error('network temporarily unavailable')
        const text = reply(input.prompt ?? '', calls)
        yield {
          type: 'result',
          data: { finalText: text },
          usage: { inputTokens: 10, outputTokens: 4, cost: 0.01 },
        }
      },
      async destroy() {
        destroyed = true
        capture.destroyed.push(id)
      },
    }
  }

  return {
    capture,
    provider: {
      name,
      capabilities: () => capabilities(options.sessionsContinue ?? true),
      async create() {
        const id = `${name}-${capture.creates}`
        capture.creates += 1
        const environment = createEnvironment(id)
        environments.set(id, environment)
        return environment
      },
      async get(id) {
        capture.gets.push(id)
        return environments.get(id) ?? null
      },
    },
  }
}

function actor(name: string, provider: AgentEnvironmentProvider): InteractionActor {
  return { name, profile: { name }, provider }
}

describe('runInteraction', () => {
  it('alternates actors through one environment and session each', async () => {
    const a = provider('provider-a', (_prompt, call) => `A${call}`)
    const b = provider('provider-b', (_prompt, call) => `B${call}`)

    const result = await runInteraction({
      actors: [actor('author', a.provider), actor('reviewer', b.provider)],
      prompt: 'Draft the plan.',
      policy: { maxTurns: 4, turnOrder: 'alternate' },
    })

    expect(result.transcript.map((turn) => [turn.actor, turn.text])).toEqual([
      ['author', 'A1'],
      ['reviewer', 'B1'],
      ['author', 'A2'],
      ['reviewer', 'B2'],
    ])
    expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 16, costUsd: 0.04 })
    expect(a.capture.creates).toBe(1)
    expect(b.capture.creates).toBe(1)
    expect(new Set(a.capture.turns.map((turn) => turn.sessionId)).size).toBe(1)
    expect(new Set(b.capture.turns.map((turn) => turn.sessionId)).size).toBe(1)
    expect(a.capture.turns[0]?.prompt).toBe('Draft the plan.')
    expect(b.capture.turns[0]?.prompt).toContain('[author] A1')
    expect(a.capture.turns[1]?.prompt).toBe('[reviewer] B1')
    expect(a.capture.destroyed).toEqual(['provider-a-0'])
    expect(b.capture.destroyed).toEqual(['provider-b-0'])
  })

  it('reattaches persisted actor environments and continues at the next turn', async () => {
    const a = provider('provider-a', (_prompt, call) => `A${call}`)
    const b = provider('provider-b', (_prompt, call) => `B${call}`)
    const existingEnvironment = await a.provider.create({ profile: { name: 'author' } })
    const journal = new InMemoryInteractionJournal()
    await journal.begin('resume-run', '2026-07-25T00:00:00.000Z', 'definition-1')
    await journal.recordActor('resume-run', {
      name: 'author',
      provider: a.provider.name,
      environmentId: existingEnvironment.id,
      sessionId: 'author-session',
    })
    await journal.appendTurn('resume-run', persistedTurn())

    const result = await runInteraction({
      actors: [actor('author', a.provider), actor('reviewer', b.provider)],
      prompt: 'Draft the plan.',
      policy: { maxTurns: 3, turnOrder: 'alternate' },
      runId: 'resume-run',
      definitionId: 'definition-1',
      journal,
    })

    expect(result.transcript.map((turn) => turn.actor)).toEqual(['author', 'reviewer', 'author'])
    expect(a.capture.creates).toBe(1)
    expect(a.capture.gets).toEqual([existingEnvironment.id])
    expect(a.capture.turns[0]?.sessionId).toBe('author-session')
    expect(a.capture.turns[0]?.prompt).toBe('[reviewer] B1')
  })

  it('retries one logical turn with the same provider identity', async () => {
    const a = provider('provider-a', () => 'recovered', { failFirst: true })
    const b = provider('provider-b', () => 'unused')

    const result = await runInteraction({
      actors: [
        {
          ...actor('author', a.provider),
          callPolicy: { maxRetries: 1, retryBackoffMs: 0 },
        },
        actor('reviewer', b.provider),
      ],
      prompt: 'Draft the plan.',
      policy: { maxTurns: 1 },
    })

    expect(result.transcript[0]?.attempts).toBe(2)
    expect(a.capture.turns).toHaveLength(2)
    expect(a.capture.turns[0]?.turnId).toBe(a.capture.turns[1]?.turnId)
    expect(a.capture.turns[0]?.sessionId).toBe(a.capture.turns[1]?.sessionId)
    expect(a.capture.turns[0]?.environmentId).toBe(a.capture.turns[1]?.environmentId)
  })

  it('rejects unsupported session continuation before creating environments', async () => {
    const a = provider('provider-a', () => 'A', { sessionsContinue: false })
    const b = provider('provider-b', () => 'B')

    await expect(
      runInteraction({
        actors: [actor('author', a.provider), actor('reviewer', b.provider)],
        prompt: 'Draft the plan.',
        policy: { maxTurns: 2 },
      }),
    ).rejects.toThrow('does not support session continuation')
    expect(a.capture.creates).toBe(0)
    expect(b.capture.creates).toBe(0)
  })
})

function persistedTurn(): InteractionTurn {
  return {
    index: 0,
    actor: 'author',
    turnId: 'resume-run.turn.0.author',
    environmentId: 'provider-a-0',
    sessionId: 'author-session',
    text: 'A0',
    usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.01 },
    attempts: 1,
    startedAt: '2026-07-25T00:00:01.000Z',
    endedAt: '2026-07-25T00:00:02.000Z',
  }
}

function capabilities(sessionsContinue: boolean): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: false,
      systemPrompt: true,
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: {
        files: true,
        instructions: true,
        tools: true,
        skills: true,
        agents: true,
        commands: true,
      },
      hooks: true,
      modes: true,
      runtimeUpdate: true,
      validation: true,
    },
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: sessionsContinue, list: true, messages: true },
    workspace: { read: true, write: true, exec: true, git: true, upload: true, download: true },
    branching: { checkpoint: true, fork: true },
    placement: true,
    usage: true,
    confidential: false,
  }
}
