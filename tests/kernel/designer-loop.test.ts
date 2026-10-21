/**
 * The designer loop, end to end on existing primitives: a supervisor ROOT
 * whose only tools are the designer tools (extraTools + executeExtraTool),
 * driving real registry files across two SEPARATE runGraph sessions over one
 * workspace — session 1 authors and records, session 2 looks up and REPLAYS
 * with zero authoring, and a failed lineage flips session 3 to a mutated
 * author. The inner graph executions are real runGraph runs (offline brain +
 * leaf seam), each recorded with terminal accounting.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { graphDesignerExtraTools } from '../../src/runtime/supervise/designer-tools'
import type { AgentGraph } from '../../src/runtime/supervise/graph'
import { graphRegistry, listGraphRuns } from '../../src/runtime/supervise/graph-registry'
import { kernelPromptRegistry } from '../../src/runtime/supervise/prompt-registry'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { runGraphForTest, superviseForTest } from '../helpers/runtime-with-test-brain'
import { scriptedDriverBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'designer-loop-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** The INNER graph the designer authors/records — a real two-node graph. */
function workGraph(): AgentGraph {
  return {
    nodes: [
      {
        id: 'root',
        profile: testAgentProfile('root', {
          harness: 'cli-base',
          tools: runtimeToolDeclarations('spawn_worker'),
          prompt: { systemPrompt: 'Drive the worker.' },
        }),
      },
      { id: 'worker', profile: testAgentProfile('worker', { prompt: { systemPrompt: 'Build.' } }) },
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'root',
        to: 'worker',
        directive: { surface: 'delegates/worker-brief', version: 1 },
      },
    ],
    deliverable: { describe: 'The built artifact', check: () => true },
    budget: { maxIterations: 10, maxTokens: 100_000 },
  }
}

/** The designer ROOT: its only tools are the designer tools. */
const designerProfile: AgentProfile = testAgentProfile('designer', {
  harness: 'cli-base',
  prompt: { systemPrompt: 'You design graphs. Look up, then run or author, then report.' },
  tools: runtimeToolDeclarations(
    'designer_lookup_graph',
    'designer_run_graph',
    'designer_history',
    'spawn_worker',
  ),
})

/** The designer is the ROOT of its own graph: designer decides, scribe records the report. */
function designerGraph(): AgentGraph {
  return {
    nodes: [
      { id: 'designer', profile: designerProfile },
      {
        id: 'scribe',
        profile: testAgentProfile('scribe', { prompt: { systemPrompt: 'Write the report.' } }),
      },
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'designer',
        to: 'scribe',
        directive: { surface: 'delegates/worker-brief', version: 1 },
      },
    ],
    deliverable: {
      describe: 'A graph run decision, made and executed.',
      check: (out: unknown) => out !== undefined,
    },
    budget: { maxIterations: 100, maxTokens: 100_000 },
  }
}

let innerRuns = 0

async function designerSession(brain: ToolLoopChat) {
  const innerBrain = () =>
    scriptedDriverBrain([
      {
        toolCalls: [
          { name: 'spawn_worker', arguments: { profile: { name: 'worker' }, task: 'build' } },
        ],
      },
      { content: 'done' },
    ])
  const leafSeam = (profile: { name?: string }) => {
    let artifact: ExecutorResult<unknown> | undefined
    const executor: Executor<unknown> = {
      runtime: 'router',
      async execute() {
        artifact = {
          outRef: `w:${profile.name ?? 'leaf'}`,
          out: { built: true },
          verdict: { valid: true, score: 1 },
          spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
        }
        return artifact
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: () => {
        if (!artifact) throw new Error('no artifact')
        return artifact
      },
    }
    const spec: AgentSpec = { profile: profile as never, harness: null, executor }
    return { name: profile.name, act: async () => undefined, executorSpec: spec } as Agent<
      unknown,
      unknown
    > & {
      executorSpec: AgentSpec
    }
  }
  const tools = graphDesignerExtraTools({
    registryDir: workspace,
    bindCheck: (graph) => ({
      ...graph,
      deliverable: { ...graph.deliverable, check: (out: unknown) => out !== undefined },
    }),
    runGraph: (graph) => {
      innerRuns += 1
      return runGraphForTest(graph, {
        runId: `inner-${innerRuns}`,
        brain: innerBrain(),
        registry: kernelPromptRegistry(),
        makeLeafAgent: leafSeam as never,
      })
    },
  })
  // The designer is ONE supervisor agent: its only tools are the designer tools.
  return superviseForTest(designerProfile, 'Design (or replay) the graph for this input.', {
    brain,
    registry: kernelPromptRegistry(),
    budget: { maxIterations: 100, maxTokens: 100_000 },
    makeLeafAgent: leafSeam as never,
    extraTools: tools.extraTools,
    executeExtraTool: async (name, args) => {
      const out = await tools.executeExtraTool(name, args)
      return out === null ? null : JSON.stringify(out)
    },
  })
}

function unwrapToolResult(content: string): Record<string, unknown> {
  const parsed = JSON.parse(content) as Record<string, unknown>
  // Coordination deliveries wrap tool outcomes; find the designer payload whatever the envelope.
  if (typeof parsed === 'object' && parsed !== null) {
    if ('decision' in parsed || 'outcome' in parsed || 'runs' in parsed || 'reason' in parsed)
      return parsed
    for (const value of Object.values(parsed)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>
        if ('decision' in nested || 'outcome' in nested || 'runs' in nested) return nested
      }
    }
  }
  return parsed as Record<string, unknown>
}

/** A brain that inspects each tool result (JSON-stringified) as it drives the designer. */
/** Coordination deliveries wrap tool outcomes (e.g. {type:"settled", result:"…"}); descend to the
 *  designer payload wherever it sits. */
function unwrapDesignerResult(content: string): Record<string, unknown> {
  const visit = (value: unknown, depth: number): Record<string, unknown> | undefined => {
    if (depth > 4 || value === undefined || value === null) return undefined
    if (typeof value === 'string') {
      try {
        return visit(JSON.parse(value), depth + 1)
      } catch {
        return undefined
      }
    }
    if (typeof value !== 'object' || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    if ('decision' in record || 'outcome' in record || 'runs' in record || 'reason' in record)
      return record
    for (const nested of Object.values(record)) {
      const found = visit(nested, depth + 1)
      if (found) return found
    }
    return undefined
  }
  try {
    return visit(JSON.parse(content), 0) ?? {}
  } catch {
    return {}
  }
}

function designerBrain(
  script: Array<(lookup: Record<string, unknown>) => Record<string, unknown> | undefined>,
) {
  let step = 0
  let consumedUpTo = 0 // message count when the last script step was issued
  const waitedOnce = false
  const seen: string[] = []
  return {
    seenToolCalls: () => seen,
    brain: (async (messages: ReadonlyArray<Record<string, unknown>>) => {
      // The coordination driver folds tool outcomes into the conversation as settled records on
      // any role — find the newest message carrying a designer payload.
      const carrying = [...messages]
        .slice(consumedUpTo) // only results that arrived AFTER the last consumed step
        .reverse()
        .map((m) => (typeof m.content === 'string' ? m.content : undefined))
        .find((text) => text !== undefined && /decision|outcome|runs/.test(text))

      const lookup = carrying ? unwrapDesignerResult(carrying) : {}
      // Coordination tools settle ASYNCHRONOUSLY: after issuing a tool call, wait (without
      // consuming script steps) until its result has landed in the conversation.
      const awaitingResult = step > 0 && step <= script.length && Object.keys(lookup).length === 0
      if (awaitingResult && messages.some((m) => m.role === 'assistant')) {
        return { content: 'waiting for the tool result', toolCalls: [] }
      }
      // The scribe is spawned on the very FIRST turn (the proven driver shape); the
      // designer's tool steps follow it.
      if (step === 0 && !messages.some((m) => m.role === 'assistant')) {
        return {
          content: '',
          toolCalls: [
            {
              id: 's0',
              name: 'spawn_worker',
              arguments: JSON.stringify({ profile: { name: 'scribe' }, task: 'report' }),
            },
          ],
        }
      }
      if (step < script.length) {
        const turn = script[step]!(lookup)
        step += 1
        consumedUpTo = messages.length
        if (turn) {
          if ('tool' in turn) {
            seen.push(String(turn.tool))
            return {
              content: '',
              toolCalls: [
                {
                  id: `d${step}`,
                  name: String(turn.tool),
                  arguments: JSON.stringify(turn.args ?? {}),
                },
              ],
            }
          }
          return { content: String(turn.content), toolCalls: [] }
        }
      }
      return { content: 'done', toolCalls: [] }
    }) as ToolLoopChat,
  }
}

describe('the designer agent (a root mounting designer tools)', () => {
  it('session 1 authors and records; session 2 looks up and REPLAYS with zero authoring', async () => {
    const taskShape = { kind: 'summarize', source: 'support-tickets' }

    // Session 1: lookup → author (first run) → run authored → settle.
    const s1 = designerBrain([
      () => ({ tool: 'designer_lookup_graph', args: { taskShape } }),
      (lookup) => {
        expect(lookup.decision).toBe('author')
        expect(lookup.reason).toMatch(/first run/)
        return {
          tool: 'designer_run_graph',
          args: { taskShape, mode: 'authored', graph: workGraph() },
        }
      },
      (run) => {
        expect(run.outcome).toBe('delivered')
        return { content: 'ran the authored graph' }
      },
    ])
    const r1 = await designerSession(s1.brain)
    expect(r1.result?.kind ?? r1?.kind).toBe('winner')
    expect(s1.seenToolCalls()).toEqual(['designer_lookup_graph', 'designer_run_graph'])

    const after1 = await listGraphRuns(graphRegistry(workspace))
    expect(after1).toHaveLength(1)
    expect(after1[0]?.outcome.kind).toBe('delivered')
    const firstDigest = after1[0]?.graphDigest

    // Session 2 — a fresh runGraph over the SAME workspace: lookup → REPLAY.
    const s2 = designerBrain([
      () => ({ tool: 'designer_lookup_graph', args: { taskShape } }),
      (lookup) => {
        expect(lookup.decision).toBe('replay')
        expect(lookup.graphDigest).toBe(firstDigest)
        return {
          tool: 'designer_run_graph',
          args: { taskShape, mode: 'replay', graphDigest: lookup.graphDigest },
        }
      },
      (run) => {
        expect(run.outcome).toBe('delivered')
        expect(run.graphDigest).toBe(firstDigest)
        return { content: 'replayed the winner' }
      },
    ])
    const r2 = await designerSession(s2.brain)
    expect(r2.result?.kind ?? r2?.kind).toBe('winner')
    expect(s2.seenToolCalls()).toEqual(['designer_lookup_graph', 'designer_run_graph'])

    const after2 = await listGraphRuns(graphRegistry(workspace))
    expect(after2).toHaveLength(2) // the registry grows monotonically
    expect(new Set(after2.map((row) => row.graphDigest))).toEqual(new Set([firstDigest]))
  })

  it('session 3 on a failing lineage: lookup says author, the mutant is recorded as a NEW digest', async () => {
    const taskShape = { kind: 'extract', source: 'pdfs' }
    const s1 = designerBrain([
      () => ({
        tool: 'designer_run_graph',
        args: { taskShape, mode: 'authored', graph: workGraph() },
      }),
      () => ({ content: 'ran it' }),
    ])
    await designerSession(s1.brain)
    // The lineage failed: flip the record to no-winner, as a real failure would.
    // (recordGraphRun refuses mismatched digests, so rewrite the outcome through the file.)
    const { readFile, writeFile } = await import('node:fs/promises')
    const file = join(workspace, 'records.jsonl')
    const rows = (await readFile(file, 'utf8')).trim().split('\n')
    const fixed = rows.map((line) => {
      const row = JSON.parse(line) as { outcome: { kind: string }; cost?: { iterations?: number } }
      if (row.outcome.kind === 'delivered') {
        row.outcome = { kind: 'no-winner', reason: 'budget-exhausted' }
        row.cost = { iterations: 10 }
      }
      return JSON.stringify(row)
    })
    await writeFile(file, fixed.join('\n') + '\n')

    const s2 = designerBrain([
      () => ({ tool: 'designer_lookup_graph', args: { taskShape } }),
      (lookup) => {
        expect(lookup.decision).toBe('author')
        expect(lookup.reason).toMatch(/no graph delivered/)
        // Mutate ONE axis: the worker's budget doubled — the mutation the record justifies.
        const mutant = workGraph()
        mutant.budget = { ...mutant.budget, maxIterations: 20 }
        return {
          tool: 'designer_run_graph',
          args: {
            taskShape,
            mode: 'authored',
            graph: mutant,
            mutationNote:
              'prior record: budget-exhausted at 10 iterations — budget doubled, topology unchanged',
          },
        }
      },
      (run) => {
        expect(run.outcome).toBe('delivered')
        return { content: 'ran the mutant' }
      },
    ])
    const r2 = await designerSession(s2.brain)
    expect(r2.result?.kind ?? r2?.kind).toBe('winner')

    const finalRows = await listGraphRuns(graphRegistry(workspace))
    expect(finalRows).toHaveLength(2)
    expect(finalRows[1]?.outcome.kind).toBe('delivered')
    expect(finalRows[1]?.graphDigest).not.toBe(finalRows[0]?.graphDigest) // one-axis mutation = new artifact
  })
})
