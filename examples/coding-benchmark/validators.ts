/**
 * The DETERMINISTIC layer — validators that run BEFORE any judge.
 *
 * Scoring a coding task in the right order matters: objective checks first (they
 * cost ~$0 and can't be gamed), an anti-fake realness gate next, and only THEN —
 * if there is still a subjective band left to grade — an LLM judge. This file owns
 * the first two layers. judges.ts owns the third.
 *
 * Two kinds of validator here:
 *   1. `runBoxChecks` — runs the scenario's `typecheck` / `test` / `lint` commands
 *      IN THE BOX via `box.exec(...)`. Pass/fail comes from the exit code. This is
 *      a runtime concern (it needs a live box), so it is a plain async function the
 *      dispatch calls each round; the booleans it returns are what steer the next
 *      round (see the firewall note in dispatch.ts).
 *   2. `realnessValidator` — wraps agent-eval's `scoreAuthenticity` + `gateRealness`
 *      as a runtime `Validator<RunArtifact>`. It catches "compiles but is a stub".
 *      Its score is WRITE-ONLY to the record — the agent never sees it, so it cannot
 *      steer toward it.
 *
 * `Validator<Output, Verdict>` is the runtime seam (src/runtime/types.ts): one
 * method, `validate(output, ctx) → Promise<verdict>`. We use the default verdict
 * shape `{ valid, score, signals }`.
 */

import {
  type AuthenticitySignals,
  gateRealness,
  type ProducedFile,
  scoreAuthenticity,
} from '@tangle-network/agent-eval/authenticity'
import type { DefaultVerdict, Validator } from '@tangle-network/agent-runtime/loops'

/** A finished coding attempt — what the dispatch produces and the judge scores. */
export interface RunArtifact {
  /** Files the agent produced, as `{ path, content }` — the realness currency. */
  files: ProducedFile[]
  /** The solution file's content (convenience; also present in `files`). */
  solution: string
  /** The agent's final chat text for the round (judge context). */
  finalText: string
  /** Deterministic check results from the LAST round — gate the judge + the record. */
  checks: BoxCheckResult
  /** The realness anchor's verdict, computed AFTER the loop by `realnessValidator`.
   *  Recorded for honesty; the agent never sees it (see the firewall in dispatch.ts). */
  realness: DefaultVerdict
}

export interface BoxCheckResult {
  typecheck: { passed: boolean; output: string }
  test: { passed: boolean; output: string }
  lint: { passed: boolean; output: string }
  /** True only when typecheck AND test pass (lint is advisory). */
  allPass: boolean
}

/** Minimal box surface the checks need — a subset of the real `SandboxInstance`.
 *  The live sandbox satisfies it; the offline in-process box implements it too. */
export interface CheckBox {
  exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

/**
 * Run the scenario's deterministic checks in the box. Exit code 0 = pass. This is
 * the objective floor: it can't be talked around by a confident judge, and it costs
 * nothing. The agent IS told what to build (the prompt), but never the grading
 * commands — those live on the scenario's eval-only fields.
 */
export async function runBoxChecks(
  box: CheckBox,
  cmds: { typecheck: string; test: string; lint: string },
): Promise<BoxCheckResult> {
  const run = async (cmd: string): Promise<{ passed: boolean; output: string }> => {
    const r = await box.exec(cmd)
    return { passed: r.exitCode === 0, output: `${r.stdout}\n${r.stderr}`.trim() }
  }
  const typecheck = await run(cmds.typecheck)
  const test = await run(cmds.test)
  const lint = await run(cmds.lint)
  return { typecheck, test, lint, allPass: typecheck.passed && test.passed }
}

/**
 * The realness anchor as a runtime `Validator`. `scoreAuthenticity` is a pure,
 * no-LLM structural scan (required artifact present? hard part implemented? or a
 * fake shim?), and `gateRealness` caps anything that faked or omitted the required
 * artifact. The verdict is recorded but NEVER fed back to the agent.
 */
export function realnessValidator(signals: AuthenticitySignals): Validator<RunArtifact> {
  return {
    async validate(artifact: RunArtifact): Promise<DefaultVerdict> {
      const result = scoreAuthenticity(artifact.files, signals)
      const gate = gateRealness(result, { requireArtifact: true })
      // realness is 0..100; normalize to the 0..1 verdict score.
      const score = gate.gated ? 0 : result.realness / 100
      const flags = result.flags.length > 0 ? ` — flags: ${result.flags.join(', ')}` : ''
      return {
        valid: !gate.gated && result.realness >= 50,
        score,
        scores: { realness: result.realness, gated: gate.gated ? 1 : 0 },
        notes: `${gate.gated ? `GATED (${gate.reason ?? 'fake/missing artifact'})` : 'real'}${flags}`,
      }
    },
  }
}
