/**
 * `examples/engine/review-loop.ts` — the first example authored against the graph ENGINE rather
 * than `runGraph`. These tests are what stop it rotting into prose: they pin the behaviour the
 * example claims, including the one a reader cannot see from a successful run — that the rebuild
 * loop is BOUNDED, and ends loud rather than spinning when a build never satisfies its reviewers.
 */
import { describe, expect, it } from 'vitest'
import { printRun, reviewEngine, reviewLoop } from '../../examples/engine/review-loop'
import { runEngineGraph } from '../../src/runtime/graph'
import { GraphEdgeCapError } from '../../src/runtime/supervise/graph'

const budget = { maxIterations: 60, maxTokens: 200_000 }
const perNode = { maxIterations: 4, maxTokens: 10_000 }

const run = (spec: ReturnType<typeof reviewLoop>) =>
  runEngineGraph(reviewEngine(), spec, 'review the change', { budget, perNode })

describe('examples/engine/review-loop — the topology decides, not a model', () => {
  it('rebuilds twice on real findings, then ships the clean build', async () => {
    const res = await run(reviewLoop())
    expect(res.kind).toBe('winner')
    if (res.kind !== 'winner') return
    expect(res.out).toEqual({
      shipped: 'export function rate(x: number): number { return x * 2 }',
    })

    // Three verdicts: reject, reject, pass — each naming the finding that forced the next round.
    const verdicts = res.settles
      .filter((settle) => settle.node === 'verdict')
      .map((settle) => settle.out as { passed: boolean; failures: string[] })
    expect(verdicts.map((verdict) => verdict.passed)).toEqual([false, false, true])
    expect(verdicts[0]?.failures).toEqual(['audit-security: hardcoded credential in source'])
    expect(verdicts[1]?.failures).toEqual(['audit-style: bare `any` defeats the type check'])
    expect(verdicts[2]?.failures).toEqual([])
  })

  it('every auditor runs every round — a review is never skipped, because no model chooses', async () => {
    const res = await run(reviewLoop())
    const audits = res.settles.filter((settle) => settle.node.startsWith('audit-'))
    // 3 auditors x 3 rounds. Under a prompt-driven supervisor this is exactly what drifts.
    expect(audits).toHaveLength(9)
    for (const id of ['audit-security', 'audit-style', 'audit-correctness']) {
      expect(audits.filter((settle) => settle.node === id)).toHaveLength(3)
    }
  })

  it("the `all` join holds: a verdict never lands before its round's three audits", async () => {
    const res = await run(reviewLoop())
    const order = res.settles
      .filter((settle) => settle.node.startsWith('audit-') || settle.node === 'verdict')
      .map((settle) => (settle.node === 'verdict' ? 'verdict' : 'audit'))
    // Each verdict is preceded by exactly three audits: audit,audit,audit,verdict — three times.
    expect(order).toEqual([
      'audit',
      'audit',
      'audit',
      'verdict',
      'audit',
      'audit',
      'audit',
      'verdict',
      'audit',
      'audit',
      'audit',
      'verdict',
    ])
  })

  it('a build that never satisfies its reviewers is ENDED by the edge cap, loudly', async () => {
    let thrown: unknown
    try {
      await run(reviewLoop({ neverFix: true }))
    } catch (error) {
      thrown = error
    }
    // Not a spin, not a silent no-winner: the cap that bounded the loop names itself.
    expect(thrown).toBeInstanceOf(GraphEdgeCapError)
    const capped = thrown as InstanceType<typeof GraphEdgeCapError>
    expect(capped.exhaustedEdges).toHaveLength(1)
    expect(String(capped.exhaustedEdges[0])).toContain('verdict->build')
  })

  it('printRun renders a run without throwing on either arm', async () => {
    const lines: string[] = []
    const log = console.log
    console.log = (...args: unknown[]) => void lines.push(args.join(' '))
    try {
      printRun(await run(reviewLoop()))
    } finally {
      console.log = log
    }
    expect(lines.join('\n')).toMatch(/review-loop → winner/)
    expect(lines.join('\n')).toMatch(/round 3: PASSED/)
  })
})
