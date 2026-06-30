/**
 * webcode-matrix — the WebCode benchmark across a MATRIX of harnesses × models, in one
 * `runProfileMatrix` call.
 *
 * WebCode (https://exa.ai/blog/webcode): 33 coding tasks across 9 languages, each targeting a library
 * release AFTER Aug 2025. The APIs post-date the model's training, so the agent MUST web-search to find
 * the current signatures; each task is graded in a sandbox by a hidden unit-test suite (empty stubs
 * fail). It is the cleanest test of "can this agent retrieve + apply knowledge it was never trained on".
 *
 * The point of this file: our runtime expresses a real cross-harness, cross-model benchmark as just the
 * axes plus one call (~90 lines of logic). The HARNESS is what drives the agent (claude-code / codex /
 * opencode / gemini); the MODEL is
 * the LLM it runs; `runProfileMatrix` sweeps the cartesian, runs each (harness×model, task) cell in its
 * own sandbox, scores on the hidden tests, and pairs the stats. The heavy lifting — a sandbox per cell,
 * in-box web search, the test run — is the runtime's `openSandboxRun`; this file is just the axes + the
 * call. Run it with `RUN_DIR`, a `SandboxClient`, and `EXA_API_KEY` set.
 */
import type { JudgeConfig, ProfileDispatchFn, Scenario } from '@tangle-network/agent-eval/campaign'
import { runProfileMatrix } from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentRunSpec,
  openSandboxRun,
  type SandboxClient,
} from '@tangle-network/agent-runtime/loops'
import type { BackendType } from '@tangle-network/sandbox'

const routerBaseUrl = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'

// ── Axis 1 — HARNESS × MODEL. Each row is one column of the matrix. A model id MUST carry a snapshot
//    date: `runProfileMatrix` rejects a bare alias (a record without the exact snapshot isn't reproducible).
const grid = [
  { harness: 'claude-code', model: 'anthropic/claude-opus-4-8-2026-01-15' },
  { harness: 'codex', model: 'openai/gpt-5-codex-2025-09-15' },
  { harness: 'opencode', model: 'deepseek/deepseek-v4-pro-2025-12-01' },
  { harness: 'gemini', model: 'google/gemini-2.5-pro-2025-06-17' },
] as const

const profiles: AgentProfile[] = grid.map(({ harness, model }) => ({
  name: `${harness}·${model.split('/')[1]}`,
  // AgentProfile has no `harness` field — the harness is a SANDBOX backend, carried on metadata so the
  // dispatch can read it back. The model rides the standard `model.default`.
  metadata: { harness, model },
  systemPrompt:
    'Solve the task. The library API post-dates your training — use web_search to find the CURRENT ' +
    'signatures, then make every test pass. Do not guess at the API.',
}))

// ── Axis 2 — the WebCode TASKS. Each is a prompt + the repo + the hidden test command (the grader).
//    Three representative tasks shown; the full 33-task dataset loads the same shape.
interface WebCodeTask extends Scenario {
  prompt: string
  lang: string
  repo: string
  testCmd: string
}
const tasks: WebCodeTask[] = [
  {
    id: 'go-fiber-v3',
    kind: 'webcode',
    lang: 'Go',
    repo: 'gofiber/fiber@v3',
    testCmd: 'go test ./...',
    prompt: 'Add a rate-limit middleware using the v3 API introduced after Aug 2025.',
  },
  {
    id: 'py-pydantic',
    kind: 'webcode',
    lang: 'Python',
    repo: 'pydantic@2.10',
    testCmd: 'pytest -q',
    prompt: 'Implement a validator using the new field API from the latest release.',
  },
  {
    id: 'ts-hono',
    kind: 'webcode',
    lang: 'TypeScript',
    repo: 'honojs/hono@4.7',
    testCmd: 'pnpm test',
    prompt: 'Wire the new streaming-SSE helper added after Aug 2025.',
  },
]

// ── DISPATCH — render one (profile, task) cell: run the harness in its own sandbox with web search on,
//    then SCORE on the hidden tests. `openSandboxRun` + the in-box test command ARE the reusable harness.
function webcodeDispatch(
  client: SandboxClient,
): ProfileDispatchFn<WebCodeTask, { passed: boolean }> {
  return async (profile, task) => {
    const harness = String(profile.metadata?.harness ?? 'opencode')
    const model = String(profile.metadata?.model ?? 'openai/gpt-4.1-2025-04-14')
    const agentRun: AgentRunSpec<string> = {
      profile,
      name: profile.name ?? harness,
      taskToPrompt: (t) => t,
      sandboxOverrides: {
        // EXA_API_KEY + the search-provider pin are the only thing WebCode adds — the agent web-searches
        // the post-cutoff API in-box. (Allowlisted env only; never router/model credentials.)
        env: {
          TANGLE_SEARCH_DEFAULT_PROVIDER: 'exa',
          ...(process.env.EXA_API_KEY ? { EXA_API_KEY: process.env.EXA_API_KEY } : {}),
        },
        backend: {
          type: harness as BackendType,
          model: { provider: 'openai-compat', model, baseUrl: routerBaseUrl },
        },
      },
    }
    // Score on the HIDDEN tests: the agent solves the task in the box, then we run the suite there. A
    // hardcode-the-prompt cheat fails the hidden inputs it never saw — execution truth, no LLM judge.
    const run = await openSandboxRun<{ passed: boolean }>(
      client,
      { agentRun, scenarioId: task.id, signal: new AbortController().signal },
      {
        kind: 'events',
        fromEvents: () => ({ passed: false }),
      },
    )
    await run.start(task.prompt)
    const res = await run.box.exec?.(task.testCmd)
    return { passed: (res?.exitCode ?? 1) === 0 }
  }
}

// ── SCORE — pass/fail on the hidden suite (deterministic; no LLM in the loop).
const hiddenTests: JudgeConfig<{ passed: boolean }, WebCodeTask> = {
  name: 'hidden-tests',
  dimensions: [{ key: 'passed', description: 'every hidden test passes' }],
  score: ({ artifact }) => ({
    dimensions: { passed: artifact.passed ? 1 : 0 },
    composite: artifact.passed ? 1 : 0,
    notes: `hidden tests ${artifact.passed ? 'pass' : 'fail'}`,
  }),
}

// ── RUN the matrix. `result` carries the per-(profile, task) records → the harness×model × pass-rate grid.
export async function runWebCodeMatrix(client: SandboxClient, runDir: string, commitSha: string) {
  return runProfileMatrix<WebCodeTask, { passed: boolean }>({
    profiles, // columns: harness × model
    scenarios: tasks, // rows: the WebCode tasks
    dispatch: webcodeDispatch(client),
    judges: [hiddenTests],
    runDir,
    commitSha,
    reps: 1,
  })
}

// Run it live:  EXA_API_KEY=… SANDBOX_API_KEY=… tsx examples/webcode-matrix/webcode-matrix.ts
// Needs: the sandbox service (SANDBOX_API_KEY), the harnesses you listed in `grid`, and EXA_API_KEY for
// in-box web search. Prints the per-(harness×model) pass rate over the tasks.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { SandboxClient } = (await import('@tangle-network/sandbox')) as {
    SandboxClient: new (o: { apiKey: string; baseUrl: string }) => SandboxClient
  }
  const client = new SandboxClient({
    apiKey: process.env.SANDBOX_API_KEY ?? '',
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
  })
  const result = await runWebCodeMatrix(
    client,
    process.env.RUN_DIR ?? './runs/webcode',
    process.env.GIT_SHA ?? 'local',
  )
  console.log(
    `\nWebCode · ${grid.length} harness×model × ${tasks.length} tasks → ${result.records.length} cells\n`,
  )
  for (const [profileId, summary] of Object.entries(result.byProfile)) {
    console.log(`  ${profileId.padEnd(28)} ${JSON.stringify(summary)}`)
  }
}
