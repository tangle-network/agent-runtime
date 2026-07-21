/**
 * `runPersonaConversation` — the persona loop runner: run a WORKER `AgentProfile`
 * (the agent under test) as a multi-round conversation driven by a PERSONA (the
 * simulated user), over the persistent conversation transcript.
 *
 * It is profiles-vs-profiles: the persona is itself a driver `AgentProfile` (an
 * LLM role-playing the user from its facts) — `runConversation` runs the two
 * against each other. Scripted persona turns are kept as a deterministic
 * fast-path. Only the WORKER is metered (it is the side under test); the
 * persona-driver is the test harness, not billed against the agent.
 *
 * `runPersonaDispatch` wraps the runner as a `ProfileDispatchFn` so it drops
 * straight into `runProfileMatrix({ dispatch })` — the same loop serves a single
 * cell and the whole matrix, replacing the per-agent hand-rolled
 * `dispatchWithSurface` bridges.
 */

import type { AgentProfile, MaximumCharge } from '@tangle-network/agent-eval'
import type {
  DispatchContext,
  ProfileDispatchFn,
  Scenario,
} from '@tangle-network/agent-eval/campaign'
import { createIterableBackend } from '../backends'
import type { AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { defineConversation } from './define-conversation'
import { runConversation } from './run-conversation'
import type { ConversationTurn, HaltPredicate, HaltReason } from './types'

/** A persona that drives the conversation: either a full driver `AgentProfile`
 *  (an LLM user-sim) or a deterministic script of user turns (the fast-path). */
export type PersonaDriver =
  | { kind: 'profile'; profile: AgentProfile }
  | { kind: 'scripted'; turns: string[] }

export interface RunPersonaConversationOptions {
  /** The agent under test. Metered; its rendered prompt leads its turns. */
  worker: AgentProfile
  /** The simulated user driving the dialogue. */
  persona: PersonaDriver
  /** Turn an `AgentProfile` into a runnable backend (router / sandbox / fake).
   *  Applied to the worker and to a `profile`-kind persona. */
  backendFor: (profile: AgentProfile, role: 'worker' | 'persona') => AgentExecutionBackend
  /** Render a profile's system prompt — prepended to that profile's messages. */
  systemPromptOf: (profile: AgentProfile) => string
  /** Speaker-turn cap. Default for a scripted persona = `2 * turns.length`
   *  (worker answers each user turn). REQUIRED for a `profile` persona. */
  maxTurns?: number
  /** Kickoff message routed to the first speaker (the persona). Default 'Begin.' */
  seed?: string
  /** Content-based "until satisfied" halt, called after every turn. `maxTurns` is the
   *  hard ceiling; this is the early stop (the persona declares the goal met / unreachable). */
  haltOn?: HaltPredicate
  signal?: AbortSignal
  /** Worker participant / transcript speaker label. Default 'agent'. */
  workerName?: string
}

export interface PersonaConversationResult {
  transcript: ConversationTurn[]
  turns: number
  halted: HaltReason
  /** Worker-only spend (the side under test). */
  costUsd: number
  tokensIn: number
  tokensOut: number
}

interface UsageCounter {
  tokensIn: number
  tokensOut: number
  costUsd: number
}

/** Prefix a backend's requests with `systemPrompt`; when `counter` is given,
 *  accumulate its `llm_call` token/cost usage (used for the metered worker). */
function withProfilePrompt(
  inner: AgentExecutionBackend,
  systemPrompt: string,
  counter?: UsageCounter,
): AgentExecutionBackend {
  return {
    kind: inner.kind,
    start: inner.start ? (input, ctx) => inner.start!(input, ctx) : undefined,
    resume: inner.resume ? (session, input, ctx) => inner.resume!(session, input, ctx) : undefined,
    stop: inner.stop ? (session, reason) => inner.stop!(session, reason) : undefined,
    async *stream(input, context) {
      const base =
        input.messages ?? (input.message ? [{ role: 'user', content: input.message }] : [])
      const messages =
        base[0]?.role === 'system' ? base : [{ role: 'system', content: systemPrompt }, ...base]
      for await (const event of inner.stream({ ...input, messages }, context)) {
        if (counter && event.type === 'llm_call') {
          counter.tokensIn += event.tokensIn ?? 0
          counter.tokensOut += event.tokensOut ?? 0
          counter.costUsd += event.costUsd ?? 0
        }
        yield event
      }
    },
  }
}

/** A persona participant that replays scripted user turns in order. */
function scriptedPersonaBackend(turns: readonly string[]): AgentExecutionBackend {
  let idx = 0
  return createIterableBackend({
    kind: 'persona-user',
    async *stream(_input, context) {
      const text = turns[idx]
      if (text === undefined) {
        throw new Error(
          `persona-user: ran out of scripted turns at index ${idx} (had ${turns.length})`,
        )
      }
      idx += 1
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
}

/**
 * Run one worker profile against one persona as a multi-round conversation.
 * The persona leads (participant 0): it speaks, the worker answers, repeat,
 * until `maxTurns`. Returns the persistent transcript + worker-only usage.
 */
export async function runPersonaConversation(
  opts: RunPersonaConversationOptions,
): Promise<PersonaConversationResult> {
  const counter: UsageCounter = { tokensIn: 0, tokensOut: 0, costUsd: 0 }
  const workerName = opts.workerName ?? 'agent'
  const worker = withProfilePrompt(
    opts.backendFor(opts.worker, 'worker'),
    opts.systemPromptOf(opts.worker),
    counter,
  )

  let persona: AgentExecutionBackend
  let maxTurns: number
  if (opts.persona.kind === 'scripted') {
    if (opts.persona.turns.length === 0) {
      throw new Error('runPersonaConversation: scripted persona has no turns')
    }
    persona = scriptedPersonaBackend(opts.persona.turns)
    maxTurns = opts.maxTurns ?? 2 * opts.persona.turns.length
  } else {
    persona = withProfilePrompt(
      opts.backendFor(opts.persona.profile, 'persona'),
      opts.systemPromptOf(opts.persona.profile),
    )
    if (opts.maxTurns === undefined) {
      throw new Error('runPersonaConversation: maxTurns is required for a profile-driven persona')
    }
    maxTurns = opts.maxTurns
  }

  const conversation = defineConversation({
    // Persona leads (participant 0): the seed routes to it, it produces the
    // user turn, the worker answers, alternate.
    participants: [
      { name: 'user', backend: persona },
      { name: workerName, backend: worker },
    ],
    policy: { maxTurns, turnOrder: 'alternate', ...(opts.haltOn ? { haltOn: opts.haltOn } : {}) },
  })
  const result = await runConversation(conversation, {
    seed: opts.seed ?? 'Begin.',
    signal: opts.signal,
  })
  // Worker-only cost. Prefer the worker's own metered llm_call spend. Fall back
  // to the engine's aggregate spend ONLY for a scripted persona — there the
  // harness has no LLM cost so the aggregate IS the worker's. For a
  // profile-driven persona the aggregate also includes the persona-driver's
  // spend, so attributing it to the worker would over-count; report the
  // worker's metered spend (0 if its backend reported none) instead.
  const costUsd =
    counter.costUsd > 0
      ? counter.costUsd
      : opts.persona.kind === 'scripted'
        ? result.spentCreditsCents / 100
        : 0
  return {
    transcript: result.transcript,
    turns: result.turns,
    halted: result.halted,
    costUsd,
    tokensIn: counter.tokensIn,
    tokensOut: counter.tokensOut,
  }
}

export interface RunPersonaConfig<TScenario extends Scenario, TArtifact> {
  /** Turn an `AgentProfile` into a runnable backend (router / sandbox / fake). */
  backendFor: (profile: AgentProfile, role: 'worker' | 'persona') => AgentExecutionBackend
  /** Render a profile's system prompt. */
  systemPromptOf: (profile: AgentProfile) => string
  /** The persona driving each scenario — a driver profile or scripted turns. */
  personaOf: (scenario: TScenario) => PersonaDriver
  /** Build the scored artifact from the finished transcript. */
  artifactOf: (transcript: ConversationTurn[], scenario: TScenario) => TArtifact
  /** Speaker-turn cap (required when a persona is profile-driven). */
  maxTurns?: (scenario: TScenario) => number
  seed?: (scenario: TScenario) => string
  workerName?: string
  /** Provider- or executor-enforced maximum for the whole worker conversation.
   * Required before execution when the enclosing campaign is cost-capped. */
  maximumCharge?:
    | MaximumCharge
    | ((worker: AgentProfile, scenario: TScenario) => MaximumCharge | undefined)
}

/**
 * Wrap {@link runPersonaConversation} as a `ProfileDispatchFn` for
 * `runProfileMatrix`: the profile axis is the worker-under-test, the scenario
 * axis is the persona, and the runner is the cell. Meters the worker through
 * `ctx.cost` so the matrix's backend-integrity guard sees real usage.
 */
export function runPersonaDispatch<TScenario extends Scenario, TArtifact>(
  config: RunPersonaConfig<TScenario, TArtifact>,
): ProfileDispatchFn<TScenario, TArtifact> {
  return async (
    worker: AgentProfile,
    scenario: TScenario,
    ctx: DispatchContext,
  ): Promise<TArtifact> => {
    const model = worker.model?.default ?? 'unknown'
    const maximumCharge =
      typeof config.maximumCharge === 'function'
        ? config.maximumCharge(worker, scenario)
        : config.maximumCharge
    const paid = await ctx.cost.runPaidCall({
      channel: 'agent',
      actor: 'persona-conversation',
      model,
      signal: ctx.signal,
      ...(maximumCharge ? { maximumCharge } : {}),
      execute: (executionSignal) =>
        runPersonaConversation({
          worker,
          persona: config.personaOf(scenario),
          backendFor: config.backendFor,
          systemPromptOf: config.systemPromptOf,
          maxTurns: config.maxTurns?.(scenario),
          seed: config.seed?.(scenario),
          signal: executionSignal,
          workerName: config.workerName,
        }),
      receipt: (result) => ({
        model,
        inputTokens: result.tokensIn,
        outputTokens: result.tokensOut,
        ...(result.costUsd > 0 ? { actualCostUsd: result.costUsd } : {}),
      }),
    })
    if (!paid.succeeded) throw paid.error
    const result = paid.value
    return config.artifactOf(result.transcript, scenario)
  }
}
