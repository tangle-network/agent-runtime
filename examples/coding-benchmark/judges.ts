/**
 * The JUDGE layer — runs LAST, only on the band the deterministic checks can't
 * resolve (e.g. "it builds and passes tests, but is the design good?").
 *
 * HOW MANY JUDGES:
 *   - default leaderboard sweep → ONE judge (`singleCodeJudge`), one model. Cheap.
 *   - ship/no-ship claim       → THREE judges (`ensembleCodeJudge`), cross-family
 *                                models, reduced by `aggregateJudgeVerdicts` inside
 *                                `ensembleJudge`. `crossFamily: true` forbids three
 *                                models from the same family at construction, so the
 *                                "ensemble" is genuinely independent.
 *
 * THE RUBRIC (4 weighted dimensions, total 1.0):
 *   correctness 0.40 · completeness 0.25 · code_quality 0.20 · robustness 0.15
 * The rubric text + anchors live HERE, with the judge — never in the workdir. The
 * agent is graded against criteria it cannot read.
 *
 * Both judges are campaign `JudgeConfig`s (the shape `runProfileMatrix.judges`
 * takes). There is NO `llmJudge` helper in agent-eval today, so the single judge is
 * a hand-built `JudgeConfig` whose `score()` does one model call; the ensemble is
 * `ensembleJudge(...)`, which already returns a `JudgeConfig`.
 */

import { ensembleJudge } from '@tangle-network/agent-eval'
import type { JudgeConfig, Scenario } from '@tangle-network/agent-eval/campaign'
import type { CodingScenario } from './scenarios'
import type { RunArtifact } from './validators'

/** The rubric: name → (description shown to the judge, weight in the composite). */
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

/** Inject your model caller. `(system, user) → completion`. The default below
 *  calls the Tangle router when `TANGLE_API_KEY` is set; offline it returns a
 *  deterministic stub so the pipeline runs with no creds. */
export type CompleteFn = (system: string, user: string) => Promise<string>

/** The judge's instructions — the rubric anchors. Kept with the judge ONLY. */
function judgeSystemPrompt(): string {
  const dims = dimKeys
    .map((k) => `- ${k} (weight ${rubric[k].weight}): ${rubric[k].description}`)
    .join('\n')
  return [
    'You are a senior code reviewer scoring a candidate solution to a coding task.',
    'Score each dimension from 0 to 1 (1 = excellent). Reply with ONLY JSON:',
    '{"correctness":0.x,"completeness":0.x,"code_quality":0.x,"robustness":0.x,"notes":"..."}',
    '',
    'Dimensions:',
    dims,
  ].join('\n')
}

/** What the judge sees: the produced code + check results + the eval-only rubric
 *  note. (This runs in the harness, not in the agent's box — see the firewall.) */
function judgeUserPrompt(artifact: RunArtifact, scenario: CodingScenario): string {
  return [
    `Task intent: ${scenario.prompt}`,
    `Grading note: ${scenario.rubricNote}`,
    `Deterministic checks — typecheck:${artifact.checks.typecheck.passed} test:${artifact.checks.test.passed} lint:${artifact.checks.lint.passed}`,
    '',
    'Candidate solution:',
    '```ts',
    artifact.solution.slice(0, 8000),
    '```',
  ].join('\n')
}

/** Parse the judge's JSON; fail-closed (a bad response scores 0, never a fake pass). */
function parseScores(raw: string): Record<RubricDim, number> {
  try {
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    const out = {} as Record<RubricDim, number>
    for (const k of dimKeys) {
      const v = Number(json[k])
      out[k] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
    }
    return out
  } catch {
    return Object.fromEntries(dimKeys.map((k) => [k, 0])) as Record<RubricDim, number>
  }
}

function composite(scores: Record<RubricDim, number>): number {
  return dimKeys.reduce((sum, k) => sum + scores[k] * weights[k], 0)
}

/** ── ONE judge ────────────────────────────────────────────────────────────
 *  A hand-built campaign `JudgeConfig` whose `score()` makes a single model call.
 *  `appliesTo` runs it only on coding scenarios (a no-op here, shown for the shape). */
export function singleCodeJudge(complete: CompleteFn): JudgeConfig<RunArtifact, CodingScenario> {
  return {
    name: 'code-quality',
    dimensions: dimKeys.map((k) => ({ key: k, description: rubric[k].description })),
    appliesTo: (s: Scenario) => s.kind === 'coding',
    async score({ artifact, scenario }) {
      const raw = await complete(judgeSystemPrompt(), judgeUserPrompt(artifact, scenario))
      const scores = parseScores(raw)
      return { dimensions: scores, composite: composite(scores), notes: 'single-judge' }
    },
  }
}

/** ── THREE judges ─────────────────────────────────────────────────────────
 *  `ensembleJudge` fans the artifact across N cross-family models in parallel and
 *  reduces surviving verdicts to one `JudgeScore`. A model that throws is excluded,
 *  never folded into a zero. Use this only for a ship/no-ship claim. */
export function ensembleCodeJudge(
  scoreOne: (model: string, code: string, intent: string) => Promise<Record<RubricDim, number>>,
): JudgeConfig<unknown> {
  return ensembleJudge<RubricDim>({
    name: 'code-quality-ensemble',
    dimensions: dimKeys,
    // Three cross-family models — independence enforced at construction.
    models: ['deepseek-chat', 'gpt-4o-mini', 'gemini-flash'],
    crossFamily: true,
    weights,
    scoreWith: async (model, input) => {
      const artifact = input.artifact as RunArtifact
      const scenario = input.scenario as CodingScenario | undefined
      const perDimension = await scoreOne(model, artifact.solution, scenario?.prompt ?? '')
      return { model, perDimension }
    },
  })
}
