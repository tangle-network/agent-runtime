/**
 * user-sim-conversation — the conversation-graph proof (#721), fully offline.
 *
 * What must hold, asserted at the seams the run ACTUALLY crossed (never on intent):
 *   1. The resumed MESSAGE-HISTORY CHAIN at the wire: each turn's captured transport request is
 *      the previous request's whole message list + the previous assistant reply + the new user
 *      turn — one growing conversation, re-attached across three spawned workers.
 *   2. The ledger stamps how every hop continued (`fresh`, then `resume` × 2) and binds each
 *      traversal to the concrete worker that ran it.
 *   3. The kernel-authored resume lineage reached the executor seam (`ofWorker` chains the prior
 *      settled worker, `sequence` counts the chain).
 *   4. Spend continuity: all three turns metered from the transport's OWN usage/cost fields into
 *      the run's one conserved pool.
 *   5. The deliverable crowns the confirming turn as the winner.
 */

import { describe, expect, it } from 'vitest'
import {
  AGENT_REPLIES,
  USER_TURNS,
  userSimConversation,
} from '../../examples/graphs/user-sim-conversation'
import { runGraphWithTestBrain } from '../../src/testing'

describe('examples/graphs/user-sim-conversation — turns are traversals, the session is one message list', () => {
  it('resumes one growing conversation across three workers, ledgered and metered', async () => {
    const { graph, opts, requests, contexts } = userSimConversation()
    const res = await runGraphWithTestBrain(graph, opts)

    // ── 5. The confirming turn wins through the deliverable ──
    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toBe(AGENT_REPLIES[2])
    expect(res.exhaustedEdges).toEqual([])

    // ── 2. The ledger: one delegates edge, three delivered traversals, continuity stamped ──
    expect(
      res.ledger.map((row) => [row.edge, row.traversal, row.outcome, row.continuity, row.workerId]),
    ).toEqual([
      ['delegates:user-sim->product-agent', 1, 'delivered', 'fresh', 'usim:s0'],
      ['delegates:user-sim->product-agent', 2, 'delivered', 'resume', 'usim:s1'],
      ['delegates:user-sim->product-agent', 3, 'delivered', 'resume', 'usim:s2'],
    ])

    // ── 3. The kernel-authored lineage reached the seam: each resume names the prior worker ──
    expect(contexts.map((c) => [c?.continuity, c?.resume?.ofWorker, c?.resume?.sequence])).toEqual([
      ['fresh', undefined, undefined],
      ['resume', 'usim:s0', 2],
      ['resume', 'usim:s1', 3],
    ])

    // ── 1. THE chain, at the wire: request k = request k−1 + [assistant k−1, user k] ──
    expect(requests).toHaveLength(3)
    const messagesOf = (i: number) => requests[i]?.messages as Array<Record<string, unknown>>
    // Turn 1: a fresh session — the pinned profile's system prompt (with the appended delegates
    // directive) + the opener. Nothing else.
    expect(messagesOf(0)).toHaveLength(2)
    expect(messagesOf(0)[0]?.role).toBe('system')
    expect(String(messagesOf(0)[0]?.content)).toContain(
      'You are the product sales agent. Close honestly.',
    )
    expect(messagesOf(0)[1]).toEqual({ role: 'user', content: USER_TURNS[0] })
    for (const turn of [1, 2]) {
      expect(messagesOf(turn)).toEqual([
        ...messagesOf(turn - 1),
        { role: 'assistant', content: AGENT_REPLIES[turn - 1] },
        { role: 'user', content: USER_TURNS[turn] },
      ])
    }
    // Every wire call carried the worker's model, NO tools field (a pure conversation), and NO
    // sampling fields the seam never configured (nothing is silently injected).
    for (const req of requests) {
      expect(req.model).toBe('scripted/product-agent')
      expect(req.tools).toBeUndefined()
      expect(req.temperature).toBeUndefined()
      expect(req.max_tokens).toBeUndefined()
    }

    // ── 4. Spend continuity: 3 turns × {12, 9} tokens and $0.25, all in the one pool ──
    if (res.result.kind === 'winner') {
      expect(res.result.spentTotal.tokens).toEqual({
        input: 36,
        output: 27,
        cacheBreakdownKnown: false,
      })
      expect(res.result.spentTotal.usd).toBe(0.75)
    }
  })
})
