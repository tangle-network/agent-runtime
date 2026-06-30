/**
 * webcode-matrix — the REAL WebCode benchmark across a MATRIX of harnesses × models, scored by Exa's own
 * graders, rendered as a multi-axis leaderboard (the surface a hosted board à la vals.ai shows).
 *
 * WebCode (https://exa.ai/blog/webcode): 33 coding tasks across 9 languages, each targeting a library
 * release AFTER Aug 2025 — the APIs post-date the model's training, so the agent MUST web-search to find
 * current signatures. Exa ships the dataset ONLY ("No agent harness included — bring your own"); this file
 * is that harness. Each cell runs one (harness×model, task) in its own sandbox with web search on, writes
 * the agent's solution, runs Exa's EXACT `test_patch` (pytest), and scores on execution truth — pass ⟺
 * pytest exits 0. No invented tasks, no LLM judge.
 *
 * One `runProfileMatrix` call sweeps the cartesian; `result.records` feed straight into the domain-agnostic
 * `leaderboard` engine → a ranked board + the full profile×task matrix + SVG/HTML charts.
 *
 * Run it live (writes report.md / report.svg / report.html to RUN_DIR):
 *   EXA_API_KEY=…  SANDBOX_API_KEY=…  [LIMIT=3]  tsx examples/webcode-matrix/webcode-matrix.ts
 */
import { writeFileSync } from 'node:fs'
import type { JudgeConfig, ProfileDispatchFn } from '@tangle-network/agent-eval/campaign'
import { runProfileMatrix } from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentRunSpec,
  leaderboard,
  openSandboxRun,
  renderLeaderboardHtml,
  renderLeaderboardMarkdown,
  renderLeaderboardSvg,
  type SandboxClient,
} from '@tangle-network/agent-runtime/loops'
import type { BackendType } from '@tangle-network/sandbox'
import { loadWebCodeTasks, type WebCodeTask } from './webcode-dataset'

const routerBaseUrl = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'

// ── Axis 1 — HARNESS × MODEL. Each row is one leaderboard profile. A model id MUST carry a snapshot date:
//    `runProfileMatrix` rejects a bare alias (a record without the exact snapshot isn't reproducible).
const grid = [
  { harness: 'claude-code', model: 'anthropic/claude-opus-4-8-2026-01-15' },
  { harness: 'codex', model: 'openai/gpt-5-codex-2025-09-15' },
  { harness: 'opencode', model: 'deepseek/deepseek-v4-pro-2025-12-01' },
  { harness: 'gemini', model: 'google/gemini-2.5-pro-2025-06-17' },
] as const

export const profiles: AgentProfile[] = grid.map(({ harness, model }) => ({
  name: `${harness}·${model.split('/')[1]}`,
  // AgentProfile has no `harness` field — the harness is a SANDBOX backend, carried on metadata so the
  // dispatch (and the leaderboard's profile key) can read it back. The model rides `model.default`.
  metadata: { harness, model },
  systemPrompt:
    'Solve the task. The library API post-dates your training — use web_search to find the CURRENT ' +
    'signatures, then write the solution file so every test passes. Do not guess at the API.',
}))

export { loadWebCodeTasks, type WebCodeTask } from './webcode-dataset'

// ── DISPATCH — render one (profile, task) cell: run the harness in its own sandbox with web search on, have
//    it write the solution file, then run EXA'S OWN test_patch as the grader.
function webcodeDispatch(
  client: SandboxClient,
): ProfileDispatchFn<WebCodeTask, { passed: boolean }> {
  return async (profile, task) => {
    const harness = String(profile.metadata?.harness ?? 'opencode')
    const model = String(profile.metadata?.model ?? 'openai/gpt-4.1-2025-04-14')
    const solutionFile = task.solutionFiles[0] ?? 'Solution.txt'
    const prompt = `${task.taskDescription}\n\n— Write your solution to \`solution/${solutionFile}\`. Use web_search for the post-${task.releaseTag} API; make every test pass.`

    const agentRun: AgentRunSpec<string> = {
      profile,
      name: profile.name ?? harness,
      taskToPrompt: (t) => t,
      sandboxOverrides: {
        // EXA_API_KEY + the search-provider pin are the only creds WebCode adds (never router/model creds).
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
    const run = await openSandboxRun<{ passed: boolean }>(
      client,
      { agentRun, scenarioId: task.id, signal: new AbortController().signal },
      { kind: 'events', fromEvents: () => ({ passed: false }) },
    )
    await run.start(prompt)

    // Grade with Exa's EXACT test_patch: drop it into the box as the test suite, run pytest, score on exit.
    // (Full fidelity grades inside the task's own `task.dockerfile` toolchain image; where the sandbox runs
    // a different base, a missing toolchain surfaces as a failing test — never a fake pass.)
    await run.box.fs.mkdir('tests', { recursive: true })
    await run.box.fs.mkdir('solution', { recursive: true })
    await run.box.fs.write('tests/test_solution.py', task.testPatch)
    const res = await run.box.exec?.('python3 -m pytest tests/ -q')
    return { passed: (res?.exitCode ?? 1) === 0 }
  }
}

// ── SCORE — pass/fail on Exa's suite (deterministic; no LLM in the loop).
const hiddenTests: JudgeConfig<{ passed: boolean }, WebCodeTask> = {
  name: 'webcode-tests',
  dimensions: [{ key: 'passed', description: "every test in Exa's test_patch passes" }],
  score: ({ artifact }) => ({
    dimensions: { passed: artifact.passed ? 1 : 0 },
    composite: artifact.passed ? 1 : 0,
    notes: `webcode tests ${artifact.passed ? 'pass' : 'fail'}`,
  }),
}

/** Run the matrix and render the leaderboard (markdown + SVG + HTML) into `runDir`. */
export async function runWebCodeMatrix(client: SandboxClient, runDir: string, commitSha: string) {
  const tasks = loadWebCodeTasks(process.env.LIMIT ? { limit: Number(process.env.LIMIT) } : {})
  const result = await runProfileMatrix<WebCodeTask, { passed: boolean }>({
    profiles,
    scenarios: tasks,
    dispatch: webcodeDispatch(client),
    judges: [hiddenTests],
    runDir,
    commitSha,
    reps: 1,
  })

  // The records ARE the universal currency — the domain-agnostic leaderboard engine renders them.
  const board = leaderboard(result.records, {
    title: 'WebCode — harness × model',
    meta: {
      dataset: 'exa-labs/benchmarks webcode e2e',
      tasks: String(tasks.length),
      commit: commitSha,
    },
  })
  writeFileSync(`${runDir}/report.md`, renderLeaderboardMarkdown(board))
  writeFileSync(`${runDir}/report.svg`, renderLeaderboardSvg(board))
  writeFileSync(`${runDir}/report.html`, renderLeaderboardHtml(board))
  console.log(renderLeaderboardMarkdown(board))
  console.log(`\nwrote report.md / report.svg / report.html → ${runDir}`)
  return { result, board }
}

// Run it live.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { SandboxClient } = (await import('@tangle-network/sandbox')) as {
    SandboxClient: new (o: { apiKey: string; baseUrl: string }) => SandboxClient
  }
  const apiKey = process.env.SANDBOX_API_KEY
  if (!apiKey) throw new Error('SANDBOX_API_KEY required')
  const client = new SandboxClient({
    apiKey,
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
  })
  await runWebCodeMatrix(client, process.env.RUN_DIR ?? '.', process.env.COMMIT_SHA ?? 'local')
}
