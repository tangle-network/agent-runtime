import { describe, expect, it } from 'vitest'
import { defineLoop, type LoopEvent, selectLoopTrace } from '../../src/runtime'

const clock = () => {
  let t = 1_000
  return () => (t += 10)
}

describe('defineLoop - thin loop facade', () => {
  it('runs a developer-authored loop and returns the complete result envelope', async () => {
    const emitted: LoopEvent[] = []
    const loop = defineLoop<{ goal: string }, { answer: string }>({
      name: 'agentic-eval',
      async run(task, ctx) {
        await ctx.event({
          kind: 'conversation.turn',
          source: 'sim-user',
          target: 'product-agent',
          payload: { prompt: task.goal },
        })
        await ctx.record({
          source: 'product-agent',
          label: 'product reply',
          kind: 'conversation-turn',
          output: { text: 'ship it' },
          trace: {
            messages: [
              { role: 'user', content: task.goal },
              { role: 'assistant', content: 'ship it' },
            ],
          },
          spent: { iterations: 1, tokens: { input: 40, output: 12 }, usd: 0.001, ms: 25 },
        })
        return { answer: 'ship it' }
      },
      verifier: ({ output }) => ({
        valid: output.answer === 'ship it',
        score: 1,
        notes: 'product agent reached the expected terminal answer',
      }),
      judge: () => ({
        valid: true,
        score: 0.86,
        notes: 'held-out conversation rubric score; not fed back into the loop',
      }),
    })

    const result = await loop.run(
      { goal: 'Migrate this repo and verify the product behavior.' },
      { runId: 'loop-1', now: clock(), onEvent: (event) => emitted.push(event) },
    )

    expect(result.ok).toBe(true)
    expect(result.status).toBe('completed')
    expect(result.output).toEqual({ answer: 'ship it' })
    expect(result.verifier?.valid).toBe(true)
    expect(result.judge?.score).toBeCloseTo(0.86, 6)
    expect(result.artifacts).toHaveLength(1)
    expect(result.events.map((event) => event.kind)).toContain('loop.completed')
    expect(emitted.length).toBe(result.events.length)

    const pairTrace = selectLoopTrace(result, {
      pair: ['sim-user', 'product-agent'],
      kinds: ['conversation.turn'],
    })
    expect(pairTrace.events).toHaveLength(1)
    expect(pairTrace.events[0]?.source).toBe('sim-user')
    expect(pairTrace.events[0]?.target).toBe('product-agent')

    const workerTrace = selectLoopTrace(result, { source: 'product-agent' })
    expect(workerTrace.artifacts.map((artifact) => artifact.source)).toContain('product-agent')
    expect(workerTrace.events.some((event) => event.artifactId === result.artifacts[0]?.id)).toBe(
      true,
    )
  })

  it('runs analysts and records findings, questions, messages, and blockers', async () => {
    const loop = defineLoop<{ task: string }, { done: boolean }>({
      name: 'secure-build-loop',
      questionPolicy: 'failClosed',
      analysts: [
        {
          id: 'missing-verifier',
          analyze({ artifact }) {
            if (!artifact) return undefined
            return {
              findings: [
                {
                  claim: 'The worker produced a patch before an executable verifier ran.',
                  severity: 'high',
                  confidence: 0.9,
                },
              ],
              questions: [
                {
                  from: artifact.source,
                  level: 'loop',
                  question: 'Should the loop spawn a verifier worker before accepting this patch?',
                  reason: 'Implementation output settled before verifier output.',
                  urgency: 'blocks-run',
                },
              ],
              messages: [
                {
                  to: artifact.source,
                  kind: 'steer',
                  body: 'Prepare verifier inputs while the parent decides.',
                  reason: 'Analyst found missing verification.',
                },
              ],
              blockers: ['implementation has no verifier artifact'],
            }
          },
        },
      ],
      async run(_task, ctx) {
        await ctx.record({
          source: 'worker-a',
          label: 'implementation worker',
          kind: 'worker',
          output: { patch: 'diff --git a/a.ts b/a.ts' },
          trace: { messages: [{ role: 'assistant', content: 'wrote patch' }] },
        })
        return { done: true }
      },
    })

    const result = await loop.run({ task: 'harden protocol' }, { runId: 'loop-analyst' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.findings).toHaveLength(1)
    expect(result.questions).toHaveLength(1)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.delivery.status).toBe('queued')
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'implementation worker: implementation has no verifier artifact',
        expect.stringContaining('unresolved blocks-run question'),
      ]),
    )
  })

  it('exposes a live handle so a root/Pi agent can message any addressed agent', async () => {
    let release: () => void = () => undefined
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    const delivered: string[] = []
    const loop = defineLoop<void, { finished: true }>({
      name: 'root-steerable-loop',
      async run(_task, ctx) {
        await ctx.record({
          source: 'worker-live',
          label: 'live worker',
          kind: 'worker',
          status: 'running',
        })
        await wait
        await ctx.record({
          source: 'worker-live',
          label: 'live worker',
          kind: 'worker',
          output: { acceptedSteer: true },
        })
        return { finished: true }
      },
    })

    const handle = loop.start(undefined, {
      runId: 'loop-live',
      messageRouter: (message) => {
        delivered.push(`${message.from}->${message.to}:${message.body}`)
        return { status: message.mode === 'immediate' ? 'delivered' : 'queued' }
      },
    })

    const message = await handle.control.send({
      from: 'pi-root',
      to: 'worker-live',
      kind: 'steer',
      body: 'Use the simplified API surface.',
      mode: 'immediate',
    })
    const controlMessage = await handle.control.send({
      from: 'pi-root',
      to: 'worker-live',
      kind: 'note',
      body: 'Root can address this worker through the control plane.',
      mode: 'queue',
    })
    expect(handle.control.snapshot().artifacts.map((artifact) => artifact.source)).toContain(
      'worker-live',
    )
    release()
    const result = await handle.result

    expect(message.delivery.status).toBe('delivered')
    expect(controlMessage.delivery.status).toBe('queued')
    expect(delivered).toEqual([
      'pi-root->worker-live:Use the simplified API surface.',
      'pi-root->worker-live:Root can address this worker through the control plane.',
    ])
    expect(result.messages.map((record) => record.id)).toContain(message.id)
    expect(result.messages.map((record) => record.id)).toContain(controlMessage.id)
    expect(result.events.some((event) => event.kind === 'message.sent')).toBe(true)
  })

  it('runs verifier and judge even when the loop output is undefined', async () => {
    const loop = defineLoop<void, void>({
      name: 'void-output-loop',
      async run(_task, ctx) {
        await ctx.record({
          source: 'worker-void',
          label: 'void worker',
        })
      },
      verifier: () => ({ valid: true, score: 1, notes: 'side-effect-only loop verified' }),
      judge: () => ({ valid: true, score: 0.5, notes: 'held-out side-effect score' }),
    })

    const result = await loop.run(undefined)

    expect(result.ok).toBe(true)
    expect(result.verifier?.valid).toBe(true)
    expect(result.judge?.score).toBe(0.5)
    expect('output' in result).toBe(true)
  })
})
