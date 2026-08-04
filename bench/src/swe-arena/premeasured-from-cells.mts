/**
 * Premeasured-baseline artifact builder — reconstruct the lib's
 * `PremeasuredOptimizationBaseline` ({surfaceHash, campaign}) from a PRIOR
 * run's on-disk baseline campaign cells.
 *
 * Why this exists: the gen-3 run (r4-mrwc0awe) measured the full 6-instance ×
 * 2-rep baseline but never wrote the artifact — its bootstrap writer keyed on
 * the Pareto frontier's generation −1 entry, and the frontier the lib returned
 * held no such entry, so the measurement survives ONLY as per-cell
 * `cached-result.json` caches under `<gen3>/improve-run/baseline/`. Those
 * caches cannot be replayed into a NEW runDir: the lib's cache-hit path
 * requires every `costCallIds` receipt in the CURRENT run's ledger (tagged
 * with the current runDir), which a fresh outDir cannot satisfy. The
 * premeasured-artifact path has no such coupling — `validatedPremeasuredBaseline`
 * checks surface hash, seed, reps, and split digest, then uses the campaign
 * as-is — so rebuilding the artifact is the designed way to pin a prior run's
 * measured baseline.
 *
 * Everything identity-bearing is REAL, never fabricated:
 *   - cells: verbatim `cached-result.json` records (verdicts, spend, receipts);
 *   - surfaceHash: recomputed from the loops repo's base-ref tip (identical
 *     incumbent surface shape the lib builds: baseCommit == candidateCommit,
 *     empty patch) — verified equal to gen-3's recorded baseline hash;
 *   - splitDigest/scenarios: the lib's own `campaignSplitDigest` /
 *     `campaignScenarioIdentity` over the exact scenario payloads;
 *   - seed/manifestHash: carried from the cells, uniformity asserted;
 *   - run window: reconstructed from cache-file mtimes (endedAt = last cell
 *     write; startedAt = earliest write minus that cell's duration).
 *
 *   tsx src/swe-arena/premeasured-from-cells.mts <config.json> --from <priorBaselineDir>
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  assertCampaignSplitIdentity,
  campaignScenarioIdentity,
  campaignSplitDigest,
  surfaceHash,
  type CampaignCellResult,
  type CampaignResult,
  type CodeSurface,
  type PremeasuredOptimizationBaseline,
  type Scenario,
} from '@tangle-network/agent-eval/campaign'
import type { R4Artifact } from './cell-evidence.mts'
import type { OuterLoopConfig } from './outer-loop.mts'
import { runOk } from './proc.ts'

export type FullCell = CampaignCellResult<R4Artifact> & { mtimeMs?: number }

/** Read every `<dir>/<cell>/cached-result.json` as a FULL lib cell record. */
export async function loadFullCampaignCells(campaignDir: string): Promise<FullCell[]> {
  const entries = await readdir(campaignDir, { withFileTypes: true })
  const cells: FullCell[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(campaignDir, entry.name, 'cached-result.json')
    const raw = await readFile(path, 'utf8').catch(() => null)
    if (raw === null) continue
    const cell = JSON.parse(raw) as FullCell
    if (typeof cell.scenarioId !== 'string' || typeof cell.rep !== 'number') {
      throw new Error(`premeasured-from-cells: ${path} is not a campaign cell`)
    }
    cell.mtimeMs = (await stat(path)).mtimeMs
    cells.push(cell)
  }
  return cells
}

/** The incumbent surface hash the lib will compute for `baseRef`'s tip: an
 *  unchanged code surface (candidate == base, empty patch). Identity material
 *  is {baseCommit, baseTree, candidateTree, patch} — worktree/ref excluded. */
export async function incumbentSurfaceHash(loopsRepo: string, baseRef: string): Promise<string> {
  const baseCommit = (await runOk('git', ['-C', loopsRepo, 'rev-parse', `${baseRef}^{commit}`])).stdout.trim()
  const tree = (await runOk('git', ['-C', loopsRepo, 'rev-parse', `${baseRef}^{tree}`])).stdout.trim()
  const surface: CodeSurface = {
    kind: 'code',
    worktreeRef: loopsRepo,
    baseRef,
    baseCommit,
    baseTree: tree,
    candidateCommit: baseCommit,
    candidateTree: tree,
    patch: {
      format: 'git-diff-binary',
      sha256: `sha256:${createHash('sha256').update(Buffer.alloc(0)).digest('hex')}`,
      byteLength: 0,
    },
  }
  return surfaceHash(surface)
}

function meanStdCi(values: number[]): { mean: number; stdev: number; ci95: [number, number]; n: number } {
  const n = values.length
  const mean = n === 0 ? 0 : values.reduce((s, v) => s + v, 0) / n
  const variance = n <= 1 ? 0 : values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
  const stdev = Math.sqrt(variance)
  const half = n === 0 ? 0 : (1.96 * stdev) / Math.sqrt(n)
  return { mean, stdev, ci95: [mean - half, mean + half], n }
}

/** Assemble the artifact from full cells. Pure over inputs; every check fails
 *  loud so a wrong artifact can never validate downstream by accident. */
export function buildPremeasuredFromCells(input: {
  cells: FullCell[]
  instances: string[]
  reps: number
  surfaceHash: string
  /** Provenance label recorded as the campaign's runDir (the SOURCE dir). */
  sourceDir: string
}): PremeasuredOptimizationBaseline<R4Artifact, Scenario> {
  const { cells, instances, reps } = input
  if (cells.length === 0) throw new Error('premeasured-from-cells: no cells')
  for (const iid of instances) {
    for (let rep = 0; rep < reps; rep++) {
      const mine = cells.filter((c) => c.scenarioId === iid && c.rep === rep)
      if (mine.length !== 1) {
        throw new Error(`premeasured-from-cells: expected exactly 1 cell for ${iid} rep ${rep}, got ${mine.length}`)
      }
    }
  }
  const extras = cells.filter((c) => !instances.includes(c.scenarioId) || c.rep >= reps)
  if (extras.length > 0) {
    throw new Error(
      `premeasured-from-cells: ${extras.length} cell(s) outside the ${instances.length}x${reps} design ` +
        `(e.g. ${extras[0]!.scenarioId}#r${extras[0]!.rep})`,
    )
  }
  // Per-cell seeds derive from the campaign base seed (run-campaign:
  // `cellSeed = seed + groupIndex * reps + rep`), so a complete design carries
  // the contiguous range [base, base + cells). The campaign-level seed the lib
  // validates is the base.
  const seeds = cells.map((c) => c.seed).sort((a, b) => a - b)
  const baseSeed = seeds[0]!
  for (let i = 0; i < seeds.length; i++) {
    if (seeds[i] !== baseSeed + i) {
      throw new Error(
        `premeasured-from-cells: cell seeds are not the contiguous derived range from base ${baseSeed} ` +
          `(got ${seeds.join(', ')})`,
      )
    }
  }
  const manifests = new Set(cells.map((c) => c.manifestHash ?? 'absent'))
  if (manifests.size !== 1) {
    throw new Error(`premeasured-from-cells: non-uniform manifestHash across cells (${[...manifests].join(', ')})`)
  }
  for (const cell of cells) {
    if (cell.error !== undefined) throw new Error(`premeasured-from-cells: cell ${cell.cellId} carries an error`)
    if (cell.artifact === null || cell.artifact.kind !== 'swe-arm') {
      throw new Error(`premeasured-from-cells: cell ${cell.cellId} has no swe-arm artifact`)
    }
    if (cell.costProvenance.kind === 'uncaptured') {
      throw new Error(`premeasured-from-cells: cell ${cell.cellId} has uncaptured cost`)
    }
    if (
      cell.costProvenance.usd !== cell.costUsd
    ) {
      throw new Error(
        `premeasured-from-cells: cell ${cell.cellId} cost provenance does not match costUsd`,
      )
    }
  }

  const scenarios: Scenario[] = instances.map((iid) => ({ id: iid, kind: 'swe-instance' }))
  const splitDigest = campaignSplitDigest(scenarios, reps)
  const identities = scenarios.map((s) => campaignScenarioIdentity(s))
  assertCampaignSplitIdentity(identities, reps, splitDigest)

  const sorted = [...cells].sort(
    (a, b) => instances.indexOf(a.scenarioId) - instances.indexOf(b.scenarioId) || a.rep - b.rep,
  )
  const composites = (cell: FullCell): number[] => Object.values(cell.judgeScores).map((s) => s.composite)
  const judgeNames = [...new Set(sorted.flatMap((c) => Object.keys(c.judgeScores)))]
  const byJudge = Object.fromEntries(
    judgeNames.map((name) => {
      const { mean, stdev, ci95, n } = meanStdCi(
        sorted.filter((c) => c.judgeScores[name]).map((c) => c.judgeScores[name]!.composite),
      )
      return [name, { mean, stdev, ci95, n }]
    }),
  )
  const byScenario = Object.fromEntries(
    instances.map((iid) => {
      const { mean, ci95, n } = meanStdCi(sorted.filter((c) => c.scenarioId === iid).flatMap(composites))
      return [iid, { meanComposite: mean, ci95, n }]
    }),
  )
  const totalCostUsd = sorted.reduce((s, c) => s + c.costUsd, 0)
  const costProvenance: CampaignCellResult<R4Artifact>['costProvenance'] = sorted.some(
    (cell) => cell.costProvenance.kind === 'estimated',
  )
    ? { kind: 'estimated', usd: totalCostUsd }
    : { kind: 'observed', usd: totalCostUsd }
  const inputTokens = sorted.reduce((s, c) => s + c.tokenUsage.input, 0)
  const outputTokens = sorted.reduce((s, c) => s + c.tokenUsage.output, 0)
  const totalCalls = sorted.reduce((s, c) => s + (c.costCallIds?.length ?? 0), 0)
  const models = [...new Set(sorted.map((c) => c.resolvedModel).filter((m): m is string => typeof m === 'string'))]

  const mtimes = sorted.filter((c) => typeof c.mtimeMs === 'number')
  const endedMs = mtimes.length > 0 ? Math.max(...mtimes.map((c) => c.mtimeMs!)) : 0
  const startedMs = mtimes.length > 0 ? Math.min(...mtimes.map((c) => c.mtimeMs! - c.durationMs)) : 0

  const campaign: CampaignResult<R4Artifact, Scenario> = {
    manifestHash: sorted[0]!.manifestHash ?? '',
    splitDigest,
    seed: baseSeed,
    reps,
    startedAt: new Date(startedMs).toISOString(),
    endedAt: new Date(endedMs).toISOString(),
    durationMs: Math.max(0, endedMs - startedMs),
    // Verbatim prior-run cells (marked cached — they were measured, and this
    // artifact replays them without dispatch). The transient mtime rider is
    // dropped from the persisted record.
    cells: sorted.map(({ mtimeMs: _mtimeMs, ...cell }) => ({ ...cell, cached: true })),
    aggregates: {
      byJudge,
      byScenario,
      cost: {
        totalCalls,
        pendingCalls: 0,
        unresolvedCalls: 0,
        reservedCostUsd: 0,
        inputTokens,
        outputTokens,
        cachedTokens: 0,
        totalCostUsd,
        costProvenance,
        byChannel: [
          {
            channel: 'agent',
            calls: totalCalls,
            inputTokens,
            outputTokens,
            cachedTokens: 0,
            costUsd: totalCostUsd,
            unpricedCalls: 0,
            unknownUsageCalls: 0,
          },
        ],
        unpricedModels: [],
        fullyPriced: true,
        usageComplete: true,
        accountingComplete: true,
        incompleteReasons: [],
      },
      cellsExecuted: sorted.length,
      cellsSkipped: 0,
      cellsCached: sorted.length,
      cellsFailed: 0,
    },
    runDir: input.sourceDir,
    artifactsByPath: {},
    scenarios: identities,
  }
  void models
  return { surfaceHash: input.surfaceHash, campaign }
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const argv = process.argv.slice(2)
  const configPath = argv[0]
  const fromIdx = argv.indexOf('--from')
  const fromDir = fromIdx !== -1 ? argv[fromIdx + 1] : undefined
  if (!configPath || configPath.startsWith('--') || !fromDir) {
    console.error('usage: tsx src/swe-arena/premeasured-from-cells.mts <config.json> --from <priorBaselineCampaignDir>')
    process.exit(2)
  }
  const config = JSON.parse(await readFile(configPath, 'utf8')) as OuterLoopConfig
  const reps = config.repsPerInstance ?? 1
  const cells = await loadFullCampaignCells(fromDir)
  const hash = await incumbentSurfaceHash(config.loopsRepo, config.loopsBaseRef)
  const artifact = buildPremeasuredFromCells({
    cells,
    instances: config.instances,
    reps,
    surfaceHash: hash,
    sourceDir: fromDir,
  })
  await writeFile(config.premeasuredBaselinePath, JSON.stringify(artifact, null, 1))
  const resolved = artifact.campaign.cells.map(
    (c) => `${c.scenarioId}#r${c.rep}=${(c.artifact as R4Artifact).resolved}`,
  )
  console.log(`premeasured baseline artifact → ${config.premeasuredBaselinePath}`)
  console.log(`surfaceHash=${hash} splitDigest=${artifact.campaign.splitDigest} seed=${artifact.campaign.seed} reps=${reps}`)
  console.log(resolved.join('\n'))
}
