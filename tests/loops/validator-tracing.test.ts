import type {
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { runAgentRounds } from '../../src/runtime/run-loop'
import type {
  LoopTraceEmitter,
  LoopTraceEvent,
  ValidationCtx,
  Validator,
} from '../../src/runtime/types'

function makeEnvironmentProvider(): AgentEnvironmentProvider {
  return {
    name: 'trace-provider',
    capabilities() {
      throw new Error('capabilities are not used without lineage')
    },
    async create() {
      return {
        id: 'environment-1',
        provider: 'trace-provider',
        async status() {
          return 'running'
        },
        async *stream() {
          yield {
            type: 'text',
            data: { content: 'done' },
          } satisfies AgentEnvironmentEvent
        },
        async destroy() {},
      }
    },
  }
}

describe('validator tracing', () => {
  it('validator receives traceEmitter in ctx when kernel has one', async () => {
    let receivedEmitter: LoopTraceEmitter | undefined

    const validator: Validator<string> = {
      async validate(_output: string, ctx: ValidationCtx) {
        receivedEmitter = ctx.traceEmitter
        return { valid: true, score: 1.0 }
      },
    }

    const events: LoopTraceEvent[] = []
    const traceEmitter: LoopTraceEmitter = {
      emit(event) {
        events.push(event)
      },
    }

    await runAgentRounds({
      driver: {
        name: 'test',
        async plan(_task, history) {
          return history.length === 0 ? ['go'] : []
        },
        decide(history) {
          return history.length > 0 ? 'done' : 'continue'
        },
      },
      agentRun: {
        profile: { name: 'test' },
        taskToPrompt: (t: string) => t,
      },
      output: { parse: () => 'parsed-output' },
      validator,
      task: 'test-task',
      ctx: {
        environmentProvider: makeEnvironmentProvider(),
        traceEmitter,
        signal: AbortSignal.timeout(5000),
      },
      maxIterations: 1,
    })

    expect(receivedEmitter).toBe(traceEmitter)
  })

  it('validator receives undefined traceEmitter when kernel has none', async () => {
    let receivedEmitter: LoopTraceEmitter | undefined
    let validatorCalled = false

    const validator: Validator<string> = {
      async validate(_output: string, ctx: ValidationCtx) {
        validatorCalled = true
        receivedEmitter = ctx.traceEmitter
        return { valid: true, score: 1.0 }
      },
    }

    await runAgentRounds({
      driver: {
        name: 'test',
        async plan(_task, history) {
          return history.length === 0 ? ['go'] : []
        },
        decide(history) {
          return history.length > 0 ? 'done' : 'continue'
        },
      },
      agentRun: {
        profile: { name: 'test' },
        taskToPrompt: (t: string) => t,
      },
      output: { parse: () => 'parsed-output' },
      validator,
      task: 'test-task',
      ctx: {
        environmentProvider: makeEnvironmentProvider(),
        signal: AbortSignal.timeout(5000),
      },
      maxIterations: 1,
    })

    expect(validatorCalled).toBe(true)
    expect(receivedEmitter).toBeUndefined()
  })

  it('validator spans emitted alongside loop events', async () => {
    const events: LoopTraceEvent[] = []
    const traceEmitter: LoopTraceEmitter = {
      emit(event) {
        events.push(event)
      },
    }

    const validator: Validator<string> = {
      async validate(_output: string, ctx: ValidationCtx) {
        // Validator can emit spans via the traceEmitter it receives
        if (ctx.traceEmitter) {
          await ctx.traceEmitter.emit({
            kind: 'loop.decision',
            runId: 'validator-span',
            timestamp: Date.now(),
            payload: { decision: 'validator-llm-call', historyLength: 0 },
          })
        }
        return { valid: true, score: 0.9 }
      },
    }

    await runAgentRounds({
      driver: {
        name: 'test',
        async plan(_task, history) {
          return history.length === 0 ? ['go'] : []
        },
        decide(history) {
          return history.length > 0 ? 'done' : 'continue'
        },
      },
      agentRun: {
        profile: { name: 'test' },
        taskToPrompt: (t: string) => t,
      },
      output: { parse: () => 'parsed-output' },
      validator,
      task: 'test-task',
      ctx: {
        environmentProvider: makeEnvironmentProvider(),
        traceEmitter,
        signal: AbortSignal.timeout(5000),
      },
      maxIterations: 1,
    })

    // Should have loop events + the validator's custom event
    const validatorEvent = events.find(
      (e) => e.kind === 'loop.decision' && e.runId === 'validator-span',
    )
    expect(validatorEvent).toBeDefined()
  })
})
