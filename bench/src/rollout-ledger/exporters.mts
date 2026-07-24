/**
 * Pure exporters over rollout-ledger lines → the three training-data shapes
 * the improvement loops feed:
 *   - SFT chat JSONL           (reward==1 train transcripts, {messages} only)
 *   - Prime Intellect verifiers RolloutOutput (prompt/completion split + reward)
 *   - OpenAI RFT items         (prompt turns + verdict reference fields)
 *
 * All exporters are pure functions of the lines — filtering (never train on
 * holdout, reward thresholds) happens HERE, on inline labels, no joins.
 */

import type { ChatMessage, RolloutLine, ToolDef } from './types.ts'

// ---------------------------------------------------------------------------
// (a) SFT chat JSONL
// ---------------------------------------------------------------------------

export interface SftExample {
  messages: ChatMessage[]
}

/**
 * Successful train-split transcripts only: reward === 1, split === "train",
 * and a non-empty transcript (gap lines carry no trainable content).
 */
export function toSftExamples(lines: RolloutLine[]): SftExample[] {
  return lines
    .filter((line) => line.outcome.reward === 1 && line.task.split === 'train' && line.messages.length > 0)
    .map((line) => ({ messages: line.messages }))
}

export function toSftJsonl(lines: RolloutLine[]): string {
  const examples = toSftExamples(lines)
  return examples.map((e) => JSON.stringify(e)).join('\n') + (examples.length > 0 ? '\n' : '')
}

// ---------------------------------------------------------------------------
// (b) Prime Intellect verifiers RolloutOutput
// ---------------------------------------------------------------------------

export interface VerifiersTokenUsage {
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
}

export interface VerifiersRolloutOutput {
  /** Messages through the last turn BEFORE the first assistant turn. */
  prompt: ChatMessage[]
  /** The first assistant turn onward — what the policy produced. */
  completion: ChatMessage[]
  reward: number | null
  metrics: Record<string, unknown>
  tool_defs: ToolDef[]
  token_usage: VerifiersTokenUsage
  info: {
    task: RolloutLine['task']
    policy: RolloutLine['policy']
    rollout_id: string
    run_id: string
    generation: number
    candidate_index: number
    role: RolloutLine['role']
  }
}

/** Index of the first assistant turn; messages.length when none exists. */
function firstAssistantIndex(messages: ChatMessage[]): number {
  const index = messages.findIndex((m) => m.role === 'assistant')
  return index === -1 ? messages.length : index
}

export function toVerifiersRolloutOutput(line: RolloutLine): VerifiersRolloutOutput {
  const split = firstAssistantIndex(line.messages)
  return {
    prompt: line.messages.slice(0, split),
    completion: line.messages.slice(split),
    reward: line.outcome.reward,
    metrics: line.outcome.metrics,
    tool_defs: line.tool_defs,
    token_usage: {
      input_tokens: line.cost.tokens_in,
      output_tokens: line.cost.tokens_out,
      reasoning_tokens: line.cost.tokens_reasoning,
      cache_read_tokens: line.cost.cache_read,
      cache_write_tokens: line.cost.cache_write,
    },
    info: {
      task: line.task,
      policy: line.policy,
      rollout_id: line.rollout_id,
      run_id: line.run_id,
      generation: line.generation,
      candidate_index: line.candidate_index,
      role: line.role,
    },
  }
}

export function toVerifiersRolloutOutputs(lines: RolloutLine[]): VerifiersRolloutOutput[] {
  return lines.filter((line) => line.messages.length > 0).map(toVerifiersRolloutOutput)
}

// ---------------------------------------------------------------------------
// (c) OpenAI RFT items
// ---------------------------------------------------------------------------

export interface RftItem {
  /** Prompt turns only — the graded completion is re-sampled during RFT. */
  messages: ChatMessage[]
  /** Verdict/label fields the grader references as item.reference.* */
  reference: {
    reward: number | null
    reward_source: string | null
    verdict: unknown
    instance_id: string
    suite: string
    split: RolloutLine['task']['split']
    rollout_id: string
  }
}

export function toRftItem(line: RolloutLine): RftItem {
  const split = firstAssistantIndex(line.messages)
  return {
    messages: line.messages.slice(0, split),
    reference: {
      reward: line.outcome.reward,
      reward_source: line.outcome.reward_source,
      verdict: line.outcome.verdict,
      instance_id: line.task.instance_id,
      suite: line.task.suite,
      split: line.task.split,
      rollout_id: line.rollout_id,
    },
  }
}

/** RFT needs a real prompt: lines whose transcript starts with prompt turns. */
export function toRftItems(lines: RolloutLine[]): RftItem[] {
  return lines
    .filter((line) => line.messages.length > 0 && firstAssistantIndex(line.messages) > 0)
    .map(toRftItem)
}
