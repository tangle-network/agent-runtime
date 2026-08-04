/**
 * Generation v2 of the agent-graphs skill improvement loop — the GATED half of
 * skills/agent-graphs/IMPROVE.md, composed on agent-eval's `runImprovementLoop`.
 *
 * What upstream owns here: the baseline campaign (v1 on TRAIN, reps=3), candidate
 * measurement (v2 on TRAIN, reps=3), the enforced-disjoint holdout scoring of both
 * arms, winner selection, and the gate invocation. What this file owns: the same two
 * closures the baseline run owned (author dispatch + deterministic scorer, imported
 * from agent-graphs-improve.mts), the reviser proposer (glm-5.2, temp 0.7, TRAIN
 * failures only), and the protocol gate:
 *
 *     ship  iff  v2 holdout mean > v1 holdout mean
 *           and  v2 train mean >= v1 train mean - 0.05
 *
 * Split (declared here, enforced by runImprovementLoop's overlap check):
 *   TRAIN   = review-pipeline, single-agent-suffices, cap-as-stop-mistake,
 *             runtime-discovered-fanout
 *   HOLDOUT = mission-in-deliverable, steer-heavy-drafting, unmeasured-harness
 *
 * Holdout hygiene: the revision prompt is built ONLY from TRAIN-case records and the
 * run asserts the holdout ids and briefs are absent from the final prompt string.
 *
 * Run:   pnpm tsx src/agent-graphs-gen2.mts             (from bench/)
 * Smoke: GEN2_SMOKE=1 pnpm tsx src/agent-graphs-gen2.mts   — stubs both LLM calls,
 *        exercises the full loop wiring + gate + report at zero cost.
 *
 * Writes skills/agent-graphs/generations/gen2.json; on ship, replaces SKILL.md with v2.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  runEval,
  runImprovementLoop,
  type CampaignResult,
  type DispatchContext,
  type Gate,
  type GateContext,
  type JudgeConfig,
  type MutableSurface,
  type ProposeContext,
  type ProposedCandidate,
  type SurfaceProposer,
} from '@tangle-network/agent-eval/campaign'
import {
  type AuthoredArtifact,
  type CaseSpec,
  buildAgentGraphsAuthorProfile,
  callAuthor,
  dispatchWithSurface,
  judgeArtifact,
  loadInputs,
} from './agent-graphs-improve.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SKILL_PATH = join(REPO, 'skills', 'agent-graphs', 'SKILL.md')
const OUT_PATH = join(REPO, 'skills', 'agent-graphs', 'generations', 'gen2.json')
const RUNS_ROOT = join(REPO, '.gen2-runs')
const SMOKE = process.env.GEN2_SMOKE === '1'

const K = 3
const SEED = 42
const TRAIN_IDS = [
  'review-pipeline',
  'single-agent-suffices',
  'cap-as-stop-mistake',
  'runtime-discovered-fanout',
] as const
const HOLDOUT_IDS = ['mission-in-deliverable', 'steer-heavy-drafting', 'unmeasured-harness'] as const
// The anti-over-graphing cases an "always graph" hack would regress on.
const DEGENERATE_IDS = ['single-agent-suffices', 'runtime-discovered-fanout'] as const

type GraphScenario = CaseSpec & { kind: 'agent-graph-case' }
/** The dispatch artifact: closure A's output plus the cell coordinates the judge
 *  needs to build per-rep failure records for the proposer. */
type CellArtifact = AuthoredArtifact & { repIndex: number; surfaceSha: string }

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// ── Captured evidence (fed to the proposer; TRAIN-filtered at prompt build) ────

interface JudgedRecord {
  surfaceSha: string
  scenarioId: string
  rep: number
  decision: string
  score: number
  failures: string[]
  validationError?: string
}

const judged: JudgedRecord[] = []

function makeJudge(): JudgeConfig<CellArtifact, GraphScenario> {
  return {
    name: 'deterministic-expect',
    judgeVersion: 'gen2-1',
    dimensions: [{ key: 'expect', description: 'fraction of case expectations satisfied' }],
    score({ artifact, scenario }) {
      const { score, reasons } = judgeArtifact(artifact, scenario)
      judged.push({
        surfaceSha: artifact.surfaceSha,
        scenarioId: scenario.id,
        rep: artifact.repIndex,
        decision: artifact.decision,
        score,
        failures: reasons.filter((r) => !r.startsWith('PASS')),
        ...(artifact.validationError !== undefined ? { validationError: artifact.validationError } : {}),
      })
      return { dimensions: { expect: score }, composite: score, notes: reasons.join('\n') }
    },
  }
}

// ── Dispatch (closure A behind the loop's surface-aware seam) ──────────────────

function smokeArtifact(scenario: GraphScenario): AuthoredArtifact {
  // Deterministic offline stand-in: always "single-agent" — wrong on graph cases,
  // right on the no-graph case; enough to exercise scoring + gate arithmetic.
  return { decision: 'single-agent', reason: `smoke stub for ${scenario.id}`, raw: '{}' }
}

async function dispatchCell(
  surface: MutableSurface,
  scenario: GraphScenario,
  ctx: DispatchContext,
): Promise<CellArtifact> {
  if (typeof surface !== 'string') throw new Error('gen2 surfaces are strings')
  const artifact = SMOKE ? smokeArtifact(scenario) : await dispatchWithSurface(surface, scenario)
  return { ...artifact, repIndex: ctx.rep, surfaceSha: sha256(surface) }
}

// ── The reviser proposer ───────────────────────────────────────────────────────

let revisionPrompt = ''
let revisionPromptSha256 = ''

function buildRevisionPrompt(v1Surface: string, trainCases: GraphScenario[]): string {
  const v1Sha = sha256(v1Surface)
  const caseBlocks = trainCases.map((kase) => {
    const rows = judged
      .filter((r) => r.surfaceSha === v1Sha && r.scenarioId === kase.id)
      .sort((a, b) => a.rep - b.rep)
      .map((r) => {
        const fails = r.failures.length > 0 ? r.failures.join('\n      ') : '(all checks passed)'
        return `  rep ${r.rep}: decision=${r.decision} score=${r.score.toFixed(2)}\n      ${fails}`
      })
    return [`<case id="${kase.id}">`, `brief: ${kase.brief}`, `measured (k=${K}):`, ...rows, '</case>'].join('\n')
  })
  return [
    'You are revising an agent-skill document. The skill below ("v1") instructs a model to author',
    'agent graphs (or decline to) from loose case briefs. It was measured k=3 per case against a',
    'deterministic scorer; the per-rep failures for the training cases are listed after the text.',
    '',
    '<v1-skill>',
    v1Surface,
    '</v1-skill>',
    '',
    'Measured training failures:',
    '',
    ...caseBlocks,
    '',
    'The two failure clusters your revision must target:',
    '1. Analysts never authored when warranted: when independent post-settle findings are required,',
    '   the author omits analyzes edges entirely and merges review into the root.',
    '2. Identical-role parallelism collapsed: when the work is N parallel instances of the same',
    '   role, the author collapses them into one worker node instead of N nodes (one delegation',
    '   edge each), losing the parallelism the brief asked for.',
    '',
    'Rewrite the skill into v2. Hard constraints:',
    '- Keep the YAML frontmatter: `name: agent-graphs` unchanged; `description:` must be a single',
    '  line of at most 96 characters.',
    '- Total file must stay under 20000 bytes.',
    '- Keep the decision honest: "single-agent" and "dynamic-workflow" remain the CORRECT answers',
    '  when one profile suffices or when topology is discovered mid-run. Do not teach "always',
    '  graph" — fixing under-graphing must not create over-graphing.',
    '- Keep the existing correct doctrine (traversal caps, analyzes-cap-is-not-a-stop,',
    '  deliverable-carries-mission, offline proving) — sharpen it, do not delete it.',
    '- The skill is consumed by a model that must output a strict JSON graph spec; keep the text',
    '  operational, not narrative.',
    '',
    'Reply with the COMPLETE revised SKILL.md between the markers, nothing else:',
    '<<<SKILL',
    '(full file here)',
    'SKILL>>>',
  ].join('\n')
}

function extractSkill(reply: string): string {
  const m = reply.match(/<<<SKILL\n([\s\S]*?)\nSKILL>>>/)
  if (!m?.[1]) throw new Error('proposer reply carries no <<<SKILL ... SKILL>>> block')
  return `${m[1].trim()}\n`
}

function validateSkillGate(text: string): string[] {
  const problems: string[] = []
  const fm = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]
  if (!fm) problems.push('missing YAML frontmatter')
  const name = fm?.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  if (name !== 'agent-graphs') problems.push(`frontmatter name is ${JSON.stringify(name)}, expected agent-graphs`)
  const description = fm?.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
  if (!description) problems.push('frontmatter description missing')
  else if (description.length > 96) problems.push(`description is ${description.length} chars (max 96)`)
  if (Buffer.byteLength(text) > 20_000) problems.push(`file is ${Buffer.byteLength(text)} bytes (max 20000)`)
  return problems
}

function makeProposer(v1Surface: string, trainCases: GraphScenario[]): SurfaceProposer {
  const proposerProfile = buildAgentGraphsAuthorProfile(v1Surface, {
    ...process.env,
    AGENT_GRAPHS_AUTHOR_PROFILE_NAME: 'agent-graphs-skill-reviser',
    AGENT_GRAPHS_AUTHOR_SYSTEM_PROMPT:
      'Revise an agent skill from measured development-case failures. Return only the requested artifact.',
  })
  const attemptLimit = Number(process.env.AGENT_GRAPHS_GEN2_PROPOSER_ATTEMPTS ?? 2)
  if (!Number.isSafeInteger(attemptLimit) || attemptLimit <= 0) {
    throw new Error('AGENT_GRAPHS_GEN2_PROPOSER_ATTEMPTS must be a positive integer')
  }
  return {
    kind: 'agent-graphs-skill-reviser',
    async propose(_ctx: ProposeContext): Promise<ProposedCandidate[]> {
      revisionPrompt = buildRevisionPrompt(v1Surface, trainCases)
      // Holdout hygiene is asserted mechanically on the final prompt string.
      for (const id of HOLDOUT_IDS) {
        if (revisionPrompt.includes(id)) throw new Error(`holdout id '${id}' leaked into the revision prompt`)
      }
      const allCases = loadInputs().cases
      for (const id of HOLDOUT_IDS) {
        const brief = allCases.find((c) => c.id === id)?.brief
        if (brief && revisionPrompt.includes(brief)) {
          throw new Error(`holdout brief for '${id}' leaked into the revision prompt`)
        }
      }
      revisionPromptSha256 = sha256(revisionPrompt)
      if (SMOKE) {
        return [
          {
            surface: v1Surface.replace(
              '# Agent graphs',
              '# Agent graphs\n\n(smoke marker: candidate differs from baseline)',
            ),
            label: 'smoke-candidate',
            rationale: 'zero-cost wiring check',
          },
        ]
      }
      let prompt = revisionPrompt
      let lastProblems: string[] = []
      for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
        const reply = await callAuthor(proposerProfile, prompt)
        const skill = extractSkill(reply)
        lastProblems = validateSkillGate(skill)
        if (lastProblems.length === 0) {
          return [
            {
              surface: skill,
              label: 'gen2-revision',
              rationale:
                'glm-5.2 rewrite targeting under-graphing on cheap briefs, missing analyzes edges, and collapsed identical-role parallelism',
            },
          ]
        }
        prompt = `${revisionPrompt}\n\nYour previous attempt violated: ${lastProblems.join('; ')}. Fix these and reply again with the full file between the markers.`
      }
      throw new Error(`proposer surface failed the skills gate after retry: ${lastProblems.join('; ')}`)
    },
  }
}

// ── The protocol gate ──────────────────────────────────────────────────────────

/** Train-side campaigns captured from `analyzeGeneration` so the gate can apply the
 *  train-mean condition (the gate ctx itself only carries the holdout arms). */
const trainMeanBySurfaceSha = new Map<string, number>()

function campaignPerRep(campaign: CampaignResult<CellArtifact, GraphScenario>) {
  const perCase = new Map<string, Array<{ rep: number; score: number; decision: string }>>()
  for (const cell of campaign.cells) {
    const s = cell.judgeScores['deterministic-expect']
    if (!s || s.failed) continue
    const rows = perCase.get(cell.scenarioId) ?? []
    rows.push({ rep: cell.rep, score: s.composite, decision: cell.artifact?.decision ?? 'unknown' })
    perCase.set(cell.scenarioId, rows)
  }
  for (const rows of perCase.values()) rows.sort((a, b) => a.rep - b.rep)
  return perCase
}

/** Split mean per protocol: mean over cases of the per-case rep means. */
function splitMean(perCase: Map<string, Array<{ score: number }>>, ids: readonly string[]): number {
  const caseMeans = ids.map((id) => {
    const rows = perCase.get(id) ?? []
    return rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.score, 0) / rows.length
  })
  return caseMeans.reduce((s, x) => s + x, 0) / Math.max(caseMeans.length, 1)
}

function holdoutMeanFromScores(scores: Map<string, Record<string, import('@tangle-network/agent-eval/campaign').JudgeScore>>): number {
  const values: number[] = []
  for (const byJudge of scores.values()) {
    const s = byJudge['deterministic-expect']
    if (s && !s.failed) values.push(s.composite)
  }
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

function makeGate(v1Sha: string): Gate<CellArtifact, GraphScenario> {
  return {
    name: 'gen2-protocol-gate',
    async decide(ctx: GateContext<CellArtifact, GraphScenario>) {
      const winnerHoldout = holdoutMeanFromScores(ctx.judgeScores)
      const baselineHoldout = ctx.baselineJudgeScores ? holdoutMeanFromScores(ctx.baselineJudgeScores) : 0
      const v1Train = trainMeanBySurfaceSha.get(v1Sha)
      const candidateShas = [...trainMeanBySurfaceSha.keys()].filter((k) => k !== v1Sha)
      const v2Train = candidateShas.length === 1 ? trainMeanBySurfaceSha.get(candidateShas[0] ?? '') : undefined
      const holdoutOk = winnerHoldout > baselineHoldout
      const trainOk = v1Train !== undefined && v2Train !== undefined && v2Train >= v1Train - 0.05
      const ship = holdoutOk && trainOk
      return {
        decision: ship ? ('ship' as const) : ('hold' as const),
        delta: winnerHoldout - baselineHoldout,
        reasons: [
          `holdout: winner ${winnerHoldout.toFixed(3)} vs baseline ${baselineHoldout.toFixed(3)} → ${holdoutOk ? 'pass' : 'fail'}`,
          `train: v2 ${v2Train?.toFixed(3) ?? 'unmeasured'} vs v1 ${v1Train?.toFixed(3) ?? 'unmeasured'} - 0.05 → ${trainOk ? 'pass' : 'fail'}`,
        ],
        contributingGates: [
          { name: 'holdout-mean-strictly-better', status: holdoutOk ? 'pass' : 'fail', detail: { winnerHoldout, baselineHoldout } },
          { name: 'train-mean-within-0.05', status: trainOk ? 'pass' : 'fail', detail: { v2Train, v1Train } },
        ],
      }
    },
  }
}

// ── The run ────────────────────────────────────────────────────────────────────

interface RepRow {
  rep: number
  score: number
  decision: string
}

function tableFor(perCase: Map<string, RepRow[]>, ids: readonly string[]): Record<string, RepRow[]> {
  return Object.fromEntries(ids.map((id) => [id, perCase.get(id) ?? []]))
}

function printSplit(label: string, perCase: Map<string, RepRow[]>, ids: readonly string[]): void {
  console.log(`  ${label}:`)
  for (const id of ids) {
    const rows = perCase.get(id) ?? []
    const reps = rows.map((r) => r.score.toFixed(2)).join(' ')
    const mean = rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.score, 0) / rows.length
    console.log(`    ${id.padEnd(28)} reps=[${reps}] mean=${mean.toFixed(3)}`)
  }
  console.log(`    split mean = ${splitMean(perCase, ids).toFixed(4)}`)
}

async function main(): Promise<void> {
  const inputs = loadInputs()
  const v1Surface = inputs.surface
  const v1Sha = sha256(v1Surface)
  const byId = new Map(inputs.cases.map((c) => [c.id, c]))
  const missing = [...TRAIN_IDS, ...HOLDOUT_IDS].filter((id) => !byId.has(id))
  if (missing.length > 0) throw new Error(`cases missing from skills/agent-graphs/cases: ${missing.join(', ')}`)
  if (TRAIN_IDS.length + HOLDOUT_IDS.length !== inputs.cases.length) {
    throw new Error(`split covers ${TRAIN_IDS.length + HOLDOUT_IDS.length} of ${inputs.cases.length} cases`)
  }
  const toScenario = (id: string): GraphScenario => ({ ...(byId.get(id) as CaseSpec), kind: 'agent-graph-case' })
  const trainScenarios = TRAIN_IDS.map(toScenario)
  const holdoutScenarios = HOLDOUT_IDS.map(toScenario)

  console.log(
    `gen2 ${SMOKE ? '(SMOKE) ' : ''}v1=${v1Sha.slice(0, 12)} (${v1Surface.length} chars, ${inputs.source}); train=${TRAIN_IDS.length} holdout=${HOLDOUT_IDS.length} k=${K}`,
  )

  const runDir = join(RUNS_ROOT, SMOKE ? 'smoke-loop' : 'loop')
  mkdirSync(runDir, { recursive: true })

  const result = await runImprovementLoop<GraphScenario, CellArtifact>({
    scenarios: trainScenarios,
    holdoutScenarios,
    reps: K,
    seed: SEED,
    maxConcurrency: 1,
    candidateConcurrency: 1,
    populationSize: 1,
    maxGenerations: 1,
    baselineSurface: v1Surface,
    dispatchRef: SMOKE ? 'gen2-smoke-stub' : 'agent-graphs-author/glm-5.2/temp-0.2',
    dispatchWithSurface: dispatchCell,
    dispatchTimeoutMs: 600_000,
    expectUsage: 'off',
    judges: [makeJudge()],
    proposer: makeProposer(v1Surface, trainScenarios),
    analyzeGeneration: async ({ candidates }) => {
      // Capture every train-side mean by surface so the gate can apply the
      // protocol's train condition; findings stay untouched.
      for (const c of candidates) {
        const perCase = campaignPerRep(c.campaign)
        const sha = firstCellSurfaceSha(c.campaign)
        if (sha !== undefined) trainMeanBySurfaceSha.set(sha, splitMean(perCase, TRAIN_IDS))
      }
      return []
    },
    gate: makeGate(v1Sha),
    autoOnPromote: 'none',
    runDir,
  })

  // ── Assemble the four arms ──
  const v1Train = campaignPerRep(result.baselineCampaign)
  const candidateGen = result.generations[0]?.surfaces[0]
  if (!candidateGen) throw new Error('loop produced no generation-0 candidate campaign')
  const v2Surface = candidateGen.surface
  if (typeof v2Surface !== 'string') throw new Error('candidate surface is not a string')
  const v2Sha = sha256(v2Surface)
  const v2Train = campaignPerRep(candidateGen.campaign)
  const v1Holdout = campaignPerRep(result.baselineOnHoldout)

  // When the upstream winner-selection kept the baseline (candidate did not strictly
  // beat v1 on train mean), `winnerOnHoldout` is the baseline arm — the protocol still
  // requires v2 measured on holdout, so score it with the same judge/reps/seed.
  const winnerIsCandidate = result.winnerSurfaceHash !== undefined && result.winnerSurface === v2Surface
  let v2HoldoutCampaign: CampaignResult<CellArtifact, GraphScenario>
  if (winnerIsCandidate) {
    v2HoldoutCampaign = result.winnerOnHoldout
  } else {
    console.log('upstream winner = baseline; measuring v2 on holdout via runEval for the protocol gate')
    v2HoldoutCampaign = await runEval<GraphScenario, CellArtifact>({
      scenarios: holdoutScenarios,
      dispatch: (scenario, ctx) => dispatchCell(v2Surface, scenario, ctx),
      dispatchRef: SMOKE ? 'gen2-smoke-stub-v2' : 'agent-graphs-author/glm-5.2/temp-0.2/v2',
      judges: [makeJudge()],
      reps: K,
      seed: SEED,
      maxConcurrency: 1,
      dispatchTimeoutMs: 600_000,
      expectUsage: 'off',
      runDir: join(RUNS_ROOT, SMOKE ? 'smoke-v2-holdout' : 'v2-holdout'),
    })
  }
  const v2Holdout = campaignPerRep(v2HoldoutCampaign)

  // ── Protocol gate, applied to the assembled arms ──
  const v1TrainMean = splitMean(v1Train, TRAIN_IDS)
  const v2TrainMean = splitMean(v2Train, TRAIN_IDS)
  const v1HoldoutMean = splitMean(v1Holdout, HOLDOUT_IDS)
  const v2HoldoutMean = splitMean(v2Holdout, HOLDOUT_IDS)
  const promoted = v2HoldoutMean > v1HoldoutMean && v2TrainMean >= v1TrainMean - 0.05
  const gateVerdict = promoted ? 'ship' : 'hold'

  const caseMean = (perCase: Map<string, RepRow[]>, id: string): number => {
    const rows = perCase.get(id) ?? []
    return rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.score, 0) / rows.length
  }
  const degenerate = Object.fromEntries(
    DEGENERATE_IDS.map((id) => [id, { v1: caseMean(v1Train, id), v2: caseMean(v2Train, id) }]),
  )

  console.log('\nv1 (baseline surface):')
  printSplit('train', v1Train, TRAIN_IDS)
  printSplit('holdout', v1Holdout, HOLDOUT_IDS)
  console.log('v2 (revised surface):')
  printSplit('train', v2Train, TRAIN_IDS)
  printSplit('holdout', v2Holdout, HOLDOUT_IDS)
  console.log(`\ndegenerate check (anti-over-graphing cases, v1 → v2): ${JSON.stringify(degenerate)}`)
  console.log(`upstream gate: ${result.gateResult.decision} [${result.gateResult.reasons.join(' | ')}]`)
  console.log(`protocol gate: ${gateVerdict} (holdout ${v1HoldoutMean.toFixed(3)} → ${v2HoldoutMean.toFixed(3)}, train ${v1TrainMean.toFixed(3)} → ${v2TrainMean.toFixed(3)})`)

  const out = {
    generation: 2,
    date: new Date().toISOString(),
    smoke: SMOKE,
    authorModel: 'glm-5.2',
    authorTemperature: 0.2,
    proposerModel: 'glm-5.2',
    proposerTemperature: 0.7,
    split: { train: TRAIN_IDS, holdout: HOLDOUT_IDS },
    k: K,
    seed: SEED,
    surfaces: { v1Sha256: v1Sha, v2Sha256: v2Sha, v2Label: candidateGen.campaign ? result.generations[0]?.record.candidates[0]?.label : undefined },
    perCase: {
      v1: { train: tableFor(v1Train, TRAIN_IDS), holdout: tableFor(v1Holdout, HOLDOUT_IDS) },
      v2: { train: tableFor(v2Train, TRAIN_IDS), holdout: tableFor(v2Holdout, HOLDOUT_IDS) },
    },
    aggregates: {
      v1: { trainMean: v1TrainMean, holdoutMean: v1HoldoutMean },
      v2: { trainMean: v2TrainMean, holdoutMean: v2HoldoutMean },
    },
    degenerateCheck: degenerate,
    upstreamGate: result.gateResult,
    upstreamWinnerWasCandidate: winnerIsCandidate,
    gateVerdict,
    promoted,
    revisionPromptSha256,
    v2Surface,
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`written: ${OUT_PATH}`)

  if (promoted && !SMOKE) {
    writeFileSync(SKILL_PATH, v2Surface)
    console.log(`promoted: ${SKILL_PATH} replaced with v2 (${v2Sha.slice(0, 12)})`)
  }
}

function firstCellSurfaceSha(campaign: CampaignResult<CellArtifact, GraphScenario>): string | undefined {
  for (const cell of campaign.cells) {
    const sha = cell.artifact?.surfaceSha
    if (typeof sha === 'string') return sha
  }
  return undefined
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
