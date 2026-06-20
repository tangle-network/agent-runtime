/**
 * Shared fixtures for the supervisor-loop runners: the demo goal + its deployable
 * completion check, and a SCRIPTED driver brain so the box / cli-bridge runners
 * exercise their wiring with no inference.
 *
 * The supervisor itself is `supervise()` (`@tangle-network/agent-runtime/loops`);
 * these are only the per-example task + the offline brain it can be driven with.
 */

import type { ToolLoopChat } from '@tangle-network/agent-runtime/loops'

/** The marker every runner asks its workers to emit; the check confirms it landed. */
export const expectedAnswer = 'ANSWER=42'

/** The deployable completion oracle: a worker settles `valid:true` ONLY when its
 *  output contains `ANSWER=42` — text content for off-box backends, the serialized
 *  harness event stream for a box. Never the model judging itself. */
export const demoCheck = (out: unknown): boolean => {
  if (out && typeof out === 'object' && 'content' in out) {
    return String((out as { content: unknown }).content).includes(expectedAnswer)
  }
  return JSON.stringify(out ?? '').includes(expectedAnswer)
}

/** The shared demo goal: produce the exact line `ANSWER=42`. */
export const demoGoal = `Produce the exact line "${expectedAnswer}".`

/**
 * A SCRIPTED `ToolLoopChat`: spawn `workerCount` workers (the "drive N workers"
 * shape), await each settlement, then stop. This is the exact contract
 * `routerBrain` fills in production — here it returns a fixed turn sequence so the
 * brain runs with no inference (the same offline seam the driver's own unit tests
 * use). The brain still REASONS the loop (spawn → await → stop) against a live
 * `Scope`; only the driver-LLM call is mocked.
 *
 * The canonical loop parses `toolCalls[].arguments` itself, so each scripted call
 * serializes its arguments to a JSON string; the loop JSON.parses them before
 * running the tool.
 */
export function scriptedSupervisorChat(workerCount: number, labelPrefix = 'solver'): ToolLoopChat {
  interface ScriptedTurn {
    content: string
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>
  }
  const turns: ScriptedTurn[] = []
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({
      content: `delegating slice ${i}`,
      toolCalls: [
        {
          name: 'spawn_agent',
          arguments: {
            profile: { name: `${labelPrefix}-${i}`, systemPrompt: `Emit ${expectedAnswer}.` },
            task: `Emit the exact line ${expectedAnswer} and nothing else.`,
            label: `${labelPrefix}-${i}`,
          },
        },
      ],
    })
  }
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({
      content: 'awaiting a worker',
      toolCalls: [{ name: 'await_event', arguments: {} }],
    })
  }
  turns.push({ content: 'all workers delivered — stopping', toolCalls: [] })

  let i = 0
  return (messages) => {
    // A real brain reads `messages` (the folded tool results) to decide; the
    // scripted one advances its fixed plan. Touch `messages` so the shape is
    // exercised.
    void messages.length
    const turn = turns[Math.min(i, turns.length - 1)] ?? { content: '', toolCalls: [] }
    i += 1
    return Promise.resolve({
      content: turn.content,
      toolCalls: turn.toolCalls.map((tc, j) => ({
        id: `call-${i}-${j}`,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
    })
  }
}
