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
  createSandboxWorkflowAgentDelegate,
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

  it('runs verifier, analyst, and reviewer delegates with typed trace events', async () => {
    const result = await runWorkflow({
      source: `
export const meta = { name: 'feedback_loop', description: 'Verify and review a worker result' }
phase('Build')
const app = await agent('build app', { label: 'implement' })
phase('Assess')
const verdict = await verify(app, {
  label: 'acceptance',
  schema: {
    type: 'object',
    required: ['pass'],
    additionalProperties: false,
    properties: { pass: { type: 'boolean' } },
  },
})
const findings = await analyzeTrace({ app, verdict }, { label: 'trace-analyst' })
const decision = await review({ verdict, findings }, { label: 'next-shot' })
return { app, verdict, findings, decision }
`,
      agent: async () => ({
        output: { files: ['src/App.tsx'] },
        costUsd: 0.01,
        tokenUsage: { input: 10, output: 5 },
      }),
      verifier: async (input) => ({
        output: { pass: true },
        costUsd: 0.02,
        tokenUsage: { input: 3, output: 2 },
        trace: { checked: input },
      }),
      analyst: async (input) => ({
        output: { failures: [], input },
        costUsd: 0.03,
        tokenUsage: { input: 4, output: 6 },
        trace: { clusters: 0 },
      }),
      reviewer: async (input) => ({
        output: { continue: false, input },
        costUsd: 0.04,
        tokenUsage: { input: 7, output: 8 },
        trace: { confidence: 0.9 },
      }),
    })

    expect(result.output).toMatchObject({
      app: { files: ['src/App.tsx'] },
      verdict: { pass: true },
      findings: { failures: [] },
      decision: { continue: false },
    })
    expect(result.costUsd).toBeCloseTo(0.1, 6)
    expect(result.tokenUsage).toEqual({ input: 24, output: 21 })
    expect(result.events.map((event) => event.kind)).toEqual([
      'workflow.started',
      'workflow.phase',
      'workflow.agent.started',
      'workflow.agent.ended',
      'workflow.phase',
      'workflow.verifier.started',
      'workflow.verifier.ended',
      'workflow.analyst.started',
      'workflow.analyst.ended',
      'workflow.reviewer.started',
      'workflow.reviewer.ended',
      'workflow.ended',
    ])
    expect(
      result.events.find((event) => event.kind === 'workflow.verifier.ended')?.payload,
    ).toMatchObject({ label: 'acceptance', costUsd: 0.02, tokenUsage: { input: 3, output: 2 } })
  })

  it('fails loudly when a workflow calls an unwired verifier delegate', async () => {
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'missing_verify', description: 'Missing verifier' }
return verify({ ok: true })
`,
        agent: async () => ({ output: null }),
      }),
    ).rejects.toThrow(/verify\(\) delegate is not configured/)
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

  it('lets workflow agent() run a sandbox-backed worker delegate', async () => {
    const profile: AgentProfile = { name: 'sandbox-worker' }
    const prompts: string[] = []
    const signals: AbortSignal[] = []
    const createOptions: unknown[] = []
    const sandboxClient = {
      async create(options?: unknown) {
        createOptions.push(options)
        return {
          id: 'box-1',
          async *streamPrompt(message: string, options?: { signal?: AbortSignal }) {
            prompts.push(message)
            if (options?.signal) signals.push(options.signal)
            yield {
              type: 'llm_call',
              data: { model: 'zai/kimi-k2.6', tokensIn: 11, tokensOut: 7, costUsd: 0.07 },
            } satisfies SandboxEvent
            yield {
              type: 'result',
              data: { finalText: 'built' },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
      describePlacement() {
        return {
          kind: 'fleet' as const,
          sandboxId: 'box-1',
          fleetId: 'fleet-1',
          machineId: 'machine-1',
        }
      },
    }
    const output: OutputAdapter<{ ok: boolean; response: string }> = {
      parse(events) {
        const result = events.find((event) => event.type === 'result')
        const data = result?.data as { finalText?: string } | undefined
        return { ok: true, response: data?.finalText ?? '' }
      },
    }

    const result = await runWorkflow({
      source: `
export const meta = { name: 'sandbox_agent', description: 'Run a sandbox worker' }
const out = await agent('build the project', { label: 'builder' })
return out
`,
      runId: 'wf-sandbox-agent',
      agent: createSandboxWorkflowAgentDelegate({
        client: sandboxClient,
        profile,
        output,
      }),
    })

    expect(result.output).toEqual({ ok: true, response: 'built' })
    expect(prompts).toEqual(['build the project'])
    expect(signals).toHaveLength(1)
    expect(createOptions[0]).toMatchObject({
      backend: { type: 'opencode', profile },
    })
    expect(result.costUsd).toBeCloseTo(0.07, 6)
    expect(result.tokenUsage).toEqual({ input: 11, output: 7 })
    const ended = result.events.find((event) => event.kind === 'workflow.agent.ended')
    expect(ended?.payload.trace).toMatchObject({
      stream: 'prompt',
      placement: 'fleet',
      sandboxId: 'box-1',
      fleetId: 'fleet-1',
      machineId: 'machine-1',
      profileName: 'sandbox-worker',
      eventCount: 2,
      eventTypes: ['llm_call', 'result'],
    })
    expect((ended?.payload.trace as { events?: unknown } | undefined)?.events).toBeUndefined()
  })

  it('supports streamTask for autonomous sandbox workers', async () => {
    const taskCalls: Array<{ prompt: string; maxTurns?: number; signal?: AbortSignal }> = []
    const sandboxClient = {
      async create() {
        return {
          id: 'box-task',
          async *streamTask(prompt: string, options?: { maxTurns?: number; signal?: AbortSignal }) {
            taskCalls.push({ prompt, maxTurns: options?.maxTurns, signal: options?.signal })
            yield { type: 'result', data: { response: 'done' } } satisfies SandboxEvent
            yield {
              type: 'done',
              data: {
                tokenUsage: { inputTokens: 2, outputTokens: 3, reasoningTokens: 1 },
                totalCostUsd: 0.02,
              },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }

    const result = await runWorkflow({
      source: `
export const meta = { name: 'sandbox_task_agent', description: 'Run a sandbox task worker' }
return agent('finish the app', { label: 'task-worker' })
`,
      agent: createSandboxWorkflowAgentDelegate({
        client: sandboxClient,
        profile: { name: 'task-worker' },
        stream: 'task',
        taskOptions: { maxTurns: 2 },
      }),
    })

    expect(result.output).toBe('done')
    expect(taskCalls).toHaveLength(1)
    expect(taskCalls[0]).toMatchObject({ prompt: 'finish the app', maxTurns: 2 })
    expect(taskCalls[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(result.costUsd).toBeCloseTo(0.02, 6)
    expect(result.tokenUsage).toEqual({ input: 2, output: 4 })
  })
})
