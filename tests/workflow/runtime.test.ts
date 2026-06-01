import type { AgentProfile, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/errors'
import {
  type AgentRunSpec,
  createRefineDriver,
  type OutputAdapter,
  type Validator,
} from '../../src/loops'
import {
  createRunLoopWorkflowDelegate,
  parseWorkflowScript,
  runWorkflow,
  type WorkflowAgentDelegate,
  type WorkflowLoopDelegate,
  type WorkflowTraceEvent,
} from '../../src/workflow'

const BASIC_SOURCE = `
export const meta = {
  name: 'inspect_project',
  description: 'Inspect and summarize a project',
  phases: [{ title: 'Scan' }, { title: 'Synthesize' }],
}

phase('Scan')
const scans = await parallel([
  () => agent('scan modules', {
    label: 'modules',
    schema: {
      type: 'object',
      required: ['kind'],
      additionalProperties: false,
      properties: { kind: { type: 'string' } },
    },
  }),
  () => agent('scan tests', { label: 'tests' }),
])
phase('Synthesize')
const summary = await loop({ scans }, { label: 'summarize' })
return { scans, summary, spent: budget.spent() }
`

function agentDelegate(): { calls: string[]; delegate: WorkflowAgentDelegate } {
  const calls: string[] = []
  return {
    calls,
    delegate: async (prompt) => {
      calls.push(prompt)
      return {
        output: prompt.includes('modules') ? { kind: 'modules' } : 'tests-ok',
        costUsd: 0.01,
        tokenUsage: { input: 10, output: 5 },
        trace: { prompt },
      }
    },
  }
}

const loopDelegate: WorkflowLoopDelegate = async (input) => ({
  output: { ok: true, input },
  costUsd: 0.02,
  tokenUsage: { input: 4, output: 6 },
  trace: { loop: 'summarize' },
})

describe('workflow runtime', () => {
  it('executes a driver-authored workflow with agent, parallel, phase, loop, and traces', async () => {
    const { calls, delegate } = agentDelegate()
    const emitted: WorkflowTraceEvent[] = []
    const result = await runWorkflow({
      source: BASIC_SOURCE,
      runId: 'wf-test',
      agent: delegate,
      loop: loopDelegate,
      caps: { maxFanout: 4, maxAgentCalls: 4, maxLoopCalls: 2, maxCostUsd: 1 },
      traceEmitter: { emit: (event) => emitted.push(event) },
    })

    expect(result.meta.name).toBe('inspect_project')
    expect(calls).toEqual(['scan modules', 'scan tests'])
    expect(result.output).toMatchObject({
      scans: [{ kind: 'modules' }, 'tests-ok'],
      summary: { ok: true },
    })
    expect(result.agentCalls).toBe(2)
    expect(result.loopCalls).toBe(1)
    expect(result.costUsd).toBeCloseTo(0.04, 6)
    expect(result.tokenUsage).toEqual({ input: 24, output: 16 })
    expect(result.events.map((e) => e.kind)).toEqual(emitted.map((e) => e.kind))
    expect(result.events.map((e) => e.kind)).toContain('workflow.parallel.started')
    expect(result.events.map((e) => e.kind)).toContain('workflow.loop.ended')
    expect(result.events.at(-1)?.kind).toBe('workflow.ended')
  })

  it('validates the metadata header before execution', () => {
    const parsed = parseWorkflowScript(`
export const meta = { name: 'x', description: 'y', phases: [{ title: 'Plan' }] }
phase('Plan')
return 1
`)
    expect(parsed.meta).toEqual({
      name: 'x',
      description: 'y',
      phases: [{ title: 'Plan' }],
    })
  })

  it('rejects forbidden capabilities instead of exposing host APIs', async () => {
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'bad', description: 'bad' }
const x = process.env.SECRET
return x
`,
        agent: async () => ({ output: null }),
      }),
    ).rejects.toThrow(/forbidden capability: process/)
  })

  it('enforces fanout caps for parallel branches', async () => {
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'wide', description: 'too wide' }
return parallel([
  () => agent('a'),
  () => agent('b'),
  () => agent('c'),
])
`,
        agent: async (prompt) => ({ output: prompt }),
        caps: { maxFanout: 2 },
      }),
    ).rejects.toThrow(/exceeds maxFanout=2/)
  })

  it('validates structured subagent output against JSON schema', async () => {
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'schema', description: 'schema check' }
return agent('bad schema', {
  schema: {
    type: 'object',
    required: ['ok'],
    additionalProperties: false,
    properties: { ok: { type: 'boolean' } },
  },
})
`,
        agent: async () => ({ output: { nope: true } }),
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('enforces nested workflow depth at runtime boundary', async () => {
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'nested', description: 'depth' }
return 'nope'
`,
        depth: 2,
        caps: { maxDepth: 1 },
        agent: async () => ({ output: null }),
      }),
    ).rejects.toThrow(/exceeds maxDepth=1/)
  })

  it('lets workflow loop() call the existing runLoop kernel through the delegate', async () => {
    interface Task {
      goal: string
    }
    interface Output {
      attempt: number
    }
    let attempt = 0
    const profile: AgentProfile = { name: 'loop-worker' }
    const agentRun: AgentRunSpec<Task> = {
      profile,
      name: 'loop-worker',
      taskToPrompt: (task) => task.goal,
    }
    const output: OutputAdapter<Output> = {
      parse(events) {
        const last = events.at(-1)
        const data = last?.data as { attempt?: number } | undefined
        return { attempt: typeof data?.attempt === 'number' ? data.attempt : 0 }
      },
    }
    const validator: Validator<Output> = {
      async validate(out) {
        return { valid: out.attempt >= 2, score: out.attempt / 2 }
      },
    }
    const sandboxClient = {
      async create() {
        return {
          async *streamPrompt() {
            attempt += 1
            yield { type: 'result', data: { attempt } } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }

    const result = await runWorkflow({
      source: `
export const meta = { name: 'loop_bridge', description: 'Call runLoop from workflow loop' }
const out = await loop({ goal: 'finish' }, { label: 'refine-loop' })
return out
`,
      agent: async () => ({ output: null }),
      loop: createRunLoopWorkflowDelegate<Task, Task, Output, 'continue' | 'stop'>({
        toRunLoopOptions(input) {
          return {
            driver: createRefineDriver<Task, Output>({ maxIterations: 3 }),
            agentRun,
            output,
            validator,
            task: input,
            ctx: { sandboxClient },
          }
        },
      }),
    })

    expect(result.output).toEqual({ attempt: 2 })
    expect(result.loopCalls).toBe(1)
    expect(result.costUsd).toBe(0)
    expect(result.events.map((e) => e.kind)).toContain('workflow.loop.ended')
  })
})
