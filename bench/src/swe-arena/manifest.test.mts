/**
 * Rollout-manifest reader: a synthetic round outDir with the lib's files
 * (loop-provenance.json, cost-ledger.jsonl, per-cell caches) and the
 * swe-arena files (arm result/judge json, patches, shot receipts) joins into
 * one versioned manifest. Pure reads — nothing is dispatched.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { R4Artifact } from './cell-evidence.mts'
import { buildRolloutManifest, loadLedgerReceipts, ROLLOUT_SCHEMA, writeRolloutManifest } from './manifest.mts'

const IID = 'django__django-11532'

describe('rollout manifest (synthetic outDir)', () => {
  let outDir: string
  let armRunDir: string
  let candDir: string

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  async function writeCell(campaignDir: string, rep: number, artifact: R4Artifact, costUsd: number): Promise<void> {
    const cellDir = join(campaignDir, `cell-${IID}-r${rep}`)
    await mkdir(cellDir, { recursive: true })
    await writeFile(
      join(cellDir, 'cached-result.json'),
      JSON.stringify({
        cellId: `cell-${IID}-r${rep}`,
        scenarioId: IID,
        rep,
        artifact,
        costUsd,
        tokenUsage: { input: 400, output: 100 },
        judgeScores: {},
        durationMs: 5,
        seed: 42,
        cached: false,
      }),
    )
  }

  async function makeOutDir(): Promise<void> {
    outDir = await mkdtemp(join(tmpdir(), 'r4-manifest-'))
    const improveRun = join(outDir, 'improve-run')

    // Arm run dir the artifacts point at (ours: result.json + judge.json).
    armRunDir = join(outDir, 'arm-runs', 'cafebabe00', 'rep-0', 'runs', IID, 'R4')
    await mkdir(armRunDir, { recursive: true })
    await writeFile(join(armRunDir, 'result.json'), JSON.stringify({ arm: 'R4', iid: IID }))
    await writeFile(join(armRunDir, 'judge.json'), JSON.stringify({ iid: IID, resolved: true, wallS: 31 }))
    const patchPath = join(outDir, 'patches', `${IID}.r4.patch`)
    await mkdir(join(outDir, 'patches'), { recursive: true })
    await writeFile(patchPath, 'diff --git a b\n')

    const artifact = (resolved: boolean): R4Artifact => ({
      kind: 'swe-arm',
      iid: IID,
      commit: 'cafebabe0012345678',
      resolved,
      verifyPass: resolved,
      patchLines: 4,
      wallS: 120,
      spentTokens: 2000,
      spentUsd: 0.02,
      recoveredTokens: 2500,
      workerTokIn: 400,
      workerTokOut: 100,
      judgeAttempts: 1,
      judgeWallS: 31,
      runDir: armRunDir,
      patchPath,
    })

    // Lib: baseline campaign cells (different commit).
    const baselineDir = join(improveRun, 'baseline')
    await writeCell(baselineDir, 0, { ...artifact(true), commit: 'basecommit12345678' }, 0.01)
    await writeCell(baselineDir, 1, { ...artifact(true), commit: 'basecommit12345678' }, 0.01)

    // Lib: gen-0 candidate campaign cells.
    candDir = join(improveRun, 'gen-0', 'candidate-0')
    await writeCell(candDir, 0, artifact(false), 0.02)
    await writeCell(candDir, 1, artifact(false), 0.02)

    // Lib: durable provenance + cost log.
    await writeFile(
      join(improveRun, 'loop-provenance.json'),
      JSON.stringify({ schema: 'tangle.loop-provenance', runId: 'r4-test', candidates: [] }),
    )
    await writeFile(
      join(improveRun, 'cost-ledger.jsonl'),
      [
        JSON.stringify({ version: 1, record: { status: 'pending', callId: 'p1', channel: 'agent', phase: 'x', actor: 'a', model: 'm', timestamp: 1 } }),
        JSON.stringify({ version: 1, record: { status: 'settled', callId: 'c1', channel: 'agent', phase: 'search.candidate', actor: 'a', model: 'm', timestamp: 2, inputTokens: 400, outputTokens: 100, costUsd: 0.02, costUnknown: false, tags: { runDir: candDir, cellId: `cell-${IID}-r0` } } }),
        JSON.stringify({ version: 1, record: { status: 'settled', callId: 'c2', channel: 'judge', phase: 'search.candidate', actor: 'j', model: 'swe-bench-official-judge', timestamp: 3, inputTokens: 0, outputTokens: 0, costUsd: 0, costUnknown: false, tags: { runDir: candDir, cellId: `cell-${IID}-r1` } } }),
        'garbage line',
      ].join('\n'),
    )

    // Ours: candidate diff + proposer shot receipt.
    await mkdir(join(outDir, 'candidates'), { recursive: true })
    await writeFile(join(outDir, 'candidates', 'cafebabe00.patch'), 'diff --git x y\n')
    await mkdir(join(outDir, 'proposer-shots'), { recursive: true })
    await writeFile(join(outDir, 'proposer-shots', 'gen0-cand0-shot1.json'), JSON.stringify({ receipt: { shot: 1 } }))
  }

  it('joins lib + swe-arena files into versioned per-generation rollout triples', async () => {
    await makeOutDir()
    const manifest = await buildRolloutManifest(outDir)

    expect(manifest.schema).toBe(ROLLOUT_SCHEMA)
    expect(manifest.instances).toEqual([IID])
    expect((manifest.provenance as { schema: string }).schema).toBe('tangle.loop-provenance')
    expect(manifest.generations.map((g) => g.generation)).toEqual([-1, 0])

    const baseline = manifest.generations[0]!.rollouts[0]!
    expect(baseline.state).toMatchObject({ generation: -1, candidateIndex: -1, commit: 'basecommit12345678' })
    expect(baseline.outcome.resolvedCount).toBe(1)
    expect(baseline.outcome.perInstance).toHaveLength(2)
    expect(baseline.action.shotReceiptPaths).toEqual([])

    const cand = manifest.generations[1]!.rollouts[0]!
    expect(cand.state).toMatchObject({ generation: 0, candidateIndex: 0, commit: 'cafebabe0012345678', campaignDir: candDir })
    expect(cand.outcome.resolvedCount).toBe(0)
    expect(cand.outcome.cellsCached).toBe(2)
    // Cost joins: cell ledger spend + artifact spend-tree + judge wall.
    expect(cand.cost.cellCostUsd).toBeCloseTo(0.04, 6)
    expect(cand.cost.cellTokensIn).toBe(800)
    expect(cand.cost.armSpentUsd).toBeCloseTo(0.04, 6)
    expect(cand.cost.armSpentTokens).toBe(4000)
    expect(cand.cost.wallS).toBe(240)
    expect(cand.cost.judgeWallS).toBe(62)
    expect(cand.cost.receiptCallIds).toEqual(['c1', 'c2'])
    // Artifact joins: our arm/judge/patch files + the shot receipt.
    expect(cand.artifactPaths.armResults).toEqual([join(armRunDir, 'result.json')])
    expect(cand.artifactPaths.judgeVerdicts).toEqual([join(armRunDir, 'judge.json')])
    expect(cand.artifactPaths.patches).toHaveLength(1)
    expect(cand.action.diffPath).toBe(join(outDir, 'candidates', 'cafebabe00.patch'))
    expect(cand.action.shotReceiptPaths).toEqual([join(outDir, 'proposer-shots', 'gen0-cand0-shot1.json')])
  })

  it('loadLedgerReceipts keeps settled records only and survives garbage lines', async () => {
    const receipts = await loadLedgerReceipts(join(outDir, 'improve-run'))
    expect(receipts.map((r) => r.callId)).toEqual(['c1', 'c2'])
  })

  it('writeRolloutManifest emits <outDir>/rollout-manifest.json (the CLI body)', async () => {
    const path = await writeRolloutManifest(outDir)
    expect(path).toBe(join(outDir, 'rollout-manifest.json'))
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { schema: string }
    expect(parsed.schema).toBe(ROLLOUT_SCHEMA)
  })

  it('a bare outDir (no improve-run yet) yields an empty, well-formed manifest', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'r4-manifest-empty-'))
    try {
      const manifest = await buildRolloutManifest(empty)
      expect(manifest.schema).toBe(ROLLOUT_SCHEMA)
      expect(manifest.provenance).toBeNull()
      expect(manifest.instances).toEqual([])
      expect(manifest.generations).toEqual([])
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})
