/**
 * Generation v3 of the agent-graphs skill improvement loop — same composition as
 * agent-graphs-gen2.mts (agent-eval's `runImprovementLoop` + the two caller closures
 * from agent-graphs-improve.mts), with the gen3 protocol deltas:
 *
 *   • baseline surface is the PROMOTED v2 SKILL.md (sha asserted at startup);
 *   • TRAIN grew to 7 cases (the 5 prior + artifact-mission-release-notes and
 *     audited-single-writer, both targeting the residual mission-in-deliverable
 *     under-graphing cluster); HOLDOUT is unchanged and never enters the prompt;
 *   • k=5 reps per case per surface, sequential, author temp 0.2;
 *   • transient router 5xx: bounded per-cell retry (up to 3, receipts kept) BEFORE a
 *     cell is declared failed — the #723 workaround for the gen2 503 cell loss;
 *   • the revision prompt carries ONLY the measured k=5 v2 TRAIN failures plus a
 *     mechanical per-check failure tally — no inherited failure-cluster narrative.
 *
 * Gate:  ship  iff  v3 holdout mean >  v2 holdout mean
 *              and  v3 train  mean >= v2 train mean - 0.05
 *              and  neither anti-over-graphing case regresses
 *                   (single-agent-suffices, runtime-discovered-fanout).
 *
 * Run:   pnpm tsx src/agent-graphs-gen3.mts             (from bench/)
 * Smoke: GEN3_SMOKE=1 pnpm tsx src/agent-graphs-gen3.mts   — stubs both LLM calls;
 *        writes into .gen3-runs/ only, never the tracked artifact.
 *
 * Writes skills/agent-graphs/generations/gen3.json; on ship, replaces SKILL.md with v3.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
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
const OUT_PATH = join(REPO, 'skills', 'agent-graphs', 'generations', 'gen3.json')
const RUNS_ROOT = join(REPO, '.gen3-runs')
const SMOKE = process.env.GEN3_SMOKE === '1'
// Smoke runs must never clobber the tracked generation record.
const EFFECTIVE_OUT = SMOKE ? join(RUNS_ROOT, 'gen3-smoke.json') : OUT_PATH

// The promoted v2 surface this generation improves on (generations/gen2.json surfaces.v2Sha256).
const EXPECTED_V2_SHA = '4c6615b6164f6c5a86efb2596556bdf325d33f08a4e1715cae9d71cb28b6255e'

const K = 5
const SEED = 42
const TRAIN_IDS = [
  'review-pipeline',
  'single-agent-suffices',
  'cap-as-stop-mistake',
  'runtime-discovered-fanout',
  'artifact-mission-release-notes',
  'audited-single-writer',
] as const
const HOLDOUT_IDS = ['mission-in-deliverable', 'steer-heavy-drafting', 'unmeasured-harness'] as const
// The anti-over-graphing cases an "always graph" hack would regress on.
const DEGENERATE_IDS = ['single-agent-suffices', 'runtime-discovered-fanout'] as const
// Holdout-brief phrases that must never reach the reviser (belt over the whole-brief check).
const BANNED_PROMPT_STRINGS = ['CHANGELOG', 'redirect it up to five times', 'three probes on claude-code'] as const

type GraphScenario = CaseSpec & { kind: 'agent-graph-case' }
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
    judgeVersion: 'gen3-1',
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

// ── Dispatch: closure A + the bounded transient-retry policy (#723 workaround) ─

const MAX_TRANSIENT_RETRIES = 3
const TRANSIENT_PATTERN =
  /HTTP 5\d\d|platform_unreachable|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket|TimeoutError|aborted|empty content/i

interface RetryReceipt {
  surfaceSha12: string
  scenarioId: string
  rep: number
  attempt: number
  error: string
  at: string
}

interface CellFailure {
  surfaceSha12: string
  scenarioId: string
  rep: number
  attempts: number
  error: string
}

const retryReceipts: RetryReceipt[] = []
const cellFailures: CellFailure[] = []

function smokeArtifact(scenario: GraphScenario): AuthoredArtifact {
  return { decision: 'single-agent', reason: `smoke stub for ${scenario.id}`, raw: '{}' }
}

async function dispatchCell(
  surface: MutableSurface,
  scenario: GraphScenario,
  ctx: DispatchContext,
): Promise<CellArtifact> {
  if (typeof surface !== 'string') throw new Error('gen3 surfaces are strings')
  const surfaceSha = sha256(surface)
  let lastErr: unknown
  for (let attempt = 1; attempt <= 1 + MAX_TRANSIENT_RETRIES; attempt += 1) {
    try {
      const artifact = SMOKE ? smokeArtifact(scenario) : await dispatchWithSurface(surface, scenario)
      return { ...artifact, repIndex: ctx.rep, surfaceSha }
    } catch (err) {
      lastErr = err
      const message = err instanceof Error ? err.message : String(err)
      const transient = TRANSIENT_PATTERN.test(message)
      if (!transient || attempt > MAX_TRANSIENT_RETRIES) break
      retryReceipts.push({
        surfaceSha12: surfaceSha.slice(0, 12),
        scenarioId: scenario.id,
        rep: ctx.rep,
        attempt,
        error: message.slice(0, 300),
        at: new Date().toISOString(),
      })
      await sleep(5_000 * attempt)
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr)
  cellFailures.push({
    surfaceSha12: surfaceSha.slice(0, 12),
    scenarioId: scenario.id,
    rep: ctx.rep,
    attempts: Math.min(1 + MAX_TRANSIENT_RETRIES, retryReceipts.filter((r) => r.scenarioId === scenario.id && r.rep === ctx.rep && r.surfaceSha12 === surfaceSha.slice(0, 12)).length + 1),
    error: message.slice(0, 300),
  })
  throw lastErr
}

// ── The reviser proposer (prompt = v2 text + measured k=5 TRAIN failures ONLY) ─

let revisionPrompt = ''
let revisionPromptSha256 = ''

function failKey(line: string): string {
  return line.match(/^FAIL ([^:]+):/)?.[1] ?? line.split(':')[0] ?? line.slice(0, 40)
}

/** Mechanical per-case tally of failing checks in the baseline's TRAIN measurements. */
function tallyTrainFailures(baselineSha: string): Record<string, Record<string, number>> {
  const tally: Record<string, Record<string, number>> = {}
  for (const r of judged) {
    if (r.surfaceSha !== baselineSha) continue
    if (!(TRAIN_IDS as readonly string[]).includes(r.scenarioId)) continue
    for (const f of r.failures) {
      const key = failKey(f)
      tally[r.scenarioId] = tally[r.scenarioId] ?? {}
      tally[r.scenarioId][key] = (tally[r.scenarioId][key] ?? 0) + 1
    }
  }
  return tally
}

function buildRevisionPrompt(v2Surface: string, trainCases: GraphScenario[]): string {
  const v2Sha = sha256(v2Surface)
  const caseBlocks = trainCases.map((kase) => {
    const rows = judged
      .filter((r) => r.surfaceSha === v2Sha && r.scenarioId === kase.id)
      .sort((a, b) => a.rep - b.rep)
      .map((r) => {
        const fails = r.failures.length > 0 ? r.failures.join('\n      ') : '(all checks passed)'
        return `  rep ${r.rep}: decision=${r.decision} score=${r.score.toFixed(2)}\n      ${fails}`
      })
    return [`<case id="${kase.id}">`, `brief: ${kase.brief}`, `measured (k=${K}):`, ...rows, '</case>'].join('\n')
  })
  const tally = tallyTrainFailures(v2Sha)
  const tallyLines = trainCases.map((kase) => {
    const byKey = tally[kase.id]
    if (!byKey || Object.keys(byKey).length === 0) return `  ${kase.id}: clean (no failing checks)`
    const parts = Object.entries(byKey)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => `${key} failed ${count}/${K} reps`)
    return `  ${kase.id}: ${parts.join(', ')}`
  })
  return [
    'You are revising an agent-skill document. The skill below ("v2") instructs a model to author',
    `agent graphs (or decline to) from loose case briefs. It was measured k=${K} per case against a`,
    'deterministic scorer; the per-rep results for the training cases are listed after the text.',
    '',
    '<v2-skill>',
    v2Surface,
    '</v2-skill>',
    '',
    'Measured training results:',
    '',
    ...caseBlocks,
    '',
    'Mechanical failure tally (check -> failed reps, from the measurements above; this tally is the',
    'ONLY ground truth about what is failing — do not assume any earlier generation\'s failure',
    'clusters still hold):',
    ...tallyLines,
    '',
    'Rewrite the skill into v3 targeting exactly the failing checks in the tally. For each failing',
    'check, find the doctrine gap that lets the author fail it and close that gap. Leave the clean',
    'cases\' behavior alone.',
    '',
    'Hard constraints:',
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

function assertNoHoldoutLeak(prompt: string): void {
  for (const id of HOLDOUT_IDS) {
    if (prompt.includes(id)) throw new Error(`holdout id '${id}' leaked into the revision prompt`)
  }
  const allCases = loadInputs().cases
  for (const id of HOLDOUT_IDS) {
    const brief = allCases.find((c) => c.id === id)?.brief
    if (brief && prompt.includes(brief)) {
      throw new Error(`holdout brief for '${id}' leaked into the revision prompt`)
    }
  }
  for (const phrase of BANNED_PROMPT_STRINGS) {
    if (prompt.includes(phrase)) {
      throw new Error(`banned holdout phrase '${phrase}' leaked into the revision prompt`)
    }
  }
}

function makeProposer(v2Surface: string, trainCases: GraphScenario[]): SurfaceProposer {
  return {
    kind: 'agent-graphs-skill-reviser',
    async propose(_ctx: ProposeContext): Promise<ProposedCandidate[]> {
      revisionPrompt = buildRevisionPrompt(v2Surface, trainCases)
      assertNoHoldoutLeak(revisionPrompt)
      revisionPromptSha256 = sha256(revisionPrompt)
      if (SMOKE) {
        return [
          {
            surface: v2Surface.replace(
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
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reply = await callAuthor(buildAgentGraphsAuthorProfile(v2Surface), prompt)
        const skill = extractSkill(reply)
        lastProblems = validateSkillGate(skill)
        if (lastProblems.length === 0) {
          return [
            {
              surface: skill,
              label: 'gen3-revision',
              rationale: 'glm-5.2 rewrite targeting the k=5-measured failing checks on the 7 train cases',
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

const trainMeanBySurfaceSha = new Map<string, number>()
const trainCaseMeansBySurfaceSha = new Map<string, Map<string, number>>()

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

/** Worst-case split mean: every missing rep of every case scored as 0 (denominator K). */
function splitMeanImputedZero(perCase: Map<string, Array<{ score: number }>>, ids: readonly string[]): number {
  const caseMeans = ids.map((id) => {
    const rows = perCase.get(id) ?? []
    return rows.reduce((s, r) => s + r.score, 0) / K
  })
  return caseMeans.reduce((s, x) => s + x, 0) / Math.max(caseMeans.length, 1)
}

function holdoutMeanFromScores(
  scores: Map<string, Record<string, import('@tangle-network/agent-eval/campaign').JudgeScore>>,
): number {
  const values: number[] = []
  for (const byJudge of scores.values()) {
    const s = byJudge['deterministic-expect']
    if (s && !s.failed) values.push(s.composite)
  }
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

function makeGate(v2Sha: string): Gate<CellArtifact, GraphScenario> {
  return {
    name: 'gen3-protocol-gate',
    async decide(ctx: GateContext<CellArtifact, GraphScenario>) {
      const winnerHoldout = holdoutMeanFromScores(ctx.judgeScores)
      const baselineHoldout = ctx.baselineJudgeScores ? holdoutMeanFromScores(ctx.baselineJudgeScores) : 0
      const v2Train = trainMeanBySurfaceSha.get(v2Sha)
      const candidateShas = [...trainMeanBySurfaceSha.keys()].filter((k) => k !== v2Sha)
      const v3Train = candidateShas.length === 1 ? trainMeanBySurfaceSha.get(candidateShas[0] ?? '') : undefined
      const v2Cases = trainCaseMeansBySurfaceSha.get(v2Sha)
      const v3Cases = candidateShas.length === 1 ? trainCaseMeansBySurfaceSha.get(candidateShas[0] ?? '') : undefined
      const holdoutOk = winnerHoldout > baselineHoldout
      const trainOk = v2Train !== undefined && v3Train !== undefined && v3Train >= v2Train - 0.05
      const degenerateOk =
        v2Cases !== undefined &&
        v3Cases !== undefined &&
        DEGENERATE_IDS.every((id) => (v3Cases.get(id) ?? 0) >= (v2Cases.get(id) ?? 0))
      const ship = holdoutOk && trainOk && degenerateOk
      return {
        decision: ship ? ('ship' as const) : ('hold' as const),
        delta: winnerHoldout - baselineHoldout,
        reasons: [
          `holdout: winner ${winnerHoldout.toFixed(3)} vs baseline ${baselineHoldout.toFixed(3)} → ${holdoutOk ? 'pass' : 'fail'}`,
          `train: v3 ${v3Train?.toFixed(3) ?? 'unmeasured'} vs v2 ${v2Train?.toFixed(3) ?? 'unmeasured'} - 0.05 → ${trainOk ? 'pass' : 'fail'}`,
          `degenerate cases non-regression → ${degenerateOk ? 'pass' : 'fail'}`,
        ],
        contributingGates: [
          { name: 'holdout-mean-strictly-better', status: holdoutOk ? 'pass' : 'fail', detail: { winnerHoldout, baselineHoldout } },
          { name: 'train-mean-within-0.05', status: trainOk ? 'pass' : 'fail', detail: { v3Train, v2Train } },
          { name: 'anti-over-graphing-non-regression', status: degenerateOk ? 'pass' : 'fail', detail: { degenerateIds: [...DEGENERATE_IDS] } },
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
    console.log(`    ${id.padEnd(32)} reps=[${reps}] mean=${mean.toFixed(3)}`)
  }
  console.log(`    split mean = ${splitMean(perCase, ids).toFixed(4)}`)
}

function firstCellSurfaceSha(campaign: CampaignResult<CellArtifact, GraphScenario>): string | undefined {
  for (const cell of campaign.cells) {
    const sha = cell.artifact?.surfaceSha
    if (typeof sha === 'string') return sha
  }
  return undefined
}

async function main(): Promise<void> {
  const inputs = loadInputs()
  const v2Surface = inputs.surface
  const v2Sha = sha256(v2Surface)
  if (!SMOKE && v2Sha !== EXPECTED_V2_SHA) {
    throw new Error(
      `working-tree SKILL.md sha ${v2Sha.slice(0, 12)} != promoted v2 ${EXPECTED_V2_SHA.slice(0, 12)}; gen3 must start from the promoted v2 surface`,
    )
  }
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
    `gen3 ${SMOKE ? '(SMOKE) ' : ''}v2=${v2Sha.slice(0, 12)} (${v2Surface.length} chars, ${inputs.source}); train=${TRAIN_IDS.length} holdout=${HOLDOUT_IDS.length} k=${K}`,
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
    baselineSurface: v2Surface,
    dispatchRef: SMOKE ? 'gen3-smoke-stub' : 'agent-graphs-author/glm-5.2/temp-0.2',
    dispatchWithSurface: dispatchCell,
    // Room for the worst retry ladder: 4 author attempts x (2x240s) + backoffs.
    dispatchTimeoutMs: 2_400_000,
    expectUsage: 'off',
    judges: [makeJudge()],
    proposer: makeProposer(v2Surface, trainScenarios),
    analyzeGeneration: async ({ candidates }) => {
      for (const c of candidates) {
        const perCase = campaignPerRep(c.campaign)
        const sha = firstCellSurfaceSha(c.campaign)
        if (sha !== undefined) {
          trainMeanBySurfaceSha.set(sha, splitMean(perCase, TRAIN_IDS))
          trainCaseMeansBySurfaceSha.set(
            sha,
            new Map(
              TRAIN_IDS.map((id) => {
                const rows = perCase.get(id) ?? []
                return [id, rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.score, 0) / rows.length]
              }),
            ),
          )
        }
      }
      return []
    },
    gate: makeGate(v2Sha),
    autoOnPromote: 'none',
    runDir,
  })

  // ── Assemble the four arms ──
  const v2Train = campaignPerRep(result.baselineCampaign)
  const candidateGen = result.generations[0]?.surfaces[0]
  if (!candidateGen) throw new Error('loop produced no generation-0 candidate campaign')
  const v3Surface = candidateGen.surface
  if (typeof v3Surface !== 'string') throw new Error('candidate surface is not a string')
  const v3Sha = sha256(v3Surface)
  const v3Train = campaignPerRep(candidateGen.campaign)
  const v2Holdout = campaignPerRep(result.baselineOnHoldout)

  // When upstream winner-selection kept the baseline (e.g. the coverage/no-op guard),
  // the protocol still requires v3 measured on holdout: same judge, reps, seed.
  const winnerIsCandidate = result.winnerSurfaceHash !== undefined && result.winnerSurface === v3Surface
  let v3HoldoutCampaign: CampaignResult<CellArtifact, GraphScenario>
  if (winnerIsCandidate) {
    v3HoldoutCampaign = result.winnerOnHoldout
  } else {
    console.log('upstream winner = baseline; measuring v3 on holdout via runEval for the protocol gate')
    v3HoldoutCampaign = await runEval<GraphScenario, CellArtifact>({
      scenarios: holdoutScenarios,
      dispatch: (scenario, ctx) => dispatchCell(v3Surface, scenario, ctx),
      dispatchRef: SMOKE ? 'gen3-smoke-stub-v3' : 'agent-graphs-author/glm-5.2/temp-0.2/v3',
      judges: [makeJudge()],
      reps: K,
      seed: SEED,
      maxConcurrency: 1,
      dispatchTimeoutMs: 2_400_000,
      expectUsage: 'off',
      runDir: join(RUNS_ROOT, SMOKE ? 'smoke-v3-holdout' : 'v3-holdout'),
    })
  }
  const v3Holdout = campaignPerRep(v3HoldoutCampaign)

  // ── Protocol gate, applied to the assembled arms ──
  const v2TrainMean = splitMean(v2Train, TRAIN_IDS)
  const v3TrainMean = splitMean(v3Train, TRAIN_IDS)
  const v2HoldoutMean = splitMean(v2Holdout, HOLDOUT_IDS)
  const v3HoldoutMean = splitMean(v3Holdout, HOLDOUT_IDS)

  const caseMean = (perCase: Map<string, RepRow[]>, id: string): number => {
    const rows = perCase.get(id) ?? []
    return rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.score, 0) / rows.length
  }
  const degenerate = Object.fromEntries(
    DEGENERATE_IDS.map((id) => [id, { v2: caseMean(v2Train, id), v3: caseMean(v3Train, id) }]),
  )
  const degenerateOk = DEGENERATE_IDS.every((id) => caseMean(v3Train, id) >= caseMean(v2Train, id))
  const promoted = v3HoldoutMean > v2HoldoutMean && v3TrainMean >= v2TrainMean - 0.05 && degenerateOk
  const gateVerdict = promoted ? 'ship' : 'hold'

  // Robustness: the same gate with every failed/missing cell imputed as 0.
  const imputed = {
    v2TrainMean: splitMeanImputedZero(v2Train, TRAIN_IDS),
    v3TrainMean: splitMeanImputedZero(v3Train, TRAIN_IDS),
    v2HoldoutMean: splitMeanImputedZero(v2Holdout, HOLDOUT_IDS),
    v3HoldoutMean: splitMeanImputedZero(v3Holdout, HOLDOUT_IDS),
  }
  const promotedUnderImputation =
    imputed.v3HoldoutMean > imputed.v2HoldoutMean &&
    imputed.v3TrainMean >= imputed.v2TrainMean - 0.05 &&
    degenerateOk

  console.log('\nv2 (baseline surface):')
  printSplit('train', v2Train, TRAIN_IDS)
  printSplit('holdout', v2Holdout, HOLDOUT_IDS)
  console.log('v3 (revised surface):')
  printSplit('train', v3Train, TRAIN_IDS)
  printSplit('holdout', v3Holdout, HOLDOUT_IDS)
  console.log(`\ndegenerate check (anti-over-graphing cases, v2 → v3): ${JSON.stringify(degenerate)}`)
  console.log(`retries: ${retryReceipts.length} receipt(s); unrecovered cell failures: ${cellFailures.length}`)
  console.log(`upstream gate: ${result.gateResult.decision} [${result.gateResult.reasons.join(' | ')}]`)
  console.log(
    `protocol gate: ${gateVerdict} (holdout ${v2HoldoutMean.toFixed(3)} → ${v3HoldoutMean.toFixed(3)}, train ${v2TrainMean.toFixed(3)} → ${v3TrainMean.toFixed(3)}, degenerate ${degenerateOk ? 'ok' : 'REGRESSED'})`,
  )

  const out = {
    generation: 3,
    date: new Date().toISOString(),
    smoke: SMOKE,
    authorModel: 'glm-5.2',
    authorTemperature: 0.2,
    proposerModel: 'glm-5.2',
    proposerTemperature: 0.7,
    split: { train: TRAIN_IDS, holdout: HOLDOUT_IDS },
    k: K,
    seed: SEED,
    surfaces: { v2Sha256: v2Sha, v3Sha256: v3Sha, v3Label: result.generations[0]?.record.candidates[0]?.label },
    perCase: {
      v2: { train: tableFor(v2Train, TRAIN_IDS), holdout: tableFor(v2Holdout, HOLDOUT_IDS) },
      v3: { train: tableFor(v3Train, TRAIN_IDS), holdout: tableFor(v3Holdout, HOLDOUT_IDS) },
    },
    aggregates: {
      v2: { trainMean: v2TrainMean, holdoutMean: v2HoldoutMean },
      v3: { trainMean: v3TrainMean, holdoutMean: v3HoldoutMean },
    },
    trainFailureTallyV2: tallyTrainFailures(v2Sha),
    degenerateCheck: degenerate,
    retryReceipts,
    cellFailures,
    worstCaseImputation: { ...imputed, promotedUnderImputation, note: 'every failed or missing rep scored 0 with denominator k' },
    upstreamGate: result.gateResult,
    upstreamWinnerWasCandidate: winnerIsCandidate,
    gateVerdict,
    promoted,
    revisionPromptSha256,
    v3Surface,
  }
  mkdirSync(dirname(EFFECTIVE_OUT), { recursive: true })
  writeFileSync(EFFECTIVE_OUT, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`written: ${EFFECTIVE_OUT}`)

  if (promoted && !SMOKE) {
    writeFileSync(SKILL_PATH, v3Surface)
    console.log(`promoted: ${SKILL_PATH} replaced with v3 (${v3Sha.slice(0, 12)})`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
