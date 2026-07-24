/**
 * Winner-selection ↔ ship-gate consistency (gen-4 selection-defect regression).
 *
 * The improvement loop used to rank candidates by the lib's per-cell MEAN
 * composite and set the run winner from that ranking; the ship gate
 * (`gateEvidenceFromCells` → `decideVerdict`) scores an instance resolved only
 * when EVERY replicate resolved (fail-closed AND). Those two metrics inverted:
 * in gen-4 the mean-selector promoted merge-author (1 fail-closed, but a higher
 * mean from one-off flaky passes) over claude-author (2 fail-closed, both-reps
 * confirmed), the gate then scored merge at 1 == baseline 1 and reported
 * rejected-no-gain — discarding a real +1-instance winner.
 *
 * `failClosedRankKey` is the selection key the outer loop now hands the loop as
 * `runOptimization.selectionRankKey`. It is built from the SAME
 * `resolvedInstanceCount` the gate uses, so selecting-then-gating is consistent
 * by construction. This test reproduces gen-4's exact per-cell shape and proves:
 *   1. ranking the candidates by `failClosedRankKey` picks claude (2 fail-closed),
 *      NOT merge (higher mean) — the fix;
 *   2. gating the fail-closed winner reports the GAIN ('accepted'), while gating
 *      the old mean-winner reports 'rejected-no-gain' — the inversion, and the
 *      cure.
 * Pure over cells: no lib runtime, no docker, no tokens.
 */

import { describe, expect, it } from 'vitest'
import {
  cellsFromCampaign,
  compareRankKeys,
  failClosedRankKey,
  gateEvidenceFromCells,
  resolvedInstanceCount,
  replicateRunsFromCells,
  type EvidenceCell,
  type R4Artifact,
} from './cell-evidence.mts'

const IIDS = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6']
const REPS = 2

/** `T`/`F`/`-` per rep0/rep1; `-` still emits a cell scored resolved:false so
 *  coverage stays complete (a missing cell would read as coverage-incomplete). */
type RepPair = [boolean, boolean]

function arm(iid: string, resolved: boolean, wallS: number): R4Artifact {
  return {
    kind: 'swe-arm',
    iid,
    commit: 'deadbeef',
    resolved,
    verifyPass: resolved,
    patchLines: 10,
    wallS,
    spentTokens: 1000,
    spentUsd: 0.01,
    recoveredTokens: 1500,
    workerTokIn: 400,
    workerTokOut: 100,
    judgeAttempts: 1,
    judgeWallS: 30,
    runDir: `/tmp/none/${iid}`,
    patchPath: `/tmp/none/${iid}.patch`,
  }
}

/** A full 6×2 candidate cell set from a per-instance resolve map (default FF). */
function candidateCells(resolve: Record<string, RepPair>, wallS = 100): EvidenceCell[] {
  const cells: EvidenceCell[] = []
  for (const iid of IIDS) {
    const pair = resolve[iid] ?? [false, false]
    for (let rep = 0; rep < REPS; rep++) {
      cells.push({
        scenarioId: iid,
        rep,
        artifact: arm(iid, pair[rep] ?? false, wallS),
        costUsd: 0.01,
        tokenUsage: { input: 400, output: 100 },
      })
    }
  }
  return cells
}

// gen-4 per-cell shape (rep0/rep1 per instance):
//   baseline: i6 TT                                → fail-closed 1, mean 2/12
//   claude  : i1 TT, i2 TT, i3 TF                  → fail-closed 2, mean 5/12
//   merge   : i1 TT, i2 TF, i3 FT, i4 TF, i5 FT    → fail-closed 1, mean 6/12
const baselineCells = candidateCells({ i6: [true, true] })
const claudeCells = candidateCells({ i1: [true, true], i2: [true, true], i3: [true, false] })
const mergeCells = candidateCells({
  i1: [true, true],
  i2: [true, false],
  i3: [false, true],
  i4: [true, false],
  i5: [false, true],
})
//   glm     : i1 TT                               → fail-closed 1, mean 2/12
const glmCells = candidateCells({ i1: [true, true] })

function resolvedCellCount(cells: EvidenceCell[]): number {
  return replicateRunsFromCells(cells).filter((r) => r.resolved === true).length
}

describe('winner-selection ↔ ship-gate consistency (gen-4 regression)', () => {
  it('the per-cell MEAN ranks merge above claude — the historical inversion', () => {
    // merge resolves 6 of 12 replicate cells, claude only 5 — the mean the old
    // selector used promotes merge, the 1-fail-closed candidate.
    expect(resolvedCellCount(mergeCells)).toBe(6)
    expect(resolvedCellCount(claudeCells)).toBe(5)
    expect(resolvedCellCount(mergeCells)).toBeGreaterThan(resolvedCellCount(claudeCells))
  })

  it('re-selection picks claude (2 fail-closed) over merge (1) and glm (1) — outer-loop logic', () => {
    expect(resolvedInstanceCount(replicateRunsFromCells(claudeCells), IIDS, REPS)).toBe(2)
    expect(resolvedInstanceCount(replicateRunsFromCells(mergeCells), IIDS, REPS)).toBe(1)
    expect(resolvedInstanceCount(replicateRunsFromCells(glmCells), IIDS, REPS)).toBe(1)

    // The exact ranking the outer loop applies: sort every coverage-complete
    // candidate by failClosedRankKey descending (compareRankKeys), pick the top.
    const candidates = [
      { name: 'claude', key: failClosedRankKey(claudeCells, IIDS, REPS) },
      { name: 'merge', key: failClosedRankKey(mergeCells, IIDS, REPS) },
      { name: 'glm', key: failClosedRankKey(glmCells, IIDS, REPS) },
    ]
    candidates.sort((a, b) => compareRankKeys(b.key, a.key))
    expect(candidates[0]!.name).toBe('claude')
    // The lib's mean-composite selector would instead pick merge (max mean).
    expect(resolvedCellCount(mergeCells)).toBeGreaterThan(resolvedCellCount(claudeCells))
  })

  it('gating the fail-closed winner reports the GAIN, not rejected-no-gain', () => {
    // The loop, ranking by failClosedRankKey, selects claude. Gate claude vs
    // baseline: 2 > 1 → accepted.
    const winner = gateEvidenceFromCells({
      winnerCells: claudeCells,
      baselineCells,
      violations: [],
      iids: IIDS,
      reps: REPS,
      costGuardRatio: 10,
    })
    expect(winner.candResolved).toBe(2)
    expect(winner.baseResolved).toBe(1)
    expect(winner.coverageComplete).toBe(true)
    expect(winner.verdict).toBe('accepted')
  })

  it('gating the OLD mean-winner (merge) reproduces the discarded-gain bug', () => {
    // What the defect shipped: the mean-selector promoted merge, the gate scored
    // it 1 == baseline 1 → rejected-no-gain, even though claude's real 2 existed.
    const mergeGate = gateEvidenceFromCells({
      winnerCells: mergeCells,
      baselineCells,
      violations: [],
      iids: IIDS,
      reps: REPS,
      costGuardRatio: 10,
    })
    expect(mergeGate.candResolved).toBe(1)
    expect(mergeGate.baseResolved).toBe(1)
    expect(mergeGate.verdict).toBe('rejected-no-gain')
  })

  it('adapts a lib campaign shape through cellsFromCampaign into the same key', () => {
    // The outer loop passes selectionRankKey(campaign) =
    //   failClosedRankKey(cellsFromCampaign(campaign), instances, reps).
    // Prove the campaign→cells adapter preserves the fail-closed count.
    const campaign = {
      cells: claudeCells.map((c) => ({
        scenarioId: c.scenarioId,
        rep: c.rep,
        artifact: c.artifact,
        costUsd: c.costUsd ?? 0,
        tokenUsage: c.tokenUsage ?? { input: 0, output: 0 },
        cached: false,
      })),
    }
    const key = failClosedRankKey(cellsFromCampaign(campaign), IIDS, REPS)
    expect(key[0]).toBe(2)
  })
})
