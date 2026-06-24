/**
 * The SCORING stack, in the order it runs — cheapest and most objective first.
 *
 *   1. DETERMINISTIC CHECKS (in the box, ~$0) — an ordered `MultiLayerVerifier`
 *      pipeline: typecheck → test → lint, with dependency-based skip (test never
 *      runs on a type error) and a blended score. These pass/fail booleans steer the
 *      refine loop (see the firewall in dispatch.ts).
 *   2. REALNESS GATE (no LLM) — `scoreAuthenticity` + `gateRealness`. Catches a stub
 *      that compiles but fakes the hard part. It does not just record a verdict — it
 *      GATES: a gated artifact short-circuits the judge to composite 0.
 *   3. LLM JUDGE (last, only on the band the checks can't resolve) — one `llmJudge`
 *      model call for the leaderboard, or a cross-family `ensembleJudge` panel for a
 *      ship/no-ship claim. Both see the SAME full context (code + rubric + check
 *      results); the rubric anchors live HERE, never in the agent's workdir.
 *
 * Every layer is a published agent-eval primitive — `MultiLayerVerifier`, `llmJudge`,
 * `ensembleJudge`, `scoreAuthenticity`/`gateRealness`. No hand-rolled scorer.
 */

import {
  type ChatClient,
  ensembleJudge,
  type Layer,
  MultiLayerVerifier,
  type VerificationReport,
} from '@tangle-network/agent-eval'
import {
  type AuthenticitySignals,
  gateRealness,
  type ProducedFile,
  scoreAuthenticity,
} from '@tangle-network/agent-eval/authenticity'
// `llmJudge` is imported from the `/campaign` subpath, not the main index: it is
// exported from `/campaign` across the entire declared peer range (>=0.97), whereas the
// main-index re-export is newer — so a consumer pinned to the peer floor still compiles.
import { type JudgeConfig, type JudgeScore, llmJudge } from '@tangle-network/agent-eval/campaign'
import type { CodingScenario, Fixture } from './scenarios'

// ── the rubric (4 weighted dimensions, total 1.0) ─────────────────────────────
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

// ── the artifact the dispatch produces and the judges score ───────────────────
export interface RunArtifact {
  /** Files the agent produced, as `{ path, content }` — the realness currency. */
  files: ProducedFile[]
  /** The solution file's content (convenience; also present in `files`). */
  solution: string
  /** The agent's final chat text for the round (judge context). */
  finalText: string
  /** The deterministic verifier report from the LAST round. */
  checks: VerificationReport
  /** The realness gate verdict, computed AFTER the loop. Recorded for honesty AND
   *  read by the judge: a gated artifact short-circuits the judge to composite 0. */
  realness: RealnessVerdict
}

export interface RealnessVerdict {
  /** 0..1 deterministic realness (0 when gated). */
  score: number
  /** True when the artifact faked or omitted the required deliverable. */
  gated: boolean
  /** Human-readable flags + gate reason for the record. */
  notes: string
}

// ── layer 1: the deterministic check pipeline ─────────────────────────────────

/** The minimal box surface the checks need — a subset of the real `SandboxInstance`.
 *  The live sandbox satisfies it; the offline in-process box implements it too. `fs.write`
 *  is the structured write seam (both boxes expose it); we prefer it over a shell write so
 *  seeding never interpolates a path into a command string. */
export interface CheckBox {
  exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>
  fs?: { write(path: string, content: string): Promise<void> }
}

/** Seed an eval-only file into the box. Prefers the structured `fs.write` seam so the
 *  fixture path/content is never interpolated into a shell command (no injection
 *  surface for partners who later load scenario paths from config). Falls back to a
 *  base64 shell write with SINGLE-QUOTED path words on a box that only exposes `exec`.
 *  The fixture's CONTENT is never described to the agent — this is write-only scaffold,
 *  not part of the prompt (the firewall). */
async function seedFile(box: CheckBox, file: Fixture): Promise<void> {
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
 * Run the scenario's deterministic checks in the box as an ordered pipeline. Seeds
 * the hidden test first, then typecheck → test → lint. `report.allPass` is true only
 * when typecheck AND test pass (lint is advisory). The `report.layers[*].detail.output`
 * is what the refine loop reads to build the next prompt.
 */
export async function runChecks(
  box: CheckBox,
  scenario: CodingScenario,
  cmds: { typecheck: string; test: string; lint: string },
): Promise<VerificationReport> {
  await seedFile(box, scenario.fixture)
  const verifier = new MultiLayerVerifier<CheckBox>([
    checkLayer('typecheck', cmds.typecheck, {}),
    checkLayer('test', cmds.test, { dependsOn: ['typecheck'] }),
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

// ── layer 2: the realness gate (no LLM) ───────────────────────────────────────

/**
 * Deterministic realness scan. `scoreAuthenticity` is a pure structural scan
 * (required artifact present? hard part implemented? or a fake shim?), and
 * `gateRealness` caps anything that faked or omitted the required artifact. The
 * verdict is recorded AND read by the judge — a gated artifact cannot earn a score.
 *
 * `reference` files (e.g. the seeded test fixture) are passed to the scan as non-scored
 * context: they let `scoreAuthenticity` observe that the required artifact IS imported,
 * so a real solution does not get a spurious `DEAD_ARTIFACT` flag just because the
 * dispatch scores the solution file in isolation. A reference cannot rescue a cheat —
 * the gate still fires on `fakeShim && !realImpl` regardless of what imports it.
 */
export function realnessGate(
  files: ProducedFile[],
  signals: AuthenticitySignals,
  reference: ProducedFile[] = [],
): RealnessVerdict {
  const result = scoreAuthenticity([...files, ...reference], signals)
  const gate = gateRealness(result, { requireArtifact: true })
  const flags = result.flags.length > 0 ? ` — flags: ${result.flags.join(', ')}` : ''
  return {
    score: gate.gated ? 0 : result.realness / 100,
    gated: gate.gated,
    notes: `${gate.gated ? `GATED (${gate.reason ?? 'fake/missing artifact'})` : 'real'}${flags}`,
  }
}

// ── layer 3: the LLM judge(s) ─────────────────────────────────────────────────

/** The judge instructions — the rubric anchors, kept with the judge ONLY. */
const judgePrompt = [
  'You are a senior code reviewer scoring a candidate solution to a coding task.',
  'Score each dimension from 0 to 1 (1 = excellent), using the criteria provided.',
].join(' ')

/** The full context every judge sees: the code + the deterministic check results +
 *  the eval-only rubric note. Shared by the single judge AND the ensemble so the
 *  panel never grades on less information than the leaderboard judge. */
function renderForJudge(artifact: RunArtifact, scenario: CodingScenario): string {
  return [
    `Task intent: ${scenario.prompt}`,
    `Grading note: ${scenario.rubricNote}`,
    `Deterministic checks — typecheck:${layerOutput(artifact.checks, 'typecheck').passed} ` +
      `test:${layerOutput(artifact.checks, 'test').passed} lint:${layerOutput(artifact.checks, 'lint').passed}`,
    `Realness: ${artifact.realness.notes}`,
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
 *  We wrap it so a realness-gated artifact short-circuits to composite 0 WITHOUT a
 *  model call — the realness gate genuinely gates the judge. */
export function singleCodeJudge(chat: ChatClient): JudgeConfig<RunArtifact, CodingScenario> {
  const base = llmJudge<RunArtifact, CodingScenario>('code-quality', judgePrompt, {
    chat,
    dimensions,
    weights,
    scale: 'unit',
    appliesTo: (s) => s.kind === 'coding',
    renderUser: ({ artifact, scenario }) => renderForJudge(artifact, scenario),
  })
  return gatedByRealness(base)
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
  return gatedByRealness(base)
}

/** Wrap a judge so a realness-gated artifact short-circuits to composite 0 with no
 *  model call. This is the gate ACTUALLY gating: a stub that faked the hard part
 *  cannot earn a judge score, however confident the model would have been. */
function gatedByRealness(
  judge: JudgeConfig<RunArtifact, CodingScenario>,
): JudgeConfig<RunArtifact, CodingScenario> {
  return {
    ...judge,
    score(input: {
      artifact: RunArtifact
      scenario: CodingScenario
      signal: AbortSignal
    }): JudgeScore | Promise<JudgeScore> {
      if (input.artifact.realness.gated) {
        return {
          dimensions: Object.fromEntries(dimKeys.map((k) => [k, 0])),
          composite: 0,
          notes: `realness-gated: ${input.artifact.realness.notes}`,
        }
      }
      return judge.score(input)
    },
  }
}
