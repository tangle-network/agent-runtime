/**
 * Task with required knowledge — the runtime auto-scores it before any
 * control loop runs and gates the task on readiness.
 *
 * Run with:
 *   pnpm tsx examples/with-knowledge-readiness/with-knowledge-readiness.ts
 */

import type { KnowledgeRequirement } from '@tangle-network/agent-eval'
import type { AgentAdapter } from '@tangle-network/agent-runtime'
import { runAgentTask } from '@tangle-network/agent-runtime'

function requirement(currentConfidence: number): KnowledgeRequirement {
  return {
    id: 'filing-status',
    description: 'Taxpayer filing status',
    requiredFor: ['return-review'],
    category: 'user_specific',
    acquisitionMode: 'ask_user',
    importance: 'blocking',
    freshness: 'static',
    sensitivity: 'private',
    confidenceNeeded: 1,
    currentConfidence,
    evidenceIds: currentConfidence === 1 ? ['evidence:filing-status'] : [],
    fallbackPolicy: 'ask',
  }
}

const adapter: AgentAdapter<{ ready: boolean }, void, void> = {
  observe() {
    return { ready: true }
  },
  validate() {
    return []
  },
  decide() {
    return { kind: 'finish', reason: 'demo done' }
  },
  act() {
    return undefined
  },
}

async function main() {
  // Run 1: zero confidence → readiness blocks → onKnowledgeBlocked fires.
  const blocked = await runAgentTask({
    task: {
      id: 'review-2026-return-blocked',
      intent: 'Review the return',
      domain: 'tax',
      requiredKnowledge: [requirement(0)],
    },
    adapter,
  })
  console.log('blocked status:', blocked.status)
  console.log('  readinessScore:', blocked.knowledge.readinessScore)
  console.log('  recommendedAction:', blocked.knowledge.recommendedAction)
  console.log(
    '  blocking gaps:',
    blocked.knowledge.blockingMissingRequirements.map((r) => r.id),
  )

  // Run 2: full confidence → readiness passes → control loop runs.
  const ready = await runAgentTask({
    task: {
      id: 'review-2026-return-ready',
      intent: 'Review the return',
      domain: 'tax',
      requiredKnowledge: [requirement(1)],
    },
    adapter,
  })
  console.log('\nready status:', ready.status)
  console.log('  readinessScore:', ready.knowledge.readinessScore)
  console.log('  recommendedAction:', ready.knowledge.recommendedAction)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
