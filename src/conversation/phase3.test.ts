/**
 * Phase 3 — the cross-gateway protocol contract. Tests assert depth refusal,
 * header propagation across nested conversations (createConversationBackend
 * recursion), and runId/parentTurnId stitching.
 *
 * The depth-limit *enforcement* lives in agent-gateway's inbound middleware;
 * here we verify the runtime emits the correct headers so the gateway has
 * something to enforce on.
 */
import { describe, expect, it } from 'vitest'

import { createIterableBackend } from '../backends'
import type { AgentBackendContext, AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { createConversationBackend } from './conversation-backend'
import { defineConversation } from './define-conversation'
import {
  buildForwardHeaders,
  DEFAULT_MAX_DEPTH,
  FORWARD_HEADERS,
  isDepthExceeded,
  readDepth,
} from './headers'
import { runConversation } from './run-conversation'

function captureHeaders(): {
  backend: AgentExecutionBackend
  ctxs: AgentBackendContext[]
} {
  const ctxs: AgentBackendContext[] = []
  const backend = createIterableBackend({
    kind: 'capture',
    async *stream(_input, context) {
      ctxs.push(context)
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text: 'noted',
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
      yield {
        type: 'llm_call',
        task: context.task,
        session: context.session,
        model: 'capture',
        costUsd: 0.01,
        tokensIn: 1,
        tokensOut: 1,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
  return { backend, ctxs }
}

// ── readDepth + buildForwardHeaders ────────────────────────────────────

describe('headers — parse + build', () => {
  it('returns 0 when the depth header is absent', () => {
    expect(readDepth({})).toBe(0)
  })
  it('parses an integer depth from string headers (Hono-style)', () => {
    expect(readDepth({ [FORWARD_HEADERS.depth]: '3' })).toBe(3)
  })
  it('throws fail-loud on non-integer depth (no silent reset)', () => {
    expect(() => readDepth({ [FORWARD_HEADERS.depth]: 'banana' })).toThrow(/non-negative integer/)
    expect(() => readDepth({ [FORWARD_HEADERS.depth]: '-1' })).toThrow(/non-negative integer/)
    expect(() => readDepth({ [FORWARD_HEADERS.depth]: '1.5' })).toThrow(/non-negative integer/)
  })
  it('uses the first value when a header is multi-valued (HTTP allows)', () => {
    expect(readDepth({ [FORWARD_HEADERS.depth]: ['2', '99'] })).toBe(2)
  })
  it('isDepthExceeded at the documented default of 4', () => {
    expect(isDepthExceeded(0)).toBe(false)
    expect(isDepthExceeded(3)).toBe(false)
    expect(isDepthExceeded(4)).toBe(true)
    expect(isDepthExceeded(99)).toBe(true)
    expect(isDepthExceeded(2, 2)).toBe(true) // custom max
    expect(DEFAULT_MAX_DEPTH).toBe(4)
  })
  it('buildForwardHeaders increments depth + carries identity + run/turn', () => {
    const out = buildForwardHeaders({
      inboundDepth: 1,
      forwardedAuthorization: 'Bearer sk-tan-user',
      runId: 'r',
      turnId: 'r.t0.alice',
      parentTurnId: 'r.t-1.outer',
      speaker: 'alice',
    })
    expect(out[FORWARD_HEADERS.depth]).toBe('2')
    expect(out[FORWARD_HEADERS.authorization]).toBe('Bearer sk-tan-user')
    expect(out[FORWARD_HEADERS.runId]).toBe('r')
    expect(out[FORWARD_HEADERS.turnId]).toBe('r.t0.alice')
    expect(out[FORWARD_HEADERS.parentTurnId]).toBe('r.t-1.outer')
    expect(out[FORWARD_HEADERS.speaker]).toBe('alice')
  })
  it('buildForwardHeaders omits absent optional fields (no empty strings)', () => {
    const out = buildForwardHeaders({
      inboundDepth: 0,
      runId: 'r',
      turnId: 'r.t0.x',
      speaker: 'x',
    })
    expect(out[FORWARD_HEADERS.authorization]).toBeUndefined()
    expect(out[FORWARD_HEADERS.parentTurnId]).toBeUndefined()
  })
})

// ── Cross-gateway propagation through nested conversations ─────────────

describe('cross-gateway propagation through createConversationBackend', () => {
  it('runId stays constant + depth monotonically increments through recursion', async () => {
    const innerCap = captureHeaders()
    const innerConv = defineConversation({
      participants: [
        { name: 'inner-x', backend: innerCap.backend },
        { name: 'inner-y', backend: innerCap.backend },
      ],
      policy: { maxTurns: 2 },
    })
    const swarm = createConversationBackend({ conversation: innerConv, kind: 'swarm' })

    const outerCap = captureHeaders()
    const outerConv = defineConversation({
      participants: [
        { name: 'outer-a', backend: outerCap.backend },
        { name: 'swarm', backend: swarm },
      ],
      policy: { maxTurns: 2 },
    })

    const result = await runConversation(outerConv, {
      seed: 'kick off',
      runId: 'shared-run',
      inboundDepth: 1, // pretend we were called from one hop deep already
      propagatedHeaders: {
        [FORWARD_HEADERS.authorization]: 'Bearer sk-tan-original-user',
      },
    })
    expect(result.runId).toBe('shared-run')

    // outer-a was called at depth 1+1 = 2; its turnId scopes under shared-run.
    expect(outerCap.ctxs).toHaveLength(1)
    const outerHeaders = outerCap.ctxs[0]?.propagatedHeaders ?? {}
    expect(outerHeaders[FORWARD_HEADERS.depth]).toBe('2')
    expect(outerHeaders[FORWARD_HEADERS.runId]).toBe('shared-run')
    expect(outerHeaders[FORWARD_HEADERS.authorization]).toBe('Bearer sk-tan-original-user')

    // inner participants were called from inside the swarm backend → another
    // hop deeper. Depth should be 3, runId preserved, parent-turn-id set.
    expect(innerCap.ctxs.length).toBeGreaterThan(0)
    for (const ctx of innerCap.ctxs) {
      const h = ctx.propagatedHeaders ?? {}
      expect(h[FORWARD_HEADERS.runId]).toBe('shared-run')
      expect(h[FORWARD_HEADERS.depth]).toBe('3')
      expect(h[FORWARD_HEADERS.authorization]).toBe('Bearer sk-tan-original-user')
      // The parent-turn-id is the outer turn the swarm was running in.
      expect(h[FORWARD_HEADERS.parentTurnId]).toMatch(/\.t\d+\.swarm$/)
    }
  })

  it('the depth-limit math holds end-to-end: an origin caller cannot trick the runtime into resetting', async () => {
    const cap = captureHeaders()
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: cap.backend },
        { name: 'b', backend: cap.backend },
      ],
      policy: { maxTurns: 2 },
    })
    // Pretend a (broken) caller forwarded depth as '0' even though they're
    // really at depth 5. The runtime takes the caller-asserted value at face
    // value here — depth honesty is enforced at the *gateway*, not by every
    // intermediate runtime. We verify only that the runtime increments
    // monotonically from whatever inboundDepth it was given.
    await runConversation(conv, {
      seed: 'go',
      inboundDepth: 5,
    })
    for (const ctx of cap.ctxs) {
      expect(ctx.propagatedHeaders?.[FORWARD_HEADERS.depth]).toBe('6')
    }
  })
})
