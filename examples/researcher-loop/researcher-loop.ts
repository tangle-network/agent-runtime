/**
 * researcherProfile + runLoop + an inline FANOUT driver — the smallest end-to-end researcher loop.
 *
 * The SUBJECT is the wiring below: `researcherProfile({ task })` hands you the output adapter,
 * validator, and agent-run spec; a single-round fanout driver spawns two parallel researchers and
 * the kernel picks the best VALID one. The validator hard-fails any output that leaks into a
 * different knowledge namespace, so the bad candidate is pruned by construction.
 *
 * Offline: the two synthetic researcher outputs and the stand-in `sandboxClient` live in
 * ./synthetic-researcher.ts. Needs the optional `@tangle-network/agent-knowledge` peer.
 *
 * Run:  pnpm tsx examples/researcher-loop/researcher-loop.ts
 */

import {
  type ResearchOutput,
  type ResearchTask,
  researcherProfile,
} from '@tangle-network/agent-knowledge/profiles'
import { type Driver, runLoop } from '@tangle-network/agent-runtime/loops'
import { sandboxClient, task } from './synthetic-researcher'

async function main(): Promise<void> {
  const { output, validator, agentRunSpec } = researcherProfile({ task })
  const driver: Driver<ResearchTask, ResearchOutput, 'pick-winner' | 'fail'> = {
    name: 'fanout',
    // A "round" = one plan → run workers → decide cycle. This driver is SINGLE-ROUND:
    // it returns two copies of the task on round 0 (history empty) → two parallel
    // workers (a "fanout"), then [] forever after → it spawns, scores, and picks ONCE.
    // It never reads a worker's output to build the next prompt. For a driver that
    // re-plans from worker output (the supervisor fold), see examples/driver-loop/.
    plan: async (task, history) => (history.length === 0 ? [task, task] : []),
    decide: (history) => (history.some((i) => i.verdict?.valid === true) ? 'pick-winner' : 'fail'),
  }

  const result = await runLoop({
    driver,
    agentRun: agentRunSpec,
    output,
    validator,
    task,
    ctx: { sandboxClient },
  })

  console.log(`decision: ${result.decision}`)
  console.log(`iterations: ${result.iterations.length}`)
  console.log(`durationMs: ${result.durationMs}`)
  console.log(`totalCostUsd: ${result.costUsd.toFixed(6)}`)
  if (!result.winner) {
    console.log('no winner — every iteration failed validation')
    return
  }
  const winner = result.winner
  console.log(`winner: iteration #${winner.iterationIndex} (${winner.agentRunName})`)
  console.log(`  score: ${winner.verdict?.score?.toFixed(3)}  valid: ${winner.verdict?.valid}`)
  console.log(`  items (${winner.output.items.length}):`)
  for (const item of winner.output.items) {
    console.log(`    - [${item.namespace}] ${item.claim}`)
    for (const ev of item.evidence) {
      console.log(
        `      • ${ev.source}${ev.url ? ` (${ev.url})` : ''}${ev.quote ? `: ${ev.quote}` : ''}`,
      )
    }
  }
  console.log(`  citations: ${winner.output.citations.length}`)
  console.log(`  proposedWrites: ${winner.output.proposedWrites.length}`)
  for (const update of winner.output.proposedWrites) {
    console.log(`    - ${update.kind} into ${update.namespace}`)
  }
  if (winner.output.gaps?.length) {
    console.log(`  gaps: ${winner.output.gaps.join('; ')}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
