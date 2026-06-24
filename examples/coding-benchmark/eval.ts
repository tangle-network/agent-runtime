/**
 * The SCORING stack, in the order it runs — cheapest and most objective first.
 *
 *   1. DEV CHECKS (in the box, ~$0) — an ordered `MultiLayerVerifier` pipeline:
 *      typecheck → test(visible) → lint, with dependency-based skip (test never runs on
 *      a type error) and a blended score. These pass/fail booleans steer the refine loop
 *      (see the firewall in dispatch.ts). They are ADVISORY for the final grade: passing
 *      the visible examples does not prove correctness, it just tells the agent it's on
 *      track.
 *   2. HELD-OUT TEST EXECUTION (in the box, after the loop, ~$0) — the PRIMARY,
 *      ungameable correctness score. The hidden test suite (never seeded during the turn)
 *      is copied in and run with `node --experimental-transform-types --test`; the score
 *      is the held-out PASS RATE. A real solution passes; a cheat that hardcoded the
 *      visible examples or faked the hard part FAILS (it never saw these inputs). This is
 *      execution truth, not a text scan.
 *   3. LLM JUDGE (last) — a SECONDARY code-QUALITY signal. One `llmJudge` model call for
 *      the leaderboard, or a cross-family `ensembleJudge` panel for a ship/no-ship claim.
 *      Both see the SAME full context (code + rubric + check results); the rubric anchors
 *      live HERE, never in the agent's workdir.
 *
 * Composite = held-out correctness (PRIMARY) + judge quality (secondary). The anti-cheat
 * is the held-out execution — a hidden suite the agent never saw — not any text scan.
 *
 * Every layer is a published agent-eval primitive — `MultiLayerVerifier`, `llmJudge`,
 * `ensembleJudge`. No hand-rolled scorer.
 */

import {
  type ChatClient,
  ensembleJudge,
  type Layer,
  MultiLayerVerifier,
  type VerificationReport,
} from '@tangle-network/agent-eval'
// `llmJudge` is imported from the `/campaign` subpath, not the main index: it is
// exported from `/campaign` across the entire declared peer range (>=0.97), whereas the
// main-index re-export is newer — so a consumer pinned to the peer floor still compiles.
import { type JudgeConfig, type JudgeScore, llmJudge } from '@tangle-network/agent-eval/campaign'
import type { CodingScenario, TestFile } from './scenarios'

// ── the composite weighting ───────────────────────────────────────────────────
// Held-out correctness is the PRIMARY, ungameable score; the judge is a secondary
// quality signal. composite = heldoutWeight·heldout + judgeWeight·judge.
export const heldoutWeight = 0.7
export const judgeWeight = 0.3

// ── the judge rubric (4 weighted dimensions, total 1.0) ───────────────────────
// The rubric text + anchors live HERE, with the judge — never in the workdir. The
// agent is graded against criteria it cannot read.
export const rubric = {
  correctness: {
    weight: 0.4,
    description: 'Does the code correctly implement the spec for all stated cases?',
  },
  completeness: {
    weight: 0.25,
    description: 'Are all required behaviors and edge cases handled, nothing stubbed?',
  },
  code_quality: {
    weight: 0.2,
    description: 'Is it clear, idiomatic, dependency-free as required, and maintainable?',
  },
  robustness: {
    weight: 0.15,
    description: 'Does it handle malformed / boundary input without crashing or misbehaving?',
  },
} as const

export type RubricDim = keyof typeof rubric
const dimKeys = Object.keys(rubric) as RubricDim[]
const weights = Object.fromEntries(dimKeys.map((k) => [k, rubric[k].weight])) as Record<
  RubricDim,
  number
>
const dimensions = dimKeys.map((k) => ({ key: k, description: rubric[k].description }))

// ── the held-out result ────────────────────────────────────────────────────────
export interface HeldoutResult {
  /** Held-out tests that passed. */
  passed: number
  /** Total held-out tests run. */
  total: number
  /** Pass rate (0..1) — the PRIMARY correctness score. 0 when the suite errored
   *  (typecheck failure, import failure, or no tests ran). */
  passRate: number
  /** Captured runner output (record only). */
  notes: string
}

// ── the artifact the dispatch produces and the judges score ───────────────────
export interface RunArtifact {
  /** The solution file's content. */
  solution: string
  /** The agent's final chat text for the round (judge context). */
  finalText: string
  /** The deterministic dev-check report from the LAST round (visible tests). */
  checks: VerificationReport
  /** The held-out test execution result, run AFTER the loop. The PRIMARY score. */
  heldout: HeldoutResult
}

// ── layer 1: the deterministic check pipeline (visible tests) ──────────────────

/** The minimal box surface the checks need — a subset of the real `SandboxInstance`.
 *  The live sandbox satisfies it; the offline in-process box implements it too. `fs.write`
 *  is the structured write seam (both boxes expose it); we prefer it over a shell write so
 *  seeding never interpolates a path into a command string. */
export interface CheckBox {
  exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>
  fs?: { write(path: string, content: string): Promise<void> }
}

/** Seed a test file into the box. Prefers the structured `fs.write` seam so the path/
 *  content is never interpolated into a shell command (no injection surface for partners
 *  who later load scenario paths from config). Falls back to a base64 shell write with
 *  SINGLE-QUOTED path words on a box that only exposes `exec`. The file's CONTENT is never
 *  described to the agent in the prompt — this is write-only scaffold (the firewall). */
async function seedFile(box: CheckBox, file: TestFile): Promise<void> {
  if (box.fs) {
    await box.fs.write(file.path, file.content)
    return
  }
  const b64 = Buffer.from(file.content, 'utf8').toString('base64')
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.'
  await box.exec(`mkdir -p '${dir}' && printf %s '${b64}' | base64 -d > '${file.path}'`)
}

/** One check command → a `Layer`. Pass/fail comes from the exit code. `advisory`
 *  layers always report `pass` (they ran) and fold their cleanliness into the
 *  blended score without gating `allPass` — that is how lint stays advisory. */
function checkLayer(
  name: string,
  command: string,
  opts: {
    dependsOn?: string[]
    advisory?: boolean
  },
): Layer<CheckBox> {
  return {
    name,
    ...(opts.dependsOn ? { dependsOn: opts.dependsOn } : {}),
    async run({ env: box }) {
      const r = await box.exec(command)
      const ok = r.exitCode === 0
      const output = `${r.stdout}\n${r.stderr}`.trim()
      const findings = ok
        ? []
        : [
            {
              severity: 'major' as const,
              message: `${name} failed`,
              evidence: output.slice(0, 1200),
            },
          ]
      if (opts.advisory) {
        // Always "ran"; cleanliness folds into the blended score, never gates allPass.
        return {
          layer: name,
          status: 'pass' as const,
          score: ok ? 1 : 0.5,
          durationMs: 0,
          findings,
          detail: { output },
        }
      }
      return {
        layer: name,
        status: ok ? ('pass' as const) : ('fail' as const),
        score: ok ? 1 : 0,
        durationMs: 0,
        findings,
        detail: { output },
      }
    },
  }
}

/**
 * Run the scenario's dev checks in the box as an ordered pipeline. Seeds the VISIBLE
 * example test first (the agent may read it, TDD-style), then typecheck → test → lint.
 * `report.allPass` is true only when typecheck AND test pass (lint is advisory). The
 * `report.layers[*].detail.output` is what the refine loop reads to build the next
 * prompt. The HELD-OUT test is NOT seeded here — that is the firewall.
 */
export async function runChecks(
  box: CheckBox,
  scenario: CodingScenario,
  cmds: { typecheck: string; dev: string; lint: string },
): Promise<VerificationReport> {
  await seedFile(box, scenario.visibleTest)
  const verifier = new MultiLayerVerifier<CheckBox>([
    checkLayer('typecheck', cmds.typecheck, {}),
    checkLayer('test', cmds.dev, { dependsOn: ['typecheck'] }),
    checkLayer('lint', cmds.lint, { dependsOn: ['typecheck'], advisory: true }),
  ])
  return verifier.run({ env: box, overallCapMs: 120_000 })
}

/** Pull one check layer's captured output (for the refine prompt). `passed` is the
 *  gating status (advisory layers always report `pass`); `clean` is the layer's real
 *  cleanliness (score === 1) — so the refine prompt can surface advisory lint warnings
 *  (clean === false) without those warnings gating `allPass`. */
export function layerOutput(
  report: VerificationReport,
  layer: string,
): { passed: boolean; clean: boolean; output: string } {
  const r = report.layers.find((l) => l.layer === layer)
  return {
    passed: r?.status === 'pass',
    clean: r ? r.score === 1 : false,
    output: typeof r?.detail?.output === 'string' ? r.detail.output : '',
  }
}

// ── layer 2: held-out test execution (the PRIMARY anti-cheat) ──────────────────

/**
 * Seed the held-out suite into the box AFTER the loop and run it. The score is the
 * held-out PASS RATE — the primary, ungameable correctness number. The agent never saw
 * these tests during the turn (the firewall), so a solution that hardcoded the visible
 * examples or faked the hard part fails them; only real behavior passes.
 *
 * `node --test` prints a TAP-ish summary (`# tests N`, `# pass N`, `# fail N`). We parse
 * those counts. A non-zero exit with no parseable counts (a typecheck/import error before
 * any test ran) is a 0/0 → passRate 0 — the honest "did not even run" signal, never a
 * spurious pass. This runs in the SAME box, so it sees the agent's real solution file.
 */
export async function runHeldout(
  box: CheckBox,
  scenario: CodingScenario,
  heldoutCmd: string,
): Promise<HeldoutResult> {
  await seedFile(box, scenario.heldoutTest)
  const r = await box.exec(heldoutCmd)
  const output = `${r.stdout}\n${r.stderr}`.trim()
  const counts = parseTestCounts(output)
  // No parseable counts means the suite never ran (e.g. the solution didn't typecheck or
  // import) — that is a 0 pass rate, the honest "did not even run" result.
  const total = counts.total
  const passed = counts.pass
  const passRate = total > 0 ? passed / total : 0
  return {
    passed,
    total,
    passRate,
    notes:
      total > 0
        ? `held-out ${passed}/${total} pass`
        : `held-out suite did not run (exit ${r.exitCode})`,
  }
}

/** Parse `node --test`'s summary counts from its output. Reads the `tests`, `pass`, and
 *  `fail` summary lines, which `node --test` prefixes with either `ℹ` (its default
 *  reporter) or `#` (the TAP reporter) and may wrap in ANSI colour. We strip ANSI and
 *  accept both markers. When `tests` is absent we fall back to pass+fail. Returns
 *  {total:0,pass:0} when nothing parseable (the suite never ran) — never guesses a pass. */
function parseTestCounts(output: string): { total: number; pass: number } {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal ANSI escapes
  const clean = output.replace(/\[[0-9;]*m/g, '')
  const read = (label: string): number | undefined => {
    const m = clean.match(new RegExp(`(?:#|\\u2139)\\s*${label}\\s+(\\d+)`))
    return m ? Number(m[1]) : undefined
  }
  const pass = read('pass') ?? 0
  const fail = read('fail') ?? 0
  const tests = read('tests')
  const total = tests ?? pass + fail
  return { total, pass }
}

// ── layer 3: the LLM judge(s) — SECONDARY quality signal ───────────────────────

/** The judge instructions — the rubric anchors, kept with the judge ONLY. */
const judgePrompt = [
  'You are a senior code reviewer scoring a candidate solution to a coding task.',
  'Score each dimension from 0 to 1 (1 = excellent), using the criteria provided.',
].join(' ')

/** The full context every judge sees: the code + the deterministic check results +
 *  the held-out pass rate + the eval-only rubric note. Shared by the single judge AND
 *  the ensemble so the panel never grades on less information than the leaderboard judge. */
function renderForJudge(artifact: RunArtifact, scenario: CodingScenario): string {
  return [
    `Task intent: ${scenario.prompt}`,
    `Grading note: ${scenario.rubricNote}`,
    `Dev checks — typecheck:${layerOutput(artifact.checks, 'typecheck').passed} ` +
      `visible-test:${layerOutput(artifact.checks, 'test').passed} ` +
      `lint:${layerOutput(artifact.checks, 'lint').passed}`,
    `Held-out correctness: ${artifact.heldout.passed}/${artifact.heldout.total} ` +
      `(${(artifact.heldout.passRate * 100).toFixed(0)}%)`,
    '',
    'Candidate solution:',
    '```ts',
    artifact.solution.slice(0, 8000),
    '```',
  ].join('\n')
}

/** ── ONE judge ──────────────────────────────────────────────────────────────
 *  `llmJudge` builds a campaign `JudgeConfig` whose `score()` makes ONE model call
 *  against the rubric and reduces it to a canonical `{ dimensions, composite, notes }`.
 *  The judge's composite is the SECONDARY quality signal; we wrap it with `blendHeldout`
 *  so the composite the matrix RECORDS is the PRIMARY-weighted blend (held-out pass rate
 *  + judge quality). */
export function singleCodeJudge(chat: ChatClient): JudgeConfig<RunArtifact, CodingScenario> {
  const base = llmJudge<RunArtifact, CodingScenario>('code-quality', judgePrompt, {
    chat,
    dimensions,
    weights,
    scale: 'unit',
    appliesTo: (s) => s.kind === 'coding',
    renderUser: ({ artifact, scenario }) => renderForJudge(artifact, scenario),
  })
  return blendHeldout(base)
}

/** ── THREE judges ────────────────────────────────────────────────────────────
 *  `ensembleJudge` fans the artifact across N cross-family models in parallel and
 *  reduces surviving verdicts to one `JudgeScore`. A model that throws is excluded,
 *  never folded into a zero. `crossFamily: true` rejects a same-family panel at
 *  construction. The panel sees the SAME full context as the single judge. */
export function ensembleCodeJudge(
  scoreOne: (model: string, context: string) => Promise<Record<RubricDim, number>>,
): JudgeConfig<RunArtifact, CodingScenario> {
  const base = ensembleJudge<RubricDim>({
    name: 'code-quality-ensemble',
    dimensions: dimKeys,
    // Snapshot-dated, cross-family panel — the SAME reproducibility rule profiles.ts
    // enforces on harness models (a bare alias isn't reproducible: "which gpt-4o-mini?").
    models: [
      'deepseek/deepseek-chat-2025-08-21',
      'openai/gpt-4o-mini-2024-07-18',
      'google/gemini-2.0-flash-2025-02-05',
    ],
    crossFamily: true,
    weights,
    scoreWith: async (model, input) => {
      const artifact = input.artifact as RunArtifact
      const scenario = input.scenario as CodingScenario
      const perDimension = await scoreOne(model, renderForJudge(artifact, scenario))
      return { model, perDimension }
    },
  }) as JudgeConfig<RunArtifact, CodingScenario>
  return blendHeldout(base)
}

// ── the composite: held-out correctness (PRIMARY) + judge quality (secondary) ──

/**
 * Blend the PRIMARY held-out pass rate with the SECONDARY judge composite into the final
 * score the leaderboard ranks on. This is what makes held-out execution the load-bearing
 * grade: a solution that fails the held-out suite is capped low no matter how the judge
 * felt about its style, and a stylistically-mediocre but CORRECT solution still scores
 * the bulk of the points.
 */
export function composeScore(heldoutPassRate: number, judgeComposite: number): number {
  return heldoutWeight * heldoutPassRate + judgeWeight * judgeComposite
}

/** Wrap a judge so the composite it REPORTS is the held-out-weighted blend. The judge
 *  still scores its quality dimensions (recorded, secondary), but the composite the
 *  matrix stamps as the run's score is `composeScore(heldoutPassRate, judgeComposite)` —
 *  so the leaderboard ranks on execution truth first, style second. The artifact is in
 *  scope at score time, so the held-out pass rate (computed before the judge runs) is
 *  read directly off it; no separate stats-side blend is needed. */
function blendHeldout(
  judge: JudgeConfig<RunArtifact, CodingScenario>,
): JudgeConfig<RunArtifact, CodingScenario> {
  return {
    ...judge,
    async score(input: {
      artifact: RunArtifact
      scenario: CodingScenario
      signal: AbortSignal
    }): Promise<JudgeScore> {
      const base = await judge.score(input)
      const heldout = input.artifact.heldout
      const composite = composeScore(heldout.passRate, base.composite)
      return {
        ...base,
        composite,
        notes:
          `composite=${composite.toFixed(3)} ` +
          `(held-out ${(heldout.passRate * 100).toFixed(0)}% × ${heldoutWeight} + ` +
          `quality ${base.composite.toFixed(3)} × ${judgeWeight})` +
          (base.notes ? ` — ${base.notes}` : ''),
      }
    },
  }
}
