/**
 * `coderProfile` + `runLoop` + `FanoutVote` driver — the smallest end-to-end
 * coder loop. Two parallel coder iterations attempt the goal; the validator
 * scores test + typecheck + diff size; the kernel picks the highest-score
 * valid winner.
 *
 * No real sandbox SDK or harness is required. The synthetic `sandboxClient`
 * mirrors the production `Sandbox` surface one-for-one (`create()` returns
 * an object with `streamPrompt(message, opts)`), and emits a `result` event
 * whose `data.result` matches the `CoderOutput` shape `coderProfile`'s
 * `parseCoderEvents` walks back-to-front.
 *
 * Run with:
 *   pnpm tsx examples/coder-loop/coder-loop.ts
 */

import { createFanoutVoteDriver, runLoop } from '@tangle-network/agent-runtime/loops'
import { type CoderTask, coderProfile } from '@tangle-network/agent-runtime/profiles'
import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'

const task: CoderTask = {
  goal: 'add util.ts that exports add(a,b)',
  repoRoot: '/tmp/coder-loop-example',
  testCmd: 'node -e \'require("./util").add(1,2)===3 || process.exit(1)\'',
  typecheckCmd: 'pnpm typecheck',
  maxDiffLines: 50,
  forbiddenPaths: ['secrets/', 'node_modules/'],
}

// ── Synthetic sandbox client ─────────────────────────────────────────────
// Two iterations: the first emits a valid CoderOutput (tests + typecheck
// pass, small diff); the second emits a near-miss (tests pass, typecheck
// fails). The FanoutVote driver picks #1 as the winner.
const candidateOutputs = [
  {
    branch: 'coder/util-add-A',
    patch: [
      'diff --git a/util.ts b/util.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/util.ts',
      '@@ -0,0 +1,1 @@',
      '+export const add = (a: number, b: number): number => a + b',
    ].join('\n'),
    testResult: { passed: true, output: '1 test passed' },
    typecheckResult: { passed: true, output: 'no errors' },
    diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
    reviewerNotes: 'Minimal arrow-function impl. No external deps.',
  },
  {
    branch: 'coder/util-add-B',
    patch: [
      'diff --git a/util.ts b/util.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/util.ts',
      '@@ -0,0 +1,3 @@',
      '+export function add(a, b) {',
      '+  return a + b',
      '+}',
    ].join('\n'),
    testResult: { passed: true, output: '1 test passed' },
    typecheckResult: { passed: false, output: 'TS7006: Parameter implicitly has any type' },
    diffStats: { filesChanged: 1, insertions: 3, deletions: 0 },
    reviewerNotes: 'Untyped params — typecheck fails.',
  },
]

let dispatchIndex = 0
const sandboxClient = {
  async create(): Promise<SandboxInstance> {
    const index = dispatchIndex++
    const output = candidateOutputs[index % candidateOutputs.length]
    const id = `sandbox-coder-${index + 1}`
    const box = {
      id,
      async *streamPrompt(): AsyncIterable<SandboxEvent> {
        // Mirror cost-bearing events so the kernel's per-iteration costUsd
        // aggregator picks them up.
        yield {
          type: 'llm_call',
          data: { model: 'claude-code/sonnet', tokensIn: 800, tokensOut: 120, costUsd: 0.0036 },
        }
        yield { type: 'result', data: { result: output } }
      },
    } as unknown as SandboxInstance
    return box
  },
}

async function main(): Promise<void> {
  const { output, validator, agentRunSpec } = coderProfile({ task, harness: 'claude-code' })
  const driver = createFanoutVoteDriver<CoderTask, ReturnType<typeof output.parse>>({ n: 2 })

  const result = await runLoop({
    driver,
    agentRun: agentRunSpec,
    output,
    validator,
    task,
    ctx: { sandboxClient },
  })

  console.log(`decision: ${result.decision}`)
  console.log(`iterations: ${result.iterations.length}`)
  console.log(`durationMs: ${result.durationMs}`)
  console.log(`totalCostUsd: ${result.costUsd.toFixed(6)}`)
  if (!result.winner) {
    console.log('no winner — every iteration failed validation')
    return
  }
  console.log(`winner: iteration #${result.winner.iterationIndex} (${result.winner.agentRunName})`)
  console.log(
    `  score: ${result.winner.verdict?.score?.toFixed(3)}  valid: ${result.winner.verdict?.valid}`,
  )
  console.log(`  branch: ${result.winner.output.branch}`)
  console.log(`  diff (${result.winner.output.diffStats.insertions} insertions):`)
  for (const line of result.winner.output.patch.split('\n')) {
    console.log(`    ${line}`)
  }
  console.log(`  tests passed: ${result.winner.output.testResult.passed}`)
  console.log(`  typecheck passed: ${result.winner.output.typecheckResult.passed}`)
  if (result.winner.output.reviewerNotes) {
    console.log(`  notes: ${result.winner.output.reviewerNotes}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
