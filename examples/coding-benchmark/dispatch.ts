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
 * │  THE FIREWALL LIVES HERE — and it is ENFORCED, not a comment.              │
 * │  The agent context is ASSEMBLED from the routing (`routeCodingFields`):    │
 * │  `scenario.prompt` is `agent-visible`, the visible test is                 │
 * │  `develop-against` (seeded during the turn so `node --test` has a file —   │
 * │  a multi-round agent CAN read it, intentional TDD), and the held-out suite │
 * │  + rubric note are `grading-only`/`judge-only` — they must never appear in │
 * │  the agent context. `assertNoHiddenLeak` (agent-eval) throws if they do.   │
 * │                                                                            │
 * │  At grading, `gradeOnHiddenCriteria` (→ agent-eval's `gradeOnHidden`)      │
 * │  RE-ASSERTS the firewall against the exact context the run used, THEN      │
 * │  seeds + runs the held-out suite. A hardcode-the-visible cheat fails the   │
 * │  held-out inputs it never saw. THAT is the anti-cheat: execution truth on  │
 * │  hidden tests, behind a firewall the substrate enforces.                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { assertNoHiddenLeak } from '@tangle-network/agent-eval'
import type { DispatchContext, ProfileDispatchFn } from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentRunSpec,
  openSandboxRun,
  type SandboxClient,
  sumSandboxUsage,
} from '@tangle-network/agent-runtime/loops'
import type { SandboxEvent } from '@tangle-network/sandbox'
import {
  type CheckBox,
  gradeOnHiddenCriteria,
  layerOutput,
  type RunArtifact,
  runChecks,
} from './eval'
import { harnessOf, type ToolPreset, withTools } from './profiles'
import { type CodingScenario, checkCmds, routeCodingFields } from './scenarios'

/** Max refine rounds. Round N+1's prompt is built from round N's CHECK output only. */
const maxRounds = 3

/** Build the next-round prompt from ONLY the VISIBLE example checks (the firewall — see
 *  the banner above). typecheck/test are gating (a failure blocks `allPass`); lint is
 *  advisory (never gates) but its warnings still ride along in a separate, labeled section
 *  so the agent can fix style. */
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
    const model = equippedProfile.model?.default ?? 'unknown'
    const cmds = checkCmds(scenario)
    // Route the scenario's fields by destination (agent-visible / develop-against /
    // grading-only / judge-only). The firewall reads these tags, not field names.
    const routedFields = routeCodingFields(scenario)

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
      // The EXACT text that reaches the agent across the whole run — every prompt it
      // sees, concatenated. The firewall checks the held-out suite + rubric never appear
      // in here. `gradeOnHidden` re-asserts this at grading; we also assert per round so a
      // leak fails the instant it would happen, not three rounds later.
      const agentContextParts: string[] = []

      for (let round = 0; round < maxRounds; round += 1) {
        const prompt = round === 0 ? scenario.prompt : nextPrompt(checks)
        // Assert BEFORE the prompt reaches the agent: a grading-only/judge-only field's
        // value inside the prompt is a firewall breach (throws). `routeFields` marked the
        // visible test `develop-against`, so seeding it never trips this.
        agentContextParts.push(prompt)
        assertNoHiddenLeak(routedFields, agentContextParts.join('\n'))
        const paid = await ctx.cost.runPaidCall({
          channel: 'agent',
          actor: 'sandbox-cell',
          model,
          signal: ctx.signal,
          execute: () => (round === 0 ? run.start(prompt) : run.resume(prompt)),
          receipt: (turn) => {
            const usage = sumSandboxUsage(turn.events)
            return {
              model,
              inputTokens: usage.input,
              outputTokens: usage.output,
              ...(usage.costUsd > 0 ? { actualCostUsd: usage.costUsd } : {}),
            }
          },
        })
        if (!paid.succeeded) throw paid.error
        const turn = paid.value
        solution = turn.out.solution
        finalText = turn.events.map(eventText).filter(Boolean).join(' ').slice(0, 2000)

        // Dev checks (visible example tests), IN THE BOX, this round. These (and only
        // these) steer the next round — the firewall keeps the held-out suite + rubric
        // out of the loop. `run.box` is a `SandboxInstance`; `CheckBox` is the minimal
        // `exec`(+optional `fs.write`) subset the checks use — a structural narrowing.
        checks = await runChecks(run.box as CheckBox, scenario, cmds)
        if (checks.allPass) break // stop on worker-observable green only
      }

      // HELD-OUT GRADING behind the FIREWALL — the anti-cheat. `gradeOnHiddenCriteria`
      // (→ agent-eval's `gradeOnHidden`) RE-ASSERTS `assertNoHiddenLeak` against the exact
      // agent context the run used (proving on real data that the held-out suite + rubric
      // never reached the agent), THEN seeds + runs the held-out suite in the SAME box. Its
      // pass rate is the PRIMARY correctness score (the judge blends it as the recorded
      // composite). A solution that hardcoded the visible examples fails the held-out inputs
      // it never saw — execution truth behind a substrate-enforced firewall, not a regex.
      const heldout = await gradeOnHiddenCriteria(
        run.box as CheckBox,
        scenario,
        cmds.heldout,
        { fields: routedFields, agentContext: agentContextParts.join('\n') },
        ctx.signal,
      )
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
