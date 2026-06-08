/**
 * defineLoop - blessed loop facade over a simulated-user/product-agent eval.
 *
 * Run with:
 *   pnpm tsx examples/define-loop/define-loop.ts
 */

import {
  type AgentBackendInput,
  createIterableBackend,
  defineConversation,
  defineLoop,
  type LoopAnalyst,
  runConversation,
  selectLoopTrace,
} from '@tangle-network/agent-runtime'

type EvalTask = {
  goal: string
}

type EvalOutput = {
  finalAnswer: string
  turns: number
}

const simUser = createIterableBackend<AgentBackendInput>({
  kind: 'sim-user',
  async *stream(input, ctx) {
    const prior = input.messages?.map((message) => message.content).join('\n') ?? ''
    const text = prior.includes('DONE')
      ? 'Thanks, that answers my question.'
      : `Please solve this without mocks: ${input.message ?? ctx.task.intent}`
    yield {
      type: 'text_delta',
      task: ctx.task,
      session: ctx.session,
      text,
      timestamp: new Date().toISOString(),
    }
    yield {
      type: 'llm_call',
      task: ctx.task,
      session: ctx.session,
      model: 'sim-user-script',
      tokensIn: 60,
      tokensOut: 18,
      costUsd: 0,
      timestamp: new Date().toISOString(),
    }
  },
})

const productAgent = createIterableBackend<AgentBackendInput>({
  kind: 'product-agent',
  async *stream(input, ctx) {
    const text = `DONE: built "${input.message ?? ctx.task.intent}", ran non-mocked checks, and shipped.`
    yield {
      type: 'text_delta',
      task: ctx.task,
      session: ctx.session,
      text,
      timestamp: new Date().toISOString(),
    }
    yield {
      type: 'llm_call',
      task: ctx.task,
      session: ctx.session,
      model: 'product-agent-script',
      tokensIn: 140,
      tokensOut: 42,
      costUsd: 0.002,
      timestamp: new Date().toISOString(),
    }
  },
})

const missingMockCheck: LoopAnalyst = {
  id: 'mock-detector',
  timing: 'record',
  select: ({ artifact }) => (artifact ? { artifactId: artifact.id } : {}),
  analyze({ artifact, trace }) {
    const text = JSON.stringify(artifact?.trace ?? trace)
      .toLowerCase()
      .replaceAll('without mocks', '')
      .replaceAll('non-mocked', '')
    if (!/\bmock(s|ed)?\b/.test(text)) return undefined
    return {
      findings: [
        {
          claim: 'The loop trace mentions mocks; require a real verifier before accepting.',
          severity: 'high',
          confidence: 0.8,
        },
      ],
      questions: [
        {
          from: artifact?.source ?? 'loop',
          level: 'loop',
          question: 'Should this run a no-mocks verifier before stopping?',
          reason: 'The trace contains the word mock.',
          urgency: 'blocks-run',
        },
      ],
    }
  },
}

const agenticEvalLoop = defineLoop<EvalTask, EvalOutput>({
  name: 'agentic-product-eval',
  questionPolicy: 'failClosed',
  analysts: [missingMockCheck],
  async run(task, ctx) {
    const conversation = defineConversation({
      participants: [
        { name: 'sim-user', backend: simUser },
        { name: 'product-agent', backend: productAgent },
      ],
      policy: {
        maxTurns: 4,
        haltOn: ({ lastTurn }) =>
          lastTurn.speaker === 'product-agent' && lastTurn.text.includes('DONE')
            ? { halted: true, reason: 'product-agent completed task' }
            : false,
      },
    })

    const result = await runConversation(conversation, {
      runId: ctx.runId,
      seed: task.goal,
      onEvent: async (event) => {
        if (event.type !== 'turn_end') return
        await ctx.event({
          kind: 'conversation.turn',
          source: event.turn.speaker,
          target: 'conversation',
          payload: { turnId: event.turn.turnId, text: event.turn.text },
        })
        await ctx.record({
          source: event.turn.speaker,
          label: `${event.turn.speaker} turn ${event.turn.index}`,
          kind: 'conversation-turn',
          output: event.turn.text,
          trace: { turn: event.turn },
          spent: {
            iterations: 1,
            tokens: {
              input: event.turn.usage?.tokensIn ?? 0,
              output: event.turn.usage?.tokensOut ?? 0,
            },
            usd: event.turn.usage?.costUsd ?? 0,
          },
        })
      },
    })

    return {
      finalAnswer: result.transcript.at(-1)?.text ?? '',
      turns: result.turns,
    }
  },
  verifier: ({ output }) => ({
    valid: output.finalAnswer.includes('DONE') && output.finalAnswer.includes('non-mocked checks'),
    score: output.finalAnswer.includes('DONE') ? 1 : 0,
    notes: 'Conversation reached a product-agent completion with non-mocked check claim.',
  }),
  judge: ({ output }) => ({
    valid: true,
    score: output.turns <= 2 ? 0.95 : 0.75,
    notes: 'Held-out quality score. This is recorded after the loop body and never steers it.',
  }),
})

async function main(): Promise<void> {
  const result = await agenticEvalLoop.run({
    goal: 'Build the feature end to end and prove it without mocks.',
  })

  const productTrace = selectLoopTrace(result, { source: 'product-agent' })
  const pairTrace = selectLoopTrace(result, { pair: ['sim-user', 'conversation'] })

  console.log(`status: ${result.status}`)
  console.log(`ok: ${result.ok}`)
  console.log(`artifacts: ${result.artifacts.length}`)
  console.log(`verifier: ${result.verifier?.valid} (${result.verifier?.notes})`)
  console.log(`judge score: ${result.judge?.score}`)
  console.log(`product-agent events: ${productTrace.events.length}`)
  console.log(`sim-user conversation events: ${pairTrace.events.length}`)
  console.log(`final: ${result.output?.finalAnswer}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
