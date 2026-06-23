/**
 * ui-audit — smallest end-to-end UI audit run.
 *
 * Wires:
 *   - `uiAuditorProfile()` — output adapter + validator + envelope-prefixed prompt
 *   - `createInProcessUiAuditClient({ workspaceDir, judge })` — the in-process
 *     `SandboxClient` that drives Playwright + a vision judge
 *   - `runLoop({ ... })` — one iteration per (lens × route), validator-gated
 *   - `appendFindings(...)` + `writeAuditIndex(...)` — persist self-contained
 *     GitHub-issue Markdown
 *
 * The example uses a STUB judge so it runs without an API key. Replace
 * `stubJudge` with a real vision-LLM-backed implementation for production.
 *
 * Usage:
 *   pnpm dlx tsx examples/ui-audit/ui-audit.ts <workspaceDir> <url>
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Driver } from '@tangle-network/agent-runtime/loops'
import { runLoop } from '@tangle-network/agent-runtime/loops'
import {
  appendFindings,
  createInProcessUiAuditClient,
  initAuditWorkspace,
  type UiAuditOutput,
  type UiAuditTask,
  type UiFinding,
  type UiJudge,
  uiAuditorProfile,
  writeAuditIndex,
} from '@tangle-network/agent-runtime/profiles'

const LENSES_TO_RUN = ['consistency', 'hierarchy', 'layout', 'ux-flow'] as const

/**
 * Deterministic stub judge — returns one canned finding referencing the
 * iteration's first capture. Replace with a real vision LLM call.
 */
const stubJudge: UiJudge = async ({ lens, captures }) => {
  if (captures.length === 0) return { findings: [] }
  const evidence = captures[0]
  if (!evidence) return { findings: [] }
  const finding: UiFinding = {
    title: `[stub] ${lens} finding on ${evidence.route}`,
    lens,
    severity: 'low',
    route: evidence.route,
    url: evidence.url,
    viewport: evidence.viewport,
    observation: `Stub judge emitted a placeholder ${lens} finding to demonstrate the pipeline.`,
    impact: 'No real impact — stub output for the example.',
    suggestedFix: 'Wire a real vision judge to replace this finding.',
    screenshots: [{ path: evidence.path, viewport: evidence.viewport }],
  }
  return { findings: [finding], tokenUsage: { input: 0, output: 0 } }
}

/**
 * `lensCyclingDriver` — plans one iteration per lens in a fixed order,
 * stops when the list is exhausted. The kernel handles cost + abort + trace.
 */
function lensCyclingDriver(
  lenses: readonly UiAuditTask['lens'][],
  task: UiAuditTask,
): Driver<UiAuditTask, UiAuditOutput, 'complete' | 'failed'> {
  let cursor = 0
  return {
    // This driver is CONTENT-BLIND by design: it cycles a fixed lens list off
    // `history.length` and never reads a worker's output. So "driver" here is just
    // a counter, NOT the output-driven re-planner. For a driver that builds the next
    // prompt FROM the last worker's output (the fold), see examples/driver-loop/.
    // plan() returns Task[] — one lens per iteration, [] once all lenses are
    // cycled. The empty plan is what ends the loop: neither 'complete' nor
    // 'failed' is a terminal Decision (isTerminalDecision = stop|fail|done|
    // pick-winner), so plan-exhaustion + maxIterations are what stop it.
    async plan(_taskIn, history) {
      if (history.length >= lenses.length || cursor >= lenses.length) return []
      const next = lenses[cursor]
      if (!next) return []
      cursor += 1
      return [{ ...task, lens: next }]
    },
    // decide() returns the bare Decision recording the outcome; termination is
    // driven by plan() → [].
    decide(history) {
      return history.some((it) => it.verdict?.valid) ? 'complete' : 'failed'
    },
  }
}

async function main(): Promise<void> {
  const [, , wsArg, urlArg] = process.argv
  const startUrl = urlArg ?? 'https://example.com'
  const workspaceDir = wsArg ?? (await mkdtemp(path.join(tmpdir(), 'ui-audit-')))
  console.log(`workspace: ${workspaceDir}`)
  await initAuditWorkspace(workspaceDir)

  const { output, validator, agentRunSpec } = uiAuditorProfile()
  const client = createInProcessUiAuditClient({ workspaceDir, judge: stubJudge })

  try {
    const task: UiAuditTask = {
      lens: 'consistency',
      captures: [{ route: 'home', url: startUrl, fullPage: true }],
    }
    const driver = lensCyclingDriver(LENSES_TO_RUN, task)

    const result = await runLoop({
      driver,
      agentRun: agentRunSpec,
      output,
      validator,
      task,
      ctx: { sandboxClient: client },
      maxIterations: LENSES_TO_RUN.length,
    })

    console.log(`iterations: ${result.iterations.length}`)
    console.log(`decision: ${result.decision}`)
    const allFindings: UiFinding[] = []
    for (const it of result.iterations) {
      if (it.output) allFindings.push(...it.output.findings)
    }
    console.log(`findings collected: ${allFindings.length}`)
    if (allFindings.length > 0) {
      const persisted = await appendFindings(workspaceDir, allFindings)
      console.log(`persisted ${persisted.written.length} finding(s)`)
    }
    const indexPath = await writeAuditIndex(workspaceDir)
    console.log(`index: ${indexPath}`)
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
