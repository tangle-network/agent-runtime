/**
 * Two runtimes, one driving the other. Agent A produces a draft (here
 * a synthetic chunked stream — swap in `runAgentTaskStream` + a real
 * backend in production with no shape change). Agent B is a reviewer:
 * an `AgentAdapter` that scores the collected draft against a rubric
 * and stops with a verdict.
 *
 * The pattern: collect A's stream into a buffer, hand it to B as
 * `task.inputs`. B's adapter is the bridge — same task lifecycle every
 * other agent-runtime call uses.
 *
 * Run with:
 *   pnpm tsx examples/pipe-into-reviewer/pipe-into-reviewer.ts
 */

import type { AgentAdapter } from '@tangle-network/agent-runtime'
import { runAgentTask } from '@tangle-network/agent-runtime'

// ── Agent A — a "model" that streams a draft. In production this is
// `runAgentTaskStream({ task, backend, input })` with the same shape:
// an async iterable of textual events. ─────────────────────────────────
async function* draftStream(): AsyncGenerator<string> {
  const chunks = [
    'The 2026 return ',
    'is mostly complete. ',
    'Missing: Schedule B (interest income) ',
    'and one W-2.',
  ]
  for (const chunk of chunks) {
    await new Promise((r) => setTimeout(r, 5))
    yield chunk
  }
}

// ── Agent B — the reviewer. Same agent-runtime task lifecycle: observe,
// validate, decide. The reviewer's input is A's collected draft. ────────
interface ReviewerState {
  draftLength: number
  mentionsMissing: boolean
}
type ReviewerAction = { kind: 'noop' }

function buildReviewer(draft: string): AgentAdapter<ReviewerState, ReviewerAction, void> {
  return {
    observe: () => ({
      draftLength: draft.length,
      mentionsMissing: /missing/i.test(draft),
    }),
    validate({ state }) {
      // The rubric: a draft is acceptable if it is non-trivially long AND
      // it surfaces missing items rather than fabricating completeness.
      return [
        { id: 'length', score: state.draftLength >= 60 ? 1 : 0, passed: state.draftLength >= 60 },
        {
          id: 'surfaces-missing',
          score: state.mentionsMissing ? 1 : 0,
          passed: state.mentionsMissing,
        },
      ]
    },
    decide({ state }) {
      const pass = state.draftLength >= 60 && state.mentionsMissing
      return {
        type: 'stop',
        pass,
        score: pass ? 1 : 0,
        reason: pass ? 'draft surfaces missing evidence' : 'draft fails rubric',
      }
    },
    act() {
      /* reviewer takes no domain actions */
    },
  }
}

async function main() {
  // 1. Collect agent A's stream — this is the "pipe" between the two.
  let draft = ''
  process.stdout.write('[A] ')
  for await (const chunk of draftStream()) {
    draft += chunk
    process.stdout.write(chunk)
  }
  process.stdout.write('\n')

  // 2. Hand the draft to agent B as input; run B through the runtime.
  const result = await runAgentTask({
    task: {
      id: 'review-2026-return',
      intent: 'Review a draft return for missing evidence',
      domain: 'review',
      inputs: { draft },
    },
    adapter: buildReviewer(draft),
  })

  console.log('\n[B] status:    ', result.status)
  console.log('[B] pass:      ', result.control.pass)
  console.log('[B] reason:    ', result.control.reason)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
