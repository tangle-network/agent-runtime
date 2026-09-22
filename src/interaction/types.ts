import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentProvider,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunSpec } from '../runtime/types'
import type { RuntimeHooks } from '../runtime-hooks'
import type { TurnCallPolicy } from './call-policy'
import type { InteractionJournal } from './journal'

export type InteractionEnvironmentOptions = Omit<CreateAgentEnvironmentInput, 'profile' | 'signal'>
export type InteractionTurnOptions = Omit<
  AgentTurnInput,
  'prompt' | 'parts' | 'sessionId' | 'signal' | 'turnId'
>

export interface InteractionActor {
  name: string
  profile: AgentProfile
  provider: AgentEnvironmentProvider
  environment?: InteractionEnvironmentOptions
  prepareEnvironment?: AgentRunSpec<unknown>['prepareEnvironment']
  turn?: InteractionTurnOptions
  callPolicy?: TurnCallPolicy
}

export interface InteractionDriveState {
  transcript: readonly InteractionTurn[]
  turnIndex: number
  costUsd: number
}

export type InteractionTurnOrder =
  | 'alternate'
  | 'round-robin'
  | ((state: InteractionDriveState) => number)

export interface InteractionStop {
  stop: true
  reason: string
}

export type InteractionStopPredicate = (
  state: InteractionDriveState & { lastTurn: InteractionTurn },
) => boolean | InteractionStop | Promise<boolean | InteractionStop>

export interface InteractionPolicy {
  maxTurns: number
  maxCostUsd?: number
  turnOrder?: InteractionTurnOrder
  stopWhen?: InteractionStopPredicate
  defaultCallPolicy?: TurnCallPolicy
}

export interface InteractionActorRef {
  name: string
  provider: string
  environmentId: string
  sessionId: string
}

export interface InteractionTurn {
  index: number
  actor: string
  turnId: string
  environmentId: string
  sessionId: string
  text: string
  usage: {
    inputTokens: number
    outputTokens: number
    costUsd: number
  }
  attempts: number
  startedAt: string
  endedAt: string
}

export type InteractionHaltReason =
  | { kind: 'max_turns'; turns: number }
  | { kind: 'max_cost'; costUsd: number; maxCostUsd: number }
  | { kind: 'stop'; reason: string }
  | { kind: 'aborted' }
  | { kind: 'actor_error'; actor: string; message: string }

export interface InteractionResult {
  runId: string
  transcript: InteractionTurn[]
  turns: number
  usage: {
    inputTokens: number
    outputTokens: number
    costUsd: number
  }
  halted: InteractionHaltReason
  startedAt: string
  endedAt: string
  durationMs: number
}

export interface RunInteractionOptions {
  actors: readonly InteractionActor[]
  prompt: string
  policy: InteractionPolicy
  runId?: string
  /**
   * Stable identity for actor profiles, provider configuration, and policy
   * functions. Required when a journal is supplied.
   */
  definitionId?: string
  journal?: InteractionJournal
  signal?: AbortSignal
  hooks?: RuntimeHooks
  onEvent?: (event: InteractionStreamEvent) => void | Promise<void>
}

export type InteractionStreamEvent =
  | {
      type: 'interaction_start' | 'interaction_resumed'
      runId: string
      actors: readonly string[]
      transcript: readonly InteractionTurn[]
      timestamp: string
    }
  | {
      type: 'actor_ready'
      runId: string
      actor: string
      ref: InteractionActorRef
      resumed: boolean
      timestamp: string
    }
  | {
      type: 'turn_start' | 'turn_retry'
      runId: string
      turnId: string
      index: number
      actor: string
      attempt: number
      reason?: string
      timestamp: string
    }
  | {
      type: 'turn_end'
      runId: string
      turn: InteractionTurn
      timestamp: string
    }
  | {
      type: 'interaction_end'
      runId: string
      result: InteractionResult
      timestamp: string
    }
