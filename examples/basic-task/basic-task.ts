/**
 * Smallest runAgentTask invocation: one act step, then finish.
 *
 * Run with:
 *   pnpm tsx examples/basic-task/basic-task.ts
 */

import { runAgentTask } from '@tangle-network/agent-runtime'
import type { AgentAdapter } from '@tangle-network/agent-runtime'

interface TaxState { reviewCount: number }
type TaxAction = { kind: 'review' }

let reviews = 0
const adapter: AgentAdapter<TaxState, TaxAction, void> = {
  observe() {
    // Domain observation. In production this reads from your DB,
    // sandbox, or external API. Here: a counter for demo purposes.
    return { reviewCount: reviews }
  },
  validate({ state }) {
    return state.reviewCount >= 1
      ? [{ id: 'reviewed', score: 1, passed: true }]
      : [{ id: 'reviewed', score: 0, passed: false }]
  },
  decide({ state }) {
    if (state.reviewCount >= 1) return { kind: 'finish', reason: 'review complete' }
    return { kind: 'act', action: { kind: 'review' } }
  },
  act(action) {
    if (action.kind === 'review') reviews += 1
  },
}

async function main() {
  const result = await runAgentTask({
    task: {
      id: 'review-2026-return',
      intent: 'Review the return for missing evidence',
      domain: 'tax',
    },
    adapter,
  })

  // result.status is the high-level outcome; result.control carries the
  // step-by-step run metadata the agent-eval control loop produced.
  console.log('status:        ', result.status)
  console.log('control.pass:  ', result.control.pass)
  console.log('control.reason:', result.control.reason)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
