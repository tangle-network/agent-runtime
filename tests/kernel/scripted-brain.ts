import type { ToolLoopChat } from '../../src/runtime/tool-loop'

/** A scripted driver turn in the easy-to-write form (parsed tool args). */
export interface ScriptedTurn {
  content?: string
  toolCalls?: Array<{ id?: string; name: string; arguments: Record<string, unknown> }>
  usage?: { input: number; output: number }
  /** Scripted costs model an exact provider receipt unless explicitly overridden. */
  costUsd?: number
  costProvenance?: 'provider-receipt' | 'billing-receipt' | 'catalog-estimate'
}

/** Build a scripted `ToolLoopChat` brain from a fixed turn sequence: converts parsed tool args to
 *  the raw-string form the canonical loop parses, records the messages each turn saw, and advances
 *  through the turns (repeating the last). The offline seam the driver's unit tests use. */
export function scriptedBrain(
  turns: ScriptedTurn[],
  seen?: Array<ReadonlyArray<Record<string, unknown>>>,
): ToolLoopChat {
  let i = 0
  return async (messages) => {
    seen?.push(messages)
    const turn = turns[Math.min(i, turns.length - 1)] ?? {}
    i += 1
    return {
      ...(turn.content !== undefined ? { content: turn.content } : {}),
      toolCalls: (turn.toolCalls ?? []).map((tc, j) => ({
        id: tc.id ?? `call-${i}-${j}`,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
      ...(turn.usage ? { usage: turn.usage } : {}),
      ...(turn.costUsd !== undefined
        ? {
            costUsd: turn.costUsd,
            costProvenance: turn.costProvenance ?? ('provider-receipt' as const),
          }
        : {}),
    }
  }
}

/** The events a woken driver received: the JSON lines of the newest wake input in `messages`. */
export function wakeEvents(
  messages: ReadonlyArray<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const wake = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && String(message.content).includes('## Events'))
  if (wake === undefined) return []
  return String(wake.content)
    .split('\n')
    .filter((line) => line.startsWith('- {'))
    .map((line) => JSON.parse(line.slice(2)) as Record<string, unknown>)
}
