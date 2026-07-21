/**
 * Rollout manifest — a pure READER/JOIN over what the round already writes.
 * No new capture pipeline: the lib's improve() run emits loop-provenance.json,
 * per-cell cached results, and the durable cost log; the swe-arena dispatch
 * emits arm result/judge files, candidate patches, and proposer-shot receipts.
 * This module joins them into one versioned per-generation manifest of
 * (state, action, outcome, cost, artifactPaths) triples.
 *
 *   tsx src/swe-arena/manifest.mts <outDir>   # writes <outDir>/rollout-manifest.json
 *
 * Sources (all optional — a missing file is a labeled gap, never a crash):
 *   - <outDir>/improve-run/loop-provenance.json            (lib)
 *   - <outDir>/improve-run/cost-ledger.jsonl               (lib, durable receipts)
 *   - <outDir>/improve-run/baseline and gen-N/candidate-K  (lib, per-cell caches)
 *   - <outDir>/candidates/<commit10>.patch                 (ours, diff writing)
 *   - <outDir>/proposer-shots/genN-candK-shotS.json        (ours, shot receipts)
 *   - per-cell artifact.runDir result.json + judge.json    (ours, arm + judge)
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  loadCampaignCells,
  loadCandidateCellGroups,
  perInstanceFromCells,
  replicateRunsFromCells,
  resolvedInstanceCount,
  sumWallSFromCells,
  type EvidenceCell,
  type StaircasePerInstance,
} from './cell-evidence.mts'

export const ROLLOUT_SCHEMA = 'swe-arena.rollout.v1'

export interface RolloutCost {
  /** Σ campaign-cell CostLedger spend (worker receipts) across the cells. */
  cellCostUsd: number
  cellTokensIn: number
  cellTokensOut: number
  /** Σ runtime spend-tree usd/tokens off the artifacts (telemetry-gap nulls skipped). */
  armSpentUsd: number
  armSpentTokens: number
  wallS: number
  judgeWallS: number
  /** Durable cost-ledger receipts whose tags name this campaign dir. */
  receiptCallIds: string[]
}

export interface RolloutEntry {
  state: {
    generation: number
    /** -1 candidateIndex = the baseline campaign. */
    candidateIndex: number
    campaignDir: string
    commit: string | null
  }
  action: {
    /** Candidate diff written at dispatch time (null for the baseline / a
     *  resumed-only run whose diff was not rewritten). */
    diffPath: string | null
    /** Persisted proposer-shot receipts for this (generation, candidate). */
    shotReceiptPaths: string[]
  }
  outcome: {
    perInstance: StaircasePerInstance[]
    resolvedCount: number
    cellsCached: number
  }
  cost: RolloutCost
  artifactPaths: {
    cells: string[]
    armResults: string[]
    judgeVerdicts: string[]
    patches: string[]
  }
}

export interface RolloutGeneration {
  generation: number
  rollouts: RolloutEntry[]
}

export interface RolloutManifest {
  schema: typeof ROLLOUT_SCHEMA
  outDir: string
  at: string
  /** The lib's durable provenance record, verbatim (null = not emitted). */
  provenance: unknown | null
  /** Improvement-set ids inferred from the baseline cells. */
  instances: string[]
  generations: RolloutGeneration[]
}

interface LedgerReceipt {
  callId: string
  tags?: Record<string, string>
  [k: string]: unknown
}

/** Settled receipts out of the lib's append-only cost-ledger.jsonl. */
export async function loadLedgerReceipts(improveRunDir: string): Promise<LedgerReceipt[]> {
  const raw = await readFile(join(improveRunDir, 'cost-ledger.jsonl'), 'utf8').catch(() => '')
  const receipts: LedgerReceipt[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const record = event.record as Record<string, unknown> | undefined
    if (record && record.status === 'settled' && typeof record.callId === 'string') {
      receipts.push(record as unknown as LedgerReceipt)
    }
  }
  return receipts
}

function costFromCells(
  cells: EvidenceCell[],
  campaignDir: string,
  receipts: LedgerReceipt[],
): RolloutCost {
  let cellCostUsd = 0
  let cellTokensIn = 0
  let cellTokensOut = 0
  let armSpentUsd = 0
  let armSpentTokens = 0
  let judgeWallS = 0
  for (const cell of cells) {
    cellCostUsd += cell.costUsd ?? 0
    cellTokensIn += cell.tokenUsage?.input ?? 0
    cellTokensOut += cell.tokenUsage?.output ?? 0
    const a = cell.artifact
    if (a !== null && a.kind === 'swe-arm') {
      armSpentUsd += a.spentUsd ?? 0
      armSpentTokens += a.spentTokens ?? 0
      judgeWallS += a.judgeWallS ?? 0
    }
  }
  return {
    cellCostUsd: Number(cellCostUsd.toFixed(6)),
    cellTokensIn,
    cellTokensOut,
    armSpentUsd: Number(armSpentUsd.toFixed(6)),
    armSpentTokens,
    wallS: sumWallSFromCells(cells),
    judgeWallS,
    receiptCallIds: receipts
      .filter((r) => r.tags?.runDir === campaignDir)
      .map((r) => r.callId)
      .sort(),
  }
}

function artifactPathsFromCells(cells: EvidenceCell[], campaignDir: string): RolloutEntry['artifactPaths'] {
  const armResults: string[] = []
  const judgeVerdicts: string[] = []
  const patches: string[] = []
  for (const cell of cells) {
    const a = cell.artifact
    if (a === null || a.kind !== 'swe-arm') continue
    if (a.runDir) {
      const resultPath = join(a.runDir, 'result.json')
      const judgePath = join(a.runDir, 'judge.json')
      if (existsSync(resultPath)) armResults.push(resultPath)
      if (existsSync(judgePath)) judgeVerdicts.push(judgePath)
    }
    if (a.patchPath && existsSync(a.patchPath)) patches.push(a.patchPath)
  }
  return {
    // The campaign dir holds the per-cell cached-result.json score records.
    cells: cells.length > 0 ? [campaignDir] : [],
    armResults: [...new Set(armResults)].sort(),
    judgeVerdicts: [...new Set(judgeVerdicts)].sort(),
    patches: [...new Set(patches)].sort(),
  }
}

async function shotReceiptPathsFor(
  outDir: string,
  generation: number,
  candidateIndex: number,
): Promise<string[]> {
  const shotDir = join(outDir, 'proposer-shots')
  const names = await readdir(shotDir).catch(() => [])
  return names
    .filter((n) => n.startsWith(`gen${generation}-cand${candidateIndex}-`) && n.endsWith('.json'))
    .sort()
    .map((n) => join(shotDir, n))
}

/** Build the rollout manifest for one round outDir. Pure join — reads only. */
export async function buildRolloutManifest(outDir: string): Promise<RolloutManifest> {
  const improveRunDir = join(outDir, 'improve-run')
  const provenanceRaw = await readFile(join(improveRunDir, 'loop-provenance.json'), 'utf8').catch(() => null)
  const provenance = provenanceRaw === null ? null : (JSON.parse(provenanceRaw) as unknown)
  const receipts = await loadLedgerReceipts(improveRunDir)

  const baselineDir = join(improveRunDir, 'baseline')
  const baselineCells = await loadCampaignCells(baselineDir)
  const instances = [...new Set(baselineCells.map((c) => c.scenarioId))].sort()

  const generations = new Map<number, RolloutGeneration>()
  const genOf = (g: number): RolloutGeneration => {
    const existing = generations.get(g)
    if (existing) return existing
    const fresh: RolloutGeneration = { generation: g, rollouts: [] }
    generations.set(g, fresh)
    return fresh
  }

  if (baselineCells.length > 0) {
    genOf(-1).rollouts.push({
      state: { generation: -1, candidateIndex: -1, campaignDir: baselineDir, commit: baselineCells[0]?.artifact?.commit ?? null },
      action: { diffPath: null, shotReceiptPaths: [] },
      outcome: {
        perInstance: perInstanceFromCells(baselineCells),
        resolvedCount: resolvedInstanceCount(
          replicateRunsFromCells(baselineCells),
          instances,
          maxRep(baselineCells) + 1,
        ),
        cellsCached: baselineCells.length,
      },
      cost: costFromCells(baselineCells, baselineDir, receipts),
      artifactPaths: artifactPathsFromCells(baselineCells, baselineDir),
    })
  }

  for (const group of await loadCandidateCellGroups(improveRunDir)) {
    const diffPath = group.commit ? join(outDir, 'candidates', `${group.commit.slice(0, 10)}.patch`) : null
    genOf(group.generation).rollouts.push({
      state: {
        generation: group.generation,
        candidateIndex: group.candidateIndex,
        campaignDir: group.dir,
        commit: group.commit,
      },
      action: {
        diffPath: diffPath !== null && existsSync(diffPath) ? diffPath : null,
        shotReceiptPaths: await shotReceiptPathsFor(outDir, group.generation, group.candidateIndex),
      },
      outcome: {
        perInstance: perInstanceFromCells(group.cells),
        resolvedCount: resolvedInstanceCount(
          replicateRunsFromCells(group.cells),
          instances,
          maxRep(group.cells) + 1,
        ),
        cellsCached: group.cells.length,
      },
      cost: costFromCells(group.cells, group.dir, receipts),
      artifactPaths: artifactPathsFromCells(group.cells, group.dir),
    })
  }

  return {
    schema: ROLLOUT_SCHEMA,
    outDir,
    at: new Date().toISOString(),
    provenance,
    instances,
    generations: [...generations.values()].sort((a, b) => a.generation - b.generation),
  }
}

/** Replicate count inferred from the cells themselves (reps = max rep index
 *  + 1). The manifest is a reader with no config in scope; an incomplete
 *  candidate under-infers reps and its resolvedCount stays fail-closed. */
const maxRep = (cells: EvidenceCell[]): number => cells.reduce((m, c) => Math.max(m, c.rep), 0)

export async function writeRolloutManifest(outDir: string): Promise<string> {
  const manifest = await buildRolloutManifest(outDir)
  const path = join(outDir, 'rollout-manifest.json')
  await writeFile(path, JSON.stringify(manifest, null, 2))
  return path
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const outDir = process.argv[2]
  if (!outDir) {
    console.error('usage: tsx src/swe-arena/manifest.mts <outDir>')
    process.exit(2)
  }
  const path = await writeRolloutManifest(outDir)
  console.log(`rollout manifest → ${path}`)
}
