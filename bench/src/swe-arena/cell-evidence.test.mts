/**
 * Cell-derived scoring: reps-AND aggregation as a pure function over lib
 * campaign cells, and the disk readers over the lib's cached-result.json
 * caches — including a reproduction of the r4-mroh3rkt resume shape (baseline
 * cells replayed from cache, only a candidate dispatched in-process) proving
 * attribution comes from the campaign directory + artifact commit, never from
 * dispatch order. No arms, no docker, no tokens.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  cellsFromCampaign,
  gateEvidenceFromCells,
  loadCampaignCells,
  loadCandidateCellGroups,
  perInstanceFromCells,
  replicateRunsFromCells,
  resolvedInstanceCount,
  sumWallSFromCells,
  type EvidenceCell,
  type R4Artifact,
} from './cell-evidence.mts'

const IIDS = ['astropy__astropy-13033', 'django__django-11532', 'matplotlib__matplotlib-20826']

function sweArtifact(iid: string, commit: string, resolved: boolean, wallS = 100): R4Artifact {
  return {
    kind: 'swe-arm',
    iid,
    commit,
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

function cell(iid: string, rep: number, artifact: R4Artifact | null, error?: string): EvidenceCell {
  return {
    scenarioId: iid,
    rep,
    artifact,
    ...(error ? { error } : {}),
    costUsd: 0.01,
    tokenUsage: { input: 400, output: 100 },
  }
}

describe('cell adapters', () => {
  it('cellsFromCampaign keeps errored cells with a null artifact', () => {
    const cells = cellsFromCampaign({
      cells: [
        { scenarioId: 'a', rep: 0, artifact: sweArtifact('a', 'c1', true), costUsd: 0.5, tokenUsage: { input: 1, output: 2 }, cached: false },
        { scenarioId: 'a', rep: 1, artifact: null, error: 'dispatch timeout', costUsd: 0, tokenUsage: { input: 0, output: 0 }, cached: false },
      ],
    })
    expect(cells).toHaveLength(2)
    expect(cells[0]!.artifact?.kind).toBe('swe-arm')
    expect(cells[1]!.artifact).toBeNull()
    expect(cells[1]!.error).toMatch(/timeout/)
  })

  it('replicateRunsFromCells: error/artifact-less cells are inconclusive, never a boolean', () => {
    const runs = replicateRunsFromCells([
      cell('a', 0, sweArtifact('a', 'c1', true)),
      cell('a', 1, sweArtifact('a', 'c1', false), 'judge inconclusive'),
      cell('b', 0, null, 'change-space violation'),
    ])
    expect(runs).toEqual([
      { iid: 'a', resolved: true },
      { iid: 'a', resolved: null },
      { iid: 'b', resolved: null },
    ])
  })

  it('perInstanceFromCells maps artifact fields, carries cell cost, skips the static cell', () => {
    const staticArt: R4Artifact = { kind: 'static-gate', commit: 'c1', changedFiles: [], violations: [], typecheckOk: true }
    const rows = perInstanceFromCells([
      cell('a', 0, sweArtifact('a', 'c1', true, 250)),
      cell('static:loops-gates', 0, staticArt),
      cell('b', 1, null, 'boom'),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ iid: 'a', rep: 0, resolved: true, wall_s: 250, costUsd: 0.01, judgeAttempts: 1 })
    expect(rows[1]).toMatchObject({ iid: 'b', rep: 1, resolved: null, wall_s: null, error: 'boom' })
  })

  it('sumWallSFromCells sums swe wall only', () => {
    expect(
      sumWallSFromCells([
        cell('a', 0, sweArtifact('a', 'c1', true, 100)),
        cell('a', 1, sweArtifact('a', 'c1', true, 40)),
        cell('b', 0, null, 'err'),
      ]),
    ).toBe(140)
  })
})

describe('disk readers + the r4-mroh3rkt resume shape', () => {
  const roots: string[] = []
  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true })
  })

  async function writeCachedCell(campaignDir: string, c: EvidenceCell): Promise<void> {
    const cellDir = join(campaignDir, `cell-${c.scenarioId.replace(/[^a-zA-Z0-9_-]/g, '_')}-r${c.rep}`)
    await mkdir(cellDir, { recursive: true })
    await writeFile(
      join(cellDir, 'cached-result.json'),
      JSON.stringify({
        cellId: `cell-${c.scenarioId}-r${c.rep}`,
        scenarioId: c.scenarioId,
        rep: c.rep,
        artifact: c.artifact,
        ...(c.error ? { error: c.error } : {}),
        costUsd: c.costUsd ?? 0,
        tokenUsage: c.tokenUsage ?? { input: 0, output: 0 },
        judgeScores: {},
        durationMs: 1,
        seed: 42,
        cached: false,
      }),
    )
  }

  /** The exact resume shape behind r4-mroh3rkt: the BASELINE campaign exists
   *  only as cached cells on disk (measured 1/3 — matplotlib both reps), while
   *  the process only ever dispatched candidate b08d31c910 (0/3). */
  async function makeResumedRunDir(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'r4-cells-'))
    roots.push(root)
    const improveRun = join(root, 'improve-run')
    const baselineDir = join(improveRun, 'baseline')
    for (const iid of IIDS) {
      const resolved = iid.startsWith('matplotlib')
      for (const rep of [0, 1]) {
        await writeCachedCell(baselineDir, cell(iid, rep, sweArtifact(iid, 'basecommit0', resolved, 100)))
      }
    }
    const candDir = join(improveRun, 'gen-0', 'candidate-0')
    for (const iid of IIDS) {
      for (const rep of [0, 1]) {
        await writeCachedCell(candDir, cell(iid, rep, sweArtifact(iid, 'b08d31c910', false, 110)))
      }
    }
    return improveRun
  }

  it('loadCampaignCells reads every cached cell; a missing dir is empty', async () => {
    const improveRun = await makeResumedRunDir()
    const cells = await loadCampaignCells(join(improveRun, 'baseline'))
    expect(cells).toHaveLength(6)
    expect(cells.every((c) => c.cached)).toBe(true)
    expect(await loadCampaignCells(join(improveRun, 'no-such-campaign'))).toEqual([])
  })

  it('candidate groups attribute by directory + commit — baseline cells never leak in', async () => {
    const improveRun = await makeResumedRunDir()
    const groups = await loadCandidateCellGroups(improveRun)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ generation: 0, candidateIndex: 0, commit: 'b08d31c910' })
    expect(groups[0]!.cells).toHaveLength(6)
    expect(groups[0]!.cells.every((c) => c.artifact?.commit === 'b08d31c910')).toBe(true)
  })

  it('r4-mroh3rkt regression: the resumed run grades winner 0/3 vs baseline 1/3, not 0/3 vs 0/3', async () => {
    const improveRun = await makeResumedRunDir()
    const groups = await loadCandidateCellGroups(improveRun)
    const winner = groups.find((g) => g.commit === 'b08d31c910')!
    const baselineCells = await loadCampaignCells(join(improveRun, 'baseline'))

    // With the pin (the shipping config): denominator is the pin, drift quiet.
    const pin = {
      'astropy__astropy-13033': false,
      'django__django-11532': false,
      'matplotlib__matplotlib-20826': true,
    }
    const pinned = gateEvidenceFromCells({
      winnerCells: winner.cells,
      baselineCells,
      staticViolations: [],
      pin,
      iids: IIDS,
      reps: 2,
      costGuardRatio: 1.2,
    })
    expect(pinned.candResolved).toBe(0)
    expect(pinned.baseResolved).toBe(1) // the bug published 0/3 here
    expect(pinned.baseFromPin).toBe(true)
    expect(pinned.driftWarnings).toEqual([])
    expect(pinned.verdict).toBe('rejected-no-gain')
    expect(pinned.coverageComplete).toBe(true)
    expect(pinned.costRatio).toBeCloseTo(660 / 600, 5)

    // WITHOUT the pin the measured baseline cells still carry the truth —
    // the candidate's cells can never masquerade as the baseline.
    const unpinned = gateEvidenceFromCells({
      winnerCells: winner.cells,
      baselineCells,
      staticViolations: [],
      pin: undefined,
      iids: IIDS,
      reps: 2,
      costGuardRatio: 1.2,
    })
    expect(unpinned.baseResolved).toBe(1)
    expect(unpinned.baseFromPin).toBe(false)
    expect(unpinned.verdict).toBe('rejected-no-gain')
  })

  it('a contradicting cached baseline raises drift warnings and the pin still rules', async () => {
    const improveRun = await makeResumedRunDir()
    const baselineCells = await loadCampaignCells(join(improveRun, 'baseline'))
    const pin = {
      'astropy__astropy-13033': true, // contradicts measured F/F
      'django__django-11532': false,
      'matplotlib__matplotlib-20826': true,
    }
    const ev = gateEvidenceFromCells({
      winnerCells: baselineCells,
      baselineCells,
      staticViolations: [],
      pin,
      iids: IIDS,
      reps: 2,
      costGuardRatio: 1.2,
    })
    expect(ev.baseResolved).toBe(2) // pin says 2/3 — the denominator stays pinned
    expect(ev.driftWarnings).toHaveLength(1)
    expect(ev.driftWarnings[0]).toContain('astropy__astropy-13033: pinned=true')
  })

  it('a missing replicate keeps the candidate coverage-incomplete (errored cells are never cached)', async () => {
    const improveRun = await makeResumedRunDir()
    const partialDir = join(improveRun, 'gen-0', 'candidate-1')
    await writeCachedCell(partialDir, cell(IIDS[0]!, 0, sweArtifact(IIDS[0]!, 'deadbeef01', true)))
    const groups = await loadCandidateCellGroups(improveRun)
    const partial = groups.find((g) => g.commit === 'deadbeef01')!
    const ev = gateEvidenceFromCells({
      winnerCells: partial.cells,
      baselineCells: await loadCampaignCells(join(improveRun, 'baseline')),
      staticViolations: [],
      pin: undefined,
      iids: IIDS,
      reps: 2,
      costGuardRatio: 1.2,
    })
    expect(ev.coverageComplete).toBe(false)
    expect(ev.verdict).toBe('rejected-incomplete')
    expect(resolvedInstanceCount(replicateRunsFromCells(partial.cells), IIDS, 2)).toBe(0)
  })

  it('a candidate dir mixing two commits fails loud', async () => {
    const improveRun = await makeResumedRunDir()
    const dir = join(improveRun, 'gen-1', 'candidate-0')
    await writeCachedCell(dir, cell(IIDS[0]!, 0, sweArtifact(IIDS[0]!, 'commitaaaa1', true)))
    await writeCachedCell(dir, cell(IIDS[1]!, 0, sweArtifact(IIDS[1]!, 'commitbbbb2', true)))
    await expect(loadCandidateCellGroups(improveRun)).rejects.toThrow(/mixes commits/)
  })
})
