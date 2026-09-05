import { describe, expect, it } from 'vitest'
import {
  type CoordinationEvent,
  createCoordinationTools,
  downMessageRefusalReasons,
  type QuestionEscalationRecord,
} from '../../src/mcp/tools/coordination'
import type { Agent, ResultBlobStore, Scope, Spend } from '../../src/runtime'
import { steerAcknowledgementDetail } from '../../src/runtime/supervise/coordination-driver'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'

const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })
const blobs: ResultBlobStore = { get: async () => undefined, put: async () => {} }
const makeWorkerAgent = (): Agent<unknown, unknown> => ({ name: 'w', act: async () => 0 })
const perWorker = { maxIterations: 1, maxTokens: 10 }

function mockScope(options: { admit?: boolean } = {}) {
  const nodes = [
    {
      id: 'w0',
      label: 'worker',
      status: 'running' as const,
      runtime: 'router',
      budget: { maxIterations: 1, maxTokens: 10 },
      spent: zeroSpend(),
    },
  ]
  return {
    spawn: (_agent: unknown, _task: unknown, opts: { label: string }) =>
      options.admit === false
        ? { ok: false as const, reason: 'budget-exhausted' as const }
        : {
            ok: true as const,
            handle: { id: 'w0', label: opts.label, status: 'running' as const, abort() {} },
          },
    next: async () => null,
    send: (id: string) => id === 'w0',
    get view() {
      return { root: 'root', nodes, inFlight: 1 }
    },
    budget: { tokensLeft: 10, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
    signal: new AbortController().signal,
  } as unknown as Scope<unknown>
}

function manager(extra: Record<string, unknown> = {}, scope = mockScope()) {
  return createCoordinationTools({ scope, blobs, makeWorkerAgent, perWorker, ...extra })
}

const tool = (tb: ReturnType<typeof createCoordinationTools>, name: string) => {
  const found = tb.tools.find((t) => t.name === name)
  if (!found) throw new Error(`no tool ${name}`)
  return found
}

const askParent = (
  tb: ReturnType<typeof createCoordinationTools>,
  over: Record<string, unknown> = {},
) =>
  tool(tb, 'ask_parent').handler({
    from: 'w0',
    level: 'driver',
    question: 'Which API version should this migration target?',
    reason: 'two supported versions',
    urgency: 'blocks-run',
    ...over,
  }) as Promise<Record<string, unknown>>

/** A refusal a manager can act on states the unmet condition in words, not only a code. */
function expectReason(result: unknown, contains?: RegExp): string {
  const reason = (result as { reason?: unknown }).reason
  expect(typeof reason).toBe('string')
  expect((reason as string).length).toBeGreaterThan(20)
  if (contains) expect(reason as string).toMatch(contains)
  return reason as string
}

describe('every coordination refusal names its unmet condition', () => {
  it('spawn_worker: pool, cap, profile, continuity and pre-flight refusals all carry a reason', async () => {
    const refusedPool = await tool(
      manager({}, mockScope({ admit: false })),
      'spawn_worker',
    ).handler({
      profile: {},
      task: 'go',
    })
    expect(refusedPool).toMatchObject({ error: 'budget-exhausted' })
    expectReason(refusedPool, /conserved pool/)

    const capped = manager({ maxLiveWorkers: 1 })
    const atCap = await tool(capped, 'spawn_worker').handler({ profile: {}, task: 'go' })
    expect(atCap).toMatchObject({ error: 'max-live-workers' })
    expectReason(atCap, /await_event/)

    const invalid = await tool(manager(), 'spawn_worker').handler({
      profile: { name: 42 },
      task: 'go',
    })
    expect(invalid).toMatchObject({ error: 'invalid-profile' })
    expectReason(invalid, /valid AgentProfile/)

    const resumeRefused = await tool(manager(), 'spawn_worker').handler({
      profile: { name: 'never-ran' },
      task: 'go',
      continuity: 'resume',
    })
    expect(resumeRefused).toMatchObject({ error: 'resume-no-prior' })
    expectReason(resumeRefused, /no settled prior worker/)

    const preflight = manager({
      preflightSpawn: async () => ({
        cause: 'model-route' as const,
        detail: 'bridge routes no backend for "pi/x/y"',
      }),
    })
    const refusedPreflight = await tool(preflight, 'spawn_worker').handler({
      profile: { name: 'unrouted' },
      task: 'go',
    })
    expect(refusedPreflight).toMatchObject({ error: 'preflight-refused' })
    expectReason(refusedPreflight, /bridge routes no backend/)
  })

  it('observe_agent and run_analyst refuse with a stable code AND a sentence', async () => {
    const analysts = {
      kinds: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
      run: async () => [{ claim: 'x' }],
    }
    const tb = manager({ analysts })

    const unknown = await tool(tb, 'observe_agent').handler({ workerId: 'nope' })
    expect(unknown).toMatchObject({ error: 'unknown-worker' })
    expectReason(unknown, /"nope"/)

    const unknownLens = await tool(tb, 'run_analyst').handler({
      kind: 'completeness',
      workerId: 'nope',
    })
    expect(unknownLens).toMatchObject({ error: 'unknown-worker' })
    expectReason(unknownLens)

    const live = await tool(tb, 'run_analyst').handler({ kind: 'completeness', workerId: 'w0' })
    expect(live).toMatchObject({ error: 'worker-not-settled' })
    expectReason(live, /await_event/)
  })

  it('steer_agent keeps the outcome CODE and adds the sentence, one per outcome', async () => {
    const tb = manager()
    const refused = await tool(tb, 'steer_agent').handler({ workerId: 'gone', instruction: 'x' })
    expect(refused).toMatchObject({ delivered: false, outcome: 'unknown-worker' })
    expectReason(refused, /observe_agent/)

    // Every outcome the down-leg can report has a sentence; a new code cannot ship without one.
    for (const [outcome, sentence] of Object.entries(downMessageRefusalReasons)) {
      expect(sentence.length, outcome).toBeGreaterThan(20)
    }
  })

  it('the manager-facing and operator-facing outcome maps stay total over the same codes', () => {
    // Two maps for one enum is deliberate — `downMessageRefusalReasons` tells a MODEL what to do
    // next, `steerAcknowledgementDetail` tells a PERSON reading the run what happened — but a new
    // outcome must not land in only one of them. The compiler holds the first (it is a
    // `Record<DownMessageDeliveryOutcome, string>`) and the exhaustive switch holds the second;
    // this holds them to the SAME key set.
    for (const outcome of Object.keys(downMessageRefusalReasons) as ReadonlyArray<
      keyof typeof downMessageRefusalReasons
    >) {
      const detail = steerAcknowledgementDetail({
        receiptId: 'r',
        toWorker: 'w0',
        instruction: 'x',
        instructionDigest: `sha256:${'0'.repeat(64)}`,
        delivered: outcome === 'delivered',
        outcome,
      })
      expect(detail, outcome).toBeTypeOf('string')
      expect(detail.length, outcome).toBeGreaterThan(20)
    }
  })

  it('submit_result separates a failed check from a THROWN one, and names the expected artifact', async () => {
    const failing = manager({
      deliverable: { describe: 'a patch that compiles', check: (out: unknown) => out === 'good' },
    })
    const refused = await tool(failing, 'submit_result').handler({ result: 'bad' })
    expect(refused).toMatchObject({ accepted: false, stop: false })
    expectReason(refused, /a patch that compiles/)

    const broken = manager({
      deliverable: {
        describe: 'a patch that compiles',
        check: () => {
          throw new Error('the test runner is not installed')
        },
      },
    })
    const threw = await tool(broken, 'submit_result').handler({ result: 'anything' })
    expect(threw).toMatchObject({ accepted: false, stop: false })
    // Previously the thrown message was swallowed, so a broken oracle and unfinished work were
    // indistinguishable. The manager now learns it must report the check, not resubmit.
    expectReason(threw, /THREW/)
    expect(String((threw as { reason: string }).reason)).toContain(
      'the test runner is not installed',
    )
    expect(broken.isStopped()).toBe(false)
  })
})

describe('ask_parent at the top of the chain', () => {
  it('answers no-parent instead of a bare receipt, and journals the artifact', async () => {
    const tb = manager({ questionPolicy: 'failClosed' })
    const asked = await askParent(tb)

    expect(asked).toMatchObject({ escalated: false, outcome: 'no-parent' })
    expectReason(asked, /no parent inbox/)
    expect(String(asked.guidance)).toMatch(/YOU are the last decider/)

    const record = tb.escalations()[0] as QuestionEscalationRecord
    expect(record).toMatchObject({ delivered: false, from: 'w0', urgency: 'blocks-run' })
    expect(record.to).toBeUndefined()
    expect(record.questionId).toBe((asked.question as { id: string }).id)

    // The artifact is on the run's own journal, record-only: an operator reads it, and the
    // manager's inbox is not filled with its own escalation.
    const journaled = tb
      .history()
      .filter((entry) => entry.event.type === 'escalation')
      .map(
        (entry) => (entry.event as Extract<CoordinationEvent, { type: 'escalation' }>).escalation,
      )
    expect(journaled).toEqual([record])
    expect(await tool(tb, 'await_event').handler({ kinds: ['question'] })).toMatchObject({
      type: 'question',
    })
    expect(await tool(tb, 'await_event').handler({})).toMatchObject({ idle: true })
  })

  it('the seam reaches a manager through the coordination MCP mount, not only the direct toolbox', async () => {
    // A seam nothing forwards is a seam that does not exist. `serveCoordinationMcp` is the harness
    // arm's mount; if it drops the option, `queued-for-parent` is unreachable in every real run.
    const received: string[] = []
    const mcp = await serveCoordinationMcp({
      scope: mockScope(),
      blobs,
      makeWorkerAgent,
      perWorker,
      toolNames: ['ask_parent'],
      host: '127.0.0.1',
      escalateQuestion: (question: { question: string }) => {
        received.push(question.question)
        return { delivered: true as const, to: 'the run operator' }
      },
    })
    try {
      const response = await fetch(mcp.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'ask_parent',
            arguments: {
              from: 'w0',
              level: 'driver',
              question: 'Which API version should this migration target?',
              reason: 'two supported versions',
              urgency: 'blocks-run',
            },
          },
        }),
      })
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const asked = JSON.parse(body.result.content[0]?.text ?? '{}') as Record<string, unknown>
      expect(asked).toMatchObject({ escalated: true, outcome: 'queued-for-parent' })
      expectReason(asked, /the run operator/)
      expect(received).toEqual(['Which API version should this migration target?'])
      expect(mcp.history().filter((record) => record.event.type === 'escalation')).toHaveLength(1)
    } finally {
      await mcp.close()
    }
  })

  it('reports queued-for-parent when a parent inbox does receive it', async () => {
    const received: string[] = []
    const tb = manager({
      escalateQuestion: (question: { question: string }) => {
        received.push(question.question)
        return { delivered: true as const, to: 'the run operator' }
      },
    })
    const asked = await askParent(tb)
    expect(asked).toMatchObject({ escalated: true, outcome: 'queued-for-parent' })
    expectReason(asked, /the run operator/)
    expect(asked.guidance).toBeUndefined()
    expect(received).toEqual(['Which API version should this migration target?'])
    expect(tb.escalations()[0]).toMatchObject({ delivered: true, to: 'the run operator' })
  })

  it('a parent channel that throws is an UNDELIVERED escalation, never a delivered one', async () => {
    const tb = manager({
      escalateQuestion: () => {
        throw new Error('parent inbox is unreachable')
      },
    })
    const asked = await askParent(tb)
    expect(asked).toMatchObject({ escalated: false, outcome: 'no-parent' })
    expectReason(asked, /parent inbox is unreachable/)
    expect(tb.escalations()[0]?.delivered).toBe(false)
  })

  it('answer_question escalateTo:parent crosses the SAME seam, so it cannot wait silently either', async () => {
    // The PR's own thesis applied to the other parent-escalation path: marking a question
    // 'escalated' and stopping there leaves it blocking `stop` under failClosed with no outcome the
    // manager can read.
    const tb = manager({ questionPolicy: 'failClosed' })
    const asked = await askParent(tb, { urgency: 'blocks-step' })
    const questionId = (asked.question as { id: string }).id

    const escalated = (await tool(tb, 'answer_question').handler({
      questionId,
      escalateTo: 'parent',
      escalateReason: 'this is a product decision, not mine',
    })) as Record<string, unknown>
    expect(escalated).toMatchObject({ escalated: false, outcome: 'no-parent' })
    expectReason(escalated, /no parent inbox/)
    expect(String(escalated.guidance)).toMatch(/Do not BLOCK/)
    // Both the ask and the escalation are on the record, so an operator sees each attempt.
    expect(tb.escalations()).toHaveLength(2)

    // `escalateTo: 'user'` addresses the operator directly and does not cross the runtime seam.
    const toUser = (await tool(tb, 'answer_question').handler({
      questionId,
      escalateTo: 'user',
    })) as Record<string, unknown>
    expect(toUser.outcome).toBeUndefined()
    expect(tb.escalations()).toHaveLength(2)
  })

  it('a parent inbox reached from answer_question reports queued-for-parent', async () => {
    const tb = manager({
      escalateQuestion: () => ({ delivered: true as const, to: 'the parent driver' }),
    })
    const asked = await askParent(tb)
    const escalated = (await tool(tb, 'answer_question').handler({
      questionId: (asked.question as { id: string }).id,
      escalateTo: 'parent',
    })) as Record<string, unknown>
    expect(escalated).toMatchObject({ escalated: true, outcome: 'queued-for-parent' })
    expect(escalated.guidance).toBeUndefined()
  })

  it('a prior process’s unheard escalation is still known after a restart', async () => {
    // Journaled and reloaded is not enough: `stop` is the reader that acts on it, and a fresh
    // toolbox that starts with an empty ledger gives the generic refusal instead of naming the
    // question nothing can answer.
    const question = {
      id: 'w0:q0',
      from: 'w0',
      level: 'driver' as const,
      question: 'Which API version?',
      reason: 'two supported versions',
      urgency: 'blocks-run' as const,
      status: 'escalated' as const,
      openedAt: 1_700_000_000_000,
    }
    const tb = manager({
      questionPolicy: 'failClosed',
      priorQuestions: [question],
      priorEscalations: [
        {
          questionId: question.id,
          from: 'w0',
          urgency: 'blocks-run' as const,
          delivered: false,
          reason: 'no parent inbox is configured for this manager',
          at: 1_700_000_000_001,
        },
      ],
    })
    const blocked = await tool(tb, 'stop').handler({ reason: 'done' })
    expect(blocked).toMatchObject({
      stopped: false,
      error: 'unresolved-blocking-questions',
      unheardQuestionIds: [question.id],
    })
    expectReason(blocked, /reached no parent/)
  })

  it('the stop refusal names the unheard question and the way out, so nothing waits forever', async () => {
    const tb = manager({ questionPolicy: 'failClosed' })
    const asked = await askParent(tb)
    const questionId = (asked.question as { id: string }).id

    const blocked = await tool(tb, 'stop').handler({ reason: 'done' })
    expect(blocked).toMatchObject({
      stopped: false,
      error: 'unresolved-blocking-questions',
      unheardQuestionIds: [questionId],
    })
    expectReason(blocked, /reached no parent/)
    expect(String((blocked as { reason: string }).reason)).toContain('deferReason')

    // The named way out actually works: the manager decides its own unheard question and stops.
    await tool(tb, 'answer_question').handler({
      questionId,
      deferReason: 'nobody can answer this; proceeding on v2 and recording the assumption',
    })
    expect(await tool(tb, 'stop').handler({ reason: 'decided and stopping' })).toEqual({
      stopped: true,
    })
  })

  it('answer_question — the verb the no-parent guidance sends you to — names its own refusals', async () => {
    // The guidance is only actionable if the verb it names refuses legibly. Every path: an id this
    // manager does not hold, a delivery that could not land, a bad escalation target, no decision.
    const tb = manager({ questionPolicy: 'failClosed' })
    const asked = await askParent(tb)
    const questionId = (asked.question as { id: string }).id
    const answer = (args: Record<string, unknown>) =>
      tool(tb, 'answer_question').handler(args) as Promise<Record<string, unknown>>

    const unknown = await answer({ questionId: 'nope', answer: 'x' })
    expect(unknown).toMatchObject({ error: 'unknown-question' })
    expectReason(unknown, /list_questions/)
    expect(await answer({ questionId: 'nope', deferReason: 'x' })).toMatchObject({
      error: 'unknown-question',
    })
    expect(await answer({ questionId: 'nope', escalateTo: 'parent' })).toMatchObject({
      error: 'unknown-question',
    })

    const badTarget = await answer({ questionId, escalateTo: 'sideways' })
    expect(badTarget).toMatchObject({ error: 'invalid-escalation-target' })
    expectReason(badTarget, /parent/)

    const noDecision = await answer({ questionId })
    expect(noDecision).toMatchObject({ error: 'no-decision' })
    expectReason(noDecision, /deferReason/)

    // A question raised by a worker that is no longer reachable: the answer cannot land, and the
    // refusal carries the code AND the sentence, exactly like steer_agent. Before this change
    // `reason` held the bare code on this one verb, so the same field meant two different things.
    const gone = (await askParent(tb, { from: 'departed-worker' })) as {
      question: { id: string }
    }
    const undelivered = await answer({ questionId: gone.question.id, answer: 'Target v2.' })
    expect(undelivered).toMatchObject({ delivered: false, outcome: 'unknown-worker' })
    expectReason(undelivered, /observe_agent/)
  })

  it('a stop blocked only by answerable questions does not claim anything went unheard', async () => {
    const tb = manager({
      questionPolicy: 'failClosed',
      escalateQuestion: () => ({ delivered: true as const, to: 'the parent driver' }),
    })
    await askParent(tb)
    const blocked = await tool(tb, 'stop').handler({ reason: 'done' })
    expect(blocked).toMatchObject({ stopped: false, error: 'unresolved-blocking-questions' })
    expect((blocked as { unheardQuestionIds?: string[] }).unheardQuestionIds).toBeUndefined()
    expectReason(blocked, /answer_question/)
  })
})
