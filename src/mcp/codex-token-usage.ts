import { isRecord } from '@tangle-network/agent-core'
import { ValidationError } from '../errors'
import { parseCodexUsageRecord } from '../runtime/harness-usage'

/**
 * Exact aggregate usage emitted by Codex's terminal `turn.completed` JSONL event.
 *
 * `cachedInputTokens` is a part of `inputTokens` and `reasoningOutputTokens` is a part of
 * `outputTokens`; neither adds to the total it describes. `cacheWriteInputTokens` is optional
 * because the codex CLI reports it and a provider-normalized capture omits it, and an absent
 * counter must stay absent rather than become a zero that claims no cache write was measured.
 */
export interface CodexTokenUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  cacheWriteInputTokens?: number
}

/**
 * Parse and validate the one terminal usage event emitted by `codex exec --json`.
 *
 * The JSONL framing is this surface's own; the usage RECORD is read by `parseCodexUsageRecord`,
 * the one codex usage reader the sandbox decoder also calls, so both surfaces hold the same field
 * policy and the same two cross-field invariants.
 */
export function parseCodexTokenUsage(stdout: string): CodexTokenUsage {
  const completed: unknown[] = []
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      throw new ValidationError(`runLocalHarness: Codex JSONL line ${index + 1} is not valid JSON`)
    }
    if (isRecord(event) && event.type === 'turn.completed') completed.push(event)
  }
  if (completed.length !== 1) {
    throw new ValidationError(
      `runLocalHarness: expected exactly one Codex turn.completed usage event, received ${completed.length}`,
    )
  }
  const event = completed[0]
  if (!isRecord(event) || !isRecord(event.usage)) {
    throw new ValidationError('runLocalHarness: Codex turn.completed event is missing usage')
  }
  const record = parseCodexUsageRecord(event.usage, 'runLocalHarness: Codex')
  return {
    inputTokens: record.inputTokens,
    cachedInputTokens: record.cachedInputTokens,
    outputTokens: record.outputTokens,
    reasoningOutputTokens: record.reasoningOutputTokens,
    ...(record.cacheWriteInputTokens === undefined
      ? {}
      : { cacheWriteInputTokens: record.cacheWriteInputTokens }),
  }
}
