/**
 * Cell-derived scoring evidence — the round's ground truth read from the
 * LIB's campaign cells, never from in-process dispatch-order bookkeeping.
 *
 * Root cause this kills (r4-mroh3rkt): `improve()` resumes its campaign from
 * runDir and replays cached cells WITHOUT dispatching them, so any recorder
 * keyed on "what this process dispatched" mislabels arms — the resumed run
 * published candidate b08d31c910's cells as "baseline 0/3" while the measured
 * baseline was 1/3. Campaign cells carry their own attribution instead:
 *
 *   - the campaign DIRECTORY names the arm (`baseline/` vs
 *     `gen-<g>/candidate-<i>/` under the improve runDir — run-campaign.ts
 *     writes one `<cellId>/cached-result.json` per conclusive cell), and
 *   - each cell's artifact names its loops commit (`R4Artifact.commit`).
 *
 * Everything here is pure over cells (plus the two disk readers), so the
 * aggregation is unit-testable against a synthetic cell set reproducing the
 * resume-replay shape with zero dispatch.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// The evaluated artifact. One cell = one (surface × scenario × rep); every
// cell carries the official-judge outcome + recovered spend. (The `kind`
// discriminant stays: cached cells on disk carry it, and it keeps replayed
// artifacts distinguishable from a null/errored cell.)
// ---------------------------------------------------------------------------

export interface R4Artifact {
  kind: 'swe-arm'
  iid: string
  commit: string
  resolved: boolean
  verifyPass: boolean
  patchLines: number
  wallS: number
  /** Runtime spend-tree total (state.json `result.spentTokens`, winner AND
   *  no-winner arms). `null` = state.json unreadable, a telemetry gap. */
  spentTokens: number | null
  spentUsd: number | null
  /** spentTokens + opencode-sqlite worker-session tokens. */
  recoveredTokens: number | null
  /** Worker-session token split from the opencode sqlite join — the
   *  usage the campaign CostLedger receipt reports. */
  workerTokIn: number | null
  workerTokOut: number | null
  judgeAttempts: number | null
  judgeWallS: number | null
  runDir: string
  patchPath: string
}

/** The minimal slice of a lib `CampaignCellResult<R4Artifact>` the scoring
 *  reads. Structural so both in-memory campaign results and parsed
 *  `cached-result.json` files satisfy it. */
export interface EvidenceCell {
  scenarioId: string
  rep: number
  /** `null` on an errored cell (the lib records failed cells with a null
   *  artifact; it never caches them). */
  artifact: R4Artifact | null
  error?: string
  costUsd?: number
  tokenUsage?: { input: number; output: number }
  cached?: boolean
}

/** Adapt a lib campaign's cells (in-memory result) to `EvidenceCell`s. */
export function cellsFromCampaign(campaign: {
  cells: Array<{
    scenarioId: string
    rep: number
    artifact: unknown
    error?: string
    costUsd: number
    tokenUsage: { input: number; output: number }
    cached: boolean
  }>
}): EvidenceCell[] {
  return campaign.cells.map((cell) => ({
    scenarioId: cell.scenarioId,
    rep: cell.rep,
    artifact: (cell.artifact ?? null) as R4Artifact | null,
    ...(cell.error ? { error: cell.error } : {}),
    costUsd: cell.costUsd,
    tokenUsage: { input: cell.tokenUsage.input, output: cell.tokenUsage.output },
    cached: cell.cached,
  }))
}

// ---------------------------------------------------------------------------
// Replicate semantics — repsPerInstance. Single-rep scoring provably flips
// instance outcomes run-to-run (judge flake + capacity noise both observed),
// so an instance counts RESOLVED only when EVERY replicate cell resolved (AND
// — fail-closed for keep-if-better), and coverage requires every replicate of
// every instance to hold a real boolean verdict.
// ---------------------------------------------------------------------------

export interface ReplicateRun {
  iid: string
  resolved: boolean | null
}

/** Instances where ALL `reps` replicates resolved (missing replicates never count). */
export function resolvedInstanceCount(runs: ReplicateRun[], iids: string[], reps: number): number {
  let count = 0
  for (const iid of iids) {
    const mine = runs.filter((r) => r.iid === iid)
    if (mine.length === reps && mine.every((r) => r.resolved === true)) count += 1
  }
  return count
}

/** Every instance has exactly `reps` replicates, each with a conclusive verdict. */
export function replicateCoverageComplete(runs: ReplicateRun[], iids: string[], reps: number): boolean {
  return iids.every((iid) => {
    const mine = runs.filter((r) => r.iid === iid)
    return mine.length === reps && mine.every((r) => r.resolved !== null)
  })
}

/** One `ReplicateRun` per swe cell. An errored/artifact-less cell is an
 *  inconclusive replicate (`resolved: null`) — never a fabricated boolean. */
export function replicateRunsFromCells(cells: EvidenceCell[]): ReplicateRun[] {
  return cells
    .filter((c) => c.artifact === null || c.artifact.kind === 'swe-arm')
    .map((c) => ({
      iid: c.scenarioId,
      resolved: c.artifact !== null && c.artifact.kind === 'swe-arm' && !c.error ? c.artifact.resolved : null,
    }))
}

/** Σ wall seconds across the swe cells (errored cells contribute 0). */
export function sumWallSFromCells(cells: EvidenceCell[]): number {
  return cells.reduce(
    (s, c) => s + (c.artifact !== null && c.artifact.kind === 'swe-arm' ? c.artifact.wallS : 0),
    0,
  )
}

/** Per-replicate staircase row — one per swe cell, straight off the artifact. */
export interface StaircasePerInstance {
  iid: string
  /** Replicate index (0-based) — repsPerInstance cells per instance. */
  rep: number
  resolved: boolean | null
  verify_pass: boolean | null
  patch_lines: number | null
  wall_s: number | null
  spentTokens: number | null
  recoveredTokens: number | null
  judgeAttempts: number | null
  /** Campaign-cell CostLedger spend for this replicate (worker receipt). */
  costUsd: number | null
  error?: string
}

export function perInstanceFromCells(cells: EvidenceCell[]): StaircasePerInstance[] {
  const rows: StaircasePerInstance[] = []
  for (const cell of cells) {
    const a = cell.artifact !== null && cell.artifact.kind === 'swe-arm' && !cell.error ? cell.artifact : null
    rows.push({
      iid: cell.scenarioId,
      rep: cell.rep,
      resolved: a ? a.resolved : null,
      verify_pass: a ? a.verifyPass : null,
      patch_lines: a ? a.patchLines : null,
      wall_s: a ? a.wallS : null,
      spentTokens: a ? a.spentTokens : null,
      recoveredTokens: a ? a.recoveredTokens : null,
      judgeAttempts: a ? a.judgeAttempts : null,
      costUsd: cell.costUsd ?? null,
      ...(cell.error ? { error: cell.error } : {}),
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Premeasured-baseline drift. The gate's denominator is the stored
// premeasured baseline artifact ({surfaceHash, campaign}) that the LIB
// validates before skipping the baseline campaign — surface hash, seed, reps,
// and split digest all fail loud on mismatch. A resumed runDir can still hold
// baseline cells cached by an OLDER run of the same surface; when those
// contradict the validated artifact, the contradiction is logged loud and the
// artifact still rules.
// ---------------------------------------------------------------------------

/** AND-verdict per instance from campaign cells. Only instances with full,
 *  conclusive replicate coverage produce a verdict — a partial record has no
 *  AND-verdict to compare. */
export function instanceVerdictsFromCells(
  cells: EvidenceCell[],
  iids: string[],
  reps: number,
): Record<string, boolean> {
  const runs = replicateRunsFromCells(cells)
  const verdicts: Record<string, boolean> = {}
  for (const iid of iids) {
    const mine = runs.filter((r) => r.iid === iid)
    if (mine.length !== reps || mine.some((r) => r.resolved === null)) continue
    verdicts[iid] = mine.every((r) => r.resolved === true)
  }
  return verdicts
}

/** Per-instance contradictions between the validated premeasured artifact's
 *  verdicts and locally cached baseline cells. Only instances with full-reps,
 *  conclusive coverage on BOTH sides are compared — a partial record has no
 *  AND-verdict to contradict with. The caller logs these loud and the
 *  premeasured artifact STILL rules. */
export function baselineDriftWarnings(
  expected: Record<string, boolean>,
  runs: ReplicateRun[],
  iids: string[],
  reps: number,
): string[] {
  const warnings: string[] = []
  for (const iid of iids) {
    const want = expected[iid]
    if (typeof want !== 'boolean') continue
    const mine = runs.filter((r) => r.iid === iid)
    if (mine.length !== reps || mine.some((r) => r.resolved === null)) continue
    const measured = mine.every((r) => r.resolved === true)
    if (measured !== want) {
      warnings.push(
        `${iid}: premeasured=${want} but cached baseline cells measured ${measured} ` +
          `(reps: ${mine.map((r) => String(r.resolved)).join('/')}) — the validated premeasured artifact rules`,
      )
    }
  }
  return warnings
}

// ---------------------------------------------------------------------------
// protocol_v2 keep-if-better.
// ---------------------------------------------------------------------------

export type StaircaseVerdict =
  | 'accepted'
  | 'rejected-no-gain'
  | 'rejected-cost'
  | 'rejected-out-of-space'
  | 'rejected-incomplete'
  /** Killed by the gen-3 pre-filter (change-space/tsc/smoke) BEFORE any full
   *  evaluation — the candidate never became a measured surface. Emitted by
   *  the outer loop's kill-row writer, never by `decideVerdict`. */
  | 'rejected-prefilter'
  /** GEN-5 activation gate: the candidate's own machine-checkable predicate
   *  (activation.mts) proved its mechanism NEVER fired in its campaign
   *  traces — recorded, never promoted, EVEN when the score improved. */
  | 'quarantined-inactive'

/** protocol_v2 keep-if-better: improvement-set resolved-count must RISE and
 *  cost must stay within the guard. Fail-closed on unprovable cost.
 *  GEN-5: `activationFired === false` quarantines the candidate ahead of the
 *  score comparison — an improved score with an inactive mechanism is
 *  indistinguishable from luck (undefined/null = gate not applicable:
 *  disabled, baseline, or predicate unevaluated). */
export function decideVerdict(input: {
  violations: string[]
  coverageComplete: boolean
  resolvedCount: number
  parentResolvedCount: number
  costRatio: number | null
  costGuardRatio: number
  activationFired?: boolean | null
}): StaircaseVerdict {
  if (input.violations.length > 0) return 'rejected-out-of-space'
  if (input.activationFired === false) return 'quarantined-inactive'
  if (!input.coverageComplete) return 'rejected-incomplete'
  if (input.resolvedCount <= input.parentResolvedCount) return 'rejected-no-gain'
  if (input.costRatio === null || input.costRatio > input.costGuardRatio) return 'rejected-cost'
  return 'accepted'
}

// ---------------------------------------------------------------------------
// Disk readers — the lib's per-cell caches. run-campaign.ts writes
// `<campaignDir>/<sanitized cellId>/cached-result.json` for every conclusive
// cell (errored cells are never cached — a missing replicate reads as
// coverage-incomplete downstream, fail-closed).
// ---------------------------------------------------------------------------

/** Parse every `<cellDir>/cached-result.json` under one campaign dir. Missing dir = []. */
export async function loadCampaignCells(campaignDir: string): Promise<EvidenceCell[]> {
  const entries = await readdir(campaignDir, { withFileTypes: true }).catch(() => [])
  const cells: EvidenceCell[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(campaignDir, entry.name, 'cached-result.json')
    const raw = await readFile(path, 'utf8').catch(() => null)
    if (raw === null) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      throw new Error(`loadCampaignCells: corrupt cell cache ${path}`)
    }
    if (typeof parsed.scenarioId !== 'string' || typeof parsed.rep !== 'number') {
      throw new Error(`loadCampaignCells: ${path} is not a campaign cell (scenarioId/rep missing)`)
    }
    cells.push({
      scenarioId: parsed.scenarioId,
      rep: parsed.rep,
      artifact: (parsed.artifact ?? null) as R4Artifact | null,
      ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
      ...(typeof parsed.costUsd === 'number' ? { costUsd: parsed.costUsd } : {}),
      ...(parsed.tokenUsage && typeof parsed.tokenUsage === 'object'
        ? { tokenUsage: parsed.tokenUsage as { input: number; output: number } }
        : {}),
      cached: true,
    })
  }
  return cells
}

export interface CandidateCellGroup {
  generation: number
  candidateIndex: number
  dir: string
  cells: EvidenceCell[]
  /** The loops commit the cells' artifacts name (null when no artifact
   *  carries one — e.g. an all-errored, never-cached candidate). */
  commit: string | null
}

/** Scan `gen-<g>/candidate-<i>/` campaign dirs under the improve runDir.
 *  Attribution is directory + artifact-commit — dispatch order plays no part. */
export async function loadCandidateCellGroups(improveRunDir: string): Promise<CandidateCellGroup[]> {
  const groups: CandidateCellGroup[] = []
  const top = await readdir(improveRunDir, { withFileTypes: true }).catch(() => [])
  for (const genEntry of top) {
    const genMatch = /^gen-(\d+)$/.exec(genEntry.name)
    if (!genEntry.isDirectory() || !genMatch) continue
    const genDir = join(improveRunDir, genEntry.name)
    for (const candEntry of await readdir(genDir, { withFileTypes: true }).catch(() => [])) {
      const candMatch = /^candidate-(\d+)$/.exec(candEntry.name)
      if (!candEntry.isDirectory() || !candMatch) continue
      const dir = join(genDir, candEntry.name)
      const cells = await loadCampaignCells(dir)
      const commits = new Set(
        cells.map((c) => c.artifact?.commit).filter((c): c is string => typeof c === 'string'),
      )
      if (commits.size > 1) {
        throw new Error(
          `loadCandidateCellGroups: ${dir} mixes commits [${[...commits].join(', ')}] — one candidate dir must hold one surface`,
        )
      }
      groups.push({
        generation: Number(genMatch[1]),
        candidateIndex: Number(candMatch[1]),
        dir,
        cells,
        commit: [...commits][0] ?? null,
      })
    }
  }
  return groups.sort((a, b) => a.generation - b.generation || a.candidateIndex - b.candidateIndex)
}

// ---------------------------------------------------------------------------
// Gate evidence — the would-be-keep operator brief, derived from cells. The
// lib's deferred-holdout gate always holds; this evidence tells the operator
// whether the pre-registered holdout run is worth approving.
// ---------------------------------------------------------------------------

export interface GateEvidence {
  candResolved: number
  baseResolved: number
  candWallS: number
  baseWallS: number
  costRatio: number | null
  coverageComplete: boolean
  verdict: StaircaseVerdict
}

/** Score the winner-vs-baseline comparison for the operator brief. Both sides
 *  come from campaign cells — the baseline side is the lib-validated
 *  premeasured campaign (or the bootstrap run's freshly measured one). */
export function gateEvidenceFromCells(input: {
  winnerCells: EvidenceCell[]
  baselineCells: EvidenceCell[]
  /** Dispatch-time change-space violations of the winner's diff. */
  violations: string[]
  iids: string[]
  reps: number
  costGuardRatio: number
  /** GEN-5 activation-gate outcome for the winner (see decideVerdict). */
  activationFired?: boolean | null
}): GateEvidence {
  const winnerRuns = replicateRunsFromCells(input.winnerCells)
  const baselineRuns = replicateRunsFromCells(input.baselineCells)
  const candResolved = resolvedInstanceCount(winnerRuns, input.iids, input.reps)
  const baseResolved = resolvedInstanceCount(baselineRuns, input.iids, input.reps)
  const candWallS = sumWallSFromCells(input.winnerCells)
  const baseWallS = sumWallSFromCells(input.baselineCells)
  const costRatio = baseWallS > 0 ? candWallS / baseWallS : null
  const coverageComplete = replicateCoverageComplete(winnerRuns, input.iids, input.reps)
  return {
    candResolved,
    baseResolved,
    candWallS,
    baseWallS,
    costRatio,
    coverageComplete,
    verdict: decideVerdict({
      violations: input.violations,
      coverageComplete,
      resolvedCount: candResolved,
      parentResolvedCount: baseResolved,
      costRatio,
      costGuardRatio: input.costGuardRatio,
      ...(input.activationFired !== undefined ? { activationFired: input.activationFired } : {}),
    }),
  }
}
