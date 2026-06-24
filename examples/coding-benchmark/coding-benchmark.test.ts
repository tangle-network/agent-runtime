/**
 * Offline smoke test — proves the whole pipeline runs with no creds and that the
 * load-bearing honesty claims hold, BY EXECUTION (not a text scan):
 *   1. the matrix produces exactly `harnesses × scenarios × reps` records and a
 *      defined leaderboard (the wiring is real, not a stub that returns nothing);
 *   2. THE ANTI-CHEAT, end-to-end: a hardcode-the-visible CHEAT passes the VISIBLE
 *      tests but FAILS the HELD-OUT suite (low pass rate) → LOW composite; the REAL
 *      solution PASSES the held-out suite → HIGH composite. Run for real against an
 *      in-process box (`node --test`), no creds. This is the whole point of the example.
 *   3. the held-out test is NEVER seeded into the box during the agent turn — the
 *      firewall — only at grading;
 *   4. reps tighten the per-cell estimate HONESTLY — identical reps do NOT narrow the
 *      leaderboard CI vs reps=1 (reps are not independent samples).
 */

import { exec as execCb } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { assertNoHiddenLeak, type RunRecord } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import { main, offlineAgentScripts } from './benchmark'
import { type CheckBox, composeScore, runChecks, runHeldout } from './eval'
import { harnessProfiles } from './profiles'
import { type CodingScenario, checkCmds, routeCodingFields, scenarios } from './scenarios'
import { pairwiseStats } from './stats'

const execAsync = promisify(execCb)

/** A real in-process `CheckBox` over a fresh temp dir — `fs.write` + `exec` only, the
 *  exact surface `runChecks` / `runHeldout` use. `node --test` runs for real here, so the
 *  held-out execution is genuine (no creds, no network). */
function tempBox(): { box: CheckBox; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'coding-bench-test-'))
  const box: CheckBox = {
    fs: {
      async write(path: string, content: string) {
        const abs = join(dir, path)
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, content, 'utf8')
      },
    },
    async exec(command: string) {
      try {
        const { stdout, stderr } = await execAsync(command, { cwd: dir, timeout: 30_000 })
        return { exitCode: 0, stdout, stderr }
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
        return {
          exitCode: e.code ?? 1,
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? e.message ?? '',
        }
      }
    },
  }
  return { box, dir }
}

/** Write a solution, run the VISIBLE example test + the HELD-OUT suite against it in one
 *  box, and return both pass rates. This is exactly what the dispatch does (minus the
 *  agent turn): seed the visible test during "the turn", then the held-out suite at
 *  grading. We run each test command directly (not the typecheck-gated `runChecks`
 *  pipeline) so the result reflects the TESTS, not the absence of `tsc` offline — the
 *  whole point is to compare visible-pass vs held-out-pass by execution. */
async function gradeSolution(
  scenario: CodingScenario,
  solution: string,
): Promise<{ visiblePassRate: number; heldoutPassRate: number; heldoutNotes: string }> {
  const { box, dir } = tempBox()
  try {
    const cmds = checkCmds(scenario)
    await box.fs?.write(scenario.solutionPath, solution)
    // "During the turn": the visible example test is seeded + run.
    const visible = await runHeldout(
      box,
      { ...scenario, heldoutTest: scenario.visibleTest },
      cmds.dev,
    )
    // "At grading": the held-out suite is seeded + run (the real anti-cheat).
    const heldout = await runHeldout(box, scenario, cmds.heldout)
    return {
      visiblePassRate: visible.passRate,
      heldoutPassRate: heldout.passRate,
      // `HiddenGradeResult.notes` is optional in the substrate type; the coding grader
      // always sets it, so coalesce for the diagnostic message.
      heldoutNotes: heldout.notes ?? '',
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('coding-benchmark (offline)', () => {
  // Integration smoke: runs the real matrix end-to-end (real box.exec on the offline
  // toolchain, all refine rounds since the dev checks can't pass without tsc).
  it('runs the full matrix and returns a defined leaderboard', async () => {
    const reps = 1
    const summary = await main(['--reps', String(reps)])
    expect(summary.records).toBe(harnessProfiles.length * scenarios.length * reps)
    expect(summary.leaderboard).toBe(harnessProfiles.length)
  }, 180_000)

  // THE ANTI-CHEAT, proven by execution: the round-0 hardcode-the-visible cheat PASSES
  // the visible test but FAILS the held-out suite (it never saw those inputs), and the
  // refined real impl PASSES the held-out suite. Composite ranks the real one far above.
  it('a hardcode-the-visible cheat FAILS the held-out tests; the real solution PASSES', async () => {
    const rl = scenarios.find((s) => s.id === 'rate-limiter') as CodingScenario
    const script = offlineAgentScripts['rate-limiter']
    expect(script).toBeDefined()
    const cheat = (script as NonNullable<typeof script>).solutionFor(0) // round-0 cheat
    const real = (script as NonNullable<typeof script>).solutionFor(1) // refined real impl

    const cheatGrade = await gradeSolution(rl, cheat)
    const realGrade = await gradeSolution(rl, real)

    // The cheat memorizes the visible example answers, so it passes the visible test...
    expect(
      cheatGrade.visiblePassRate,
      `cheat should pass the visible test: ${cheatGrade.heldoutNotes}`,
    ).toBe(1)
    // ...but it FAILS the held-out suite (different inputs it never saw).
    expect(
      cheatGrade.heldoutPassRate,
      `cheat should NOT fully pass held-out: ${cheatGrade.heldoutNotes}`,
    ).toBeLessThan(1)

    // The real implementation passes the held-out suite outright.
    expect(
      realGrade.heldoutPassRate,
      `real solution should pass held-out: ${realGrade.heldoutNotes}`,
    ).toBe(1)

    // Composite ranks the real solution strictly above the cheat (held-out is primary).
    // Hold the secondary judge score equal so the gap is purely the held-out term.
    const judgeQuality = 0.8
    const cheatComposite = composeScore(cheatGrade.heldoutPassRate, judgeQuality)
    const realComposite = composeScore(realGrade.heldoutPassRate, judgeQuality)
    expect(realComposite).toBeGreaterThan(cheatComposite)
  }, 60_000)

  // Every scenario's REAL offline solution passes its held-out suite (the suites are not
  // accidentally impossible) — run for real against the in-process box.
  it.each(
    scenarios,
  )('the real offline solution passes the held-out suite for $id', async (scenario: CodingScenario) => {
    const script = offlineAgentScripts[scenario.id]
    expect(script, `no offline solution for ${scenario.id}`).toBeDefined()
    const solution = (script as NonNullable<typeof script>).solutionFor(99) // settled round
    const grade = await gradeSolution(scenario, solution)
    expect(
      grade.heldoutPassRate,
      `real ${scenario.id} failed held-out: ${grade.heldoutNotes}`,
    ).toBe(1)
  }, 60_000)

  // FIREWALL: the held-out test is never seeded into the box during the agent turn —
  // only the visible test is. After running the dev checks (which seed the visible test),
  // the held-out file must NOT exist in the box; it appears only after `runHeldout`.
  it.each(
    scenarios,
  )('does NOT seed the held-out test during the turn for $id', async (scenario: CodingScenario) => {
    const { box, dir } = tempBox()
    try {
      const cmds = checkCmds(scenario)
      const script = offlineAgentScripts[scenario.id] as NonNullable<
        (typeof offlineAgentScripts)[string]
      >
      await box.fs?.write(scenario.solutionPath, script.solutionFor(99))
      // "The turn": run the dev checks, which seed ONLY the visible test.
      await runChecks(box, scenario, cmds)
      // The visible test exists; the held-out test must NOT (the firewall).
      const visibleExists = await box.exec(`test -f '${scenario.visibleTest.path}'`)
      const heldoutExists = await box.exec(`test -f '${scenario.heldoutTest.path}'`)
      expect(visibleExists.exitCode, 'visible test should be seeded during the turn').toBe(0)
      expect(
        heldoutExists.exitCode,
        `held-out test for ${scenario.id} leaked into the box during the turn`,
      ).not.toBe(0)
      // Only AFTER grading does the held-out file appear.
      await runHeldout(box, scenario, cmds.heldout)
      const afterGrading = await box.exec(`test -f '${scenario.heldoutTest.path}'`)
      expect(afterGrading.exitCode, 'held-out should be seeded at grading').toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  // FIREWALL ENFORCEMENT (the agent-eval port): `assertNoHiddenLeak` over the routed fields
  // is real enforcement, not a comment — a clean agent context passes, but the held-out
  // suite's CONTENT inside the context is a breach that THROWS. This is what the dispatch's
  // `gradeOnHidden` re-asserts on real data at grading time.
  it.each(
    scenarios,
  )('the firewall passes a clean context but THROWS when the held-out suite leaks for $id', (scenario: CodingScenario) => {
    const fields = routeCodingFields(scenario)
    // A clean context — only the agent-visible prompt — does not trip the firewall.
    expect(() => assertNoHiddenLeak(fields, scenario.prompt)).not.toThrow()
    // The held-out suite's CONTENT pasted into the context IS a breach → throws loud.
    const leaked = `${scenario.prompt}\n${scenario.heldoutTest.content}`
    expect(
      () => assertNoHiddenLeak(fields, leaked),
      `held-out leak for ${scenario.id} should throw`,
    ).toThrow(/firewall/i)
    // The rubric note (judge-only) leaking is also a breach.
    const rubricLeak = `${scenario.prompt}\n${scenario.rubricNote}`
    expect(
      () => assertNoHiddenLeak(fields, rubricLeak),
      `rubric leak for ${scenario.id} should throw`,
    ).toThrow(/firewall/i)
  })

  it('reps do NOT fake independent n — identical reps leave the CI unchanged', () => {
    // Two harnesses, two scenarios, identical scores. Build records for reps=1 and
    // reps=3 (the extra reps are exact duplicates → zero new information). The honest
    // leaderboard collapses reps to one mean per (harness, scenario), so the CI width
    // and the n must be IDENTICAL across reps — duplicating a sample cannot tighten it.
    const mk = (harness: string, scenarioId: string, s: number): RunRecord =>
      ({
        candidateId: harness,
        scenarioId,
        outcome: { searchScore: s },
      }) as unknown as RunRecord
    const base: Array<[string, string, number]> = [
      ['a', 's1', 0.9],
      ['a', 's2', 0.4],
      ['b', 's1', 0.8],
      ['b', 's2', 0.5],
    ]
    const nameOf = (id: string) => id
    const reps1 = base.map(([h, s, v]) => mk(h, s, v))
    const reps3 = base.flatMap(([h, s, v]) => [mk(h, s, v), mk(h, s, v), mk(h, s, v)])

    const r1 = pairwiseStats(reps1, nameOf)
    const r3 = pairwiseStats(reps3, nameOf)

    for (const harness of ['a', 'b']) {
      const row1 = r1.leaderboard.find((r) => r.harness === harness)
      const row3 = r3.leaderboard.find((r) => r.harness === harness)
      expect(row1).toBeDefined()
      expect(row3).toBeDefined()
      const r1Row = row1 as NonNullable<typeof row1>
      const r3Row = row3 as NonNullable<typeof row3>
      // Same honest n (= distinct scenarios), same mean, and the CI must NOT narrow.
      expect(r3Row.n).toBe(r1Row.n)
      expect(r3Row.meanComposite).toBeCloseTo(r1Row.meanComposite, 10)
      const width1 = r1Row.ci.upper - r1Row.ci.lower
      const width3 = r3Row.ci.upper - r3Row.ci.lower
      expect(width3).toBeCloseTo(width1, 10)
      // The pass-rate Wilson interval likewise must not tighten.
      const pw1 = r1Row.passCi.upper - r1Row.passCi.lower
      const pw3 = r3Row.passCi.upper - r3Row.passCi.lower
      expect(pw3).toBeCloseTo(pw1, 10)
    }
  })
})
