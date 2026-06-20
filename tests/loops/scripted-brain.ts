import type { ToolLoopChat } from '../../src/runtime/tool-loop'

/** A scripted driver turn in the easy-to-write form (parsed tool args). */
export interface ScriptedTurn {
  content?: string
  toolCalls?: Array<{ id?: string; name: string; arguments: Record<string, unknown> }>
  usage?: { input: number; output: number }
  costUsd?: number
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
      ...(turn.costUsd !== undefined ? { costUsd: turn.costUsd } : {}),
    }
  }
}
