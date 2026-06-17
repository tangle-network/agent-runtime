import { describe, expect, it } from 'vitest'
import { selectValidWinner } from '../../src/runtime/personify/combinators'
import type { Outcome } from '../../src/runtime/personify/types'
import {
  type DeliverableSpec,
  gateOnDeliverable,
} from '../../src/runtime/supervise/completion-gate'
import type { Executor, ExecutorResult, Iteration, UsageEvent } from '../../src/runtime'

// The point: the completion-gate seam is DOMAIN-FREE. A domain customizes "is it delivered" by
// constructing a plain `DeliverableSpec` whose `check` verifies a field on ITS OWN artifact —
// there is no coder/patch coupling left in the seam. Here the artifact is a `{ report }` blob.
interface ReportArtifact {
  report: string
  words: number
}

function reportWorker(artifact: ReportArtifact): Executor<ReportArtifact> {
  const result: ExecutorResult<ReportArtifact> = {
    outRef: `r:${artifact.report}`,
    out: artifact,
    // The worker self-scores high — the gate must override `valid` from the check, not this.
    verdict: { valid: true, score: 0.99 },
    spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
  }
  return {
    runtime: 'router',
    execute: async () => result,
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => result,
  }
}

async function settle(ex: Executor<ReportArtifact>): Promise<ExecutorResult<ReportArtifact>> {
  const r = ex.execute(undefined, new AbortController().signal)
  if (Symbol.asyncIterator in (r as object)) {
    for await (const _ of r as AsyncIterable<UsageEvent>) {
      /* drain */
    }
    return ex.resultArtifact()
  }
  return r as Promise<ExecutorResult<ReportArtifact>>
}

// A domain-authored deliverable: "delivered" iff the report mentions the required section. No coder
// types, no patch, no worktree — just a field check over the domain's own artifact.
const mentionsSummary: DeliverableSpec<ReportArtifact> = {
  describe: 'report includes a Summary section',
  check: (out) => out.report.includes('## Summary'),
}

describe('completion-gate seam is domain-free — a non-patch DeliverableSpec gates a {report} artifact', () => {
  it('settles valid when the domain check passes (no coder coupling)', async () => {
    const ex = gateOnDeliverable(
      reportWorker({ report: '# Title\n## Summary\nall good', words: 4 }),
      mentionsSummary,
    )
    const art = await settle(ex)
    expect(art.verdict?.valid).toBe(true)
  })

  it('overrides valid=false when the domain check fails, despite the high self-score', async () => {
    const ex = gateOnDeliverable(
      reportWorker({ report: '# Title\nno summary here', words: 4 }),
      mentionsSummary,
    )
    const art = await settle(ex)
    expect(art.verdict?.valid).toBe(false)
    expect(art.verdict?.score).toBe(0.99) // score preserved; only `valid` is gated
  })

  it('the shared selectValidWinner ranks non-patch artifacts by a domain sizeOf (shortest report)', () => {
    // Build Outcome-wrapped iterations the way a fanout would, two valid reports of different size.
    const iter = (
      index: number,
      report: string,
      words: number,
      valid: boolean,
    ): Iteration<unknown, Outcome<ReportArtifact>> => ({
      index,
      task: undefined,
      agentRunName: `report:${index}`,
      output: { kind: 'done', deliverable: { report, words } },
      verdict: { valid, score: 1 },
      events: [],
      startedAt: 0,
      endedAt: 0,
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
    })
    const winner = selectValidWinner<ReportArtifact>({
      strategy: 'smallest-artifact',
      sizeOf: (a) => a.words, // a DOMAIN size metric — words, not diff lines
    })([
      iter(0, '## Summary long long long', 4, true),
      iter(1, '## Summary short', 2, true),
      iter(2, 'invalid', 1, false), // smallest but NOT valid → must never win
    ])
    const out = winner?.output
    expect(out && out.kind === 'done' ? out.deliverable.words : -1).toBe(2)
  })
})
