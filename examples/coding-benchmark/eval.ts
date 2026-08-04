/**
 * The SCORING stack: dev checks (advisory) → held-out execution (PRIMARY) → LLM judge
 * (secondary), cheapest and most objective first. The README's "How it scores" table is
 * the canonical explanation; the per-function docstrings below cover the local detail.
 * Every layer is a published agent-eval primitive (`MultiLayerVerifier`, `llmJudge`,
 * `ensembleJudge`) — no hand-rolled scorer, and the composite weights held-out
 * correctness over judge style (see `composeScore`).
 */

import {
  blendHeldout,
  type ChatClient,
  ensembleJudge,
  gradeOnHidden,
  type HiddenCriteriaGrader,
  type HiddenGradeResult,
  hiddenGrade,
  type Layer,
  MultiLayerVerifier,
  type RoutedField,
  type VerificationReport,
  withHeldoutBlend,
} from '@tangle-network/agent-eval'
// `llmJudge` + the judge types are imported from the `/campaign` subpath, not the main
// index: they are exported from `/campaign` across the entire declared peer range (>=0.97),
// whereas the main-index re-export is newer — so a consumer pinned to the peer floor still
// compiles. (The hidden-criteria port above is new in >=0.100 and lives at the root only,
// which the devDependency floor now matches.)
import { type JudgeConfig, type JudgeScore, llmJudge } from '@tangle-network/agent-eval/campaign'
import type { CodingScenario, TestFile } from './scenarios'

// ── the composite weighting ───────────────────────────────────────────────────
// Held-out correctness is the PRIMARY, ungameable score; the judge is a secondary
// quality signal. The substrate's `blendHeldout` renormalizes these, so they are a
// ratio: composite = heldout·heldout-pass-rate + judge·judge-quality.
export const blendWeights = { heldout: 0.7, judge: 0.3 } as const

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

/** The judge instructions — the rubric anchors, kept with the judge ONLY. */
const judgePrompt = [
  'You are a senior code reviewer scoring a candidate solution to a coding task.',
  'Score each dimension from 0 to 1 (1 = excellent), using the criteria provided.',
].join(' ')

/** Exact system prompt llmJudge sends after appending its response contract. */
export const codeJudgeSystemPrompt = [
  judgePrompt,
  '',
  'Score the artifact on EACH of these dimensions:',
  ...dimensions.map(
    (dimension) => `  - "${dimension.key}": ${dimension.description} (score 0.0 to 1.0)`,
  ),
  '',
  'Respond with JSON ONLY, no prose. Every dimension is a number in [0.0 to 1.0]:',
  `{"dimensions": {${dimensions.map((dimension) => `"${dimension.key}": <number>`).join(', ')}}, "notes": "<one-line rationale>"}`,
].join('\n')

// ── the held-out result ────────────────────────────────────────────────────────
// The substrate's canonical hidden-criteria grade: { passed, total, passRate, notes? }.
// `passRate` is the PRIMARY correctness score; `hiddenGrade` makes a no-run an honest 0.
export type HeldoutResult = HiddenGradeResult

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

/** Read the held-out pass rate off a run artifact — the seam `withHeldoutBlend` calls to
 *  fold the PRIMARY correctness score into the composite. */
export const heldoutPassRateOf = (artifact: RunArtifact): number => artifact.heldout.passRate

// ── layer 1: the deterministic check pipeline (visible tests) ──────────────────

/** The minimal box surface the checks need — a subset of the real `SandboxInstance`.
 *  The live sandbox satisfies it; the offline in-process box implements it too. `fs.write`
 *  is the structured write seam (both boxes expose it); we prefer it over a shell write so
 *  seeding never interpolates a path into a command string. */
export interface CheckBox {
  exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>
  fs?: { write(path: string, content: string): Promise<unknown> }
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

/** The hidden criteria for a coding task: the held-out test file to seed at grading +
 *  the command to run it. This is the `THidden` payload the grader receives — opaque to
 *  the substrate, owned by the coding domain. */
export interface CodingHiddenCriteria {
  heldoutTest: TestFile
  heldoutCmd: string
}

/**
 * THE DOMAIN GRADER — the coding `HiddenCriteriaGrader` a consumer plugs into
 * `gradeOnHidden`. The substrate bakes in NO node/test/TS/exec/regex; THIS is where the
 * coding execution lives: seed the held-out suite into the box AFTER the loop and run it,
 * then read the pass counts off `node --test`'s output. The score is the held-out PASS
 * RATE — the primary, ungameable correctness number. The agent never saw these tests during
 * the turn (the firewall), so a hardcode-the-visible cheat or a faked impl fails them.
 *
 * `node --test` prints a TAP-ish summary (`# tests N`, `# pass N`, `# fail N`). We parse
 * those counts. A non-zero exit with no parseable counts (a typecheck/import error before
 * any test ran) is a 0/0 → `hiddenGrade` makes that an honest passRate 0, never a spurious
 * pass. The grader runs in the box (the `artifact`), so it sees the agent's real solution.
 */
export function nodeTestGrader(): HiddenCriteriaGrader<CheckBox, CodingHiddenCriteria> {
  return async (box, criteria): Promise<HiddenGradeResult> => {
    await seedFile(box, criteria.heldoutTest)
    const r = await box.exec(criteria.heldoutCmd)
    const output = `${r.stdout}\n${r.stderr}`.trim()
    const { total, pass } = parseTestCounts(output)
    // `hiddenGrade` normalizes: total === 0 (the suite never ran — e.g. the solution
    // didn't typecheck or import) becomes the honest passRate 0, never a spurious pass.
    return hiddenGrade(
      pass,
      total,
      total > 0
        ? `held-out ${pass}/${total} pass`
        : `held-out suite did not run (exit ${r.exitCode})`,
    )
  }
}

/** A pre-built coding grader — one instance reused by every grading call. */
const codingGrader = nodeTestGrader()

/**
 * Run the held-out grader directly (NO firewall — the firewall is `gradeOnHiddenCriteria`,
 * which re-asserts it on real data before grading). This is the bare executor seam: seed
 * the held-out suite, run it, return the `HiddenGradeResult`. Used where the suite to run
 * is supplied explicitly (the smoke test grades the visible suite this way too).
 */
export function runHeldout(
  box: CheckBox,
  scenario: CodingScenario,
  heldoutCmd: string,
): Promise<HiddenGradeResult> {
  return Promise.resolve(codingGrader(box, { heldoutTest: scenario.heldoutTest, heldoutCmd }))
}

/**
 * Grade behind the firewall — the dispatch's grading call. `agent-eval`'s `gradeOnHidden`
 * re-asserts `assertNoHiddenLeak` against the exact agent context the run used (proving, on
 * real data at grading time, that the held-out suite + rubric never reached the agent), THEN
 * runs the coding grader. A breach throws — the firewall is enforcement, not a comment.
 */
export function gradeOnHiddenCriteria(
  box: CheckBox,
  scenario: CodingScenario,
  heldoutCmd: string,
  firewall: { fields: readonly RoutedField[]; agentContext: string },
  signal?: AbortSignal,
): Promise<HiddenGradeResult> {
  return gradeOnHidden<CheckBox, CodingHiddenCriteria>({
    artifact: box,
    hiddenCriteria: { heldoutTest: scenario.heldoutTest, heldoutCmd },
    grader: codingGrader,
    firewall,
    signal,
  })
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
  return withHeldoutComposite(base)
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
  return withHeldoutComposite(base)
}

// ── the composite: held-out correctness (PRIMARY) + judge quality (secondary) ──

/**
 * Blend the PRIMARY held-out pass rate with the SECONDARY judge composite into the final
 * score the leaderboard ranks on — `agent-eval`'s `blendHeldout` (renormalized weights,
 * both inputs clamped to [0,1]). This is what makes held-out execution the load-bearing
 * grade: a solution that fails the held-out suite is capped low no matter how the judge
 * felt about its style, and a stylistically-mediocre but CORRECT solution still scores the
 * bulk of the points. Re-exported under the bench's name so the smoke test reads in the
 * domain's vocabulary.
 */
export function composeScore(heldoutPassRate: number, judgeComposite: number): number {
  return blendHeldout(heldoutPassRate, judgeComposite, blendWeights)
}

/** Wrap a judge so the composite it REPORTS is the held-out-weighted blend — the substrate's
 *  `withHeldoutBlend` does exactly this: the judge still scores its quality dimensions
 *  (recorded, secondary), but the composite downstream selection reads becomes
 *  `blendHeldout(heldoutPassRate(artifact), judgeComposite, weights)`. The held-out pass
 *  rate is read off the artifact via `heldoutPassRateOf` (already computed before the judge
 *  runs), so no second grading pass is needed. We thread it back through a `JudgeConfig` so
 *  the matrix's judge interface is unchanged. */
function withHeldoutComposite(
  judge: JudgeConfig<RunArtifact, CodingScenario>,
): JudgeConfig<RunArtifact, CodingScenario> {
  const blendedScore = withHeldoutBlend<RunArtifact>(
    (input) => judge.score(input as Parameters<typeof judge.score>[0]),
    heldoutPassRateOf,
    blendWeights,
  )
  return {
    ...judge,
    score: (input: { artifact: RunArtifact; scenario: CodingScenario; signal: AbortSignal }) =>
      blendedScore(input) as Promise<JudgeScore>,
  }
}
