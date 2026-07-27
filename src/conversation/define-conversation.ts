/**
 *
 * Declarative constructor for a multi-agent `Conversation`. Validates inputs
 * fail-loud at definition time (duplicate participant names, alternate order
 * with ≠2 participants, non-positive `maxTurns`) so misconfiguration is caught
 * before `runConversation` is called and not buried inside a streaming run.
 *
 * @stable
 */

import { ValidationError } from '../errors'
import type { Conversation, ConversationParticipant, ConversationPolicy, TurnOrder } from './types'

/** Validate and define a conversation before execution. */
export function defineConversation(input: {
  participants: ConversationParticipant[]
  policy: ConversationPolicy
}): Conversation {
  if (input.participants.length < 2) {
    throw new ValidationError(
      `Conversation requires at least 2 participants; received ${input.participants.length}.`,
    )
  }

  const seen = new Set<string>()
  for (const p of input.participants) {
    if (!p.name || p.name.trim() === '') {
      throw new ValidationError('Conversation participant.name must be a non-empty string.')
    }
    if (seen.has(p.name)) {
      throw new ValidationError(
        `Conversation participant names must be unique within a Conversation; '${p.name}' appears more than once.`,
      )
    }
    seen.add(p.name)
    if (!p.backend || typeof p.backend.stream !== 'function') {
      throw new ValidationError(
        `Conversation participant '${p.name}' is missing a backend with a stream() method.`,
      )
    }
  }

  const policy = normalizePolicy(input.policy, input.participants.length)

  return {
    participants: input.participants,
    policy,
  }
}

function normalizePolicy(policy: ConversationPolicy, participantCount: number): ConversationPolicy {
  if (!Number.isInteger(policy.maxTurns) || policy.maxTurns < 1) {
    throw new ValidationError(
      `ConversationPolicy.maxTurns must be a positive integer; received ${String(policy.maxTurns)}.`,
    )
  }
  if (
    policy.maxCreditsCents !== undefined &&
    (!Number.isFinite(policy.maxCreditsCents) || policy.maxCreditsCents < 0)
  ) {
    throw new ValidationError(
      `ConversationPolicy.maxCreditsCents must be a non-negative finite number when set; received ${String(
        policy.maxCreditsCents,
      )}.`,
    )
  }
  const turnOrder = policy.turnOrder ?? (participantCount === 2 ? 'alternate' : 'round-robin')
  if (turnOrder === 'alternate' && participantCount !== 2) {
    throw new ValidationError(
      `ConversationPolicy.turnOrder 'alternate' requires exactly 2 participants; received ${participantCount}. Use 'round-robin' or a custom selector for N-party conversations.`,
    )
  }
  return { ...policy, turnOrder: turnOrder as TurnOrder }
}
