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
 *   TANGLE_API_KEY=...  [LIMIT=3]  tsx examples/webcode-matrix/webcode-matrix.ts
 * ONE key: TANGLE_API_KEY provisions the box's own
 * model + search credential — nothing else is passed in. A live run therefore requires IN-BOX router
 * inference to be enabled for that key; if it is not, the agent stream produces zero tokens and the
 * backend-integrity guard correctly aborts the matrix as a stub (it never fakes a score).
 */
import { writeFileSync } from 'node:fs'
import type { JudgeConfig, ProfileDispatchFn } from '@tangle-network/agent-eval/campaign'
import { runProfileMatrix } from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import {
  type AgentRunSpec,
  leaderboard,
  openEnvironmentRun,
  pairwiseSignificance,
  renderLeaderboardHtml,
  renderLeaderboardMarkdown,
  renderLeaderboardSvg,
  renderPairwiseMarkdown,
  sumEnvironmentUsage,
} from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { loadWebCodeTasks, type WebCodeTask } from './webcode-dataset'

const routerBaseUrl = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'

// ── Axis 1 — HARNESS × MODEL. Each row is one leaderboard profile. A model id MUST carry a snapshot date:
//    `runProfileMatrix` rejects a bare alias (a record without the exact snapshot isn't reproducible).
// Real router-served model ids (GET /v1/models). The harness is the in-box agent CLI; the model is the
// LLM it runs, routed via openai-compat. Vary both for a real matrix; edit freely.
const grid = [
  { harness: 'claude-code', model: 'claude-sonnet-4-6' },
  { harness: 'codex', model: 'openai/gpt-5' },
  { harness: 'opencode', model: 'deepseek-v4-flash' },
  { harness: 'gemini', model: 'gemini-2.5-pro' },
] as const

// The eval RECORD pins a snapshot date for reproducibility (runProfileMatrix requires `name@YYYY-MM-DD`);
// the router serves BARE ids, so the box CALL uses the bare id (metadata.model) while model.default carries
// the dated id. Stamp the date you ran.
const snapshot = process.env.MODEL_SNAPSHOT ?? '2026-06-30'

export const profiles: AgentProfile[] = grid.map(({ harness, model }) => ({
  name: `${harness}·${model.split('/').at(-1)}`,
  // model.default = the dated id the eval records by; metadata.model = the bare id the provider calls.
  model: { default: `${model}@${snapshot}` },
  harness,
  metadata: { harness, model },
  prompt: {
    systemPrompt:
      'Solve the task. The library API post-dates your training. Use web_search to find the current ' +
      'signatures, then write the solution file so every test passes. Do not guess at the API.',
  },
}))

export { loadWebCodeTasks, type WebCodeTask } from './webcode-dataset'

/** Build the maintained Tangle adapter used by live WebCode runs. */
export function createWebCodeEnvironmentProvider(options: {
  apiKey: string
  baseUrl?: string
}): AgentEnvironmentProvider {
  return createTangleProvider({
    client: new Sandbox({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? 'https://sandbox.tangle.tools',
    }) as unknown as Parameters<typeof createTangleProvider>[0]['client'],
  })
}

// ── DISPATCH — render one (profile, task) cell: run the harness in its own sandbox with web search on, have
//    it write the solution file, then run EXA'S OWN test_patch as the grader.
function webcodeDispatch(
  environmentProvider: AgentEnvironmentProvider,
): ProfileDispatchFn<WebCodeTask, { passed: boolean }> {
  return async (profile, task, ctx) => {
    const harness = String(profile.metadata?.harness ?? 'opencode')
    const model = String(profile.metadata?.model ?? 'openai/gpt-4.1-2025-04-14')
    const solutionFile = task.solutionFiles[0] ?? 'Solution.txt'
    const prompt = `${task.taskDescription}\n\n— Write your solution to \`solution/${solutionFile}\`. Use web_search for the post-${task.releaseTag} API; make every test pass.`

    const agentRun: AgentRunSpec<string> = {
      profile,
      name: profile.name ?? harness,
      taskToPrompt: (t) => t,
      environment: {
        backend: harness,
        workspace: task.baseImage ? { image: task.baseImage } : { environment: 'universal' },
        env: { TANGLE_SEARCH_DEFAULT_PROVIDER: 'exa' },
        providerOptions: {
          sandboxCreateOptions: {
            backend: {
              model: { provider: 'openai-compat', model, baseUrl: routerBaseUrl },
            },
          },
        },
      },
    }
    const run = await openEnvironmentRun<{ passed: boolean }>({
      provider: environmentProvider,
      agentRun,
      scenarioId: task.id,
      signal: ctx.signal,
      deliverable: { kind: 'events', fromEvents: () => ({ passed: false }) },
    })
    try {
      const paid = await ctx.cost.runPaidCall({
        channel: 'agent',
        actor: 'webcode-cell',
        model,
        signal: ctx.signal,
        execute: () => run.turn(prompt),
        receipt: (turn) => {
          const usage = sumEnvironmentUsage(turn.events)
          return {
            model,
            inputTokens: usage.input,
            outputTokens: usage.output,
            ...(usage.costUsd > 0 ? { actualCostUsd: usage.costUsd } : {}),
          }
        },
      })
      if (!paid.succeeded) throw paid.error
      return { passed: await gradeWebCodeEnvironment(run.environment, task) }
    } finally {
      await run.close()
    }
  }
}

/** Run Exa's exact test patch inside the provider environment. */
export async function gradeWebCodeEnvironment(
  environment: AgentEnvironment,
  task: WebCodeTask,
): Promise<boolean> {
  if (!environment.exec || !environment.write) {
    throw new Error('WebCode requires a provider with workspace write and command execution')
  }
  await environment.exec('mkdir -p tests solution')
  await environment.write('tests/test_solution.py', task.testPatch)
  await environment.exec('python3 -m pip install -q pytest 2>/dev/null || true')
  const result = await environment.exec('python3 -m pytest tests/ -q')
  return result.exitCode === 0
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
export async function runWebCodeMatrix(
  environmentProvider: AgentEnvironmentProvider,
  runDir: string,
  commitSha: string,
) {
  const tasks = loadWebCodeTasks(process.env.LIMIT ? { limit: Number(process.env.LIMIT) } : {})
  const result = await runProfileMatrix<WebCodeTask, { passed: boolean }>({
    profiles,
    scenarios: tasks,
    dispatch: webcodeDispatch(environmentProvider),
    judges: [hiddenTests],
    runDir,
    commitSha,
    reps: 1,
  })

  // The records ARE the universal currency — the domain-agnostic leaderboard engine renders them, with
  // Wilson + bootstrap CIs (stats) and the paired, BH-corrected who-beat-whom table (pairwiseSignificance).
  const board = leaderboard(result.records, {
    title: 'WebCode — harness × model',
    stats: true,
    meta: {
      dataset: 'exa-labs/benchmarks webcode e2e',
      tasks: String(tasks.length),
      commit: commitSha,
    },
  })
  const pairs = pairwiseSignificance(result.records)
  const md = `${renderLeaderboardMarkdown(board)}\n\n${renderPairwiseMarkdown(pairs)}`
  writeFileSync(`${runDir}/report.md`, md)
  writeFileSync(`${runDir}/report.svg`, renderLeaderboardSvg(board))
  writeFileSync(`${runDir}/report.html`, renderLeaderboardHtml(board))
  console.log(md)
  console.log(`\nwrote report.md / report.svg / report.html → ${runDir}`)
  return { result, board }
}

// Run it live.
if (import.meta.url === `file://${process.argv[1]}`) {
  const apiKey = process.env.TANGLE_API_KEY
  if (!apiKey) throw new Error('TANGLE_API_KEY required')
  const environmentProvider = createWebCodeEnvironmentProvider({
    apiKey,
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
  })
  await runWebCodeMatrix(
    environmentProvider,
    process.env.RUN_DIR ?? '.',
    process.env.COMMIT_SHA ?? 'local',
  )
}
