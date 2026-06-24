/**
 * The DISPATCH — renders one (profile, scenario) matrix cell: it runs the coding
 * agent on the profile's harness, MULTI-ROUND, in ONE persistent box, then hands
 * back the `RunArtifact` the judges score.
 *
 * This file composes four primitives and nothing bespoke:
 *   - `offlineSandboxClient` (offline) or `new SandboxClient(...)` (live) give the box.
 *   - `openSandboxRun(client, opts, deliverable)` opens ONE persistent, resumable box.
 *     `.start(prompt)` = round 1; `.resume(prompt)` = round N over the SAME session.
 *     That IS the "each round builds on the prior output" loop — no extra combinator.
 *   - `runChecks` (eval.ts) runs the deterministic `MultiLayerVerifier` pipeline each round.
 *   - `extractLlmCallEvent` (the runtime's own metering seam) reads token usage off the
 *     stream — across ALL backend event shapes — and reports it so the backend-integrity
 *     guard sees a real run.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  THE FIREWALL LIVES HERE — and it is EXECUTION-BASED, not a text scan.     │
 * │  The ONLY scenario field that reaches the agent's CONTEXT is               │
 * │  `scenario.prompt` (the `taskToPrompt` below, and `nextPrompt` built ONLY  │
 * │  from check output). The LLM-judge rubric note is read later by eval.ts —  │
 * │  never written into the box.                                               │
 * │                                                                            │
 * │  The VISIBLE example test is seeded into the box DURING the turn (so       │
 * │  `node --test` has a file to run) and a multi-round agent with native file │
 * │  tools CAN read it — intentional, the same as real TDD.                    │
 * │                                                                            │
 * │  The HELD-OUT grading suite is NEVER seeded during the turn. It is copied  │
 * │  in ONLY at grading (after the loop, `runHeldout` below) and run; the      │
 * │  score is its pass rate. The agent cannot game tests it never saw — a      │
 * │  hardcode-the-visible cheat fails the held-out inputs. THAT is the         │
 * │  anti-cheat: execution truth on hidden tests.                              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { DispatchContext, ProfileDispatchFn } from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentRunSpec,
  extractLlmCallEvent,
  openSandboxRun,
  type SandboxClient,
} from '@tangle-network/agent-runtime/loops'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { type CheckBox, layerOutput, type RunArtifact, runChecks, runHeldout } from './eval'
import { harnessOf, type ToolPreset, withTools } from './profiles'
import { type CodingScenario, checkCmds } from './scenarios'

/** Max refine rounds. Round N+1's prompt is built from round N's CHECK output only. */
const maxRounds = 3

/** Build the next-round prompt from the checks the AGENT is allowed to see — the
 *  pass/fail + output of the VISIBLE example tests. NEVER from the held-out suite, the
 *  rubric, or the judge. This is the firewall in action: the agent steers on the visible
 *  example failures, nothing else, and is GRADED on the held-out suite it never saw.
 *
 *  typecheck/test are gating (a failure blocks `allPass`); lint is advisory (it never
 *  gates) but its warnings are still surfaced here so the agent can fix style — visible
 *  to the agent is decoupled from gates-allPass. Advisory warnings ride along as a
 *  separate, clearly-labeled section. */
function nextPrompt(report: RunArtifact['checks']): string {
  const fails: string[] = []
  const advisories: string[] = []
  for (const layer of ['typecheck', 'test'] as const) {
    const c = layerOutput(report, layer)
    if (!c.passed) fails.push(`${layer} failed:\n${c.output.slice(0, 1200)}`)
  }
  // lint is advisory: report its warnings (not "clean") without treating them as a
  // gating failure, so style issues can actually be refined.
  const lint = layerOutput(report, 'lint')
  if (!lint.clean && lint.output) advisories.push(`lint warnings:\n${lint.output.slice(0, 1200)}`)

  const sections = [`Your solution did not pass these checks. Fix the file and try again.`]
  if (fails.length > 0) sections.push(fails.join('\n\n'))
  if (advisories.length > 0)
    sections.push(`Advisory (does not block, but improve if you can):\n${advisories.join('\n\n')}`)
  return sections.join('\n\n')
}

/**
 * The dispatch factory. Curry the tool preset + the sandbox client; return a
 * `ProfileDispatchFn` the matrix calls once per cell.
 *
 * @param clientFor  Resolve a `SandboxClient` for a profile's harness. Offline:
 *                   return `offlineSandboxClient(...)`. Live: `new SandboxClient(...)`.
 */
export function codingDispatch(
  toolPreset: ToolPreset,
  clientFor: (profile: AgentProfile) => SandboxClient,
): ProfileDispatchFn<CodingScenario, RunArtifact> {
  return async (
    profile: AgentProfile,
    scenario: CodingScenario,
    ctx: DispatchContext,
  ): Promise<RunArtifact> => {
    const harness = harnessOf(profile)
    // Author the tool surface onto the profile (one line). The substrate
    // materializes it into the harness's real config.
    const equippedProfile = withTools(profile, toolPreset)
    const cmds = checkCmds(scenario)

    const agentRun: AgentRunSpec<string> = {
      profile: equippedProfile,
      // FIREWALL: the prompt is the WHOLE of what the agent sees. Only scenario.prompt.
      taskToPrompt: (task: string) => task,
      sandboxOverrides: { backend: { type: harness } },
    }

    // Read the produced solution file off the box after each turn (the deliverable).
    const run = await openSandboxRun<{ solution: string }>(
      clientFor(profile),
      { agentRun, signal: ctx.signal, runId: ctx.cellId, scenarioId: scenario.id },
      {
        kind: 'artifact',
        path: scenario.solutionPath,
        fromArtifact: (raw: string) => ({ solution: raw }),
      },
    )

    try {
      let checks = blankReport()
      let solution = ''
      let finalText = ''

      for (let round = 0; round < maxRounds; round += 1) {
        const prompt = round === 0 ? scenario.prompt : nextPrompt(checks)
        const turn = round === 0 ? await run.start(prompt) : await run.resume(prompt)
        solution = turn.out.solution
        finalText = turn.events.map(eventText).filter(Boolean).join(' ').slice(0, 2000)

        // Report usage so the integrity guard sees a real backend (not a stub).
        // `extractLlmCallEvent` reads usage off EVERY backend event shape — the live
        // sandbox's `done`/`result`/`llm_call` events all sum correctly here.
        const usage = sumTokens(turn.events)
        if (usage.input || usage.output) ctx.cost.observeTokens(usage)

        // Dev checks (visible example tests), IN THE BOX, this round. These (and only
        // these) steer the next round — the firewall keeps the held-out suite + rubric
        // out of the loop. `run.box` is a `SandboxInstance`; `CheckBox` is the minimal
        // `exec`(+optional `fs.write`) subset the checks use — a structural narrowing.
        checks = await runChecks(run.box as CheckBox, scenario, cmds)
        if (checks.allPass) break // stop on worker-observable green only
      }

      // HELD-OUT TEST EXECUTION — the anti-cheat. Runs AFTER the loop in the SAME box:
      // the held-out suite (never seeded during the turn) is copied in and run against
      // the agent's real solution. Its pass rate is the PRIMARY correctness score (the
      // judge blends it as the recorded composite). A solution that hardcoded the visible
      // examples fails the held-out inputs it never saw — execution truth, not a regex.
      const heldout = await runHeldout(run.box as CheckBox, scenario, cmds.heldout)
      await ctx.artifacts.writeJson(`heldout/${ctx.cellId}.json`, heldout)

      return { solution, finalText, checks, heldout }
    } finally {
      await run.close()
    }
  }
}

/** An empty verifier report for the pre-loop state (no layer has run yet). */
function blankReport(): RunArtifact['checks'] {
  const now = new Date().toISOString()
  return {
    layers: [],
    passCount: 0,
    failCount: 0,
    skippedCount: 0,
    errorCount: 0,
    allPass: false,
    blendedScore: 0,
    valid: false,
    score: 0,
    durationMs: 0,
    startedAt: now,
    finishedAt: now,
  }
}

/** Pull the agent's text out of a stream event (best-effort, for judge context). The
 *  text payload isn't on `SandboxEvent`'s typed surface, so we read `data` defensively. */
function eventText(ev: SandboxEvent): string {
  const e = ev as { data?: { finalText?: string; text?: string; delta?: string } }
  return e.data?.finalText ?? e.data?.text ?? e.data?.delta ?? ''
}

/** Sum token usage across the turn's events into the `{ input, output }` shape
 *  `ctx.cost.observeTokens` expects, using the runtime's own metering extractor so
 *  EVERY backend event shape (`done`/`result`/`llm_call`/`usage`) is counted.
 *  `events` is the turn's real `SandboxEvent[]` — `extractLlmCallEvent` takes it directly. */
function sumTokens(events: SandboxEvent[]): { input: number; output: number } {
  let input = 0
  let output = 0
  for (const ev of events) {
    const call = extractLlmCallEvent(ev, 'agent')
    if (call) {
      input += call.tokensIn ?? 0
      output += call.tokensOut ?? 0
    }
  }
  return { input, output }
}
