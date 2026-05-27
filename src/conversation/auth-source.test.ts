/**
 * authSource — per-participant control over X-Tangle-Forwarded-Authorization
 * propagation. The three modes correspond to the three commercial billing
 * shapes a multi-agent system can take:
 *
 *  1. forward-user  → pass-through. Downstream bills the original user.
 *  2. agent-owned   → reseller. Downstream bills the participant's own creds.
 *  3. (state) => …  → mixed. Per-turn / per-condition decision.
 *
 * The runtime carries the agent's own credentials on the backend itself
 * (constructed with sk-tan-AGENT or x402 wallet); this knob is *only* about
 * whether to additionally forward the user's identity downstream. Tests
 * therefore assert the *presence/absence of the forwarded-authorization
 * header* on outbound backend calls, which is the observable side-effect.
 */
import { describe, expect, it } from 'vitest'

import { createIterableBackend } from '../backends'
import type { AgentBackendContext, AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { defineConversation } from './define-conversation'
import { FORWARD_HEADERS } from './headers'
import { runConversation } from './run-conversation'

function headerCapturingBackend(): {
  backend: AgentExecutionBackend
  contexts: AgentBackendContext[]
} {
  const contexts: AgentBackendContext[] = []
  const backend = createIterableBackend({
    kind: 'auth-capture',
    async *stream(_input, context) {
      contexts.push(context)
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text: 'ack',
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
      yield {
        type: 'llm_call',
        task: context.task,
        session: context.session,
        model: 'auth-capture',
        costUsd: 0.01,
        tokensIn: 1,
        tokensOut: 1,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
  return { backend, contexts }
}

const USER_AUTH = 'Bearer sk-tan-user-123'

describe('authSource — forward-user (pass-through)', () => {
  it('forwards the user authorization to the participant by default', async () => {
    const cap = headerCapturingBackend()
    const conv = defineConversation({
      participants: [
        { name: 'router', backend: cap.backend },
        { name: 'other', backend: headerCapturingBackend().backend },
      ],
      policy: { maxTurns: 1 },
    })
    await runConversation(conv, {
      seed: 'go',
      propagatedHeaders: { [FORWARD_HEADERS.authorization]: USER_AUTH },
    })
    const h = cap.contexts[0]?.propagatedHeaders ?? {}
    expect(h[FORWARD_HEADERS.authorization]).toBe(USER_AUTH)
  })

  it('explicit forward-user is identical to default', async () => {
    const cap = headerCapturingBackend()
    const conv = defineConversation({
      participants: [
        { name: 'router', backend: cap.backend, authSource: 'forward-user' },
        { name: 'other', backend: headerCapturingBackend().backend },
      ],
      policy: { maxTurns: 1 },
    })
    await runConversation(conv, {
      seed: 'go',
      propagatedHeaders: { [FORWARD_HEADERS.authorization]: USER_AUTH },
    })
    expect(cap.contexts[0]?.propagatedHeaders?.[FORWARD_HEADERS.authorization]).toBe(USER_AUTH)
  })
})

describe('authSource — agent-owned (reseller)', () => {
  it('omits the forwarded-authorization header for an agent-owned participant', async () => {
    const cap = headerCapturingBackend()
    const conv = defineConversation({
      participants: [
        { name: 'reseller', backend: cap.backend, authSource: 'agent-owned' },
        { name: 'other', backend: headerCapturingBackend().backend },
      ],
      policy: { maxTurns: 1 },
    })
    await runConversation(conv, {
      seed: 'go',
      propagatedHeaders: { [FORWARD_HEADERS.authorization]: USER_AUTH },
    })
    const h = cap.contexts[0]?.propagatedHeaders ?? {}
    expect(h[FORWARD_HEADERS.authorization]).toBeUndefined()
    expect(h[FORWARD_HEADERS.runId]).toBeDefined()
    expect(h[FORWARD_HEADERS.depth]).toBe('1')
  })

  it('does not bleed agent-owned omission to a sibling forward-user participant', async () => {
    const reseller = headerCapturingBackend()
    const passthrough = headerCapturingBackend()
    const conv = defineConversation({
      participants: [
        { name: 'reseller', backend: reseller.backend, authSource: 'agent-owned' },
        { name: 'passthrough', backend: passthrough.backend, authSource: 'forward-user' },
      ],
      policy: { maxTurns: 2 },
    })
    await runConversation(conv, {
      seed: 'go',
      propagatedHeaders: { [FORWARD_HEADERS.authorization]: USER_AUTH },
    })
    expect(reseller.contexts[0]?.propagatedHeaders?.[FORWARD_HEADERS.authorization]).toBeUndefined()
    expect(passthrough.contexts[0]?.propagatedHeaders?.[FORWARD_HEADERS.authorization]).toBe(
      USER_AUTH,
    )
  })
})

describe('authSource — function (mixed, per-turn decision)', () => {
  it('lets the participant decide per turn based on transcript state', async () => {
    const cap = headerCapturingBackend()
    // Bill the agent for the first turn (cheap base service) and the user for
    // subsequent turns (premium upgrade). Stand-in for a real predicate that
    // would look at the *content* of the last turn — here we just key off
    // turnIndex, which the runner threads into the predicate state.
    const conv = defineConversation({
      participants: [
        {
          name: 'tiered',
          backend: cap.backend,
          authSource: (state) => (state.turnIndex === 0 ? 'agent-owned' : 'forward-user'),
        },
        { name: 'peer', backend: headerCapturingBackend().backend },
      ],
      policy: { maxTurns: 3 },
    })
    await runConversation(conv, {
      seed: 'go',
      propagatedHeaders: { [FORWARD_HEADERS.authorization]: USER_AUTH },
    })
    // tiered speaks at turnIndex 0 and 2 (alternating).
    expect(cap.contexts).toHaveLength(2)
    expect(cap.contexts[0]?.propagatedHeaders?.[FORWARD_HEADERS.authorization]).toBeUndefined()
    expect(cap.contexts[1]?.propagatedHeaders?.[FORWARD_HEADERS.authorization]).toBe(USER_AUTH)
  })

  it('passes spentCreditsCents into the predicate', async () => {
    let observedSpent: number | undefined
    const cap = headerCapturingBackend()
    const conv = defineConversation({
      participants: [
        {
          name: 'budgeted',
          backend: cap.backend,
          authSource: (state) => {
            observedSpent = state.spentCreditsCents
            return 'agent-owned'
          },
        },
        { name: 'peer', backend: headerCapturingBackend().backend },
      ],
      policy: { maxTurns: 1 },
    })
    await runConversation(conv, {
      seed: 'go',
      propagatedHeaders: { [FORWARD_HEADERS.authorization]: USER_AUTH },
    })
    expect(observedSpent).toBe(0)
  })
})

describe('authSource — interaction with no inbound authorization', () => {
  it('forward-user with no caller auth still produces a clean omit', async () => {
    const cap = headerCapturingBackend()
    const conv = defineConversation({
      participants: [
        { name: 'p', backend: cap.backend, authSource: 'forward-user' },
        { name: 'q', backend: headerCapturingBackend().backend },
      ],
      policy: { maxTurns: 1 },
    })
    await runConversation(conv, { seed: 'go' }) // no propagatedHeaders
    const h = cap.contexts[0]?.propagatedHeaders ?? {}
    expect(h[FORWARD_HEADERS.authorization]).toBeUndefined()
  })
})
