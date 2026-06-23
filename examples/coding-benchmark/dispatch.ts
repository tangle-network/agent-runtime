/**
 * The DISPATCH — renders one (profile, scenario) matrix cell: it runs the coding
 * agent on the profile's harness, MULTI-ROUND, in ONE persistent box, then hands
 * back the `RunArtifact` the judges score.
 *
 * This file composes four primitives and nothing bespoke:
 *   - `createExecutor`/`new SandboxClient` give the box (live) — or `offlineSandboxClient` (offline).
 *   - `openSandboxRun(client, opts, deliverable)` opens ONE persistent, resumable box.
 *     `.start(prompt)` = round 1; `.resume(prompt)` = round N over the SAME session.
 *     That IS the "each round builds on the prior output" loop — no extra combinator.
 *   - `runBoxChecks` (validators.ts) runs the deterministic checks in the box each round.
 *   - `ctx.cost.observeTokens(...)` reports usage so the backend-integrity guard sees a real run.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  THE NO-CHEAT FIREWALL LIVES HERE.                                         │
 * │  The ONLY scenario field that ever reaches the box is `scenario.prompt`    │
 * │  (the `agentRun.taskToPrompt` below, and `nextPrompt` built ONLY from      │
 * │  validator stderr). The rubric, the realness signals, and the grading      │
 * │  note are read later by judges.ts / the realness validator — never written  │
 * │  into the box. The agent literally cannot read the answer key.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { ProducedFile } from '@tangle-network/agent-eval/authenticity'
import type { DispatchContext, ProfileDispatchFn } from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentRunSpec,
  type DefaultVerdict,
  openSandboxRun,
  type SandboxClient,
} from '@tangle-network/agent-runtime/loops'
import { harnessOf } from './profiles'
import type { CodingScenario } from './scenarios'
import { type ToolPreset, withTools } from './tools'
import {
  type BoxCheckResult,
  type CheckBox,
  type RunArtifact,
  realnessValidator,
  runBoxChecks,
} from './validators'

/** Max refine rounds. Round N+1's prompt is built from round N's CHECK output only. */
const maxRounds = 3

/** Build the next-round prompt from the validators the AGENT is allowed to see —
 *  pass/fail + stderr. NEVER from the rubric, realness, or judge. This is the
 *  firewall in action: the agent steers on objective check failures, nothing else. */
function nextPrompt(checks: BoxCheckResult): string {
  const fails: string[] = []
  if (!checks.typecheck.passed)
    fails.push(`typecheck failed:\n${checks.typecheck.output.slice(0, 1200)}`)
  if (!checks.test.passed) fails.push(`tests failed:\n${checks.test.output.slice(0, 1200)}`)
  if (!checks.lint.passed) fails.push(`lint failed:\n${checks.lint.output.slice(0, 600)}`)
  return `Your solution did not pass these checks. Fix the file and try again.\n\n${fails.join('\n\n')}`
}

/** A box exposing the methods both `openSandboxRun` and the validators call. */
type RunBox = CheckBox & { fs: { read(path: string): Promise<string> } }

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

    const agentRun: AgentRunSpec<string> = {
      profile: equippedProfile,
      // FIREWALL: the prompt is the WHOLE of what the agent sees. Only scenario.prompt.
      taskToPrompt: (task: string) => task,
      sandboxOverrides: { backend: { type: harness } },
    }

    // Read the produced solution file off the box after each turn (the deliverable).
    const run = await openSandboxRun<{ solution: string; files: ProducedFile[] }>(
      clientFor(profile),
      { agentRun, signal: ctx.signal, runId: ctx.cellId, scenarioId: scenario.id },
      {
        kind: 'artifact',
        path: scenario.solutionPath,
        fromArtifact: (raw: string) => ({
          solution: raw,
          files: [{ path: scenario.solutionPath, content: raw }],
        }),
      },
    )

    try {
      let checks: BoxCheckResult = { typecheck: blank, test: blank, lint: blank, allPass: false }
      let solution = ''
      let files: ProducedFile[] = []
      let finalText = ''

      for (let round = 0; round < maxRounds; round += 1) {
        const prompt = round === 0 ? scenario.prompt : nextPrompt(checks)
        const turn = round === 0 ? await run.start(prompt) : await run.resume(prompt)
        solution = turn.out.solution
        files = turn.out.files
        finalText = turn.events.map(eventText).filter(Boolean).join(' ').slice(0, 2000)

        // Report usage so the integrity guard sees a real backend (not a stub).
        const usage = sumTokens(turn.events)
        if (usage.input || usage.output) ctx.cost.observeTokens(usage)

        // Deterministic checks, IN THE BOX, this round. These (and only these) steer
        // the next round — the firewall keeps the rubric/realness out of the loop.
        checks = await runBoxChecks(run.box as unknown as RunBox, scenario.validatorCmds)
        if (checks.allPass) break // stop on worker-observable green only
      }

      // The realness anchor runs AFTER the loop — never inside it, so it can never
      // steer the agent. Its verdict is recorded for honesty (`ctx.artifacts`) and
      // carried on the artifact for the record; the box never saw the signals.
      const realness = await realnessValidator(scenario.realnessSignals).validate(
        { files, solution, finalText, checks, realness: emptyVerdict },
        { iteration: maxRounds, signal: ctx.signal },
      )
      await ctx.artifacts.writeJson(`realness/${ctx.cellId}.json`, realness)

      return { files, solution, finalText, checks, realness }
    } finally {
      await run.close()
    }
  }
}

const blank = { passed: false, output: '' }

/** A placeholder verdict for the artifact passed INTO the realness validator (which
 *  reads only `files`, never this field). The real verdict replaces it on return. */
const emptyVerdict: DefaultVerdict = { valid: false, score: 0 }

/** Pull the agent's text out of a stream event (best-effort, for judge context). */
function eventText(ev: unknown): string {
  const e = ev as { data?: { finalText?: string; text?: string; delta?: string } }
  return e.data?.finalText ?? e.data?.text ?? e.data?.delta ?? ''
}

/** Sum token usage across the turn's events into the `{ input, output }` shape
 *  `ctx.cost.observeTokens` (and `RunTokenUsage`) expect. */
function sumTokens(events: unknown[]): { input: number; output: number } {
  let input = 0
  let output = 0
  for (const ev of events) {
    const d = (ev as { data?: { tokenUsage?: { inputTokens?: number; outputTokens?: number } } })
      .data
    input += d?.tokenUsage?.inputTokens ?? 0
    output += d?.tokenUsage?.outputTokens ?? 0
  }
  return { input, output }
}
