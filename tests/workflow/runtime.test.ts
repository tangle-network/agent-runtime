import type { AgentProfile, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { refineDriver } from '../loops/refine-driver'
import { ValidationError } from '../../src/errors'
import {
  type AgentRunSpec,
  type OutputAdapter,
  type Validator,
} from '../../src/loops'
import {
  createNestedWorkflowAgentDelegate,
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
    expect(result.events.filter((e) => e.kind === 'workflow.branch.started')).toHaveLength(2)
    expect(result.events.filter((e) => e.kind === 'workflow.branch.ended')).toHaveLength(2)
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

  it('does not expose host constructors through globals, delegate outputs, budget snapshots, or errors', async () => {
    const result = await runWorkflow({
      source: `
export const meta = { name: 'realm_escape', description: 'Keep host objects out of the workflow realm' }
const key = 'constructor'
const code = 'return process'
const attempts = []
try {
  attempts.push((await agent[key](code)()).version)
} catch (err) {
  attempts.push(err.name)
}
const out = await agent('host object')
try {
  attempts.push(out[key][key](code)().version)
} catch (err) {
  attempts.push(err.name)
}
const spent = budget.spent()
try {
  attempts.push(spent[key][key](code)().version)
} catch (err) {
  attempts.push(err.name)
}
try {
  await agent('throw host error')
} catch (err) {
  try {
    attempts.push(err[key][key](code)().version)
  } catch (inner) {
    attempts.push(inner.name)
  }
}
try {
  await agent('bad bridge output')
} catch (err) {
  try {
    attempts.push(err[key][key](code)().version)
  } catch (inner) {
    attempts.push(inner.name)
  }
}
return attempts
`,
      agent: async (prompt) => {
        if (prompt.includes('throw')) throw new ValidationError('host delegate failed')
        if (prompt.includes('bad bridge')) return { output: () => null }
        return { output: { ok: true }, costUsd: 0.01, tokenUsage: { input: 1, output: 1 } }
      },
    })

    expect(result.output).toEqual(['EvalError', 'EvalError', 'EvalError', 'EvalError', 'EvalError'])
  })

  it('removes nondeterministic Math.random even through computed property access', async () => {
    const result = await runWorkflow({
      source: `
export const meta = { name: 'deterministic_globals', description: 'No randomness in workflow scripts' }
const key = 'random'
return { randomType: typeof Math[key], max: Math.max(1, 3) }
`,
      agent: async () => ({ output: null }),
    })

    expect(result.output).toEqual({ randomType: 'undefined', max: 3 })
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

  it('emits per-branch trace events for pipeline branches', async () => {
    const result = await runWorkflow({
      source: `
export const meta = { name: 'pipeline_branches', description: 'Trace each pipeline item branch' }
phase('Fanout')
return pipeline(
  ['a', 'b'],
  (value) => value + ':scan',
  async (value) => agent(value, { label: value }),
)
`,
      agent: async (prompt) => ({
        output: { prompt },
        costUsd: 0.01,
        tokenUsage: { input: 1, output: 1 },
      }),
      caps: { maxFanout: 2, maxAgentCalls: 2 },
    })

    expect(result.output).toEqual([{ prompt: 'a:scan' }, { prompt: 'b:scan' }])
    expect(
      result.events
        .filter((event) => event.kind === 'workflow.branch.started')
        .map((event) => event.payload),
    ).toEqual([
      { operation: 'pipeline', branchIndex: 0, stageCount: 2, phase: 'Fanout' },
      { operation: 'pipeline', branchIndex: 1, stageCount: 2, phase: 'Fanout' },
    ])
    expect(
      result.events
        .filter((event) => event.kind === 'workflow.branch.ended')
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({
        operation: 'pipeline',
        branchIndex: 0,
        stageCount: 2,
        phase: 'Fanout',
      }),
      expect.objectContaining({
        operation: 'pipeline',
        branchIndex: 1,
        stageCount: 2,
        phase: 'Fanout',
      }),
    ])
  })

  it('emits branch failure context before failing the workflow', async () => {
    const emitted: WorkflowTraceEvent[] = []
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'branch_failure', description: 'Trace failed branch' }
phase('Race')
return parallel([
  () => agent('ok'),
  () => {
    throw new Error('branch exploded')
  },
])
`,
        agent: async (prompt) => ({ output: prompt }),
        caps: { maxFanout: 2 },
        traceEmitter: { emit: (event) => emitted.push(event) },
      }),
    ).rejects.toThrow(/branch exploded/)

    expect(
      emitted
        .filter((event) => event.kind === 'workflow.branch.failed')
        .map((event) => event.payload),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'parallel',
          branchIndex: 1,
          message: 'branch exploded',
          code: 'Error',
          phase: 'Race',
        }),
      ]),
    )
    expect(emitted.at(-1)).toMatchObject({
      kind: 'workflow.failed',
      payload: { message: 'branch exploded', phase: 'Race' },
    })
  })

  it('aborts sibling branches and drains branch failures before workflow failure', async () => {
    const emitted: WorkflowTraceEvent[] = []
    const branchSignals: AbortSignal[] = []
    const delegate: WorkflowAgentDelegate = async (prompt, _options, ctx) => {
      if (prompt !== 'slow') return { output: prompt }
      branchSignals.push(ctx.signal)
      return await new Promise((_, reject) => {
        ctx.signal.addEventListener(
          'abort',
          () => reject(new Error('slow branch observed abort')),
          { once: true },
        )
      })
    }

    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'branch_cancel', description: 'Abort siblings on fanout failure' }
return parallel([
  () => agent('slow'),
  async () => {
    await agent('fast')
    throw new Error('trigger failure')
  },
])
`,
        agent: delegate,
        caps: { maxFanout: 2, maxAgentCalls: 3, maxWallMs: 1_000 },
        traceEmitter: { emit: (event) => emitted.push(event) },
      }),
    ).rejects.toThrow(/trigger failure/)

    expect(branchSignals[0]?.aborted).toBe(true)
    const workflowFailedIndex = emitted.findIndex((event) => event.kind === 'workflow.failed')
    const branchFailedIndices = emitted
      .map((event, index) => (event.kind === 'workflow.branch.failed' ? index : -1))
      .filter((index) => index >= 0)
    expect(branchFailedIndices).toHaveLength(2)
    expect(branchFailedIndices.every((index) => index < workflowFailedIndex)).toBe(true)
    expect(emitted.at(-1)).toMatchObject({
      kind: 'workflow.failed',
      payload: { message: 'trigger failure' },
    })
  })

  it('applies wall-time caps to workflow body waits before any delegate call', async () => {
    const emitted: WorkflowTraceEvent[] = []
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'body_timeout', description: 'body should not hang forever' }
return await new Promise(() => {})
`,
        agent: async () => ({ output: null }),
        caps: { maxWallMs: 5 },
        traceEmitter: { emit: (event) => emitted.push(event) },
      }),
    ).rejects.toThrow(/workflow body timed out/)

    expect(emitted.map((event) => event.kind)).toEqual(['workflow.started', 'workflow.failed'])
    expect(
      (emitted.at(-1) as Extract<WorkflowTraceEvent, { kind: 'workflow.failed' }>).payload.message,
    ).toBe('workflow body timed out')
  })

  it('aborts workflow body waits even when no delegate has started', async () => {
    const controller = new AbortController()
    const promise = runWorkflow({
      source: `
export const meta = { name: 'body_abort', description: 'body should observe cancellation' }
return await new Promise(() => {})
`,
      agent: async () => ({ output: null }),
      caps: { maxWallMs: 1_000 },
      signal: controller.signal,
    })

    controller.abort()
    await expect(promise).rejects.toThrow(/workflow aborted before body completed/)
  })

  it('rejects invalid budget caps instead of silently disabling limits', async () => {
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'bad_caps', description: 'invalid budget caps' }
return 1
`,
        agent: async () => ({ output: null }),
        caps: { maxWallMs: Number.NaN },
      }),
    ).rejects.toThrow(/caps.maxWallMs/)

    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'bad_count_cap', description: 'invalid count caps' }
return 1
`,
        agent: async () => ({ output: null }),
        caps: { maxFanout: 1.5 },
      }),
    ).rejects.toThrow(/caps.maxFanout must be an integer/)
  })

  it('validates structured subagent output against JSON schema', async () => {
    const emitted: WorkflowTraceEvent[] = []
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
        traceEmitter: { emit: (event) => emitted.push(event) },
      }),
    ).rejects.toThrow(ValidationError)

    expect(emitted.map((event) => event.kind)).toEqual([
      'workflow.started',
      'workflow.agent.started',
      'workflow.agent.failed',
      'workflow.failed',
    ])
    expect(
      (
        emitted.find((event) => event.kind === 'workflow.agent.failed') as
          | Extract<WorkflowTraceEvent, { kind: 'workflow.agent.failed' }>
          | undefined
      )?.payload,
    ).toMatchObject({
      index: 0,
      message: '$: missing required property ok',
      code: 'ValidationError',
    })
  })

  it('rejects invalid JSON schema definitions before dispatching delegates', async () => {
    let called = false
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'bad_schema_definition', description: 'Schema definitions must be strict' }
return agent('should not run', {
  schema: {
    type: 'object',
    required: ['ok'],
    properties: { ok: {} },
  },
})
`,
        agent: async () => {
          called = true
          return { output: { ok: true } }
        },
      }),
    ).rejects.toThrow(/agent\.schema\.properties\.ok\.type/)

    expect(called).toBe(false)
  })

  it('rejects driver-supplied decode callbacks instead of executing them in host delegate handling', async () => {
    let called = false
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'decode_callback', description: 'Decode callbacks are host code only' }
return agent('should not run', {
  decode: function(value) {
    return value
  },
})
`,
        agent: async () => {
          called = true
          return { output: { ok: true } }
        },
      }),
    ).rejects.toThrow(/decode/)

    expect(called).toBe(false)
  })

  it('rejects workflow option accessors without invoking them', async () => {
    const result = await runWorkflow({
      source: `
export const meta = { name: 'accessor_options', description: 'Accessors must not cross VM boundary' }
const options = {}
Object.defineProperty(options, 'label', {
  get: function() {
    throw new Error('getter executed')
  },
})
try {
  await agent('should not run', options)
} catch (err) {
  return err.message
}
return 'unexpected'
`,
      agent: async () => ({ output: { ok: true } }),
    })

    expect(result.output).toBe('agent options.label: accessor properties are not allowed')
  })

  it('emits loop failure context before failing the workflow', async () => {
    const emitted: WorkflowTraceEvent[] = []
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'loop_failure', description: 'Trace failed loop delegate' }
phase('Improve')
return loop({ task: 'finish' }, { label: 'refine' })
`,
        agent: async () => ({ output: null }),
        loop: async () => {
          throw new ValidationError('loop validator rejected output')
        },
        traceEmitter: { emit: (event) => emitted.push(event) },
      }),
    ).rejects.toThrow(/loop validator rejected output/)

    expect(emitted.map((event) => event.kind)).toEqual([
      'workflow.started',
      'workflow.phase',
      'workflow.loop.started',
      'workflow.loop.failed',
      'workflow.failed',
    ])
    expect(
      (
        emitted.find((event) => event.kind === 'workflow.loop.failed') as
          | Extract<WorkflowTraceEvent, { kind: 'workflow.loop.failed' }>
          | undefined
      )?.payload,
    ).toMatchObject({
      index: 0,
      label: 'refine',
      message: 'loop validator rejected output',
      code: 'ValidationError',
      phase: 'Improve',
    })
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

  it('emits checkpoint failure context before failing the workflow', async () => {
    const emitted: WorkflowTraceEvent[] = []
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'checkpoint_failure', description: 'Trace failed feedback delegate' }
phase('Assess')
await verify({ ok: true }, { label: 'acceptance' })
await analyzeTrace({ ok: true }, { label: 'trace-analyst' })
return review({ ok: true }, { label: 'next-shot' })
`,
        agent: async () => ({ output: null }),
        verifier: async () => ({ output: { pass: true } }),
        analyst: async () => {
          throw new Error('analyst could not cluster trace')
        },
        reviewer: async () => ({ output: { continue: false } }),
        traceEmitter: { emit: (event) => emitted.push(event) },
      }),
    ).rejects.toThrow(/analyst could not cluster trace/)

    expect(emitted.map((event) => event.kind)).toEqual([
      'workflow.started',
      'workflow.phase',
      'workflow.verifier.started',
      'workflow.verifier.ended',
      'workflow.analyst.started',
      'workflow.analyst.failed',
      'workflow.failed',
    ])
    expect(
      (
        emitted.find((event) => event.kind === 'workflow.analyst.failed') as
          | Extract<WorkflowTraceEvent, { kind: 'workflow.analyst.failed' }>
          | undefined
      )?.payload,
    ).toMatchObject({
      index: 0,
      label: 'trace-analyst',
      message: 'analyst could not cluster trace',
      code: 'Error',
      phase: 'Assess',
    })
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

  it('runs nested workflows through explicit allowWorkflow with bounded child caps', async () => {
    const childSource = [
      "export const meta = { name: 'child_workflow', description: 'Build and verify child work' }",
      "phase('Child')",
      "const worker = await agent('child worker', { label: 'nested-worker' })",
      "const verdict = await verify(worker, { label: 'child-check' })",
      'return { worker, verdict }',
    ].join('\n')
    const workerCalls: string[] = []
    const childEvents: WorkflowTraceEvent[] = []

    const result = await runWorkflow({
      source: `
export const meta = { name: 'parent_workflow', description: 'Delegate a child workflow' }
const childSource = ${JSON.stringify(childSource)}
return agent(childSource, {
  label: 'child-workflow',
  allowWorkflow: true,
  schema: {
    type: 'object',
    required: ['worker', 'verdict'],
    additionalProperties: false,
    properties: {
      worker: { type: 'object' },
      verdict: { type: 'object' },
    },
  },
})
`,
      runId: 'wf-parent',
      caps: {
        maxWallMs: 2_000,
        maxAgentCalls: 4,
        maxLoopCalls: 1,
        maxFanout: 3,
        maxDepth: 1,
        maxCostUsd: 1,
        maxTokens: 100,
      },
      agent: createNestedWorkflowAgentDelegate({
        agent: async (prompt, _options, ctx) => {
          workerCalls.push(`${ctx.workflowRunId}:${prompt}`)
          return {
            output: { prompt, depth: ctx.depth, phase: ctx.phase },
            costUsd: 0.01,
            tokenUsage: { input: 2, output: 3 },
            trace: { workerDepth: ctx.depth },
          }
        },
        verifier: async (input, _options, ctx) => ({
          output: { pass: true, phase: ctx.phase, input },
          costUsd: 0.02,
          tokenUsage: { input: 4, output: 5 },
          trace: { verifierDepth: ctx.depth },
        }),
        caps: {
          maxWallMs: 500,
          maxAgentCalls: 2,
          maxLoopCalls: 0,
          maxFanout: 2,
          maxDepth: 1,
          maxCostUsd: 0.5,
          maxTokens: 50,
        },
        runId: ({ parent }) => `${parent.workflowRunId}-child`,
        traceEmitter: { emit: (event) => childEvents.push(event) },
      }),
    })

    expect(workerCalls).toEqual(['wf-parent-child:child worker'])
    expect(result.output).toMatchObject({
      worker: { prompt: 'child worker', depth: 1, phase: 'Child' },
      verdict: { pass: true, phase: 'Child' },
    })
    expect(result.agentCalls).toBe(2)
    expect(result.loopCalls).toBe(0)
    expect(result.costUsd).toBeCloseTo(0.03, 6)
    expect(result.tokenUsage).toEqual({ input: 6, output: 8 })
    expect(childEvents.map((event) => event.kind)).toEqual([
      'workflow.started',
      'workflow.phase',
      'workflow.agent.started',
      'workflow.agent.ended',
      'workflow.verifier.started',
      'workflow.verifier.ended',
      'workflow.ended',
    ])
    const parentAgentEnd = result.events.find((event) => event.kind === 'workflow.agent.ended')
    expect(parentAgentEnd?.payload.trace).toMatchObject({
      nested: true,
      runId: 'wf-parent-child',
      parentRunId: 'wf-parent',
      depth: 1,
      metaName: 'child_workflow',
      eventCount: 7,
      costUsd: 0.03,
      tokenUsage: { input: 6, output: 8 },
      agentCalls: 1,
      loopCalls: 0,
    })
  })

  it('rejects nested workflows without explicit finite child caps', async () => {
    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'bad_nested_caps', description: 'Nested caps must be explicit' }
return agent("export const meta = { name: 'child', description: 'child' }\\nreturn 1", {
  allowWorkflow: true,
})
`,
        caps: { maxDepth: 1, maxAgentCalls: 2, maxLoopCalls: 1, maxFanout: 1, maxWallMs: 100 },
        agent: createNestedWorkflowAgentDelegate({
          agent: async () => ({ output: null }),
          caps: { maxWallMs: 50, maxAgentCalls: 1, maxLoopCalls: 0, maxFanout: 1 },
        }),
      }),
    ).rejects.toThrow(/nested workflow caps.maxDepth must be a finite non-negative number/)
  })

  it('clamps child workflow calls to the parent remaining agent-call budget', async () => {
    const childSource = [
      "export const meta = { name: 'child_budget', description: 'Child should inherit parent budget' }",
      "return agent('child worker')",
    ].join('\n')

    await expect(
      runWorkflow({
        source: `
export const meta = { name: 'parent_budget', description: 'Parent has no spare agent calls' }
return agent(${JSON.stringify(childSource)}, { allowWorkflow: true })
`,
        caps: { maxDepth: 1, maxAgentCalls: 1, maxLoopCalls: 1, maxFanout: 1, maxWallMs: 1_000 },
        agent: createNestedWorkflowAgentDelegate({
          agent: async (prompt) => ({ output: prompt }),
          caps: { maxWallMs: 500, maxAgentCalls: 2, maxLoopCalls: 0, maxFanout: 1, maxDepth: 1 },
        }),
      }),
    ).rejects.toThrow(/maxAgentCalls=0/)
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
            driver: refineDriver<Task, Output>({ maxIterations: 3 }),
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
