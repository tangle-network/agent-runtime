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
// The evaluated artifact. One cell = one (surface × scenario × rep) — the
// swe cells carry the official-judge outcome + recovered spend; the single
// static cell carries the change-space/tsc gates.
// ---------------------------------------------------------------------------

export type R4Artifact =
  | {
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
  | {
      kind: 'static-gate'
      commit: string
      changedFiles: string[]
      violations: string[]
      typecheckOk: boolean
      feedback?: string
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
    if (cell.artifact !== null && cell.artifact.kind === 'static-gate') continue
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
// Pinned baseline. The accept/reject gate compares candidates against a
// MEASURED, reps-confirmed baseline pinned in config — never a per-run
// recomputation (see the r4-mroh3rkt note above). Retained as the gate's
// denominator until the substrate's premeasuredBaseline passthrough is
// consumable (capabilities.mts) — then the pin becomes the fallback.
// ---------------------------------------------------------------------------

/** Fail-loud pinned resolved-count: every improvement-set instance must carry a
 *  pinned boolean, and every pinned iid must be in the improvement set. */
export function pinnedBaselineResolvedCount(pin: Record<string, boolean>, iids: string[]): number {
  const missing = iids.filter((iid) => typeof pin[iid] !== 'boolean')
  if (missing.length > 0) {
    throw new Error(`pinnedBaseline: missing boolean verdict for ${missing.join(', ')}`)
  }
  const unknown = Object.keys(pin).filter((iid) => !iids.includes(iid))
  if (unknown.length > 0) {
    throw new Error(`pinnedBaseline: unknown instance(s) not in the improvement set: ${unknown.join(', ')}`)
  }
  return iids.filter((iid) => pin[iid] === true).length
}

/** Per-instance contradictions between the pin and a run's OWN baseline cells.
 *  Only instances with full-reps, conclusive coverage in the run are compared —
 *  a partial baseline record has no AND-verdict to contradict the pin with.
 *  The caller logs these loud and STILL uses the pin. */
export function baselineDriftWarnings(
  pin: Record<string, boolean>,
  runs: ReplicateRun[],
  iids: string[],
  reps: number,
): string[] {
  const warnings: string[] = []
  for (const iid of iids) {
    const pinned = pin[iid]
    if (typeof pinned !== 'boolean') continue
    const mine = runs.filter((r) => r.iid === iid)
    if (mine.length !== reps || mine.some((r) => r.resolved === null)) continue
    const measured = mine.every((r) => r.resolved === true)
    if (measured !== pinned) {
      warnings.push(
        `${iid}: pinned=${pinned} but this run's baseline cells measured ${measured} ` +
          `(reps: ${mine.map((r) => String(r.resolved)).join('/')}) — gate uses the PIN`,
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

/** protocol_v2 keep-if-better: improvement-set resolved-count must RISE and
 *  cost must stay within the guard. Fail-closed on unprovable cost. */
export function decideVerdict(input: {
  violations: string[]
  coverageComplete: boolean
  resolvedCount: number
  parentResolvedCount: number
  costRatio: number | null
  costGuardRatio: number
}): StaircaseVerdict {
  if (input.violations.length > 0) return 'rejected-out-of-space'
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
// Gate evidence — everything the operator gate reports, derived from cells.
// ---------------------------------------------------------------------------

export interface GateEvidence {
  candResolved: number
  baseResolved: number
  /** True when `baseResolved` came from the config pin (the default). */
  baseFromPin: boolean
  candWallS: number
  baseWallS: number
  costRatio: number | null
  coverageComplete: boolean
  verdict: StaircaseVerdict
  driftWarnings: string[]
}

/** Score the winner-vs-baseline comparison for the operator gate. The PIN is
 *  the denominator when present; the run's own baseline cells serve as drift
 *  detector + cost-ratio denominator only. */
export function gateEvidenceFromCells(input: {
  winnerCells: EvidenceCell[]
  baselineCells: EvidenceCell[]
  staticViolations: string[]
  pin?: Record<string, boolean> | undefined
  iids: string[]
  reps: number
  costGuardRatio: number
}): GateEvidence {
  const winnerRuns = replicateRunsFromCells(input.winnerCells)
  const baselineRuns = replicateRunsFromCells(input.baselineCells)
  const candResolved = resolvedInstanceCount(winnerRuns, input.iids, input.reps)
  const baseFromPin = input.pin !== undefined
  const baseResolved = input.pin
    ? pinnedBaselineResolvedCount(input.pin, input.iids)
    : resolvedInstanceCount(baselineRuns, input.iids, input.reps)
  const driftWarnings = input.pin
    ? baselineDriftWarnings(input.pin, baselineRuns, input.iids, input.reps)
    : []
  const candWallS = sumWallSFromCells(input.winnerCells)
  const baseWallS = sumWallSFromCells(input.baselineCells)
  const costRatio = baseWallS > 0 ? candWallS / baseWallS : null
  const coverageComplete = replicateCoverageComplete(winnerRuns, input.iids, input.reps)
  return {
    candResolved,
    baseResolved,
    baseFromPin,
    candWallS,
    baseWallS,
    costRatio,
    coverageComplete,
    verdict: decideVerdict({
      violations: input.staticViolations,
      coverageComplete,
      resolvedCount: candResolved,
      parentResolvedCount: baseResolved,
      costRatio,
      costGuardRatio: input.costGuardRatio,
    }),
    driftWarnings,
  }
}
