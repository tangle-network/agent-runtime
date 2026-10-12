/**
 * The LIVE designer: a real model (Router :free lane, $0) driving the designer
 * tools as a graph root, registry in a workspace directory that persists
 * across processes — run this twice and the second run REPLAYS.
 *
 *   SESSION=1 npx tsx examples/graphs/designer-live.ts   # authors + records
 *   SESSION=2 npx tsx examples/graphs/designer-live.ts   # looks up → replays
 *
 * Env: ROUTER_URL, ROUTER_KEY (defaults: the factory test lane), MODEL
 * (default glm-5.3), DESIGNER_WORKSPACE (default
 * ./.designer-workspace). The WORKER leaves are offline (the designer's
 * decisions are the subject; worker quality is not).
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  type GraphResult,
  graphDesignerExtraTools,
  kernelPromptRegistry,
  runGraph,
} from '../../src/runtime/index'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { scriptedBrain } from '../../tests/kernel/scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from '../../tests/kernel/test-agent-profile'

const ROUTER_URL = process.env.ROUTER_URL ?? 'https://router.tangle.tools/v1'
const ROUTER_KEY = process.env.ROUTER_KEY ?? process.env.TANGLE_ROUTER_API_KEY ?? ''
const MODEL = process.env.MODEL ?? 'glm-5.3'
const SESSION = process.env.SESSION ?? '1'
/** The task shape is CALLER-OWNED (a stable routing key derived from the request) — never invented by the model. */
const TASK_SHAPE = JSON.parse(
  process.env.TASK_SHAPE ?? '{"kind":"support-ticket-digest","source":"weekly-tickets"}',
)
const WORKSPACE = process.env.DESIGNER_WORKSPACE ?? join(process.cwd(), '.designer-workspace')

if (!ROUTER_KEY) throw new Error('ROUTER_KEY / TANGLE_ROUTER_API_KEY required')

/** The REAL brain: one Router chat completion per driver turn, tools passed OpenAI-style. */
const routerBrain: ToolLoopChat = async (messages, tools) => {
  const res = await fetch(`${ROUTER_URL}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ROUTER_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: messages.map((m) => ({
        role: m.role,
        ...(typeof m.content === 'string' ? { content: m.content } : {}),
        ...('tool_calls' in m && m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...('tool_call_id' in m && m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      })),
      ...(tools.length > 0
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: {
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
              },
            })),
          }
        : {}),
    }),
  })
  if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const choice = ((await res.json()) as { choices: Array<{ message: Record<string, unknown> }> })
    .choices[0]!
  const message = choice.message
  const rawCalls = (message.tool_calls ?? []) as Array<{
    id: string
    function: { name: string; arguments: string }
  }>
  return {
    ...(typeof message.content === 'string' && message.content
      ? { content: message.content }
      : { content: '' }),
    toolCalls: rawCalls.map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: c.function.arguments,
    })),
  }
}

const DESIGNER_PROMPT = `You are the graph designer. Your job is NOT to do the work — it is to pick or design the GRAPH that does the work.

Loop, always:
1. Call designer_lookup_graph with EXACTLY this task shape (verbatim, do not modify it): ${JSON.stringify(TASK_SHAPE)}.
2. If the decision is "replay": call designer_run_graph with mode "replay" and the returned graphDigest. Nothing else — the stored graph IS the answer.
3. If the decision is "author": call designer_run_graph with mode "authored" and this graph template (adapt ONLY the prompt texts):
   {
     "nodes": [
       {"id": "root", "profile": {"name": "root", "harness": "cli-base", "model": {"provider": "offline", "default": "offline-test-model"}, "tools": {"agent_runtime_coordination_spawn_worker": true}, "prompt": {"systemPrompt": "<one line: how the root drives the worker>"}}},
       {"id": "worker", "profile": {"name": "worker", "harness": "opencode", "model": {"provider": "offline", "default": "offline-test-model"}, "prompt": {"systemPrompt": "<one line: what the worker builds>"}}}
     ],
     "edges": [{"kind": "delegates", "from": "root", "to": "worker", "directive": {"surface": "delegates/worker-brief", "version": 1}}],
     "deliverable": {"describe": "<what finished work looks like>"},
     "budget": {"maxIterations": 10, "maxTokens": 100000}
   }
4. Then spawn the scribe worker once (spawn_worker, profile {"name":"scribe"}, task "report the run"), wait a turn, and answer with one sentence: which graph ran, and its outcome.

Never invent fields outside the template. Never include a check function.`

const designerProfile: AgentProfile = testAgentProfile('designer', {
  harness: 'cli-base',
  prompt: { systemPrompt: DESIGNER_PROMPT },
  tools: runtimeToolDeclarations(
    'designer_lookup_graph',
    'designer_run_graph',
    'designer_history',
    'spawn_worker',
  ),
})

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
    budget: { maxIterations: 40, maxTokens: 400_000 },
  }
}

async function main() {
  await mkdir(WORKSPACE, { recursive: true })
  const registryDir = join(WORKSPACE, 'graph-registry')

  const innerBrain = () =>
    scriptedBrain([
      {
        toolCalls: [
          { name: 'spawn_worker', arguments: { profile: { name: 'worker' }, task: 'build' } },
        ],
      },
      { content: 'done' },
    ])
  const leafSeam = (profile: { name?: string }) => {
    let artifact: { outRef: string; out: unknown; verdict: unknown; spent: unknown } | undefined
    const executor = {
      runtime: 'router' as const,
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
    return {
      name: profile.name,
      act: async () => undefined,
      executorSpec: { profile, harness: null, executor },
    }
  }

  const tools = graphDesignerExtraTools({
    registryDir,
    bindCheck: (graph) => ({
      ...graph,
      deliverable: { ...graph.deliverable, check: (out: unknown) => out !== undefined },
    }),
    runGraph: (graph) =>
      runGraph(graph, {
        runId: `inner-${Date.now()}`,
        brain: innerBrain(),
        registry: kernelPromptRegistry(),
        makeLeafAgent: leafSeam as never,
      }),
  })

  console.log(
    `[session ${SESSION}] model=${MODEL} workspace=${WORKSPACE} taskShape=${JSON.stringify(TASK_SHAPE)}`,
  )
  const result: GraphResult = await runGraph(designerGraph(), {
    runId: `designer-live-${SESSION}-${Date.now()}`,
    brain: routerBrain,
    registry: kernelPromptRegistry(),
    makeLeafAgent: leafSeam as never,
    extraTools: tools.extraTools,
    executeExtraTool: async (name, args) => {
      const out = await tools.executeExtraTool(name, args)
      console.log(`  [tool] ${name} →`, JSON.stringify(out).slice(0, 220))
      return out === null ? null : JSON.stringify(out)
    },
  })
  console.log(`[session ${SESSION}] result: ${result.result.kind}`)
  if (result.result.kind === 'winner') {
    console.log(`[session ${SESSION}] out:`, JSON.stringify(result.result.out).slice(0, 160))
  }
}

main().catch((e) => {
  console.error('designer-live failed:', e)
  process.exit(1)
})
