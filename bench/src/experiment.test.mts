import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoopSandboxClient } from '@tangle-network/agent-runtime/loops'
import type { BenchmarkAdapter, BenchScore, BenchTask } from './benchmarks/types'
import { analystArm, randomArm, refineArm, runExperiment, sandboxAgentRun } from './experiment'

// The developer-friendly verification seam: a LoopSandboxClient that yields
// SCRIPTED events, so the WHOLE one flow (provision → stream → deliverable →
// judge → usage → corpus) runs offline, deterministically, with ZERO creds.
// This is the "local-bridge" dial as a test double — the painful part of bench
// DX ("you need a Tangle key to run anything") solved for the test path.
function mockSandboxClient(script: (prompt: string) => unknown[]): LoopSandboxClient {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: a test double for SandboxInstance — only the methods runLoop touches
    create: async (): Promise<any> => ({
      id: 'mock-box',
      status: 'running',
      async *streamPrompt(prompt: string) {
        for (const ev of script(prompt)) yield ev
      },
      async delete() {},
      async refresh() {},
    }),
  }
}

/** A scripted run: the agent's final text + a `done` event carrying REAL usage. */
const scriptRun = (finalText: string, usage = { input: 120, output: 35 }, costUsd = 0.012) =>
  () => [
    { type: 'message', data: { finalText } },
    { type: 'done', data: { tokenUsage: { inputTokens: usage.input, outputTokens: usage.output }, totalCostUsd: costUsd } },
  ]

/** A fake benchmark adapter — judge passes iff the (streamed) answer contains PASS. */
const fakeAdapter = (): BenchmarkAdapter => ({
  name: 'mockbench',
  async preflight() {},
  async loadTasks(): Promise<BenchTask[]> {
    return [{ id: 't1', prompt: 'solve it' }]
  },
  async judge(_task, artifact): Promise<BenchScore> {
    const resolved = artifact.includes('PASS')
    return { resolved, score: resolved ? 1 : 0 }
  },
  async goldArtifact() {
    return undefined
  },
})

const agentRun = sandboxAgentRun({ model: 'mock-model', routerBaseUrl: 'http://x', routerKey: 'k' })

// --- the one flow runs end-to-end offline + captures REAL usage into the corpus ---
{
  const corpusPath = join(await mkdtemp(join(tmpdir(), 'exp-')), 'corpus.jsonl')
  const r = await runExperiment({
    adapter: fakeAdapter(),
    sandboxClient: mockSandboxClient(scriptRun('the answer is PASS')),
    agentRun,
    arms: [randomArm('random')],
    model: 'mock-model',
    rounds: 1,
    n: 1,
    concurrency: 1,
    corpusPath,
  })
  assert.equal(r.n, 1, 'one clean instance')
  assert.equal(r.errored, 0, 'no infra error')
  assert.equal(r.arms[0]?.resolved, 1, 'the judge passed (answer contains PASS)')

  // The whole point: REAL usage flowed from the (mock) stream → kernel → corpus.
  const rows = (await readFile(corpusPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
  const att = rows[0]?.attempts?.[0]
  assert.equal(att?.tokensIn, 120, 'real input tokens captured (not a fabricated 0)')
  assert.equal(att?.tokensOut, 35, 'real output tokens captured')
  assert.equal(att?.costUsd, 0.012, 'real cost captured')
  assert.ok(typeof att?.wallMs === 'number', 'wallMs captured')
  await rm(join(corpusPath, '..'), { recursive: true, force: true })
}

// --- a failing answer is judged not-resolved; the arm/Δ accounting holds ---
{
  const r = await runExperiment({
    adapter: fakeAdapter(),
    sandboxClient: mockSandboxClient(scriptRun('the answer is wrong')),
    agentRun,
    arms: [randomArm('random'), refineArm('refine', 'try again, carefully')],
    model: 'mock-model',
    rounds: 1,
    n: 1,
    concurrency: 1,
  })
  assert.equal(r.n, 1)
  assert.equal(r.arms[0]?.resolved, 0, 'judge fails on a non-PASS answer')
  assert.equal(r.arms[1]?.deltaVsControl, 0, 'refine − control = 0 here (both fail)')
}

// --- analystArm: the steer investigates the trace and frames TARGETED feedback ---
{
  // analyze is mocked (an LLM/sub-loop would go here) — the arm just frames its output.
  const a = analystArm('analyst', async () => 'FIX: you missed the JOIN on user_id')
  const planner = a.planner('solve it', 3)
  // round 0: empty history → bare task (nothing to analyze yet)
  // biome-ignore lint/suspicious/noExplicitAny: minimal PlannerContext for a unit test
  const m0 = (await planner({ task: 'solve it', history: [] } as any)) as { kind: string; task?: string }
  assert.equal(m0.kind, 'refine')
  assert.equal(m0.task, 'solve it', 'round 0 is bare (no analysis yet)')
  // round 1: a failed prior attempt → the next prompt carries the analyst's correction
  // biome-ignore lint/suspicious/noExplicitAny: minimal PlannerContext for a unit test
  const m1 = (await planner({ task: 'solve it', history: [{ output: 'wrong', verdict: { valid: false } }] } as any)) as {
    kind: string
    task?: string
  }
  assert.equal(m1.kind, 'refine')
  assert.match(m1.task ?? '', /FIX: you missed the JOIN on user_id/, 'round 1 carries the analyst feedback')
  assert.match(m1.task ?? '', /Analysis of your previous attempt/)
}

// --- analyst says "no change needed" → the steer leaves the task bare (no churn) ---
{
  const a = analystArm('analyst', async () => 'no change needed')
  const planner = a.planner('solve it', 3)
  // biome-ignore lint/suspicious/noExplicitAny: minimal PlannerContext for a unit test
  const m1 = (await planner({ task: 'solve it', history: [{ output: 'fine', verdict: { valid: false } }] } as any)) as {
    task?: string
  }
  assert.equal(m1.task, 'solve it', 'a no-op analysis does not churn the prompt')
}

console.log('experiment.test.mts: all assertions passed')
