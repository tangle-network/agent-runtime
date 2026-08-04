import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { campaignSplitDigest, assertCampaignSplitIdentity, type Scenario } from '@tangle-network/agent-eval/campaign'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cellsFromCampaign, replicateRunsFromCells, resolvedInstanceCount } from './cell-evidence.mts'
import type { R4Artifact } from './cell-evidence.mts'
import {
  buildPremeasuredFromCells,
  incumbentSurfaceHash,
  loadFullCampaignCells,
  type FullCell,
} from './premeasured-from-cells.mts'
import { runOk } from './proc.ts'

const artifact = (iid: string, resolved: boolean): R4Artifact => ({
  kind: 'swe-arm',
  iid,
  commit: 'c0ffee',
  resolved,
  verifyPass: resolved,
  patchLines: 3,
  wallS: 100,
  spentTokens: 10,
  spentUsd: 0.01,
  recoveredTokens: 20,
  workerTokIn: 5,
  workerTokOut: 5,
  judgeAttempts: 1,
  judgeWallS: 9,
  runDir: '/runs/x',
  patchPath: '/patches/x.patch',
})

// Per-cell seeds mirror run-campaign's derivation: base 42 + groupIndex*reps + rep.
const derivedSeed = (iid: string, rep: number): number => 42 + (iid === 'inst-a' ? 0 : 2) + rep

const cell = (iid: string, rep: number, resolved: boolean, over: Partial<FullCell> = {}): FullCell => ({
  manifestHash: 'm1',
  cellId: `${iid}:${rep}`,
  scenarioId: iid,
  rep,
  artifact: artifact(iid, resolved),
  judgeScores: {
    'swe-arena-official-judge': {
      composite: resolved ? 1 : 0,
      dimensions: { resolved: resolved ? 1 : 0 },
      notes: `official judge: ${iid} resolved=${resolved}`,
    },
  },
  costUsd: 0.05,
  costProvenance: { kind: 'observed', usd: 0.05 },
  costCallIds: [`call-${iid}-${rep}`],
  tokenUsage: { input: 100, output: 50 },
  resolvedModel: 'zai-coding-plan/glm-5.2',
  durationMs: 60_000,
  seed: derivedSeed(iid, rep),
  cached: false,
  mtimeMs: 1_000_000 + rep * 1000,
  ...over,
})

const INSTANCES = ['inst-a', 'inst-b']

describe('buildPremeasuredFromCells', () => {
  const cells = [cell('inst-a', 0, false), cell('inst-a', 1, true), cell('inst-b', 0, true), cell('inst-b', 1, true)]

  it('assembles a campaign whose split identity passes the lib validation checks', () => {
    const out = buildPremeasuredFromCells({
      cells,
      instances: INSTANCES,
      reps: 2,
      surfaceHash: 'abc123',
      sourceDir: '/prior/baseline',
    })
    expect(out.surfaceHash).toBe('abc123')
    const scenarios: Scenario[] = INSTANCES.map((id) => ({ id, kind: 'swe-instance' }))
    // The exact checks validatedPremeasuredBaseline runs (minus surface):
    expect(out.campaign.reps).toBe(2)
    expect(out.campaign.seed).toBe(42)
    expect(out.campaign.splitDigest).toBe(campaignSplitDigest(scenarios, 2))
    expect(() => assertCampaignSplitIdentity(out.campaign.scenarios, 2, out.campaign.splitDigest)).not.toThrow()
    // Cells replay verbatim into the harness scoring (AND rule: a=F, b=T → 1/2).
    const evidence = cellsFromCampaign(out.campaign)
    expect(resolvedInstanceCount(replicateRunsFromCells(evidence), INSTANCES, 2)).toBe(1)
    expect(out.campaign.cells.every((c) => c.cached)).toBe(true)
    expect(out.campaign.cells.every((c) => !('mtimeMs' in c))).toBe(true)
    // Honest spend rollup from the real cells.
    expect(out.campaign.aggregates.cost.totalCostUsd).toBeCloseTo(0.2)
    expect(out.campaign.aggregates.cost.costProvenance).toEqual({
      kind: 'observed',
      usd: 0.2,
    })
    expect(out.campaign.aggregates.cost.inputTokens).toBe(400)
    expect(out.campaign.runDir).toBe('/prior/baseline')
    // Window reconstructed from mtimes: ends at the last cell write.
    expect(out.campaign.endedAt).toBe(new Date(1_001_000).toISOString())
  })

  it('fails loud on a missing replicate, an extra cell, or a design mismatch', () => {
    expect(() =>
      buildPremeasuredFromCells({
        cells: cells.slice(0, 3),
        instances: INSTANCES,
        reps: 2,
        surfaceHash: 'x',
        sourceDir: '/p',
      }),
    ).toThrow(/expected exactly 1 cell for inst-b rep 1/)
    expect(() =>
      buildPremeasuredFromCells({
        cells: [...cells, cell('inst-c', 0, true)],
        instances: INSTANCES,
        reps: 2,
        surfaceHash: 'x',
        sourceDir: '/p',
      }),
    ).toThrow(/outside the 2x2 design/)
  })

  it('fails loud on broken seed derivation or manifest drift, an errored cell, or a missing artifact', () => {
    const seedDrift = [cell('inst-a', 0, false, { seed: 7 }), cell('inst-a', 1, true), cell('inst-b', 0, true), cell('inst-b', 1, true)]
    expect(() =>
      buildPremeasuredFromCells({ cells: seedDrift, instances: INSTANCES, reps: 2, surfaceHash: 'x', sourceDir: '/p' }),
    ).toThrow(/contiguous derived range/)
    const manifestDrift = [cell('inst-a', 0, false, { manifestHash: 'OTHER' }), cell('inst-a', 1, true), cell('inst-b', 0, true), cell('inst-b', 1, true)]
    expect(() =>
      buildPremeasuredFromCells({ cells: manifestDrift, instances: INSTANCES, reps: 2, surfaceHash: 'x', sourceDir: '/p' }),
    ).toThrow(/non-uniform manifestHash/)
    const errored = [cell('inst-a', 0, false, { error: 'boom' }), cell('inst-a', 1, true), cell('inst-b', 0, true), cell('inst-b', 1, true)]
    expect(() =>
      buildPremeasuredFromCells({ cells: errored, instances: INSTANCES, reps: 2, surfaceHash: 'x', sourceDir: '/p' }),
    ).toThrow(/carries an error/)
    const uncapturedCost = [
      cell('inst-a', 0, false, { costProvenance: { kind: 'uncaptured', usd: null } }),
      cell('inst-a', 1, true),
      cell('inst-b', 0, true),
      cell('inst-b', 1, true),
    ]
    expect(() =>
      buildPremeasuredFromCells({
        cells: uncapturedCost,
        instances: INSTANCES,
        reps: 2,
        surfaceHash: 'x',
        sourceDir: '/p',
      }),
    ).toThrow(/has uncaptured cost/)
  })
})

describe('loadFullCampaignCells + incumbentSurfaceHash (real fs/git)', () => {
  let dir: string
  let repo: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'premeasured-'))
    repo = await mkdtemp(join(tmpdir(), 'premeasured-repo-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  })

  it('round-trips full cells (costCallIds and manifest preserved) from disk', async () => {
    const c = cell('inst-a', 0, true)
    await mkdir(join(dir, 'inst-a_0'), { recursive: true })
    const { mtimeMs: _m, ...persisted } = c
    await writeFile(join(dir, 'inst-a_0', 'cached-result.json'), JSON.stringify(persisted))
    const loaded = await loadFullCampaignCells(dir)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      scenarioId: 'inst-a',
      rep: 0,
      manifestHash: 'm1',
      costCallIds: ['call-inst-a-0'],
      seed: 42,
    })
    expect(typeof loaded[0]!.mtimeMs).toBe('number')
  })

  it('computes the same incumbent hash for the unchanged tip (baseCommit == candidateCommit, empty patch)', async () => {
    await runOk('git', ['init', '-q', '-b', 'main', repo])
    await runOk('git', ['-C', repo, 'config', 'user.email', 't@t.dev'])
    await runOk('git', ['-C', repo, 'config', 'user.name', 'T'])
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await runOk('git', ['-C', repo, 'add', '-A'])
    await runOk('git', ['-C', repo, 'commit', '-q', '-m', 'init'])
    const h1 = await incumbentSurfaceHash(repo, 'main')
    const h2 = await incumbentSurfaceHash(repo, 'main')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{16}$/)
    // A moved tip changes the hash — the fail-loud property the artifact rides.
    await writeFile(join(repo, 'a.txt'), 'y\n')
    await runOk('git', ['-C', repo, 'add', '-A'])
    await runOk('git', ['-C', repo, 'commit', '-q', '-m', 'move'])
    expect(await incumbentSurfaceHash(repo, 'main')).not.toBe(h1)
  })
})
