/**
 *
 * The one rule for reading a leaf task as prompt text. A `Scope` task is opaque (`unknown`) and
 * every leaf that speaks to a text-in/text-out backend has to project it the same way, or two
 * placements handed the identical task send the harness different bytes.
 *
 * Module-scoped, not package surface: it is shared between sibling leaf executors, never a
 * published verb.
 */

import { AgentTurnInputSchema, renderInputPartsAsText } from '@tangle-network/agent-interface'

/** A leaf task is opaque (`unknown`). A string is the prompt verbatim; an object
 *  with a `prompt`/`content`/`task` string field uses it; otherwise it serializes. */
export function taskToPrompt(task: unknown): string {
  if (typeof task === 'string') return task
  if (task && typeof task === 'object') {
    const obj = task as Record<string, unknown>
    for (const k of ['prompt', 'content', 'task', 'message']) {
      if (typeof obj[k] === 'string') return obj[k] as string
    }
    if (Array.isArray(obj.parts)) {
      const parsed = AgentTurnInputSchema.safeParse({ parts: obj.parts })
      if (parsed.success && parsed.data.parts) return renderInputPartsAsText(parsed.data.parts)
    }
  }
  return JSON.stringify(task)
}
